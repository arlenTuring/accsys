import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { listUnreadForEmployee, listVisibleAnnouncements } from '@/lib/announcements/service';
import { listPendingSurveysForEmployee } from '@/lib/surveys/service';
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
  unreadAnnouncementCount: number;
  pendingSurveyCount: number;
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
  const employee = await getCurrentEmployee();
  const unreadAnnouncements = employee
    ? await listUnreadForEmployee({
        employeeId: employee.id,
        departmentId: employee.departmentId,
        limit: 5,
      })
    : [];
  const recentAnnouncements =
    employee && unreadAnnouncements.length === 0
      ? (
          await listVisibleAnnouncements({
            employeeId: employee.id,
            departmentId: employee.departmentId,
            manage: false,
          })
        ).slice(0, 3)
      : [];
  const pendingSurveys = employee
    ? await listPendingSurveysForEmployee({
        employeeId: employee.id,
        departmentId: employee.departmentId,
        limit: 5,
      })
    : [];

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
      unreadAnnouncementCount: unreadAnnouncements.length,
      pendingSurveyCount: pendingSurveys.length,
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
  const greeting = employee ? `你好，${employee.name}！我是你的 ACCSYS 企業 AI 助手。` : '你好！我是你的 ACCSYS 企業 AI 助手。';
  const quiet =
    pendingCount === 0 &&
    inProgressCount === 0 &&
    progressTodayCount === 0 &&
    unreadAnnouncements.length === 0 &&
    recentAnnouncements.length === 0 &&
    pendingSurveys.length === 0;
  if (quiet) {
    text = `${greeting}\n目前沒有待簽核、進行中的單據、最新公告或待填問卷。（資料時間 ${timeLabel}）`;
  } else {
    const parts: string[] = [];
    if (pendingCount > 0) parts.push(`📋 **待我簽核**：目前有 **${pendingCount} 張**單據等待你審核簽核`);
    if (inProgressCount > 0) {
      let mine = `📤 **我的申請**：你送出的 **${inProgressCount} 張**單據正在簽核流程中`;
      if (inbox.returnedTotal > 0) mine += `（其中 **${inbox.returnedTotal} 張**被退回待補件）`;
      parts.push(mine);
    }
    if (progressTodayCount > 0) parts.push(`🔔 今天有 **${progressTodayCount} 張**單據有新進度`);
    if (unreadAnnouncements.length > 0) {
      const titles = unreadAnnouncements.map((a) => `「${a.title}」`).join('、');
      parts.push(`📢 **未讀公告（${unreadAnnouncements.length} 則）**：${titles}`);
    } else if (recentAnnouncements.length > 0) {
      const titles = recentAnnouncements.map((a) => `「${a.title}」`).join('、');
      parts.push(`📢 **近期公司公告**：${titles}`);
    }
    if (pendingSurveys.length > 0) {
      const titles = pendingSurveys.map((s) => `「${s.title}」`).join('、');
      parts.push(`📝 **待填問卷（${pendingSurveys.length} 份）**：${titles}`);
    }
    text = `${greeting}為你整理今日重點摘要（${timeLabel}）：\n\n- ${parts.join('\n- ')}`;
  }

  const options: Array<{ id: string; label: string; value: string }> = [];
  if (pendingCount > 0) options.push({ id: 'view_pending', label: `查看待簽核 (${pendingCount})`, value: 'view_pending' });
  if (inProgressCount > 0) options.push({ id: 'view_mine', label: `查看送件進度 (${inProgressCount})`, value: 'view_mine' });
  if (unreadAnnouncements.length > 0 || recentAnnouncements.length > 0) {
    options.push({
      id: 'view_announcements',
      label: unreadAnnouncements.length > 0 ? `查看未讀公告 (${unreadAnnouncements.length})` : '查看近期公告',
      value: 'view_announcements',
    });
  }
  if (pendingSurveys.length > 0) {
    options.push({ id: 'view_surveys', label: '填寫待辦問卷', value: 'view_surveys' });
  }
  options.push(
    { id: 'open_draft_library', label: '開啟我的申請草稿庫', value: 'open_draft_library' },
    { id: 'create_form', label: '建立單據', value: 'create_form' }
  );

  const hasInboxWork =
    pendingCount > 0 ||
    inProgressCount > 0 ||
    unreadAnnouncements.length > 0 ||
    recentAnnouncements.length > 0 ||
    pendingSurveys.length > 0;

  const blocks: AiMessageBlock[] = hasInboxWork
    ? [
        {
          kind: 'choice',
          id: `welcome_actions_${conversationId}`,
          prompt: '你可以：',
          options,
          conversationId,
          status: 'open',
        },
      ]
    : [];

  return {
    text,
    blocks,
    fetchedAt,
    pendingCount,
    inProgressCount,
    progressTodayCount,
    unreadAnnouncementCount: unreadAnnouncements.length,
    pendingSurveyCount: pendingSurveys.length,
    loadError: null,
  };
}
