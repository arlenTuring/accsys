import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import { aiChatStagedAttachments, stagedInvoiceConfirmations } from '@/lib/db/schema';
import {
  INVOICE_RULES_VERSION,
  runInvoiceCheckOnBytes,
  type InvoiceCheckResult,
} from '@/lib/attachments/invoice-check';
import {
  invoiceStatusNeedsConfirm,
  reminderCodeForStatus,
} from '@/lib/attachments/invoice-reminder';
import { ANALYSIS_MAX_INLINE_BYTES, ANALYSIS_TIMEOUT_MS, PDF_PAGE_BATCH } from '@/lib/attachments/policy';
import { readNoFollow } from '@/lib/attachments/storage';
import { readEditAnalysis } from './file-edits';

export { invoiceStatusNeedsConfirm, reminderCodeForStatus };

const notCompleted = (summary: string): InvoiceCheckResult => ({
  complete: false,
  pagesAnalysed: 0,
  pagesTotal: null,
  overallStatus: 'analysis_failed',
  summary,
  pages: [],
  usedVision: false,
});

/** The bytes the model sees: the file itself, or the first pages of a PDF too big to send inline. */
async function analysisInput(bytes: Uint8Array, mimeType: string): Promise<{ bytes: Uint8Array; pagesTotal: number | null; pagesSent: number | null }> {
  if (mimeType !== 'application/pdf') return { bytes, pagesTotal: null, pagesSent: null };
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const total = doc.getPageCount();
    if (bytes.length <= ANALYSIS_MAX_INLINE_BYTES) return { bytes, pagesTotal: total, pagesSent: total };
    const copy = await PDFDocument.create();
    const pages = await copy.copyPages(doc, doc.getPageIndices().slice(0, PDF_PAGE_BATCH));
    pages.forEach((p) => copy.addPage(p));
    return { bytes: await copy.save(), pagesTotal: total, pagesSent: pages.length };
  } catch {
    return { bytes, pagesTotal: null, pagesSent: null };
  }
}

/**
 * One AI check of a staged file. Bounded by ANALYSIS_TIMEOUT_MS; every outcome,
 * including failure, is stored with the file hash and company profile it used.
 */
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
    .set({ analysisStatus: 'running', analysisStartedAt: new Date() })
    .where(eq(aiChatStagedAttachments.id, row.id));

  const finish = async (result: InvoiceCheckResult, analysed = row.sha256) => {
    await db
      .update(aiChatStagedAttachments)
      .set({
        analysisStatus: result.overallStatus === 'analysis_failed' ? 'failed' : 'ready',
        analysisResult: result as unknown as Record<string, unknown>,
        analysisCompletedAt: new Date(),
        analysisContentSha256: analysed,
        analysisCompanyVersion: result.companyProfileVersion ?? null,
        analysisRulesVersion: INVOICE_RULES_VERSION,
      })
      .where(eq(aiChatStagedAttachments.id, row.id));
  };

  // An edited photo is checked from its annotation-free render, never from the annotated output.
  let bytes: Uint8Array;
  let contentSha = row.sha256;
  let mimeType = row.mimeType;
  try {
    if (row.activeEditId) {
      const copy = await readEditAnalysis(row.activeEditId, input.ownerEmployeeId);
      if (!copy) throw new Error('edit_missing');
      bytes = copy.bytes;
      contentSha = copy.sha256;
      mimeType = copy.mimeType;
    } else {
      bytes = await readNoFollow(row.storagePath);
    }
  } catch {
    await finish(notCompleted('無法讀取檔案，未完成檢查'));
    return { ok: false, error: 'read_failed' };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const input2 = await analysisInput(bytes, mimeType);
    const check = runInvoiceCheckOnBytes({ bytes: input2.bytes, mimeType });
    const timeout = new Promise<InvoiceCheckResult>((resolve) => {
      timer = setTimeout(() => resolve(notCompleted('檢查逾時，未完成檢查；不代表已核對統編')), ANALYSIS_TIMEOUT_MS);
    });
    const raw = await Promise.race([check, timeout]);
    const partial = input2.pagesTotal !== null && input2.pagesSent !== null && input2.pagesSent < input2.pagesTotal;
    const result: InvoiceCheckResult = {
      ...raw,
      ...(input2.pagesTotal !== null ? { pagesTotal: input2.pagesTotal, pagesAnalysed: input2.pagesSent ?? raw.pagesAnalysed } : {}),
      ...(partial ? { complete: false, summary: `${raw.summary}（只檢查前 ${input2.pagesSent} 頁，共 ${input2.pagesTotal} 頁）` } : {}),
    };
    await finish(result, contentSha);
    return { ok: true, result };
  } catch (err) {
    console.warn('[staged-invoice] check failed', err instanceof Error ? err.message : err);
    const result = notCompleted('檢查發生錯誤，未完成檢查；不代表已核對統編');
    await finish(result, contentSha);
    return { ok: true, result };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type StagedCheckState = { stagedId: string; state: 'idle' | 'running' | 'done'; result: InvoiceCheckResult | null };

/**
 * 確認並檢查: start the AI check for files the person confirmed. Runs in the
 * background so large files do not hold a request open; the page polls
 * getStagedCheckStates. A result for the same file content is reused.
 */
export async function startStagedChecks(ownerEmployeeId: string, stagedIds: string[], targetDraftId?: string | null): Promise<void> {
  const db = getDb();
  const staleBefore = new Date(Date.now() - ANALYSIS_TIMEOUT_MS * 2).toISOString();
  for (const id of stagedIds) {
    const claimed = await db
      .update(aiChatStagedAttachments)
      .set({ analysisStatus: 'running', analysisStartedAt: new Date(), targetDraftId: targetDraftId ?? null })
      .where(
        and(
          eq(aiChatStagedAttachments.id, id),
          eq(aiChatStagedAttachments.ownerEmployeeId, ownerEmployeeId),
          eq(aiChatStagedAttachments.scanStatus, 'ready'),
          isNull(aiChatStagedAttachments.purgedAt),
          sql`(${aiChatStagedAttachments.analysisStatus} is null
            or (${aiChatStagedAttachments.analysisStatus} = 'failed')
            or (${aiChatStagedAttachments.analysisStatus} = 'running' and ${aiChatStagedAttachments.analysisStartedAt} < ${staleBefore}::timestamptz))`
        )
      )
      .returning({ id: aiChatStagedAttachments.id });
    if (claimed.length === 0) continue;
    void analyzeStagedAttachment({ ownerEmployeeId, stagedId: id }).catch((err) =>
      console.warn('[staged-invoice] background check', err instanceof Error ? err.message : err)
    );
  }
}

export async function getStagedCheckStates(ownerEmployeeId: string, stagedIds: string[]): Promise<StagedCheckState[]> {
  if (stagedIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: aiChatStagedAttachments.id,
      status: aiChatStagedAttachments.analysisStatus,
      result: aiChatStagedAttachments.analysisResult,
      startedAt: aiChatStagedAttachments.analysisStartedAt,
    })
    .from(aiChatStagedAttachments)
    .where(and(inArray(aiChatStagedAttachments.id, stagedIds), eq(aiChatStagedAttachments.ownerEmployeeId, ownerEmployeeId)));
  const out: StagedCheckState[] = [];
  for (const r of rows) {
    if (r.status === 'running') {
      const age = r.startedAt ? Date.now() - r.startedAt.getTime() : Infinity;
      if (age < ANALYSIS_TIMEOUT_MS * 2) {
        out.push({ stagedId: r.id, state: 'running', result: null });
        continue;
      }
      // The worker died (restart, crash): report it as not completed instead of waiting forever.
      const result = notCompleted('檢查中斷，未完成檢查；可重試');
      await db
        .update(aiChatStagedAttachments)
        .set({ analysisStatus: 'failed', analysisResult: result as unknown as Record<string, unknown>, analysisCompletedAt: new Date() })
        .where(eq(aiChatStagedAttachments.id, r.id));
      out.push({ stagedId: r.id, state: 'done', result });
      continue;
    }
    out.push({
      stagedId: r.id,
      state: r.status ? 'done' : 'idle',
      result: (r.result as unknown as InvoiceCheckResult | null) ?? null,
    });
  }
  return out;
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
    companyProfileVersion: row.analysisCompanyVersion,
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
