import type { AiMessageBlock } from './blocks';
import { loadAssistantInbox } from './inbox';

export const WELCOME_CLIENT_MESSAGE_ID_PREFIX = 'welcome_summary:';

export function welcomeClientMessageId(conversationId: string): string {
  return `${WELCOME_CLIENT_MESSAGE_ID_PREFIX}${conversationId}`;
}

export type WelcomeSummary = {
  text: string;
  blocks: AiMessageBlock[];
  fetchedAt: string;
  pendingCount: number;
  inProgressCount: number;
  progressTodayCount: number;
  loadError: string | null;
};

/**
 * Structured inbox welcome — numbers come only from authorized backend queries.
 * Gemini may rephrase later; this payload is authoritative when the model fails.
 */
export async function buildWelcomeSummary(conversationId: string): Promise<WelcomeSummary> {
  const inbox = await loadAssistantInbox(8);
  const fetchedAt = inbox.fetchedAt;
  const pendingCount = inbox.pendingTotal;
  const inProgressCount = inbox.mineTotal;

  if (inbox.loadError) {
    return {
      text: '待辦摘要暫時無法載入，請稍後再試。這不代表你沒有待辦。',
      blocks: [
        {
          kind: 'action_result',
          id: `welcome_err_${conversationId}`,
          action: 'welcome_summary',
          ok: false,
          message: '待辦摘要載入失敗',
        },
      ],
      fetchedAt,
      pendingCount: 0,
      inProgressCount: 0,
      progressTodayCount: 0,
      loadError: inbox.loadError,
    };
  }

  const progressTodayCount = inbox.progressToday;

  const timeLabel = new Date(fetchedAt).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
    day: 'numeric',
  });

  let text: string;
  if (pendingCount === 0 && inProgressCount === 0 && progressTodayCount === 0) {
    text = `你好，目前沒有待簽核或進行中的單據。（資料時間 ${timeLabel}）`;
  } else {
    const parts: string[] = [];
    if (pendingCount > 0) parts.push(`你目前有 ${pendingCount} 張單待簽核`);
    if (inProgressCount > 0) {
      let mine = `你送出的 ${inProgressCount} 張單仍在處理`;
      if (inbox.returnedTotal > 0) mine += `，其中 ${inbox.returnedTotal} 張被退回待補件`;
      parts.push(mine);
    }
    if (progressTodayCount > 0) parts.push(`今天有 ${progressTodayCount} 張單有新進度`);
    text = `${parts.join('；')}。（資料時間 ${timeLabel}）`;
  }

  const blocks: AiMessageBlock[] = [
    {
      kind: 'choice',
      id: `welcome_actions_${conversationId}`,
      prompt: '你可以：',
      options: [
        { id: 'view_pending', label: '查看待簽核', value: 'view_pending' },
        { id: 'view_mine', label: '查看送件進度', value: 'view_mine' },
        { id: 'open_draft_library', label: '開啟草稿庫', value: 'open_draft_library' },
        { id: 'create_form', label: '建立單據', value: 'create_form' },
      ],
      conversationId,
      status: 'open',
    },
  ];

  return {
    text,
    blocks: pendingCount === 0 && inProgressCount === 0 ? [] : blocks,
    fetchedAt,
    pendingCount,
    inProgressCount,
    progressTodayCount,
    loadError: null,
  };
}
