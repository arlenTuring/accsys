'use server';

export type { AiChatActionResult } from './turn';

import { and, eq } from 'drizzle-orm';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { hitRateLimit } from '@/lib/rate-limit';
import { loadAiChatConfig } from './config';
import {
  appendMessage,
  archiveConversation,
  createConversation,
  getOwnedConversation,
  listConversations,
  listMessages,
  listRecentConversation,
  renameConversation,
  type ConversationRow,
} from './conversations';
import {
  abandonDraft,
  getDraftForOwner,
  listDraftLibrary,
  loadDraftFormContext,
  submitApplicationDraft,
  type ApplicationDraft,
} from './drafts';
import { loadFormFacts, loadReturnReason } from './form-facts';
import { loadAssistantInbox, loadAssistantInboxMore, type AssistantInbox, type InboxItem } from './inbox';
import { ackLauncherEvents, pollLauncherEvents, type LauncherEvent } from './launcher-events';
import { startResubmission } from './resubmit';
import { AI_CHAT_RATE_LIMITS } from './limits';
import { executeNudge, previewNudge } from './nudge';
import { type OpenResourceEvent } from './open-resource';
import { listRecentProjectsForEmployee, searchProjectsPaged } from './projects';
import { sanitizeBlocks, type AiMessageBlock } from './blocks';
import {
  IMAGE_MIME,
  publicError,
  runAssistantTurn,
  type AiChatActionResult,
  type AssistantTurnInput,
} from './turn';
import { buildWelcomeSummary, welcomeClientMessageId } from './welcome';
import { saveDraftFromPanel, summarizeDrafts, type PanelSaveResult } from './draft-work';
import {
  chooseFormCard,
  confirmChangeCard,
  offerTripCarryOver,
  pickProjectCard,
  refreshFieldFormCard,
  submitFieldFormCard,
  type CardActionResult,
} from './block-actions';
import type { FormSchema } from '@/lib/custom-forms/schema';
import { getFilableDefinitions, type PickerOptions } from '@/lib/custom-forms/queries';

export async function getAiChatStatus(): Promise<{
  ok: boolean;
  enabled: boolean;
  model: string;
  location: string;
  /** Opaque principal class for UI — never the raw SA email for end users. */
  principalKind: 'runtime' | 'impersonated' | 'unset';
  error?: string;
}> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return { ok: false, enabled: false, model: '', location: '', principalKind: 'unset', error: 'unauthenticated' };
  }
  const cfg = loadAiChatConfig();
  return {
    ok: true,
    enabled: cfg.enabled && Boolean(cfg.projectId),
    model: cfg.model,
    location: cfg.location,
    principalKind: cfg.impersonateServiceAccount ? 'impersonated' : cfg.enabled ? 'runtime' : 'unset',
  };
}

export async function getAssistantInboxAction(): Promise<
  | { ok: true; inbox: AssistantInbox }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const { allowed } = await hitRateLimit(
    `ai-chat:inbox:${employee.id}`,
    AI_CHAT_RATE_LIMITS.aiChatInboxPerEmployee
  );
  if (!allowed) return { ok: false, error: publicError('rate_limited') };
  const inbox = await loadAssistantInbox();
  return { ok: true, inbox };
}

export async function loadMoreInboxAction(input: {
  section: 'pending' | 'mine';
  offset: number;
}): Promise<{ ok: true; items: InboxItem[]; hasMore: boolean } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const res = await loadAssistantInboxMore(input.section, Math.max(0, input.offset), 8);
  if (res.loadError) return { ok: false, error: '待辦載入失敗，請稍後重試。' };
  return { ok: true, items: res.items, hasMore: res.hasMore };
}

export async function bootstrapAssistantConversation(input?: {
  conversationId?: string | null;
  forceNew?: boolean;
}): Promise<
  | {
      ok: true;
      conversationId: string;
      title: string;
      messages: Array<{
        id: string;
        role: 'user' | 'model' | 'system';
        text: string;
        toolsUsed: string[];
        blocks: AiMessageBlock[];
        createdAt: string;
      }>;
      hasOlder: boolean;
      welcomeInserted: boolean;
    }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };

  let conversation: ConversationRow;
  if (input?.forceNew) {
    conversation = await createConversation(employee.id);
  } else if (input?.conversationId) {
    const owned = await getOwnedConversation(employee.id, input.conversationId, { includeArchived: true });
    if (!owned) return { ok: false, error: publicError('conversation_not_found') };
    conversation = owned;
  } else {
    conversation = (await listRecentConversation(employee.id)) ?? (await createConversation(employee.id));
  }

  const firstPage = await listMessages(conversation.id, employee.id, 40);
  let welcomeInserted = false;

  if (firstPage.messages.length === 0) {
    const summary = await buildWelcomeSummary(conversation.id);
    const appended = await appendMessage({
      conversationId: conversation.id,
      ownerEmployeeId: employee.id,
      role: 'system',
      contentText: summary.text,
      clientMessageId: welcomeClientMessageId(conversation.id),
      blocks: summary.blocks,
    });
    welcomeInserted = !appended.replayed;
  }

  const refreshed =
    firstPage.messages.length === 0
      ? await listMessages(conversation.id, employee.id, 40)
      : firstPage;

  return {
    ok: true,
    conversationId: conversation.id,
    title: conversation.title,
    messages: refreshed.messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.contentText,
      toolsUsed: m.toolsUsed,
      blocks: sanitizeBlocks(m.blocks, conversation.id),
      createdAt: m.createdAt.toISOString(),
    })),
    hasOlder: refreshed.hasOlder,
    welcomeInserted,
  };
}


export async function stageAiChatImageAction(input: {
  conversationId: string;
  clientAttachmentId: string;
  fileName: string;
  mimeType: string;
  base64: string;
}): Promise<
  | {
      ok: true;
      stagedId: string;
      scanStatus: string;
      fileName: string;
      mimeType: string;
      fileSizeBytes: number;
      width: number | null;
      height: number | null;
    }
  | { ok: false; error: string; code?: string }
> {
  try {
    const employee = await getCurrentEmployee();
    if (!employee) return { ok: false, error: publicError('unauthenticated') };
    const { stageAiChatImage } = await import('./staged-images');
    if (!IMAGE_MIME.has(input.mimeType)) {
      return { ok: false, error: '僅支援 JPEG、PNG、WebP、HEIC／HEIF、PDF。', code: 'unsupported_type' };
    }
    // Small-file fallback only; larger uploads use /api/ai-chat/staged-upload (multipart).
    if (typeof input.base64 !== 'string' || input.base64.length === 0 || input.base64.length > 700_000) {
      return { ok: false, error: '圖片內容無效或請改用較大檔上傳通道。', code: 'too_large' };
    }
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(input.base64), (c) => c.charCodeAt(0));
    } catch {
      return { ok: false, error: '圖片解碼失敗。', code: 'decode_failed' };
    }
    const result = await stageAiChatImage({
      ownerEmployeeId: employee.id,
      conversationId: input.conversationId,
      clientAttachmentId: input.clientAttachmentId,
      fileName: input.fileName,
      bytes,
    });
    if (!result.ok) return { ok: false, error: result.error, code: result.code };
    return {
      ok: true,
      stagedId: result.staged.id,
      scanStatus: result.staged.scanStatus,
      fileName: result.staged.fileName,
      mimeType: result.staged.mimeType,
      fileSizeBytes: result.staged.fileSizeBytes,
      width: result.staged.width,
      height: result.staged.height,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'stage_failed';
    if (msg === 'conversation_forbidden') {
      return { ok: false, error: '無法上傳到此對話。', code: 'forbidden' };
    }
    console.error('[ai-chat] stageAiChatImageAction failed', msg);
    return { ok: false, error: '圖片上傳或檢查失敗，請稍後重試。', code: 'unavailable' };
  }
}

export async function purgeStagedAiChatImageAction(input: {
  stagedId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const { purgeStagedImage } = await import('./staged-images');
  await purgeStagedImage(employee.id, input.stagedId);
  return { ok: true };
}

export async function attachApprovedPdfAction(input: {
  sourceFormId: string;
  draftId: string;
  expectedVersion: number;
  /** Conversation of the picker card; the carry-over offer is posted there. */
  conversationId: string;
}): Promise<
  | {
      ok: true;
      snapshotId: string;
      draftVersion: number;
      created: boolean;
      previewHref: string;
      formNumber: string;
    }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  if (!(await getOwnedConversation(employee.id, input.conversationId))) return { ok: false, error: publicError('conversation_not_found') };
  const actor = { id: employee.id, role: employee.role };
  const { getOrCreateApprovedPdfSnapshot } = await import('./approved-pdf');
  const { attachApprovedSnapshotToDraft } = await import('./attach-approved');
  const snap = await getOrCreateApprovedPdfSnapshot({ actor, formType: 'custom', formId: input.sourceFormId });
  if (!snap.ok) return { ok: false, error: snap.error };
  try {
    // Adding a fixed PDF touches no field, so a newer draft version is safe to build on.
    let linked = await attachApprovedSnapshotToDraft({ actor, draftId: input.draftId, expectedVersion: input.expectedVersion, snapshotId: snap.snapshot.id });
    if (!linked.ok) {
      linked = await attachApprovedSnapshotToDraft({ actor, draftId: input.draftId, expectedVersion: linked.conflict.draft.version, snapshotId: snap.snapshot.id });
    }
    if (!linked.ok) return { ok: false, error: '草稿剛被更新，請再按一次。' };
    if (linked.created) {
      await offerTripCarryOver({
        draftId: input.draftId,
        ownerEmployeeId: employee.id,
        conversationId: input.conversationId,
        sourceFormId: input.sourceFormId,
        sourceFormNumber: snap.snapshot.sourceFormNumber,
      });
    }
    return {
      ok: true,
      snapshotId: snap.snapshot.id,
      draftVersion: linked.draft.version,
      created: linked.created,
      previewHref: `/api/ai-chat/approved-snapshots/${snap.snapshot.id}`,
      formNumber: snap.snapshot.sourceFormNumber,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'attach_failed';
    return { ok: false, error: msg === 'snapshot_not_found' ? '找不到核准快照。' : msg === 'draft_not_editable' ? '草稿已送出，無法再夾帶。' : '附加失敗。' };
  }
}

export async function sendAiChatMessage(input: AssistantTurnInput): Promise<AiChatActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  return runAssistantTurn(employee, input);
}

export async function answerChoiceAction(input: {
  conversationId: string;
  blockId: string;
  optionId: string;
  optionValue: string;
  optionLabel: string;
}): Promise<
  | { ok: true; draftId?: string; openResources?: OpenResourceEvent[]; intent?: string; sendText?: string }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };

  const owned = await getOwnedConversation(employee.id, input.conversationId);
  if (!owned) return { ok: false, error: publicError('conversation_not_found') };

  // Welcome / structured intents — no draft creation.
  if (
    input.optionValue === 'view_pending' ||
    input.optionValue === 'view_mine' ||
    input.optionValue === 'open_draft_library' ||
    input.optionValue === 'create_form'
  ) {
    await appendMessage({
      conversationId: input.conversationId,
      ownerEmployeeId: employee.id,
      role: 'user',
      contentText: `選擇：${input.optionLabel}`,
      clientMessageId: crypto.randomUUID(),
    });
    return { ok: true, intent: input.optionValue };
  }

  // Form type: same create path as typed requests, plus a card for the key fields.
  const res = await chooseFormCard({ employeeId: employee.id, conversationId: input.conversationId, blockId: input.blockId, optionId: input.optionId });
  if (res.ok && res.draftId) return { ok: true, draftId: res.draftId, openResources: res.openResources };
  if (!res.ok && res.code !== 'invalid') return { ok: false, error: res.error };
  // Any other choice is an answer to the assistant: send it as the person's message.
  return { ok: true, sendText: input.optionLabel };
}

/** Field form card submitted (same fill service as typed requests). */
export async function submitFieldFormAction(input: { conversationId: string; blockId: string; values: Record<string, string> }): Promise<CardActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, code: 'not_found', error: publicError('unauthenticated') };
  return submitFieldFormCard({ employeeId: employee.id, ...input });
}

export async function confirmChangeAction(input: { conversationId: string; blockId: string; accept: boolean }): Promise<CardActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, code: 'not_found', error: publicError('unauthenticated') };
  return confirmChangeCard({ employeeId: employee.id, ...input });
}

export async function refreshCardAction(input: { conversationId: string; blockId: string }): Promise<CardActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, code: 'not_found', error: publicError('unauthenticated') };
  return refreshFieldFormCard({ employeeId: employee.id, ...input });
}

/** 「建立單據」: a card listing the forms this person may file (no typing needed). */
export async function presentFormChoicesAction(input: { conversationId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  if (!(await getOwnedConversation(employee.id, input.conversationId))) return { ok: false, error: publicError('conversation_not_found') };
  const forms = await getFilableDefinitions();
  await appendMessage({
    conversationId: input.conversationId,
    ownerEmployeeId: employee.id,
    role: 'model',
    contentText: '要建立哪一種單據？',
    blocks: [
      {
        kind: 'choice',
        id: `forms_${crypto.randomUUID().slice(0, 8)}`,
        prompt: '選擇表單類型',
        options: forms.slice(0, 20).map((f) => ({ id: f.key, label: f.name, value: f.key })),
        conversationId: input.conversationId,
        status: 'open',
      },
    ],
  });
  return { ok: true };
}

export async function searchProjectsAction(input: {
  query: string;
  offset?: number;
}): Promise<
  | { ok: true; projects: Array<{ id: string; code: string; name: string; kind: string | null }>; hasMore: boolean }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const { allowed } = await hitRateLimit(`ai-chat:proj:${employee.id}`, {
    limit: 60,
    windowSeconds: 600,
  });
  if (!allowed) return { ok: false, error: publicError('rate_limited') };
  const page = await searchProjectsPaged({
    query: input.query,
    employeeId: employee.id,
    offset: input.offset ?? 0,
    limit: 20,
  });
  return { ok: true, ...page };
}

export async function listRecentProjectsAction(): Promise<
  | { ok: true; projects: Awaited<ReturnType<typeof listRecentProjectsForEmployee>> }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const projects = await listRecentProjectsForEmployee(employee.id, 5);
  return { ok: true, projects };
}

export async function selectProjectAction(input: {
  conversationId: string;
  blockId: string;
  projectId: string;
}): Promise<CardActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, code: 'not_found', error: publicError('unauthenticated') };
  return pickProjectCard({ employeeId: employee.id, ...input });
}

/** What the returned form already carries: stays on it, shown read-only next to new files. */
async function listAttachmentsForDraftPanel(submissionId: string) {
  const rows = await getDb()
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      fileSizeBytes: attachments.fileSizeBytes,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(and(eq(attachments.formType, 'custom'), eq(attachments.formId, submissionId)));
  return rows.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSizeBytes: a.fileSizeBytes,
    sourceStagedId: null,
    attachedAt: a.createdAt.toISOString(),
    activeEditId: null,
    checkState: 'done' as const,
    checkSummary: '原單已有的附件，會保留',
    href: `/api/attachments/${a.id}/preview`,
  }));
}

export async function getDraftPanelAction(draftId: string): Promise<
  | {
      ok: true;
      draft: ApplicationDraft;
      formKey: string;
      name: string;
      description: string | null;
      schema: FormSchema;
      options: PickerOptions;
      currentEmployeeId: string;
      versionMismatch: boolean;
      today: string;
      /** 補件: the returned form behind this draft. */
      resubmit: { formNumber: string; href: string; reason: string | null } | null;
      /** Chat→draft staged copies (shown in draft panel; submitted with the form). */
      files: Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSizeBytes: number;
        sourceStagedId: string | null;
        attachedAt: string;
        activeEditId: string | null;
        checkState: 'none' | 'running' | 'done';
        checkSummary: string | null;
        /** Set on approved-document PDFs: a fixed copy, opened through this link. */
        href?: string;
      }>;
    }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const ctx = await loadDraftFormContext(draftId, employee.id);
  if (!ctx) return { ok: false, error: '找不到草稿或無權限。' };
  const { listDraftFiles } = await import('./attach-staged');
  const files = await listDraftFiles(draftId, employee.id);
  const { listDraftSnapshots } = await import('./attach-approved');
  const snapshots = await listDraftSnapshots(draftId, employee.id);
  const resubmitOf = ctx.draft.resubmitOfSubmissionId;
  const kept = resubmitOf ? await listAttachmentsForDraftPanel(resubmitOf) : [];
  const facts = resubmitOf ? await loadFormFacts([{ formType: 'custom', formId: resubmitOf }]) : null;
  return {
    ok: true,
    resubmit: resubmitOf
      ? {
          formNumber: facts?.get(`custom:${resubmitOf}`)?.formNumber ?? '',
          href: `/f/${ctx.formKey}/${resubmitOf}`,
          reason: await loadReturnReason({ formType: 'custom', formId: resubmitOf }),
        }
      : null,
    draft: ctx.draft,
    formKey: ctx.formKey,
    name: ctx.name,
    description: ctx.description,
    schema: ctx.schema,
    options: ctx.options,
    currentEmployeeId: ctx.currentEmployeeId,
    versionMismatch: ctx.versionMismatch,
    today: ctx.today,
    files: [
      ...kept,
      ...snapshots.map((s) => ({
        id: s.snapshotId,
        fileName: s.fileName,
        mimeType: 'application/pdf',
        fileSizeBytes: s.fileSizeBytes,
        sourceStagedId: null,
        attachedAt: s.attachedAt.toISOString(),
        activeEditId: null,
        checkState: 'done' as const,
        checkSummary: `核准單 ${s.sourceFormNumber} 的固定版本`,
        href: `/api/ai-chat/approved-snapshots/${s.snapshotId}`,
      })),
      ...files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      fileSizeBytes: f.fileSizeBytes,
      sourceStagedId: f.sourceStagedId,
      attachedAt: f.attachedAt.toISOString(),
      activeEditId: f.activeEditId ?? null,
      checkState: f.checkState ?? 'none',
      checkSummary: f.checkSummary ?? null,
      })),
    ],
  };
}

export async function saveDraftAction(input: {
  draftId: string;
  expectedVersion: number;
  data: Record<string, unknown>;
  /** Draft data the panel loaded at expectedVersion; enables field-level merge. */
  baseData?: Record<string, unknown> | null;
}): Promise<PanelSaveResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, code: 'not_found', error: publicError('unauthenticated') };
  try {
    return await saveDraftFromPanel({ ...input, ownerEmployeeId: employee.id });
  } catch (err) {
    console.error('[ai-chat] save draft failed', err instanceof Error ? err.message : err);
    return { ok: false, code: 'version_conflict', error: '儲存失敗，請再試一次；您的輸入仍保留在畫面上。' };
  }
}

export async function submitDraftAction(input: {
  draftId: string;
  expectedVersion: number;
  /** Optional multipart-compatible file list from the draft panel. */
  files?: File[];
}): Promise<
  | { ok: true; submissionId: string; formNumber: string; formKey: string; href: string; replayed?: boolean }
  | { ok: false; error: string; code?: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };

  const files = (input.files ?? []).filter((f) => f instanceof File && f.size > 0).slice(0, 20);

  const result = await submitApplicationDraft({
    draftId: input.draftId,
    ownerEmployeeId: employee.id,
    expectedVersion: input.expectedVersion,
    files,
  });
  if (!result.ok) return result;

  const draft = await getDraftForOwner(input.draftId, employee.id);
  if (draft) {
    await appendMessage({
      conversationId: draft.conversationId,
      ownerEmployeeId: employee.id,
      role: 'model',
      contentText: result.copyFailures
        ? `單據已送出：${result.formNumber}，但有 ${result.copyFailures} 個附件沒有複製成功，請到單據頁補傳。`
        : `單據已送出：${result.formNumber}`,
      blocks: [
        {
          kind: 'action_result',
          id: `submit_${result.submissionId}`,
          action: 'submit',
          ok: !result.copyFailures,
          message: result.copyFailures
            ? `已送出 ${result.formNumber}；${result.copyFailures} 個附件未複製成功`
            : `已送出 ${result.formNumber}`,
          formNumber: result.formNumber,
          href: `/f/${result.formKey}/${result.submissionId}`,
        },
      ],
    });
  }

  return {
    ok: true,
    submissionId: result.submissionId,
    formNumber: result.formNumber,
    formKey: result.formKey,
    href: `/f/${result.formKey}/${result.submissionId}`,
    replayed: result.replayed,
  };
}

export async function previewNudgeAction(input: {
  formType: string;
  formId: string;
}): Promise<{ ok: true; preview: NonNullable<Awaited<ReturnType<typeof previewNudge>>> } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const preview = await previewNudge(input.formType, input.formId);
  if (!preview) return { ok: false, error: '找不到單據或無權限。' };
  return { ok: true, preview };
}

export async function confirmNudgeAction(input: {
  formType: string;
  formId: string;
  conversationId: string;
}): Promise<
  | { ok: true; status: string; recipientNames: string[]; businessDate: string; message: string }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };

  const result = await executeNudge({ formType: input.formType, formId: input.formId });
  if (!result.ok) return { ok: false, error: result.error };

  const message =
    result.status === 'already_today'
      ? `此單今日（${result.businessDate}）已催簽過。`
      : `已建立站內催簽通知（收件：${result.recipientNames.join('、') || '—'}）。`;

  await appendMessage({
    conversationId: input.conversationId,
    ownerEmployeeId: employee.id,
    role: 'model',
    contentText: message,
  });

  return {
    ok: true,
    status: result.status,
    recipientNames: result.recipientNames,
    businessDate: result.businessDate,
    message,
  };
}

export async function listConversationsAction(input?: {
  query?: string;
  cursorUpdatedAt?: string | null;
  cursorId?: string | null;
}): Promise<
  | {
      ok: true;
      items: Array<{ id: string; title: string; updatedAt: string }>;
      nextCursor: { updatedAt: string; id: string } | null;
    }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const page = await listConversations({
    ownerEmployeeId: employee.id,
    query: input?.query,
    cursorUpdatedAt: input?.cursorUpdatedAt,
    cursorId: input?.cursorId,
    limit: 20,
  });
  return {
    ok: true,
    items: page.items.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}

export async function createConversationAction(): Promise<
  | { ok: true; conversationId: string; title: string }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const conversation = await createConversation(employee.id);
  const summary = await buildWelcomeSummary(conversation.id);
  await appendMessage({
    conversationId: conversation.id,
    ownerEmployeeId: employee.id,
    role: 'system',
    contentText: summary.text,
    clientMessageId: welcomeClientMessageId(conversation.id),
    blocks: summary.blocks,
  });
  return { ok: true, conversationId: conversation.id, title: conversation.title };
}

export async function renameConversationAction(input: {
  conversationId: string;
  title: string;
}): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const row = await renameConversation(employee.id, input.conversationId, input.title);
  if (!row) return { ok: false, error: '無法重新命名。' };
  return { ok: true, title: row.title };
}

export async function archiveConversationAction(input: {
  conversationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const ok = await archiveConversation(employee.id, input.conversationId);
  if (!ok) return { ok: false, error: publicError('conversation_not_found') };
  return { ok: true };
}

export async function loadOlderMessagesAction(input: {
  conversationId: string;
  beforeCreatedAt: string;
  beforeId: string;
}): Promise<
  | {
      ok: true;
      messages: Array<{
        id: string;
        role: 'user' | 'model' | 'system';
        text: string;
        toolsUsed: string[];
        blocks: AiMessageBlock[];
        createdAt: string;
      }>;
      hasOlder: boolean;
    }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const before = new Date(input.beforeCreatedAt);
  if (Number.isNaN(before.getTime())) return { ok: false, error: '無效的分頁游標。' };
  const page = await listMessages(input.conversationId, employee.id, 40, {
    beforeCreatedAt: before,
    beforeId: input.beforeId,
  });
  return {
    ok: true,
    messages: page.messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.contentText,
      toolsUsed: m.toolsUsed,
      blocks: sanitizeBlocks(m.blocks, input.conversationId),
      createdAt: m.createdAt.toISOString(),
    })),
    hasOlder: page.hasOlder,
  };
}

export async function listDraftLibraryAction(input?: {
  query?: string;
  status?: 'draft' | 'submitted' | 'abandoned' | 'all';
  offset?: number;
}): Promise<
  | {
      ok: true;
      items: Array<{
        id: string;
        title: string;
        formKey: string;
        status: string;
        version: number;
        updatedAt: string;
        conversationId: string;
        /** Header fields (dates, place, purpose…) to tell drafts apart. */
        summary: string;
      }>;
      total: number;
    }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const page = await listDraftLibrary({
    ownerEmployeeId: employee.id,
    query: input?.query,
    status: input?.status ?? 'draft',
    offset: input?.offset ?? 0,
    limit: 20,
  });
  const summaries = await summarizeDrafts(page.items);
  return {
    ok: true,
    total: page.total,
    items: page.items.map((d) => ({
      summary: summaries.get(d.id) ?? '',
      id: d.id,
      title: d.title,
      formKey: d.formDefinitionKey,
      status: d.status,
      version: d.version,
      updatedAt: d.updatedAt.toISOString(),
      conversationId: d.conversationId,
    })),
  };
}

export async function abandonDraftAction(input: {
  draftId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const row = await abandonDraft(input.draftId, employee.id);
  if (!row) return { ok: false, error: '無法放棄草稿（不存在、無權限或已非草稿狀態）。' };
  return { ok: true };
}

export async function pollLauncherEventsAction(input: {
  scope: 'fresh' | 'delivered';
  after?: string | null;
}): Promise<
  | { ok: true; events: LauncherEvent[]; hasMore: boolean; nextAfter: string | null }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const { allowed } = await hitRateLimit(`ai-chat:launcher:${employee.id}`, {
    limit: 120,
    windowSeconds: 600,
  });
  if (!allowed) return { ok: false, error: publicError('rate_limited') };
  const scope = input?.scope === 'delivered' ? 'delivered' : 'fresh';
  const page = await pollLauncherEvents({ actor: employee, scope, after: input?.after });
  return { ok: true, ...page };
}

/** 補件 from a reminder: opens (or reopens) a draft of the returned form in a new conversation. */
export async function startResubmissionAction(input: {
  submissionId: string;
}): Promise<{ ok: true; conversationId: string; draftId: string; title: string } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const result = await startResubmission({ ownerEmployeeId: employee.id, submissionId: input.submissionId });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, conversationId: result.conversationId, draftId: result.draft.id, title: result.draft.title };
}

export async function ackLauncherEventsAction(input: {
  eventKeys: string[];
  state: 'viewed' | 'dismissed' | 'muted';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  await ackLauncherEvents({
    employeeId: employee.id,
    eventKeys: input.eventKeys,
    state: input.state,
  });
  return { ok: true };
}

export async function refreshWelcomeAction(input: {
  conversationId: string;
}): Promise<
  | { ok: true; text: string; blocks: AiMessageBlock[]; fetchedAt: string }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const owned = await getOwnedConversation(employee.id, input.conversationId);
  if (!owned) return { ok: false, error: publicError('conversation_not_found') };
  const summary = await buildWelcomeSummary(input.conversationId);
  // Append a fresh system note (distinct client id) so history keeps prior welcome.
  await appendMessage({
    conversationId: input.conversationId,
    ownerEmployeeId: employee.id,
    role: 'system',
    contentText: summary.text,
    clientMessageId: `welcome_refresh:${input.conversationId}:${Date.now()}`,
    blocks: summary.blocks,
  });
  return {
    ok: true,
    text: summary.text,
    blocks: summary.blocks,
    fetchedAt: summary.fetchedAt,
  };
}
