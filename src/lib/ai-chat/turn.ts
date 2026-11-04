import type { CurrentEmployee } from '@/lib/auth/current-employee';
import { AiChatConfigError, loadAiChatConfig, requireAiChatConfig } from './config';
import { appendMessage, getOwnedConversation, listMessages } from './conversations';
import { bindDraftToConversation, listConversationDrafts } from './drafts';
import { assertAiChatMessageRate, releaseEmployeeTurn, tryAcquireEmployeeTurn } from './limits';
import { mergeOpenResources, type OpenResourceEvent } from './open-resource';
import { generateChatReply, type UserContentPart } from './vertex-client';
import { sanitizeBlocks, type AiMessageBlock } from './blocks';
import { readEditAnalysis } from './file-edits';
import { summarize, TurnTrace } from './trace';
import { buildWorkState, type FillOptions } from './draft-work';

export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);


export function openResourcesFromDraftBlocks(
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

export function publicError(raw: string): string {
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

export type AssistantTurnInput = {
  message: string;
  clientMessageId: string;
  conversationId?: string | null;
  /** Preferred: staged attachment IDs (already scanned). */
  stagedAttachmentIds?: string[];
  /** Legacy inline images (base64). Prefer stagedAttachmentIds. */
  images?: Array<{ mimeType: string; base64: string; fileName?: string }>;
  /** Draft open on the person's screen (draft library / tab); linked to this conversation after an owner check. */
  targetDraftId?: string | null;
  /**
   * When the person taps「接續回覆」on a model message: the assistant turn is
   * about that reply. Stored user text stays plain; context is injected for the model only.
   */
  replyToMessageId?: string | null;
};

/**
 * One assistant turn for an already authenticated employee. Server-only:
 * callers must pass the session employee (sendAiChatMessage) -- never a value
 * from the client. Lives outside the 'use server' module on purpose.
 */
function clientMessageIdOf(input: AssistantTurnInput): string {
  return String(input.clientMessageId ?? '').slice(0, 80);
}

export async function runAssistantTurn(
  employee: CurrentEmployee,
  input: AssistantTurnInput,
  options: {
    persistTrace?: boolean;
    fill?: FillOptions;
    onProgress?: import('./progress').TurnProgressSink;
  } = {}
): Promise<AiChatActionResult> {

  if (!tryAcquireEmployeeTurn(employee.id)) {
    return { ok: false, error: publicError('busy') };
  }

  let trace: TurnTrace | null = null;
  /** Set once the person's message is stored, so a failure can be recorded next to it. */
  let storedTurn: { conversationId: string; replayed: boolean } | null = null;
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
    const { getReadyStagedImagesForOwner, markStagedSent } = await import('./staged-images');
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

    trace = new TurnTrace(clientMessageId, conversation.id, employee.id, options.persistTrace !== false);
    trace.emit('turn.start', {
      employeeId: employee.id,
      conversationId: conversation.id,
      model: cfg.model,
      messageChars: message.length,
      stagedCount: staged.length,
    });

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
    storedTurn = { conversationId: conversation.id, replayed: Boolean(userAppend.replayed) };

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

    const openDrafts = (await listConversationDrafts(conversation.id, employee.id)).map((d) => ({
      draftId: d.id,
      formKey: d.formDefinitionKey,
      formVersionId: d.formVersionId,
      version: d.version,
      status: d.status,
      filledKeys: Object.keys(d.data ?? {}),
    }));
    trace.emit('turn.context', {
      historyTurns: history.length,
      historyCarriesDraftIds: history.some((h) => /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(h.text)),
      conversationDrafts: openDrafts,
      replayed: Boolean(userAppend.replayed),
    });

    let focusDraftId: string | null = null;
    if (typeof input.targetDraftId === 'string' && /^[0-9a-f-]{36}$/i.test(input.targetDraftId)) {
      const bound = await bindDraftToConversation({ conversationId: conversation.id, draftId: input.targetDraftId, ownerEmployeeId: employee.id });
      trace.emit('turn.context', { targetDraftId: input.targetDraftId, bound: bound.ok ? (bound.linked ? 'linked' : 'already') : bound.error });
      if (bound.ok) focusDraftId = bound.draft.id;
    }
    // Authoritative state from the database, sent to the model only (not stored as the user's message).
    const workState = await buildWorkState({
      conversationId: conversation.id,
      ownerEmployeeId: employee.id,
      focusDraftId,
      userMessage: message,
    });
    trace.emit('turn.work_state', { chars: workState.length, text: summarize(workState) });
    const userParts: UserContentPart[] = [{ type: 'text', text: workState }];

    const replyToId =
      typeof input.replyToMessageId === 'string' && /^[0-9a-f-]{36}$/i.test(input.replyToMessageId)
        ? input.replyToMessageId
        : null;
    if (replyToId) {
      const { getOwnedModelMessage } = await import('./conversations');
      const quoted = await getOwnedModelMessage(conversation.id, employee.id, replyToId);
      if (quoted) {
        const clip = quoted.contentText.replace(/\s+/g, ' ').trim().slice(0, 1200);
        userParts.push({
          type: 'text',
          text: `【使用者正在針對助手上一則回覆作回應】\n助手當時說：\n${clip}${quoted.contentText.length > 1200 ? '…' : ''}\n請依使用者下方訊息回應該內容；把它當成延續該則回覆的對話，不要當成無關的新話題。`,
        });
        trace.emit('turn.context', { replyToMessageId: quoted.id, quotedChars: quoted.contentText.length });
      }
    }

    if (message) userParts.push({ type: 'text', text: `【使用者訊息】\n${message}` });
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
    if (message) {
      const { buildMentionContextHint } = await import('./mentions');
      const mentionHint = await buildMentionContextHint(message);
      if (mentionHint) {
        userParts.push({ type: 'text', text: mentionHint });
      }
      const { intentHintsForUserMessage } = await import('./intent-hints');
      for (const hint of intentHintsForUserMessage(message)) {
        userParts.push({ type: 'text', text: hint });
      }
    }
    // Inline vision only for reasonably small files. Large photos stay staged-only
    // (model still gets staged ids + attach tool). Avoids model_empty / payload failures.
    const INLINE_RAW_MAX = 7 * 1024 * 1024;
    if (staged.length > 0) {
      for (const img of staged) {
        // An edited photo reaches the model without its annotations (see file-edits.ts).
        const copy = img.activeEditId ? await readEditAnalysis(img.activeEditId, employee.id) : null;
        const bytes = copy?.bytes ?? img.bytes;
        if (bytes.length > INLINE_RAW_MAX) continue;
        userParts.push({ type: 'image', mimeType: copy?.mimeType ?? img.mimeType, base64: Buffer.from(bytes).toString('base64') });
      }
      await markStagedSent(employee.id, staged.map((s) => s.id));
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
        actor: employee,
        fill: options.fill,
      },
      undefined,
      trace,
      options.onProgress
    );

    const safeBlocks = sanitizeBlocks(blocks, conversation.id);
    const uiOpen = mergeOpenResources(openResources);
    trace.emit('turn.ui_events', {
      openResources: uiOpen.map((o) => ({ resourceId: o.resourceId, operation: o.operation, version: o.version })),
      blockKinds: safeBlocks.map((b) => b.kind),
      blocksDroppedBySanitize: blocks.length - safeBlocks.length,
    });
    const modelAppend = await appendMessage({
      conversationId: conversation.id,
      ownerEmployeeId: employee.id,
      role: 'model',
      contentText: text,
      toolsUsed,
      blocks: safeBlocks,
    });

    trace.emit('turn.end', { ok: true, toolsUsed, replyChars: text.length });
    return {
      ok: true,
      reply: text,
      model: cfg.model,
      toolsUsed,
      blocks: safeBlocks,
      conversationId: conversation.id,
      userMessageId: userAppend.id,
      modelMessageId: modelAppend.id,
      openResources: uiOpen,
    };
  } catch (err) {
    const raw =
      err instanceof AiChatConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'unknown';
    console.error('[ai-chat]', { employeeId: employee.id, error: raw.slice(0, 500) });
    trace?.emit('turn.error', { error: raw.split('\n')[0]!.slice(0, 200), publicError: publicError(raw) });
    // Keep the failure next to the stored message, so a reload shows why there is no answer.
    if (storedTurn && !storedTurn.replayed) {
      try {
        await appendMessage({
          conversationId: storedTurn.conversationId,
          ownerEmployeeId: employee.id,
          role: 'system',
          contentText: `這則訊息沒有處理完成：${publicError(raw)} 草稿沒有因這則訊息變更。`,
          clientMessageId: `${clientMessageIdOf(input)}:failed`,
        });
      } catch {
        // best-effort
      }
    }
    return { ok: false, error: publicError(raw) };
  } finally {
    releaseEmployeeTurn(employee.id);
    await trace?.flush();
  }
}

