import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import { aiChatStagedAttachments, stagedInvoiceConfirmations } from '@/lib/db/schema';
import {
  runInvoiceCheckOnBytes,
  type InvoiceCheckResult,
} from '@/lib/attachments/invoice-check';
import {
  invoiceStatusNeedsConfirm,
  reminderCodeForStatus,
} from '@/lib/attachments/invoice-reminder';
import { readNoFollow } from '@/lib/attachments/storage';

export { invoiceStatusNeedsConfirm, reminderCodeForStatus };

export async function analyzeStagedAttachment(input: {
  ownerEmployeeId: string;
  stagedId: string;
}): Promise<{ ok: true; result: InvoiceCheckResult } | { ok: false; error: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiChatStagedAttachments)
    .where(
      and(
        eq(aiChatStagedAttachments.id, input.stagedId),
        eq(aiChatStagedAttachments.ownerEmployeeId, input.ownerEmployeeId),
        eq(aiChatStagedAttachments.scanStatus, 'ready'),
        isNull(aiChatStagedAttachments.purgedAt)
      )
    )
    .limit(1);
  if (!row) return { ok: false, error: 'staged_not_ready' };

  await db
    .update(aiChatStagedAttachments)
    .set({ analysisStatus: 'running' })
    .where(eq(aiChatStagedAttachments.id, row.id));

  let bytes: Uint8Array;
  try {
    bytes = await readNoFollow(row.storagePath);
  } catch {
    await db
      .update(aiChatStagedAttachments)
      .set({ analysisStatus: 'failed', analysisResult: { error: 'read_failed' } })
      .where(eq(aiChatStagedAttachments.id, row.id));
    return { ok: false, error: 'read_failed' };
  }

  const result = await runInvoiceCheckOnBytes({ bytes, mimeType: row.mimeType });
  await db
    .update(aiChatStagedAttachments)
    .set({
      analysisStatus: result.overallStatus === 'analysis_failed' ? 'failed' : 'ready',
      analysisResult: result as unknown as Record<string, unknown>,
      analysisCompletedAt: new Date(),
    })
    .where(eq(aiChatStagedAttachments.id, row.id));

  return { ok: true, result };
}

export async function getStagedAnalysis(
  ownerEmployeeId: string,
  stagedId: string
): Promise<InvoiceCheckResult | null> {
  const [row] = await getDb()
    .select({
      analysisResult: aiChatStagedAttachments.analysisResult,
      analysisStatus: aiChatStagedAttachments.analysisStatus,
    })
    .from(aiChatStagedAttachments)
    .where(
      and(
        eq(aiChatStagedAttachments.id, stagedId),
        eq(aiChatStagedAttachments.ownerEmployeeId, ownerEmployeeId)
      )
    )
    .limit(1);
  if (!row?.analysisResult || typeof row.analysisResult !== 'object') return null;
  return row.analysisResult as unknown as InvoiceCheckResult;
}

export async function hasStagedInvoiceConfirmation(input: {
  stagedId: string;
  draftId: string;
  contentSha256: string;
}): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: stagedInvoiceConfirmations.id })
    .from(stagedInvoiceConfirmations)
    .where(
      and(
        eq(stagedInvoiceConfirmations.stagedId, input.stagedId),
        eq(stagedInvoiceConfirmations.draftId, input.draftId),
        eq(stagedInvoiceConfirmations.contentSha256, input.contentSha256)
      )
    )
    .orderBy(desc(stagedInvoiceConfirmations.confirmedAt))
    .limit(1);
  return Boolean(row);
}

export async function confirmStagedInvoiceReminder(input: {
  actorId: string;
  stagedId: string;
  draftId: string;
  userNote?: string | null;
}): Promise<{ ok: true; confirmationId: string; result: InvoiceCheckResult } | { ok: false; error: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiChatStagedAttachments)
    .where(
      and(
        eq(aiChatStagedAttachments.id, input.stagedId),
        eq(aiChatStagedAttachments.ownerEmployeeId, input.actorId),
        eq(aiChatStagedAttachments.scanStatus, 'ready'),
        isNull(aiChatStagedAttachments.purgedAt)
      )
    )
    .limit(1);
  if (!row) return { ok: false, error: '找不到已掃描通過的附件' };

  let result = row.analysisResult as unknown as InvoiceCheckResult | null;
  if (!result || row.analysisStatus !== 'ready') {
    const analyzed = await analyzeStagedAttachment({
      ownerEmployeeId: input.actorId,
      stagedId: input.stagedId,
    });
    if (!analyzed.ok) return { ok: false, error: '發票檢查尚未完成，請稍後再試' };
    result = analyzed.result;
  }

  if (!invoiceStatusNeedsConfirm(result.overallStatus)) {
    // Match / not_invoice — confirmation not required, but allow idempotent record skip.
    return { ok: true, confirmationId: 'not_required', result };
  }

  const id = randomUUID();
  await db.insert(stagedInvoiceConfirmations).values({
    id,
    stagedId: row.id,
    draftId: input.draftId,
    contentSha256: row.sha256,
    reminderCode: reminderCodeForStatus(result.overallStatus),
    reminderSummary: result.summary.slice(0, 500),
    userNote: input.userNote?.slice(0, 500) ?? null,
    analysisSnapshot: result as unknown as Record<string, unknown>,
    companyProfileVersion: null,
    confirmedByEmployeeId: input.actorId,
  });
  await recordAudit(db, {
    actorEmployeeId: input.actorId,
    action: 'staged.confirm_invoice_reminder',
    entityType: 'ai_chat_staged_attachment',
    entityId: row.id,
    details: {
      confirmationId: id,
      draftId: input.draftId,
      status: result.overallStatus,
      summary: result.summary,
    },
  });
  return { ok: true, confirmationId: id, result };
}
