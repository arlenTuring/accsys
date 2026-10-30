'use server';

import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { hitRateLimit } from '@/lib/rate-limit';
import { AiChatConfigError, requireAiChatConfig, loadAiChatConfig } from './config';
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
  patchApplicationDraft,
  submitApplicationDraft,
  type ApplicationDraft,
} from './drafts';
import { loadAssistantInbox, loadAssistantInboxMore, type AssistantInbox, type InboxItem } from './inbox';
import { ackLauncherEvents, pollLauncherEvents, type LauncherEvent } from './launcher-events';
import { assertAiChatMessageRate, releaseEmployeeTurn, tryAcquireEmployeeTurn, AI_CHAT_RATE_LIMITS } from './limits';
import { executeNudge, previewNudge } from './nudge';
import { mergeOpenResources, type OpenResourceEvent } from './open-resource';
import { listRecentProjectsForEmployee, recordProjectUsage, searchProjectsPaged } from './projects';
import { generateChatReply, type UserContentPart } from './vertex-client';
import { sanitizeBlocks, type AiMessageBlock } from './blocks';
import { buildWelcomeSummary, welcomeClientMessageId } from './welcome';
import type { FormSchema } from '@/lib/custom-forms/schema';
import type { PickerOptions } from '@/lib/custom-forms/queries';

function openResourcesFromDraftBlocks(
  blocks: AiMessageBlock[],
  operation: OpenResourceEvent['operation']
): OpenResourceEvent[] {
  const out: OpenResourceEvent[] = [];
  for (const b of blocks) {
    if (b.kind !== 'draft_reference') continue;
    out.push({
      type: 'open_resource',
      resourceType: 'application_draft',
      resourceId: b.draftId,
      title: b.formName,
      version: b.version,
      operation,
      formKey: b.formKey,
      status: b.status,
    });
  }
  return mergeOpenResources(out);
}

function publicError(raw: string): string {
  const code = raw.split('\n')[0] ?? raw;
  switch (true) {
    case code === 'rate_limited':
      return '操作過於頻繁，請稍後再試。';
    case code === 'busy':
      return '上一個回覆還在處理中，請稍候再傳送。';
    case code === 'task_timeout' || code.startsWith('task_timeout'):
      return '這次回應逾時，請再試一次。';
    case code === 'model_empty_text' || code.startsWith('model_empty_text'):
      return '模型沒有回傳內容，請再試一次。';
    case code === 'unauthenticated':
      return '請先登入後再使用 AI 助手。';
    case code === 'empty_user_content':
      return '請輸入訊息或上傳圖片。';
    case code === 'conversation_not_found' || code === 'conversation_forbidden':
      return '找不到此對話或無權限存取。';
    default:
      if (code.startsWith('model_http_')) return '目前無法連線到語言模型，請稍後再試或聯絡管理員。';
      if (
        code.includes('憑證') ||
        code.includes('ADC') ||
        code.includes('default credentials') ||
        code.includes('AI_CHAT_PROJECT')
      ) {
        // Local: actionable; production: hide internals.
        if (loadAiChatConfig().isLocal) {
          return '本機尚未設定 Vertex 開發憑證。請在終端機執行：gcloud auth application-default login';
        }
        return 'AI 助手設定尚未完成，請聯絡管理員。';
      }
      return '處理失敗，請稍後再試。';
  }
}

export type AiChatActionResult =
  | {
      ok: true;
      reply: string;
      model: string;
      toolsUsed: string[];
      blocks: AiMessageBlock[];
      conversationId: string;
      userMessageId: string;
      modelMessageId: string;
      /**
       * Controlled open events from successful tools only.
       * Frontend must open tabs from this — never from model prose or “latest draft”.
       */
      openResources: OpenResourceEvent[];
    }
  | { ok: false; error: string };

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

const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

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
      invoice: import('@/lib/attachments/invoice-check').InvoiceCheckResult | null;
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
    let invoice: import('@/lib/attachments/invoice-check').InvoiceCheckResult | null = null;
    try {
      const { analyzeStagedAttachment } = await import('./staged-invoice');
      const analyzed = await analyzeStagedAttachment({
        ownerEmployeeId: employee.id,
        stagedId: result.staged.id,
      });
      if (analyzed.ok) {
        invoice = analyzed.result;
      } else {
        invoice = {
          complete: false,
          pagesAnalysed: 0,
          pagesTotal: null,
          overallStatus: 'analysis_failed',
          summary: '無法完成發票／統編檢查；安全掃描已通過，確認後仍可夾帶',
          pages: [],
          usedVision: false,
        };
      }
    } catch (err) {
      console.warn('[ai-chat] invoice analyze after stage:', (err as Error).message);
      invoice = {
        complete: false,
        pagesAnalysed: 0,
        pagesTotal: null,
        overallStatus: 'analysis_failed',
        summary: '發票檢查發生錯誤；安全掃描已通過，確認後仍可夾帶',
        pages: [],
        usedVision: false,
      };
    }
    return {
      ok: true,
      stagedId: result.staged.id,
      scanStatus: result.staged.scanStatus,
      fileName: result.staged.fileName,
      mimeType: result.staged.mimeType,
      fileSizeBytes: result.staged.fileSizeBytes,
      width: result.staged.width,
      height: result.staged.height,
      invoice,
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
  fillTripOrderNo?: boolean;
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
  const actor = { id: employee.id, role: employee.role };
  const { getOrCreateApprovedPdfSnapshot } = await import('./approved-pdf');
  const { attachApprovedSnapshotToDraft } = await import('./attach-approved');
  const snap = await getOrCreateApprovedPdfSnapshot({
    actor,
    formType: 'custom',
    formId: input.sourceFormId,
  });
  if (!snap.ok) return { ok: false, error: snap.error };
  try {
    const linked = await attachApprovedSnapshotToDraft({
      actor,
      draftId: input.draftId,
      expectedVersion: input.expectedVersion,
      snapshotId: snap.snapshot.id,
    });
    if (!linked.ok) return { ok: false, error: '草稿版本衝突，請重新整理。' };
    if (input.fillTripOrderNo) {
      const { patchApplicationDraft } = await import('./drafts');
      const draft = linked.draft;
      const currentNo = draft.data.tripOrderNo;
      if (currentNo == null || currentNo === '') {
        await patchApplicationDraft({
          draftId: draft.id,
          ownerEmployeeId: employee.id,
          expectedVersion: linked.draft.version,
          patch: { tripOrderNo: snap.snapshot.sourceFormNumber },
        });
      }
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
    return { ok: false, error: msg === 'snapshot_not_found' ? '找不到核准快照。' : '附加失敗。' };
  }
}

export async function sendAiChatMessage(input: {
  message: string;
  clientMessageId: string;
  conversationId?: string | null;
  /** Preferred: staged attachment IDs (already scanned). */
  stagedAttachmentIds?: string[];
  /** Legacy inline images (base64). Prefer stagedAttachmentIds. */
  images?: Array<{ mimeType: string; base64: string; fileName?: string }>;
}): Promise<AiChatActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };

  if (!tryAcquireEmployeeTurn(employee.id)) {
    return { ok: false, error: publicError('busy') };
  }

  try {
    try {
      await assertAiChatMessageRate(employee.id);
    } catch {
      return { ok: false, error: publicError('rate_limited') };
    }

    const cfg = requireAiChatConfig();
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const clientMessageId =
      typeof input.clientMessageId === 'string' ? input.clientMessageId.trim() : '';

    if (!input.conversationId) {
      return { ok: false, error: '請先開啟對話再傳送訊息。' };
    }
    const conversation = await getOwnedConversation(employee.id, input.conversationId);
    if (!conversation) {
      return { ok: false, error: publicError('conversation_not_found') };
    }

    const stagedIds = (input.stagedAttachmentIds ?? [])
      .filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
      .slice(0, 3);
    const { getReadyStagedImagesForOwner } = await import('./staged-images');
    const staged = stagedIds.length
      ? await getReadyStagedImagesForOwner(employee.id, conversation.id, stagedIds)
      : [];
    if (stagedIds.length > 0 && staged.length !== stagedIds.length) {
      return {
        ok: false,
        error: '部分圖片尚未就緒或無權限，請等待掃描完成或重新上傳後再送出。',
      };
    }

    const legacyImages = (input.images ?? [])
      .filter(
        (img) =>
          IMAGE_MIME.has(img.mimeType) &&
          typeof img.base64 === 'string' &&
          img.base64.length > 0 &&
          img.base64.length <= 4_000_000
      )
      .slice(0, 3);

    const imageCount = staged.length || legacyImages.length;
    if (!message && imageCount === 0) return { ok: false, error: '請輸入訊息或上傳圖片。' };
    if (message.length > cfg.maxInputChars) {
      return { ok: false, error: `訊息過長（上限 ${cfg.maxInputChars} 字）。` };
    }
    if (!/^[0-9a-f-]{36}$/i.test(clientMessageId)) {
      return { ok: false, error: '訊息識別無效，請重新整理後再試。' };
    }

    const userTextForStore =
      message || (imageCount > 0 ? `（上傳 ${imageCount} 張圖片）` : '');

    const userAppend = await appendMessage({
      conversationId: conversation.id,
      ownerEmployeeId: employee.id,
      role: 'user',
      contentText: userTextForStore,
      clientMessageId,
      blocks:
        staged.length > 0
          ? staged.map((img) => ({
              kind: 'attachment_status',
              id: `staged_${img.id}`,
              fileName: img.fileName,
              state: 'ready',
              detail: `staged:${img.id}`,
            }))
          : legacyImages.map((img, i) => ({
              kind: 'attachment_status',
              id: `img_${clientMessageId}_${i}`,
              fileName: img.fileName ?? `image-${i + 1}`,
              state: 'ready',
              detail: '已交給模型辨識（尚未寫入正式單據附件）',
            })),
    });

    if (userAppend.replayed) {
      const { messages: msgs } = await listMessages(conversation.id, employee.id, 80);
      const idx = msgs.findIndex((m) => m.id === userAppend.id);
      const following = idx >= 0 ? msgs.slice(idx + 1).find((m) => m.role === 'model') : undefined;
      if (following) {
        const replayBlocks = sanitizeBlocks(following.blocks, conversation.id);
        return {
          ok: true,
          reply: following.contentText,
          model: cfg.model,
          toolsUsed: following.toolsUsed,
          blocks: replayBlocks,
          conversationId: conversation.id,
          userMessageId: userAppend.id,
          modelMessageId: following.id,
          openResources: openResourcesFromDraftBlocks(replayBlocks, 'opened'),
        };
      }
    }

    const { messages: historyRows } = await listMessages(
      conversation.id,
      employee.id,
      cfg.maxHistoryTurns * 2
    );
    const history = historyRows
      .filter((m) => m.role === 'user' || m.role === 'model')
      .filter((m) => m.id !== userAppend.id)
      .slice(-cfg.maxHistoryTurns)
      .map((m) => ({ role: m.role as 'user' | 'model', text: m.contentText }));

    const userParts: UserContentPart[] = [];
    if (message) userParts.push({ type: 'text', text: message });
    else if (imageCount > 0) {
      userParts.push({
        type: 'text',
        text: '使用者上傳了圖片。請先辨識文件類型與可讀內容；若要建單請先確認表單種類，不要自動正式送件。看不清楚的金額／日期／統編標示待確認，不要猜測。無關圖片（例如測試動物照）請說明無法辨識報支資料，不可捏造金額。若使用者要求夾到草稿，請呼叫 attach_staged_files_to_draft。',
      });
    }
    if (staged.length > 0) {
      userParts.push({
        type: 'text',
        text: `本回合可附加的 staged_attachment_ids：${staged.map((s) => s.id).join(', ')}（檔名：${staged.map((s) => s.fileName).join('、')}）。`,
      });
    }
    // Inline vision only for reasonably small files. Large photos stay staged-only
    // (model still gets staged ids + attach tool). Avoids model_empty / payload failures.
    const INLINE_RAW_MAX = 7 * 1024 * 1024;
    if (staged.length > 0) {
      for (const img of staged) {
        if (img.bytes.length > INLINE_RAW_MAX) continue;
        let binary = '';
        for (let i = 0; i < img.bytes.length; i++) binary += String.fromCharCode(img.bytes[i]!);
        userParts.push({ type: 'image', mimeType: img.mimeType, base64: btoa(binary) });
      }
    } else {
      for (const img of legacyImages) {
        if (img.base64.length > 10_000_000) continue;
        userParts.push({ type: 'image', mimeType: img.mimeType, base64: img.base64 });
      }
    }

    const { text, toolsUsed, blocks, openResources } = await generateChatReply(
      cfg,
      history,
      userParts,
      {
        conversationId: conversation.id,
        ownerEmployeeId: employee.id,
        turnId: clientMessageId,
        recentStagedIds: staged.map((s) => s.id),
      }
    );

    const safeBlocks = sanitizeBlocks(blocks, conversation.id);
    const modelAppend = await appendMessage({
      conversationId: conversation.id,
      ownerEmployeeId: employee.id,
      role: 'model',
      contentText: text,
      toolsUsed,
      blocks: safeBlocks,
    });

    return {
      ok: true,
      reply: text,
      model: cfg.model,
      toolsUsed,
      blocks: safeBlocks,
      conversationId: conversation.id,
      userMessageId: userAppend.id,
      modelMessageId: modelAppend.id,
      openResources: mergeOpenResources(openResources),
    };
  } catch (err) {
    const raw =
      err instanceof AiChatConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'unknown';
    console.error('[ai-chat]', { employeeId: employee.id, error: raw.slice(0, 500) });
    return { ok: false, error: publicError(raw) };
  } finally {
    releaseEmployeeTurn(employee.id);
  }
}

export async function answerChoiceAction(input: {
  conversationId: string;
  blockId: string;
  optionId: string;
  optionValue: string;
  optionLabel: string;
}): Promise<
  | { ok: true; draftId?: string; openResources?: OpenResourceEvent[]; intent?: string }
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

  await appendMessage({
    conversationId: input.conversationId,
    ownerEmployeeId: employee.id,
    role: 'user',
    contentText: `選擇：${input.optionLabel}`,
    clientMessageId: crypto.randomUUID(),
    blocks: [
      {
        kind: 'action_result',
        id: `choice_ans_${input.blockId}`,
        action: 'choice',
        ok: true,
        message: `已選擇「${input.optionLabel}」`,
      },
    ],
  });

  // If value looks like a form key, create draft (idempotent per choice block).
  if (/^[a-z0-9-]{2,40}$/i.test(input.optionValue) && input.optionValue.includes('-')) {
    const { createApplicationDraft } = await import('./drafts');
    try {
      const { draft } = await createApplicationDraft({
        conversationId: input.conversationId,
        ownerEmployeeId: employee.id,
        formDefinitionKey: input.optionValue,
        createIdempotencyKey: `choice:${input.blockId}:${input.optionValue}`,
        title: input.optionLabel,
      });
      const open: OpenResourceEvent = {
        type: 'open_resource',
        resourceType: 'application_draft',
        resourceId: draft.id,
        title: input.optionLabel,
        version: draft.version,
        operation: 'created',
        formKey: draft.formDefinitionKey,
        status: draft.status,
      };
      await appendMessage({
        conversationId: input.conversationId,
        ownerEmployeeId: employee.id,
        role: 'model',
        contentText: `已建立「${input.optionLabel}」草稿。請在文件工作區確認欄位後按「送出單據」。`,
        blocks: [
          {
            kind: 'draft_reference',
            id: `draft_${draft.id}`,
            draftId: draft.id,
            formKey: draft.formDefinitionKey,
            formName: input.optionLabel,
            version: draft.version,
            status: draft.status,
          },
        ],
      });
      return { ok: true, draftId: draft.id, openResources: [open] };
    } catch {
      // not a form key — just record the choice
    }
  }
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
  projectId: string;
  draftId?: string;
  draftVersion?: number;
  fieldId?: string;
}): Promise<{ ok: true; label: string; draft?: ApplicationDraft } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };

  const { getDb } = await import('@/lib/db');
  const { projects } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const db = getDb();
  const [row] = await db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!row) return { ok: false, error: '找不到專案。' };

  await recordProjectUsage(employee.id, row.id);
  const label = `${row.code} ${row.name}`;

  let draft: ApplicationDraft | undefined;
  if (input.draftId && typeof input.draftVersion === 'number') {
    const fieldId = input.fieldId || 'projectId';
    const patched = await patchApplicationDraft({
      draftId: input.draftId,
      ownerEmployeeId: employee.id,
      expectedVersion: input.draftVersion,
      patch: { [fieldId]: row.id, projectLabel: label },
    });
    if (!patched.ok) return { ok: false, error: '草稿版本衝突，請重新整理。' };
    draft = patched.draft;
  }

  await appendMessage({
    conversationId: input.conversationId,
    ownerEmployeeId: employee.id,
    role: 'user',
    contentText: `已選擇專案：${label}`,
    clientMessageId: crypto.randomUUID(),
  });

  return { ok: true, label, draft };
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
      /** Chat→draft staged copies (shown in draft panel; submitted with the form). */
      files: Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSizeBytes: number;
        sourceStagedId: string | null;
        attachedAt: string;
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
  return {
    ok: true,
    draft: ctx.draft,
    formKey: ctx.formKey,
    name: ctx.name,
    description: ctx.description,
    schema: ctx.schema,
    options: ctx.options,
    currentEmployeeId: ctx.currentEmployeeId,
    versionMismatch: ctx.versionMismatch,
    today: ctx.today,
    files: files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      fileSizeBytes: f.fileSizeBytes,
      sourceStagedId: f.sourceStagedId,
      attachedAt: f.attachedAt.toISOString(),
    })),
  };
}

export async function saveDraftAction(input: {
  draftId: string;
  expectedVersion: number;
  data: Record<string, unknown>;
}): Promise<
  | { ok: true; draft: ApplicationDraft }
  | { ok: false; error: string; draft?: ApplicationDraft; code?: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  try {
    const result = await patchApplicationDraft({
      draftId: input.draftId,
      ownerEmployeeId: employee.id,
      expectedVersion: input.expectedVersion,
      patch: input.data,
      replace: true,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: '草稿已被其他操作更新，請重新載入後再儲存。',
        code: 'version_conflict',
        draft: result.conflict.draft,
      };
    }
    return { ok: true, draft: result.draft };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'save_failed';
    return { ok: false, error: msg === 'draft_not_editable' ? '草稿已送出，無法再修改。' : '儲存失敗。' };
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
      contentText: `單據已送出：${result.formNumber}`,
      blocks: [
        {
          kind: 'action_result',
          id: `submit_${result.submissionId}`,
          action: 'submit',
          ok: true,
          message: `已送出 ${result.formNumber}`,
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
    blocks: [
      {
        kind: 'action_result',
        id: `nudge_${result.eventId || 'x'}`,
        action: 'nudge',
        ok: true,
        message,
      },
    ],
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
  return {
    ok: true,
    total: page.total,
    items: page.items.map((d) => ({
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

export async function pollLauncherEventsAction(input?: {
  cursorCreatedAt?: string | null;
}): Promise<
  | { ok: true; events: LauncherEvent[]; nextCursor: string | null }
  | { ok: false; error: string }
> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: publicError('unauthenticated') };
  const { allowed } = await hitRateLimit(`ai-chat:launcher:${employee.id}`, {
    limit: 120,
    windowSeconds: 600,
  });
  if (!allowed) return { ok: false, error: publicError('rate_limited') };
  const page = await pollLauncherEvents({
    employeeId: employee.id,
    cursorCreatedAt: input?.cursorCreatedAt,
  });
  return { ok: true, ...page };
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
