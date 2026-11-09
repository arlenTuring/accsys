import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { listUnreadForEmployee, listVisibleAnnouncements } from '@/lib/announcements/service';
import { getServerLocale } from '@/lib/i18n/server';
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
 * Localized according to the user's current locale ('zh-Hant' | 'en' | 'ja').
 */
export async function buildWelcomeSummary(conversationId: string): Promise<WelcomeSummary> {
  const [inbox, employee, locale] = await Promise.all([
    loadAssistantInbox(8),
    getCurrentEmployee(),
    getServerLocale(),
  ]);
  const fetchedAt = inbox.fetchedAt;
  const pendingCount = inbox.pendingTotal;
  const inProgressCount = inbox.mineTotal;

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
    const errMsg =
      locale === 'en'
        ? 'Summary temporarily unavailable. Please try again later.'
        : locale === 'ja'
          ? '要約を一時的に読み込めませんでした。後ほど再試行してください。'
          : '待辦摘要暫時無法載入，請稍後再試。這不代表你沒有待辦。';
    return {
      text: errMsg,
      blocks: [
        {
          kind: 'action_result',
          id: `welcome_err_${conversationId}`,
          action: 'welcome_summary',
          ok: false,
          message: errMsg,
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

  const dateLocale = locale === 'zh-Hant' ? 'zh-TW' : locale;
  const timeLabel = new Date(fetchedAt).toLocaleString(dateLocale, {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
    day: 'numeric',
  });

  const quiet =
    pendingCount === 0 &&
    inProgressCount === 0 &&
    progressTodayCount === 0 &&
    unreadAnnouncements.length === 0 &&
    recentAnnouncements.length === 0 &&
    pendingSurveys.length === 0;

  let text: string;
  const options: Array<{ id: string; label: string; value: string }> = [];

  if (locale === 'en') {
    const greeting = employee
      ? `Hello, ${employee.name}! I am your ACCSYS Enterprise AI Assistant.`
      : 'Hello! I am your ACCSYS Enterprise AI Assistant.';
    if (quiet) {
      text = `${greeting}\nThere are currently no pending approvals, active applications, new announcements, or pending surveys. (As of ${timeLabel})`;
    } else {
      const parts: string[] = [];
      if (pendingCount > 0)
        parts.push(`Waiting for Your Approval: ${pendingCount} request(s) ready for review`);
      if (inProgressCount > 0) {
        const pendingApprovalOnly = Math.max(0, inProgressCount - inbox.returnedTotal);
        let mine = `My Applications: ${pendingApprovalOnly} form(s) pending approval`;
        if (inbox.returnedTotal > 0)
          mine += `, ${inbox.returnedTotal} returned for revision`;
        parts.push(mine);
      }
      if (progressTodayCount > 0)
        parts.push(`${progressTodayCount} form(s) updated today`);
      if (unreadAnnouncements.length > 0) {
        const titles = unreadAnnouncements.map((a) => `“${a.title}”`).join(', ');
        parts.push(`Unread Announcements (${unreadAnnouncements.length}): ${titles}`);
      } else if (recentAnnouncements.length > 0) {
        const titles = recentAnnouncements.map((a) => `“${a.title}”`).join(', ');
        parts.push(`Recent Announcements: ${titles}`);
      }
      if (pendingSurveys.length > 0) {
        const titles = pendingSurveys.map((s) => `“${s.title}”`).join(', ');
        parts.push(`Pending Surveys (${pendingSurveys.length}): ${titles}`);
      }
      text = `${greeting} Here is your daily briefing (${timeLabel}):\n\n- ${parts.join('\n- ')}`;
    }

    if (pendingCount > 0)
      options.push({ id: 'view_pending', label: `To Approve (${pendingCount})`, value: 'view_pending' });
    if (inProgressCount > 0)
      options.push({ id: 'view_mine', label: `My Progress (${inProgressCount})`, value: 'view_mine' });
    if (unreadAnnouncements.length > 0 || recentAnnouncements.length > 0) {
      options.push({
        id: 'view_announcements',
        label:
          unreadAnnouncements.length > 0
            ? `Unread Announcements (${unreadAnnouncements.length})`
            : 'Recent Announcements',
        value: 'view_announcements',
      });
    }
    if (pendingSurveys.length > 0) {
      options.push({ id: 'view_surveys', label: 'Fill Out Surveys', value: 'view_surveys' });
    }
    options.push(
      { id: 'open_draft_library', label: 'Open Draft Library', value: 'open_draft_library' },
      { id: 'create_form', label: 'Create Form', value: 'create_form' }
    );
  } else if (locale === 'ja') {
    const greeting = employee
      ? `こんにちは、${employee.name}さん！ACCSYS 企業 AI アシスタントです。`
      : 'こんにちは！ACCSYS 企業 AI アシスタントです。';
    if (quiet) {
      text = `${greeting}\n現在、承認待ち・進行中の申請書・新着のお知らせ・未回答のアンケートはありません。（取得時刻 ${timeLabel}）`;
    } else {
      const parts: string[] = [];
      if (pendingCount > 0)
        parts.push(`承認待ち（自分）：現在 ${pendingCount} 件の申請書があなたの承認を待っています`);
      if (inProgressCount > 0) {
        const pendingApprovalOnly = Math.max(0, inProgressCount - inbox.returnedTotal);
        let mine = `自分の申請：承認進行中 ${pendingApprovalOnly} 件`;
        if (inbox.returnedTotal > 0)
          mine += `、差戻し・再提出待ち ${inbox.returnedTotal} 件`;
        parts.push(mine);
      }
      if (progressTodayCount > 0)
        parts.push(`本日 ${progressTodayCount} 件の申請書に進捗がありました`);
      if (unreadAnnouncements.length > 0) {
        const titles = unreadAnnouncements.map((a) => `「${a.title}」`).join('、');
        parts.push(`未読のお知らせ（${unreadAnnouncements.length} 件）：${titles}`);
      } else if (recentAnnouncements.length > 0) {
        const titles = recentAnnouncements.map((a) => `「${a.title}」`).join('、');
        parts.push(`最近の社内お知らせ：${titles}`);
      }
      if (pendingSurveys.length > 0) {
        const titles = pendingSurveys.map((s) => `「${s.title}」`).join('、');
        parts.push(`未回答アンケート（${pendingSurveys.length} 件）：${titles}`);
      }
      text = `${greeting}本日の重要サマリー（${timeLabel}）：\n\n- ${parts.join('\n- ')}`;
    }

    if (pendingCount > 0)
      options.push({ id: 'view_pending', label: `承認待ちを確認 (${pendingCount})`, value: 'view_pending' });
    if (inProgressCount > 0)
      options.push({ id: 'view_mine', label: `申請進捗を確認 (${inProgressCount})`, value: 'view_mine' });
    if (unreadAnnouncements.length > 0 || recentAnnouncements.length > 0) {
      options.push({
        id: 'view_announcements',
        label:
          unreadAnnouncements.length > 0
            ? `未読のお知らせ (${unreadAnnouncements.length})`
            : '最近のお知らせを見る',
        value: 'view_announcements',
      });
    }
    if (pendingSurveys.length > 0) {
      options.push({ id: 'view_surveys', label: 'アンケートに回答', value: 'view_surveys' });
    }
    options.push(
      { id: 'open_draft_library', label: '下書き一覧を開く', value: 'open_draft_library' },
      { id: 'create_form', label: '申請書を作成', value: 'create_form' }
    );
  } else {
    const greeting = employee
      ? `你好，${employee.name}！我是你的 ACCSYS 企業 AI 助手。`
      : '你好！我是你的 ACCSYS 企業 AI 助手。';
    if (quiet) {
      text = `${greeting}\n目前沒有待簽核、進行中的單據、最新公告或待填問卷。（資料時間 ${timeLabel}）`;
    } else {
      const parts: string[] = [];
      if (pendingCount > 0)
        parts.push(`待我簽核：目前有 ${pendingCount} 張單據等待你審核簽核`);
      if (inProgressCount > 0) {
        const pendingApprovalOnly = Math.max(0, inProgressCount - inbox.returnedTotal);
        let mine = `我的申請：目前有 ${pendingApprovalOnly} 張簽核中`;
        if (inbox.returnedTotal > 0) mine += `、${inbox.returnedTotal} 張已退回待補件`;
        parts.push(mine);
      }
      if (progressTodayCount > 0) parts.push(`今天有 ${progressTodayCount} 張單據有新進度`);
      if (unreadAnnouncements.length > 0) {
        const titles = unreadAnnouncements.map((a) => `「${a.title}」`).join('、');
        parts.push(`未讀公告（${unreadAnnouncements.length} 則）：${titles}`);
      } else if (recentAnnouncements.length > 0) {
        const titles = recentAnnouncements.map((a) => `「${a.title}」`).join('、');
        parts.push(`近期公司公告：${titles}`);
      }
      if (pendingSurveys.length > 0) {
        const titles = pendingSurveys.map((s) => `「${s.title}」`).join('、');
        parts.push(`待填問卷（${pendingSurveys.length} 份）：${titles}`);
      }
      text = `${greeting}為你整理今日重點摘要（${timeLabel}）：\n\n- ${parts.join('\n- ')}`;
    }

    if (pendingCount > 0)
      options.push({ id: 'view_pending', label: `查看待簽核 (${pendingCount})`, value: 'view_pending' });
    if (inProgressCount > 0)
      options.push({ id: 'view_mine', label: `查看送件進度 (${inProgressCount})`, value: 'view_mine' });
    if (unreadAnnouncements.length > 0 || recentAnnouncements.length > 0) {
      options.push({
        id: 'view_announcements',
        label:
          unreadAnnouncements.length > 0
            ? `查看未讀公告 (${unreadAnnouncements.length})`
            : '查看近期公告',
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
  }

  const hasInboxWork =
    pendingCount > 0 ||
    inProgressCount > 0 ||
    unreadAnnouncements.length > 0 ||
    recentAnnouncements.length > 0 ||
    pendingSurveys.length > 0;

  const choicePrompt =
    locale === 'en' ? 'Quick Actions:' : locale === 'ja' ? 'クイック操作：' : '你可以：';

  const blocks: AiMessageBlock[] = hasInboxWork
    ? [
        {
          kind: 'choice',
          id: `welcome_actions_${conversationId}`,
          prompt: choicePrompt,
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
