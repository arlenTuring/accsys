'use server';

import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { attachStagedFilesToDraft } from '@/lib/ai-chat/attach-staged';
import { bindDraftToConversation, getDraftForOwner } from '@/lib/ai-chat/drafts';
import { editState, restoreOriginal, type EditKind } from '@/lib/ai-chat/file-edits';
import { listPendingStaged } from '@/lib/ai-chat/staged-images';
import {
  analyzeStagedAttachment,
  confirmStagedInvoiceReminder,
  getStagedAnalysis,
  getStagedCheckStates,
  hasStagedInvoiceConfirmation,
  invoiceStatusNeedsConfirm,
  startStagedChecks,
} from '@/lib/ai-chat/staged-invoice';
import { MAX_CHAT_ATTACHMENTS } from '@/lib/attachments/policy';
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

export async function getFileEditStateAction(input: { kind: EditKind; sourceId: string }) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  const state = await editState(input.kind, input.sourceId, employee.id);
  return state ? { ok: true as const, state } : { ok: false as const, error: '找不到檔案，或這張草稿已送出。' };
}

export async function restoreOriginalAction(input: { kind: EditKind; sourceId: string }) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  const res = await restoreOriginal({ ownerEmployeeId: employee.id, ...input });
  return res.ok ? { ok: true as const } : { ok: false as const, error: res.error ?? '還原失敗' };
}

/** Files the composer still holds, so a reload does not lose them. */
export async function listPendingStagedAction(input: { conversationId: string }) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  return { ok: true as const, items: await listPendingStaged(employee.id, input.conversationId) };
}

/** 確認並檢查: the person's go-ahead; only now does any file reach the AI check. */
export async function startStagedCheckAction(input: { stagedIds: string[]; targetDraftId?: string | null }) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  const ids = [...new Set(input.stagedIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, MAX_CHAT_ATTACHMENTS);
  if (ids.length === 0) return { ok: false as const, error: '沒有可檢查的檔案' };
  await startStagedChecks(employee.id, ids, input.targetDraftId);
  return { ok: true as const };
}

export async function getStagedCheckStatesAction(input: { stagedIds: string[] }) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  return { ok: true as const, states: await getStagedCheckStates(employee.id, input.stagedIds.slice(0, MAX_CHAT_ATTACHMENTS)) };
}

/**
 * Direct UI path: copy staged chat files onto the bound draft (no model required).
 * Still enforces invoice「仍要夾帶」confirmation when needed.
 */
export async function attachStagedFilesToDraftAction(input: {
  /** Conversation the files were staged in; the draft is linked to it after an owner check. */
  conversationId: string;
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
  const bound = await bindDraftToConversation({ conversationId: input.conversationId, draftId: input.draftId, ownerEmployeeId: employee.id });
  if (!bound.ok) return { ok: false as const, error: '無法把此草稿用於這個對話' };

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
      conversationId: input.conversationId,
      draftId: input.draftId,
      expectedVersion,
      stagedIds,
    });
    if (linked.ok) {
      return {
        ok: true as const,
        draft: linked.draft,
        skipped: linked.skipped,
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
