'use server';

import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { attachStagedFilesToDraft } from '@/lib/ai-chat/attach-staged';
import { getDraftForOwner } from '@/lib/ai-chat/drafts';
import {
  analyzeStagedAttachment,
  confirmStagedInvoiceReminder,
  getStagedAnalysis,
  hasStagedInvoiceConfirmation,
  invoiceStatusNeedsConfirm,
} from '@/lib/ai-chat/staged-invoice';
import { getDb } from '@/lib/db';
import { aiChatStagedAttachments } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

export async function analyzeStagedAttachmentAction(stagedId: string) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  return analyzeStagedAttachment({ ownerEmployeeId: employee.id, stagedId });
}

export async function getStagedAnalysisAction(stagedId: string) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  const result = await getStagedAnalysis(employee.id, stagedId);
  return result
    ? { ok: true as const, result }
    : { ok: false as const, error: '尚無分析結果' };
}

export async function confirmStagedInvoiceReminderAction(input: {
  stagedId: string;
  draftId: string;
  userNote?: string | null;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  return confirmStagedInvoiceReminder({
    actorId: employee.id,
    stagedId: input.stagedId,
    draftId: input.draftId,
    userNote: input.userNote,
  });
}

/**
 * Direct UI path: copy staged chat files onto the bound draft (no model required).
 * Still enforces invoice「仍要夾帶」confirmation when needed.
 */
export async function attachStagedFilesToDraftAction(input: {
  draftId: string;
  expectedVersion: number;
  stagedIds: string[];
  /** Optional note applied when auto-confirming reminders. */
  userNote?: string | null;
  /** If true, record「仍要夾帶」for any pending reminders then attach. */
  confirmReminders?: boolean;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  const draft = await getDraftForOwner(input.draftId, employee.id);
  if (!draft) return { ok: false as const, error: '找不到草稿' };
  if (draft.status !== 'draft') return { ok: false as const, error: '草稿已送出，無法再夾帶' };

  const stagedIds = [...new Set(input.stagedIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (stagedIds.length === 0) return { ok: false as const, error: '沒有可夾帶的檔案' };

  for (const sid of stagedIds) {
    const [row] = await getDb()
      .select()
      .from(aiChatStagedAttachments)
      .where(
        and(
          eq(aiChatStagedAttachments.id, sid),
          eq(aiChatStagedAttachments.ownerEmployeeId, employee.id),
          eq(aiChatStagedAttachments.scanStatus, 'ready'),
          isNull(aiChatStagedAttachments.purgedAt)
        )
      )
      .limit(1);
    if (!row) continue;
    let analysis = row.analysisResult as { overallStatus?: string } | null;
    if (!analysis?.overallStatus) {
      const analyzed = await analyzeStagedAttachment({
        ownerEmployeeId: employee.id,
        stagedId: sid,
      });
      if (analyzed.ok) analysis = analyzed.result;
    }
    if (analysis?.overallStatus && invoiceStatusNeedsConfirm(analysis.overallStatus)) {
      const confirmed = await hasStagedInvoiceConfirmation({
        stagedId: sid,
        draftId: input.draftId,
        contentSha256: row.sha256,
      });
      if (!confirmed) {
        if (!input.confirmReminders) {
          return {
            ok: false as const,
            error: 'confirmation_required',
            message: '此檔有業務提醒，請先按「仍要夾帶」或勾選確認後再夾入草稿。',
          };
        }
        const conf = await confirmStagedInvoiceReminder({
          actorId: employee.id,
          stagedId: sid,
          draftId: input.draftId,
          userNote: input.userNote ?? '使用者於草稿一鍵夾帶時確認',
        });
        if (!conf.ok) return { ok: false as const, error: conf.error };
      }
    }
  }

  let expectedVersion = input.expectedVersion;
  for (let attempt = 0; attempt < 2; attempt++) {
    const linked = await attachStagedFilesToDraft({
      actor: { id: employee.id, role: employee.role },
      conversationId: draft.conversationId,
      draftId: input.draftId,
      expectedVersion,
      stagedIds,
    });
    if (linked.ok) {
      return {
        ok: true as const,
        draft: linked.draft,
        attached: linked.attached.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSizeBytes: a.fileSizeBytes,
        })),
      };
    }
    if ('conflict' in linked && linked.conflict) {
      expectedVersion = linked.conflict.draft.version;
      if (attempt === 0) continue;
      return {
        ok: false as const,
        error: 'version_conflict',
        message: '草稿已被更新，請重新整理後再夾帶。',
        draft: linked.conflict.draft,
      };
    }
    return {
      ok: false as const,
      error: 'error' in linked ? linked.error : 'attach_failed',
      message: '夾帶失敗，請稍後再試。',
    };
  }
  return { ok: false as const, error: 'attach_failed', message: '夾帶失敗，請稍後再試。' };
}
