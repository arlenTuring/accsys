import { eq, sql } from 'drizzle-orm';
import { writeNew, readNoFollow } from '@/lib/attachments/storage';
import { getDb } from '@/lib/db';
import {
  assetFieldDefinitions,
  assetFieldPurgeJobs,
  assetInventoryLines,
  assets,
} from '@/lib/db/schema';

export const PURGE_BACKUP_KIND = 'accsys.asset_field_purge_backup.v1' as const;

export type FieldPurgeBackupDocument = {
  kind: typeof PURGE_BACKUP_KIND;
  exportedAt: string;
  field: Record<string, unknown>;
  assetValues: Array<{ assetId: string; tag: string; value: unknown }>;
  inventoryValues: Array<{
    lineId: string;
    batchId: string;
    assetTag: string;
    value: unknown;
  }>;
  /** Filled when purge finished; restore tooling uses this to recognize completed deletes. */
  purge?: {
    jobId: string;
    completedAt: string;
    assetFilledCount: number;
    inventoryFilledCount: number;
  };
};

export function isFieldPurgeBackup(raw: unknown): raw is FieldPurgeBackupDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const doc = raw as Record<string, unknown>;
  return doc.kind === PURGE_BACKUP_KIND && typeof doc.exportedAt === 'string' && !!doc.field;
}

export function recognizePurgeFromBackup(raw: unknown): {
  recognized: boolean;
  fieldId: string | null;
  label: string | null;
  purgeCompleted: boolean;
  jobId: string | null;
  message: string;
} {
  if (!isFieldPurgeBackup(raw)) {
    return {
      recognized: false,
      fieldId: null,
      label: null,
      purgeCompleted: false,
      jobId: null,
      message: '不是 ACCSYS 資產欄位永久刪除備份檔',
    };
  }
  const field = raw.field as { id?: unknown; label?: unknown };
  const fieldId = typeof field.id === 'string' ? field.id : null;
  const label = typeof field.label === 'string' ? field.label : null;
  const purgeCompleted = !!raw.purge?.completedAt;
  return {
    recognized: true,
    fieldId,
    label,
    purgeCompleted,
    jobId: raw.purge?.jobId ?? null,
    message: purgeCompleted
      ? `已辨識永久刪除備份「${label ?? fieldId}」（job ${raw.purge?.jobId}）；還原 DB 後此欄位值應視為已刪除，勿默默寫回。`
      : `已辨識刪除前備份「${label ?? fieldId}」，尚未標記 purge 完成。`,
  };
}

export async function buildFieldPurgeBackup(fieldId: string): Promise<FieldPurgeBackupDocument | null> {
  const db = getDb();
  const [field] = await db.select().from(assetFieldDefinitions).where(eq(assetFieldDefinitions.id, fieldId)).limit(1);
  if (!field || field.status === 'deleted') return null;

  const assetRows = await db
    .select({ id: assets.id, tag: assets.tag, extraValues: assets.extraValues })
    .from(assets)
    .where(sql`${assets.extraValues} ? ${fieldId}::text`);

  const invRows = await db
    .select({
      id: assetInventoryLines.id,
      batchId: assetInventoryLines.batchId,
      assetTag: assetInventoryLines.assetTag,
      answers: assetInventoryLines.answers,
    })
    .from(assetInventoryLines)
    .where(sql`${assetInventoryLines.answers} ? ${fieldId}::text`);

  return {
    kind: PURGE_BACKUP_KIND,
    exportedAt: new Date().toISOString(),
    field: { ...field },
    assetValues: assetRows.map((r) => ({
      assetId: r.id,
      tag: r.tag,
      value: r.extraValues?.[fieldId],
    })),
    inventoryValues: invRows.map((r) => ({
      lineId: r.id,
      batchId: r.batchId,
      assetTag: r.assetTag,
      value: r.answers?.[fieldId],
    })),
  };
}

export async function writeFieldPurgeBackupFile(input: {
  jobId: string;
  doc: FieldPurgeBackupDocument;
}): Promise<string> {
  const key = `asset-field-purge/${input.jobId}.json`;
  const bytes = new TextEncoder().encode(`${JSON.stringify(input.doc, null, 2)}\n`);
  await writeNew(key, bytes);
  return key;
}

export async function markPurgeBackupCompleted(input: {
  backupPath: string;
  jobId: string;
  assetFilledCount: number;
  inventoryFilledCount: number;
}): Promise<void> {
  const bytes = await readNoFollow(input.backupPath);
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  if (!isFieldPurgeBackup(parsed)) return;
  const next: FieldPurgeBackupDocument = {
    ...parsed,
    purge: {
      jobId: input.jobId,
      completedAt: new Date().toISOString(),
      assetFilledCount: input.assetFilledCount,
      inventoryFilledCount: input.inventoryFilledCount,
    },
  };
  // Overwrite by remove+write: storage writeNew refuses existing keys.
  const { removeKey } = await import('@/lib/attachments/storage');
  await removeKey(input.backupPath);
  await writeNew(input.backupPath, new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`));
}

export async function readFieldPurgeBackup(backupPath: string): Promise<FieldPurgeBackupDocument | null> {
  try {
    const bytes = await readNoFollow(backupPath);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    return isFieldPurgeBackup(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function getPurgeJobBackupPath(jobId: string): Promise<string | null> {
  const [job] = await getDb()
    .select({ backupPath: assetFieldPurgeJobs.backupPath })
    .from(assetFieldPurgeJobs)
    .where(eq(assetFieldPurgeJobs.id, jobId))
    .limit(1);
  return job?.backupPath ?? null;
}
