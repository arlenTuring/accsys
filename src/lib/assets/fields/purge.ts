import { and, eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import {
  assetFieldDefinitions,
  assetFieldPurgeJobs,
  assetInventoryLines,
  assets,
} from '@/lib/db/schema';
import {
  buildFieldPurgeBackup,
  markPurgeBackupCompleted,
  writeFieldPurgeBackupFile,
} from './purge-backup';
import { countFilledAssetValues } from './service';
import type { PurgeImpact } from './types';

export type { PurgeImpact };

export async function previewFieldPurge(fieldId: string): Promise<PurgeImpact | null> {
  const db = getDb();
  const [field] = await db.select().from(assetFieldDefinitions).where(eq(assetFieldDefinitions.id, fieldId)).limit(1);
  if (!field || field.status === 'deleted') return null;

  const assetFilledCount = await countFilledAssetValues(fieldId);

  const invRows = await db.select({ answers: assetInventoryLines.answers }).from(assetInventoryLines);
  let inventoryFilledCount = 0;
  for (const row of invRows) {
    const v = row.answers?.[fieldId];
    if (v !== undefined && v !== null && v !== '') inventoryFilledCount += 1;
  }

  const dependencies: string[] = [];
  if (field.systemBinding) {
    dependencies.push(`系統核心對應「${field.systemBinding}」：不可永久刪除，請改為隱藏。`);
  }

  return {
    fieldId: field.id,
    label: field.label,
    fieldType: field.fieldType,
    version: field.version,
    status: field.status,
    systemBinding: field.systemBinding,
    assetFilledCount,
    inventoryFilledCount,
    dependencies,
    willDelete: [
      '欄位定義（標記為已刪除，日常介面不可見）',
      `資產主檔 extra_values 中此欄位鍵（約 ${assetFilledCount} 筆有值）`,
      `盤點明細 answers 中此欄位鍵（約 ${inventoryFilledCount} 筆有值）`,
    ],
    willNotDelete: [
      '既有核准 PDF／簽核快照不會被改寫',
      '稽核紀錄只保留刪除操作摘要，不複製全部被刪欄位值',
      '已下載到本機的匯出檔無法由系統銷毀',
      '資料庫備份還原後可能仍含舊值；還原程序須辨識已完成的刪除操作',
    ],
  };
}

/**
 * Queue + run purge. For v1 we process synchronously in chunks but report via job row
 * so retries are idempotent on idempotencyKey.
 */
export async function purgeAssetField(input: {
  actorId: string;
  fieldId: string;
  expectedVersion: number;
  confirmLabel: string;
  idempotencyKey: string;
}): Promise<
  { ok: true; jobId: string; impact: PurgeImpact; backupPath: string } | { ok: false; error: string }
> {
  const impact = await previewFieldPurge(input.fieldId);
  if (!impact) return { ok: false, error: '找不到欄位' };
  if (impact.systemBinding) {
    return { ok: false, error: '系統必要欄位不能永久刪除，請改為隱藏。' };
  }
  if (impact.version !== input.expectedVersion) {
    return { ok: false, error: '欄位版本已變更，請重新整理後再刪除。' };
  }
  if (input.confirmLabel.trim() !== impact.label) {
    return { ok: false, error: '確認名稱與欄位顯示名稱不符' };
  }

  const db = getDb();
  const [existingJob] = await db
    .select()
    .from(assetFieldPurgeJobs)
    .where(eq(assetFieldPurgeJobs.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existingJob?.status === 'completed') {
    return { ok: true, jobId: existingJob.id, impact, backupPath: existingJob.backupPath ?? '' };
  }
  if (existingJob && (existingJob.status === 'queued' || existingJob.status === 'running')) {
    return { ok: true, jobId: existingJob.id, impact, backupPath: existingJob.backupPath ?? '' };
  }

  const [job] = existingJob
    ? [existingJob]
    : await db
        .insert(assetFieldPurgeJobs)
        .values({
          fieldDefinitionId: input.fieldId,
          status: 'queued',
          requestedByEmployeeId: input.actorId,
          expectedVersion: input.expectedVersion,
          progress: { phase: 'queued' },
          idempotencyKey: input.idempotencyKey,
        })
        .returning();

  await db
    .update(assetFieldPurgeJobs)
    .set({ status: 'running', startedAt: sql`now()`, progress: { phase: 'backup' } })
    .where(eq(assetFieldPurgeJobs.id, job.id));

  const backupDoc = await buildFieldPurgeBackup(input.fieldId);
  if (!backupDoc) {
    await db
      .update(assetFieldPurgeJobs)
      .set({ status: 'failed', error: 'backup_build_failed', finishedAt: sql`now()` })
      .where(eq(assetFieldPurgeJobs.id, job.id));
    return { ok: false, error: '無法建立刪除前備份' };
  }

  let backupPath = job.backupPath;
  if (!backupPath) {
    try {
      backupPath = await writeFieldPurgeBackupFile({ jobId: job.id, doc: backupDoc });
    } catch (err) {
      await db
        .update(assetFieldPurgeJobs)
        .set({
          status: 'failed',
          error: `backup_write_failed:${(err as Error).message}`.slice(0, 400),
          finishedAt: sql`now()`,
        })
        .where(eq(assetFieldPurgeJobs.id, job.id));
      return { ok: false, error: '刪除前備份寫入失敗，未執行清除' };
    }
    await db
      .update(assetFieldPurgeJobs)
      .set({ backupPath, progress: { phase: 'clearing_values', backupPath } })
      .where(eq(assetFieldPurgeJobs.id, job.id));
  }

  // Stop new writes: mark deleted first (API/editor will refuse).
  const [marked] = await db
    .update(assetFieldDefinitions)
    .set({
      status: 'deleted',
      deletedAt: sql`now()`,
      deletedByEmployeeId: input.actorId,
      deleteJobId: job.id,
      version: sql`${assetFieldDefinitions.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(assetFieldDefinitions.id, input.fieldId),
        eq(assetFieldDefinitions.version, input.expectedVersion)
      )
    )
    .returning();
  if (!marked) {
    await db
      .update(assetFieldPurgeJobs)
      .set({ status: 'failed', error: 'version_conflict', finishedAt: sql`now()` })
      .where(eq(assetFieldPurgeJobs.id, job.id));
    return { ok: false, error: '欄位版本衝突，刪除未執行' };
  }

  // Clear asset extra_values key
  await db.execute(sql`
    update assets
    set extra_values = extra_values - ${input.fieldId}::text,
        updated_at = now()
    where extra_values ? ${input.fieldId}::text
  `);

  // Clear inventory answers key
  await db.execute(sql`
    update asset_inventory_lines
    set answers = answers - ${input.fieldId}::text,
        updated_at = now()
    where answers ? ${input.fieldId}::text
  `);

  try {
    await markPurgeBackupCompleted({
      backupPath,
      jobId: job.id,
      assetFilledCount: impact.assetFilledCount,
      inventoryFilledCount: impact.inventoryFilledCount,
    });
  } catch (err) {
    console.warn('[asset-field-purge] mark backup completed failed:', (err as Error).message);
  }

  await db
    .update(assetFieldPurgeJobs)
    .set({
      status: 'completed',
      finishedAt: sql`now()`,
      backupPath,
      progress: {
        phase: 'completed',
        assetFilledCount: impact.assetFilledCount,
        inventoryFilledCount: impact.inventoryFilledCount,
        backupPath,
      },
    })
    .where(eq(assetFieldPurgeJobs.id, job.id));

  await recordAudit(db, {
    actorEmployeeId: input.actorId,
    action: 'asset_field.purge',
    entityType: 'asset_field_definition',
    entityId: input.fieldId,
    details: {
      label: impact.label,
      assetFilledCount: impact.assetFilledCount,
      inventoryFilledCount: impact.inventoryFilledCount,
      jobId: job.id,
      backupPath,
    },
  });

  return { ok: true, jobId: job.id, impact, backupPath };
}
