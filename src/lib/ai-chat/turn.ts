import type { CurrentEmployee } from '@/lib/auth/current-employee';
import { getServerLocale } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/messages';
import { AiChatConfigError, loadAiChatConfig, requireAiChatConfig } from './config';
import { appendMessage, getOwnedConversation, listMessages } from './conversations';
import { bindDraftToConversation, listConversationDrafts } from './drafts';
import { assertAiChatMessageRate, releaseEmployeeTurn, tryAcquireEmployeeTurn } from './limits';
import { mergeOpenResources, type OpenResourceEvent } from './open-resource';
import { compactConversationHistory, estimateTokensFromText } from './harness';
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

export function resolveTurnLocale(uiLocale: Locale, _userMessage?: string): Locale {
  return uiLocale;
}

function buildLanguageInstruction(locale: Locale): string {
  if (locale === 'ja') {
    return [
      '【語言要求 / 言語指示（最優先）】',
      '1. 現在の画面言語モードは「日（日本語 / Japanese）」です。過去の会話履歴（History）に中国語や英語のやり取りが含まれていても、本ターンの思考要約および回答は必ず自然で丁寧なビジネス日本語（です・ます調）のみで記述してください。中国語（繁體中文）や英語での回答は厳禁です。',
      '2. データベースやツールの返却値（申請書名、ステータス、部署名、摘要、ボタン案内など）が中国語であっても、回答文の中では自然な日本語に翻訳して説明してください（例：「用印申請單(合約類)」→「押印申請書（契約関連）」、「費用申請單(部門版)」→「経費申請書（部門版）」、「公出差旅申請單」→「出張申請書」、「出差報告暨旅費報支單」→「出張報告および旅費精算書」、「請購單」→「購買依頼書」、「全部核准」→「すべて承認」）。',
      '3. 書類番号（例：20261104CS9544）や申請者氏名（例：阮振瑋）はそのまま保持してください。Markdown のアスタリスク（**）や絵文字は使用しないでください。',
    ].join('\n');
  }
  if (locale === 'en') {
    return [
      '【Language Instruction (Highest Priority)】',
      '1. The active UI language mode for this turn is "EN (English)". Even if earlier messages in the conversation history were written in Traditional Chinese or Japanese, you MUST write your thinking summary and your entire response 100% in clear, professional English only. Do NOT respond in Chinese or Japanese.',
      '2. Even when database records, system work states, or tool outputs contain Chinese text (such as form names, summaries, department names, or status labels), translate them naturally into English in your explanation (e.g., "用印申請單(合約類)" -> "Seal Application (Contract)", "費用申請單(部門版)" -> "Expense Application (Department)", "公出差旅申請單" -> "Business Trip Application", "出差報告暨旅費報支單" -> "Trip Report & Travel Expense Claim", "請購單" -> "Purchase Request", "全部核准" -> "Approve all").',
      '3. Keep document numbers (e.g., 20261104CS9544) and person names intact. Do NOT use Markdown asterisks (**) or emojis.',
    ].join('\n');
  }
  return [
    '【語言要求（最優先）】',
    '1. 目前畫面語言模式為「中（繁體中文 zh-Hant）」。即使上方歷史對話紀錄（History）中曾出現日文（日本語）或英文回覆，本回合已切換為繁體中文模式，請務必 100% 使用繁體中文（臺灣商務用語）撰寫所有思考過程與最終回覆，嚴禁延續歷史訊息輸出日文或英文句子！',
    '2. 語氣清楚精簡，不使用 Markdown 雙星號（**）或 Emoji。',
  ].join('\n');
}

export function publicError(raw: string, locale: Locale = 'zh-Hant'): string {
  const code = raw.split('\n')[0] ?? raw;
  if (locale === 'en') {
    switch (true) {
      case code === 'rate_limited':
        return 'Too many requests. Please try again shortly.';
      case code === 'busy':
        return 'The previous response is still processing. Please wait a moment.';
      case code === 'task_timeout' || code.startsWith('task_timeout'):
        return 'The request timed out. Please try again.';
      case code === 'model_empty_text' || code.startsWith('model_empty_text'):
        return 'The model returned an empty response. Please try again.';
      case code === 'unauthenticated':
        return 'Please sign in before using the AI Assistant.';
      case code === 'empty_user_content':
        return 'Please enter a message or upload an image.';
      case code === 'conversation_not_found' || code === 'conversation_forbidden':
        return 'Conversation not found or access denied.';
      default:
        if (code.startsWith('model_http_')) return 'Unable to connect to the language model right now. Please try again later.';
        return 'Request failed. Please try again later.';
    }
  }
  if (locale === 'ja') {
    switch (true) {
      case code === 'rate_limited':
        return '操作が頻繁すぎます。しばらくしてから再試行してください。';
      case code === 'busy':
        return '前の回答を処理中です。少々お待ちください。';
      case code === 'task_timeout' || code.startsWith('task_timeout'):
        return '応答がタイムアウトしました。もう一度お試しください。';
      case code === 'model_empty_text' || code.startsWith('model_empty_text'):
        return 'モデルから応答がありませんでした。もう一度お試しください。';
      case code === 'unauthenticated':
        return 'AI アシスタントを利用するにはログインしてください。';
      case code === 'empty_user_content':
        return 'メッセージを入力するか、画像をアップロードしてください。';
      case code === 'conversation_not_found' || code === 'conversation_forbidden':
        return 'スレッドが見つからないか、アクセス権限がありません。';
      default:
        if (code.startsWith('model_http_')) return '現在言語モデルに接続できません。しばらくしてから再試行してください。';
        return '処理に失敗しました。しばらくしてから再試行してください。';
    }
  }
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
  locale?: Locale;
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
    signal?: AbortSignal;
  } = {}
): Promise<AiChatActionResult> {

  if (!tryAcquireEmployeeTurn(employee.id)) {
    return { ok: false, error: publicError('busy') };
  }

  let trace: TurnTrace | null = null;
  /** Set once the person's message is stored, so a failure can be recorded next to it. */
  let storedTurn: { conversationId: string; replayed: boolean } | null = null;
  try {
    const { getSystemFeatureFlags } = await import('@/lib/feature-flags/service');
    const featureFlags = await getSystemFeatureFlags();
    if (!featureFlags.ai_chat && !featureFlags.global_floating_assistant) {
      return {
        ok: false,
        error:
          '「AI 助手」模組目前於全公司系統授權中為未開放／已關閉狀態，包含系統管理員在內全體人員皆無法使用。',
      };
    }

    try {
      await assertAiChatMessageRate(employee.id);
    } catch {
      return { ok: false, error: publicError('rate_limited') };
    }

    const cfg = requireAiChatConfig();
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const clientMessageId =
      typeof input.clientMessageId === 'string' ? input.clientMessageId.trim() : '';
    let uiLocale: Locale = 'zh-Hant';
    if (input.locale === 'en' || input.locale === 'ja' || input.locale === 'zh-Hant') {
      uiLocale = input.locale;
    } else {
      try {
        uiLocale = await getServerLocale();
      } catch {
        uiLocale = 'zh-Hant';
      }
    }
    const turnLocale = resolveTurnLocale(uiLocale, message);

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
    const rawHistory = historyRows
      .filter((m) => m.role === 'user' || m.role === 'model')
      .filter((m) => m.id !== userAppend.id)
      .slice(-cfg.maxHistoryTurns)
      .map((m) => ({ role: m.role as 'user' | 'model', text: m.contentText }));

    const compaction = compactConversationHistory(rawHistory, {
      maxContextTokens: 24_000,
      compactionThresholdRatio: 0.7,
      currentTurnTokens: estimateTokensFromText(message),
    });
    const history = compaction.compacted;

    const rawConversationDrafts = await listConversationDrafts(conversation.id, employee.id);
    const openDrafts = rawConversationDrafts.map((d) => ({
      draftId: d.id,
      formKey: d.formDefinitionKey,
      formVersionId: d.formVersionId,
      version: d.version,
      status: d.status,
      filledKeys: Object.keys(d.data ?? {}),
    }));
    trace.emit('turn.context', {
      historyTurns: history.length,
      rawHistoryTurns: rawHistory.length,
      didCompact: compaction.didCompact,
      estimatedTokensBefore: compaction.estimatedTokensBefore,
      estimatedTokensAfter: compaction.estimatedTokensAfter,
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
    userParts.push({ type: 'text', text: buildLanguageInstruction(turnLocale) });
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

    const { text, usage, toolsUsed, blocks, openResources } = await generateChatReply(
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
        locale: turnLocale,
      },
      options.signal,
      trace,
      options.onProgress
    );

    const extractDistinctiveTokens = (
      rawLabel: string,
      extraData?: Record<string, unknown>
    ): string[] => {
      const cleaned = (rawLabel || '')
        .replace(
          /\b(11[0-9]|202[0-9])\b|年度|部門年度預算|專案年度預算|部門預算|專案預算|預算表|預算單|預算編列|預算規劃|編列草稿|申請單|報支單|請購單|採購單|驗收單|用印申請|草稿|專案|部門|一般|版|共\s*\d+\s*項預算科目/g,
          ' '
        )
        .replace(/\b\d+\.\s*/g, ' ');
      const rawTokens = cleaned
        .split(/[()（）[\]【】｜|·,，、：:\s/]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2);

      const tokens = new Set<string>();
      for (const tok of rawTokens) {
        tokens.add(tok);
        if (tok.length >= 3 && (tok.endsWith('專案') || tok.endsWith('部門') || tok.endsWith('部'))) {
          const stripped = tok.replace(/(專案|部門|部)$/, '').trim();
          if (stripped.length >= 2) tokens.add(stripped);
        }
      }
      if (extraData && typeof extraData === 'object') {
        for (const k of ['projectCode', 'departmentCode', 'departmentName', 'vendorName', 'subject']) {
          const val = extraData[k];
          if (typeof val === 'string' && val.trim().length >= 2) {
            tokens.add(val.trim());
          }
        }
      }
      return Array.from(tokens);
    };

    const tokenMatchesText = (token: string, haystack: string): boolean => {
      if (!token || !haystack) return false;
      if (/^[A-Za-z0-9_-]{2,4}$/.test(token)) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(haystack);
      }
      return haystack.toLowerCase().includes(token.toLowerCase());
    };

    const activeDrafts = rawConversationDrafts.filter((d) => d.status === 'draft');
    const draftById = new Map(activeDrafts.map((d) => [d.id, d]));

    // 1. If a tool returned multiple cards (e.g. list_my_budget_tasks_and_history),
    //    prune cards that were NOT mentioned at all when the reply is focused on a specific single item.
    const cardBlocks = blocks.filter(
      (b) => b.kind === 'draft_reference' || b.kind === 'submission_card'
    );
    if (cardBlocks.length > 1) {
      const isListOverviewQuery =
        /有哪些|所有|全部|清單|列表|總覽|幾個|幾張|待辦|歷史|歷年/i.test(message) &&
        !/另外一張|另一張|切換|開啟|打開|編輯|修改/i.test(message);

      if (!isListOverviewQuery) {
        const cardMatchesReply = (b: AiMessageBlock): boolean => {
          if (b.kind === 'draft_reference') {
            if (text.includes(b.draftId) || message.includes(b.draftId)) return true;
            const dRow = draftById.get(b.draftId);
            const tokens = extractDistinctiveTokens(
              b.formName || dRow?.title || '',
              (dRow?.data ?? undefined) as Record<string, unknown> | undefined
            );
            return tokens.some((tok) => tokenMatchesText(tok, text) || tokenMatchesText(tok, message));
          }
          if (b.kind === 'submission_card') {
            if (b.formNumber && (text.includes(b.formNumber) || message.includes(b.formNumber))) {
              return true;
            }
            if (text.includes(b.formId) || message.includes(b.formId)) return true;
            const tokens = extractDistinctiveTokens(`${b.formName} ${b.summary ?? ''}`);
            return (
              Boolean(b.formNumber && text.includes(b.formNumber)) ||
              (tokens.length > 0 &&
                tokens.every((tok) => tokenMatchesText(tok, text)))
            );
          }
          return true;
        };

        const matchedCards = cardBlocks.filter(cardMatchesReply);
        if (matchedCards.length > 0 && matchedCards.length < cardBlocks.length) {
          const keepIds = new Set(matchedCards.map((c) => c.id));
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i]!;
            if (
              (b.kind === 'draft_reference' || b.kind === 'submission_card') &&
              !keepIds.has(b.id)
            ) {
              blocks.splice(i, 1);
            }
          }
          // Ensure openResources opens the matched draft if one was matched
          const matchedDraftBlock = matchedCards.find(
            (c): c is Extract<AiMessageBlock, { kind: 'draft_reference' }> =>
              c.kind === 'draft_reference'
          );
          if (matchedDraftBlock) {
            openResources.length = 0;
            openResources.push({
              type: 'open_resource',
              resourceType: 'application_draft',
              resourceId: matchedDraftBlock.draftId,
              title: matchedDraftBlock.formName,
              version: matchedDraftBlock.version,
              operation: 'opened',
              formKey: matchedDraftBlock.formKey,
              status: matchedDraftBlock.status,
            });
          }
        }
      }
    }

    // 2. Ensure any reply that discusses active draft(s) from workState (even when the model did not invoke a draft tool,
    //    or only invoked list_my_approval_queue while also listing active drafts in text)
    //    includes the relevant draft_reference card(s) and opens the right-side panel when switching/opening a single draft.
    const hasCardBlock = blocks.some(
      (b) => b.kind === 'draft_reference' || b.kind === 'submission_card'
    );
    if (activeDrafts.length > 0) {
      const existingDraftIds = new Set(
        blocks
          .filter(
            (b): b is Extract<AiMessageBlock, { kind: 'draft_reference' }> =>
              b.kind === 'draft_reference'
          )
          .map((b) => b.draftId)
      );
      const combinedText = `${message}\n${text}`;
      // First look for drafts whose distinctive tokens (e.g. PJ-389, NSC, 資訊安全部, IS) are explicitly mentioned in the reply/message
      const specificallyMatched = activeDrafts.filter((d) => {
        if (existingDraftIds.has(d.id)) return false;
        if (text.includes(d.id) || message.includes(d.id)) return true;
        const tokens = extractDistinctiveTokens(
          d.title || '',
          (d.data ?? undefined) as Record<string, unknown> | undefined
        );
        return tokens.some((tok) => tokenMatchesText(tok, text) || tokenMatchesText(tok, message));
      });

      let toAttach = specificallyMatched;
      if (toAttach.length === 0 && !hasCardBlock) {
        // No specific project/department token was mentioned and no other cards exist:
        // fall back ONLY to the single currently focused draft
        const focused = focusDraftId ? activeDrafts.find((d) => d.id === focusDraftId) : undefined;
        if (
          focused &&
          /草稿|規劃|預算|申請|表單|單據|填寫|修改|明細|欄位|開啟|打開|檢視|詳情/i.test(combinedText)
        ) {
          toAttach = [focused];
        } else if (/有哪些草稿|所有草稿|全部草稿/i.test(message)) {
          toAttach = activeDrafts.slice(0, 3);
        }
      }

      for (const d of toAttach) {
        blocks.push({
          kind: 'draft_reference',
          id: `draft_${d.id}`,
          draftId: d.id,
          formKey: d.formDefinitionKey,
          formName: d.title || d.formDefinitionKey,
          version: d.version,
          status: d.status,
        });
      }

      // If a single draft is the sole card of this turn (e.g. "我們編輯另外一張預算規劃吧 NSC那個" or "你可以幫我開啟嗎"),
      // automatically emit open_resource so the right-side DraftPanel opens/switches immediately!
      if (!hasCardBlock && toAttach.length === 1 && openResources.length === 0) {
        const target = toAttach[0]!;
        const wantsSwitchOrOpen =
          target.id !== focusDraftId ||
          /開啟|打開|切換|編輯|修改|另外一張|另一張|看這張|檢視|詳情/i.test(message);
        if (wantsSwitchOrOpen) {
          openResources.push({
            type: 'open_resource',
            resourceType: 'application_draft',
            resourceId: target.id,
            title: target.title || target.formDefinitionKey,
            version: target.version,
            operation: 'opened',
            formKey: target.formDefinitionKey,
            status: target.status,
          });
        }
      }
    }

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

    trace.emit('turn.end', { ok: true, toolsUsed, replyChars: text.length, usage: usage ?? null });
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

