export type Locale = 'zh-Hant' | 'en' | 'ja';

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-Hant', 'en', 'ja'] as const;
export const DEFAULT_LOCALE: Locale = 'zh-Hant';
export const LOCALE_COOKIE_NAME = 'accsys_locale';

export const LOCALE_LABELS: Record<Locale, { native: string; short: string; flag: string }> = {
  'zh-Hant': { native: '繁體中文', short: '中', flag: '🇹🇼' },
  en: { native: 'English', short: 'EN', flag: '🇺🇸' },
  ja: { native: '日本語', short: '日', flag: '🇯🇵' },
};

export function normalizeLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const v = raw.trim().toLowerCase();
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v === 'ja' || v.startsWith('ja-')) return 'ja';
  if (v === 'zh' || v.startsWith('zh-')) return 'zh-Hant';
  return DEFAULT_LOCALE;
}

/**
 * Phrase-level translation dictionary for known system labels, form titles,
 * category names, statuses, and navigation links across zh-Hant, English, and Japanese.
 */
export const PHRASE_TRANSLATIONS: Record<string, { en: string; ja: string }> = {
  // Primary & Secondary Nav
  'AI 助手': { en: 'AI Assistant', ja: 'AI アシスタント' },
  '簽核管理': { en: 'Approvals', ja: '承認管理' },
  '公司資訊': { en: 'Company Info', ja: '会社情報' },
  '財會管理': { en: 'Finance', ja: '財務・会計' },
  '系統管理': { en: 'System Admin', ja: 'システム管理' },
  '工具區': { en: 'Tools', ja: 'ツール' },
  '簽核與進度': { en: 'Approvals & Progress', ja: '承認・進捗' },
  '我的草稿庫': { en: 'My Drafts', ja: '下書き一覧' },
  '草稿庫': { en: 'Drafts', ja: '下書き一覧' },
  '申請進度總覽': { en: 'Applications Overview', ja: '申請進捗一覧' },
  '全公司財會與資產': { en: 'Corporate Finance & Assets', ja: '全社財務・資産管理' },
  '系統管理設定': { en: 'System Administration', ja: 'システム管理設定' },
  '實用工具箱': { en: 'Utility Toolbox', ja: '便利ツール' },
  '工具總覽': { en: 'All Tools', ja: 'ツール一覧' },
  'PDF 編輯器': { en: 'PDF Editor', ja: 'PDF エディター' },
  '更多工具': { en: 'More Tools', ja: 'その他のツール' },

  // Company Info Links
  '公司公告': { en: 'Announcements', ja: '社内のお知らせ' },
  '公司規章': { en: 'Company Regulations', ja: '社内規程' },
  '內部問卷': { en: 'Internal Surveys', ja: '社内アンケート' },

  // Finance Links
  '簽核追蹤': { en: 'Case Tracking', ja: '案件・承認追跡' },
  '預算編號管理': { en: 'Budget Codes', ja: '予算コード管理' },
  '全公司財產清冊': { en: 'Corporate Asset Register', ja: '全社資産台帳' },

  // Admin Links
  '公司資料': { en: 'Company Profile', ja: '会社基本情報' },
  '主檔資料': { en: 'Master Data', ja: 'マスタデータ' },
  '帳號與權限': { en: 'Accounts & Permissions', ja: 'アカウント・権限' },
  '帳號權限': { en: 'Accounts & Permissions', ja: 'アカウント・権限' },
  '組織與簽核': { en: 'Org & Approval Flow', ja: '組織・承認フロー' },
  '組織簽核': { en: 'Org & Approval Flow', ja: '組織・承認フロー' },
  '表單設計器': { en: 'Form Designer', ja: 'フォームデザイナー' },
  '表單設計': { en: 'Form Designer', ja: 'フォームデザイナー' },
  '系統日誌': { en: 'System Logs', ja: 'システムログ' },
  '系統操作教學': { en: 'User Guide', ja: '操作マニュアル' },
  '操作教學': { en: 'User Guide', ja: '操作マニュアル' },
  '公告管理': { en: 'Manage Announcements', ja: 'お知らせ管理' },
  '規章管理': { en: 'Manage Regulations', ja: '規程管理' },
  '問卷管理': { en: 'Manage Surveys', ja: 'アンケート管理' },

  // Categories
  '採購流程': { en: 'Procurement', ja: '購買プロセス' },
  '費用報支': { en: 'Expense Claims', ja: '経費精算' },
  '費用與差旅報支': { en: 'Expenses & Travel', ja: '経費・出張精算' },
  '用印申請': { en: 'Corporate Seal', ja: '押印申請' },
  '資產管理': { en: 'Asset Management', ja: '資産管理' },
  '差勤與其他表單': { en: 'Attendance & Others', ja: '勤怠・その他申請' },
  '出差與請假': { en: 'Business Trip & Leave', ja: '出張・休暇申請' },

  // Form Titles
  '請購單': { en: 'Purchase Request', ja: '購買依頼書' },
  '採購單': { en: 'Purchase Order', ja: '発注書 (PO)' },
  '驗收單': { en: 'Acceptance Report', ja: '検収書' },
  '費用申請單': { en: 'Expense Payment Request', ja: '支払申請書' },
  '費用申請單(採購付款)': { en: 'Procurement Payment Request', ja: '購買支払申請書' },
  '出差報告暨旅費報支單': { en: 'Business Trip & Travel Expense', ja: '出張報告・旅費精算書' },
  '公出差旅申請單': { en: 'Business Trip Application', ja: '出張申請書' },
  '費用申請單(部門版)': { en: 'Expense Claim (Department)', ja: '経費精算書（部門予算）' },
  '費用申請單(產品專案版)': { en: 'Expense Claim (Product Project)', ja: '経費精算書（製品プロジェクト）' },
  '費用申請單(營收專案版)': { en: 'Expense Claim (Revenue Project)', ja: '経費精算書（案件プロジェクト）' },
  '費用申請單(部門版_單筆一萬元以下)': {
    en: 'Petty Expense Claim (≤ NT$10,000)',
    ja: '少額経費精算書（1万NT$以下）',
  },
  '用印申請單(合約類)': { en: 'Seal Request (Contracts)', ja: '押印申請書（契約書）' },
  '用印申請單(非合約類)': { en: 'Seal Request (General Docs)', ja: '押印申請書（一般文書）' },
  '用印申請單(開立發票/Invoice)': { en: 'Seal Request (Invoices)', ja: '押印申請書（請求書・インボイス）' },
  '資產異動申請單': { en: 'Asset Transfer Request', ja: '資産異動申請書' },
  '申請單': { en: 'Application Form', ja: '申請書' },

  // Status Labels
  '全部': { en: 'All', ja: 'すべて' },
  '待我簽核': { en: 'To Approve', ja: '承認待ち（自分）' },
  '簽核中': { en: 'In Progress', ja: '承認中' },
  '已核准': { en: 'Approved', ja: '承認済' },
  '已退回': { en: 'Returned', ja: '差戻し' },
  '已退回（待修改）': { en: 'Returned (Action Needed)', ja: '差戻し（修正待ち）' },
  '已撤回': { en: 'Withdrawn', ja: '取下げ済' },
  '待簽核': { en: 'Pending', ja: '承認待ち' },
  '由系統代簽': { en: 'Auto-Approved', ja: 'システム自動承認' },
  '略過': { en: 'Skipped', ja: 'スキップ' },

  // Approval Step Roles
  '申請單位主管': { en: 'Dept. Manager', ja: '申請部門長' },
  '直屬主管': { en: 'Direct Manager', ja: '直属の上司' },
  '部門主管': { en: 'Dept. Manager', ja: '部門長' },
  '預算負責人': { en: 'Budget Owner', ja: '予算責任者' },
  '總經理': { en: 'General Manager', ja: '総経理 (GM)' },
  '董事長': { en: 'Chairman', ja: '会長 (Chairman)' },
  '申請人確認': { en: 'Applicant Confirmation', ja: '申請者確認' },
  '原保管人': { en: 'Current Custodian', ja: '現管理者' },
  '新保管人': { en: 'New Custodian', ja: '新管理者' },
  '其他保管人': { en: 'Co-Custodian', ja: '共同管理者' },
  '原保管單位主管': { en: 'Current Dept. Manager', ja: '現管理部門長' },
  '新保管單位主管': { en: 'New Dept. Manager', ja: '新管理部門長' },
  '其他保管單位主管': { en: 'Other Dept. Manager', ja: '他管理部門長' },
  '財會審核': { en: 'Finance Review', ja: '財務審査' },
  '人資審核': { en: 'HR Review', ja: '人事審査' },

  // System Roles
  '一般員工': { en: 'Employee', ja: '一般社員' },
  '財會': { en: 'Finance', ja: '財務・会計' },
  '系統管理員': { en: 'System Admin', ja: 'システム管理者' },

  // Regulation Categories
  '人資與考勤差旅': { en: 'HR, Attendance & Travel', ja: '人事・勤怠・出張' },
  '薪酬福利與績效': { en: 'Compensation, Benefits & Review', ja: '報酬・福利厚生・評価' },
  '採購核銷與資產': { en: 'Procurement, Expenses & Assets', ja: '購買・経費精算・資産' },
  '法務用印與資安治理': { en: 'Legal, Seal & InfoSec Governance', ja: '法務・押印・情報セキュリティ' },
  '通用管理規章': { en: 'General Administration', ja: '一般管理規程' },

  // Asset Status
  '使用中': { en: 'In Use', ja: '使用中' },
  '閒置': { en: 'Idle', ja: '遊休' },
  '外借中': { en: 'Loaned Out', ja: '貸出中' },
  '維修中': { en: 'In Repair', ja: '修理中' },
  '已報廢': { en: 'Scrapped', ja: '廃棄済' },
  '已出售': { en: 'Sold', ja: '売却済' },
  '已遺失': { en: 'Lost', ja: '紛失' },
};

export function translatePhrase(text: string | null | undefined, locale: Locale): string {
  if (!text) return '';
  if (locale === 'zh-Hant') return text;
  const trimmed = text.trim();
  const hit = PHRASE_TRANSLATIONS[trimmed];
  if (hit) return locale === 'en' ? hit.en : hit.ja;

  // Handle prefixed "新增 · XXX"
  if (trimmed.startsWith('新增 · ')) {
    const rest = trimmed.slice('新增 · '.length);
    const subHit = PHRASE_TRANSLATIONS[rest];
    const subText = subHit ? (locale === 'en' ? subHit.en : subHit.ja) : rest;
    return locale === 'en' ? `New · ${subText}` : `新規 · ${subText}`;
  }

  return text;
}

export type TranslationShape = {
  common: {
    appName: string;
    companyName: string;
    search: string;
    reset: string;
    cancel: string;
    confirm: string;
    save: string;
    close: string;
    edit: string;
    delete: string;
    loading: string;
    processing: string;
    send: string;
    submit: string;
    details: string;
    viewDetails: string;
    copy: string;
    copied: string;
    logout: string;
    language: string;
    itemsUnit: string;
    openMenu: string;
    closeMenu: string;
  };
  shell: {
    companyInfoTooltip: string;
    expandSubmenu: string;
    collapseSubmenu: string;
    newPrefix: string;
    account: {
      employeeCode: string;
      department: string;
      directManager: string;
      titleAndRole: string;
      generalManager: string;
      chairman: string;
      unboundGws: string;
      custodyAssetsTitle: string;
      noCustodyAssets: string;
      copyTagTitle: string;
      companyAssetShortcut: string;
      logoutButton: string;
    };
  };
  assistantWidget: {
    title: string;
    hoverTooltip: string;
    mute1h: string;
    collapse: string;
    mutedNotice: string;
    emptyNotice: string;
    remindersCount: (n: number) => string;
    dismissAllLater: string;
    viewFullReason: string;
    caseNoPrefix: string;
    resubmit: string;
    view: string;
    later: string;
    inputPlaceholder: string;
    sendButton: string;
    continueInFull: string;
  };
  aiChat: {
    sidebarTitle: string;
    newChat: string;
    searchChat: string;
    searchPlaceholder: string;
    loadMore: string;
    rename: string;
    archive: string;
    archiveConfirm: string;
    saveShort: string;
    chatListTitle: string;
    untitledChat: string;
    headerSubtitle: string;
    briefingButton: string;
    briefingTitle: string;
    newFormButton: string;
    draftsButton: string;
    composerPlaceholder: string;
    sendButton: string;
    voiceStartTitle: string;
    voiceStopTitle: string;
    voiceRecordingHint: string;
    voiceTranscribing: string;
    attachFileTitle: string;
    attachFileHint: string;
    scrollToBottom: string;
    quickPromptsTitle: string;
    quickPromptsHeader: string;
    quickPrompts: Array<{ id: string; label: string; prompt: string }>;
  };
  approvalsPage: {
    title: string;
    subtitle: string;
    tabs: {
      all: string;
      toApprove: string;
      pendingApproval: string;
      returned: string;
      approved: string;
    };
    searchPlaceholder: string;
    groupFilterLabel: string;
    allGroups: string;
    toApproveBadge: string;
    toApproveSectionTitle: string;
    seedDemoButton: string;
    emptyToApprove: string;
    showAllApplicationsLink: (n: number) => string;
    myApplicationsBadge: string;
    myApplicationsSectionTitle: string;
    emptyMyApplicationsNone: string;
    emptyMyApplicationsFiltered: string;
    collapseSection: string;
    expandSection: string;
    collapseGroup: string;
    expandGroup: string;
    stepBadge: (done: number, total: number) => string;
    applicantPrefix: string;
    waitingForPrefix: (dur: string) => string;
    quickApprove: string;
    approving: string;
    approvedDone: string;
    returnBtn: string;
    returning: string;
    returnedDone: string;
    confirmReturn: string;
    returnReasonPlaceholder: string;
    pendingApproversPrefix: string;
    returnReasonPrefix: string;
    defaultReturnHint: string;
    editAndResubmit: string;
    printShortcut: string;
    printingShortcut: string;
  };
  announcementsPage: {
    sectionTitle: string;
    title: string;
    subtitle: string;
    allTab: (n: number) => string;
    unreadTab: (n: number) => string;
    pinnedTab: (n: number) => string;
    helperHint: string;
    emptyMessage: string;
    pinnedBadge: string;
    priority: {
      urgent: string;
      important: string;
      normal: string;
    };
    category: {
      general: string;
      hr: string;
      finance: string;
      it: string;
      security: string;
      event: string;
      facility: string;
      policy: string;
    };
    publishedDate: string;
    audience: string;
    audienceCompany: string;
    prevBtn: string;
    nextBtn: string;
    collapseCard: string;
    attachmentsHeader: (n: number) => string;
    attachmentsCountBadge: (n: number) => string;
    readBadge: string;
    acknowledgedBadge: string;
    acknowledgeBtn: string;
    acknowledging: string;
    unreadBadge: string;
    acknowledgedShort: string;
    readShort: string;
    clickToExpand: string;
  };
  regulationsPage: {
    sectionTitle: string;
    title: string;
    subtitle: string;
    manageBtn: string;
    searchPlaceholder: string;
    searchBtn: string;
    clearFilterBtn: string;
    allCategories: string;
    emptyMessage: string;
    totalRegulationsCount: (n: number) => string;
    coreRequiredBadge: string;
    versionPrefix: string;
    effectivePrefix: string;
    relatedFormsLabel: string;
    ownerDeptPrefix: string;
    approverPrefix: string;
    originalPdfLink: string;
    readFullLink: string;
  };
  surveysPage: {
    sectionTitle: string;
    title: string;
    pendingSection: string;
    allSurveysSection: string;
    closesAtPrefix: string;
    hasDraft: string;
    noOtherSurveys: string;
    noSurveys: string;
    statusOpen: string;
    statusClosed: string;
  };
  toolsPage: {
    sectionTitle: string;
    title: string;
    subtitle: string;
    openTool: string;
    statusReady: string;
    statusSoon: string;
    pdfEditorTitle: string;
    pdfEditorDesc: string;
    comingSoonTitle: string;
    comingSoonDesc: string;
  };
  draftsPage: {
    sectionTitle: string;
    title: string;
    subtitle: string;
    otherFormsLink: string;
    aiAssistantLink: string;
  };
  assetsPage: {
    sectionTitle: string;
    title: string;
    subtitle: string;
  };
  loginPage: {
    subtitle: string;
    googleLoginBtn: string;
    workspaceNotice: string;
    supportPrefix: string;
    homeLink: string;
  };
};

export const TRANSLATIONS: Record<Locale, TranslationShape> = {
  'zh-Hant': {
    common: {
      appName: 'ACCSYS · 台灣智慧駕駛 電子採購與簽核',
      companyName: '台灣智慧駕駛',
      search: '搜尋',
      reset: '重置',
      cancel: '取消',
      confirm: '確認',
      save: '儲存',
      close: '關閉',
      edit: '編輯',
      delete: '刪除',
      loading: '載入中…',
      processing: '處理中…',
      send: '送出',
      submit: '送出申請',
      details: '詳情 →',
      viewDetails: '查看詳情 →',
      copy: '複製',
      copied: '✓ 已複製',
      logout: '登出系統',
      language: '語言',
      itemsUnit: '件',
      openMenu: '開啟選單',
      closeMenu: '關閉選單',
    },
    shell: {
      companyInfoTooltip: '公司資訊（公司公告 · 公司規章 · 內部問卷）',
      expandSubmenu: '展開第二層選單',
      collapseSubmenu: '收合第二層選單',
      newPrefix: '新增 · ',
      account: {
        employeeCode: '員工工號',
        department: '所屬部門',
        directManager: '直屬主管',
        titleAndRole: '職稱／身分',
        generalManager: '總經理',
        chairman: '董事長',
        unboundGws: '未綁定 Google Workspace',
        custodyAssetsTitle: '名下保管資產',
        noCustodyAssets: '目前名下無保管資產',
        copyTagTitle: '複製財產編號',
        companyAssetShortcut: '全公司財產清冊 →',
        logoutButton: '登出系統',
      },
    },
    assistantWidget: {
      title: 'ACCSYS 小助手',
      hoverTooltip: 'ACCSYS 小助手（滑鼠移入開啟提醒與快速提問）',
      mute1h: '靜音 1 小時',
      collapse: '收合',
      mutedNotice: '已暫時靜音主動提醒。',
      emptyNotice: '沒有新的主動提醒。可問短問題，或進入完整助手。',
      remindersCount: (n) => `共 ${n} 則提醒`,
      dismissAllLater: '全部稍後',
      viewFullReason: '看完整原因',
      caseNoPrefix: '單號',
      resubmit: '補件',
      view: '查看',
      later: '稍後',
      inputPlaceholder: '簡短提問…（按 Enter 傳送）',
      sendButton: '送出',
      continueInFull: '在完整助手繼續',
    },
    aiChat: {
      sidebarTitle: 'AI 助手 · 對話紀錄',
      newChat: '新對話',
      searchChat: '搜尋對話',
      searchPlaceholder: '對話名稱',
      loadMore: '載入更多',
      rename: '重新命名',
      archive: '刪除',
      archiveConfirm: '確定要刪除此對話嗎？刪除後將從您的對話清單移除（草稿與單據不會刪除）。',
      saveShort: '存',
      chatListTitle: '對話清單',
      untitledChat: '對話',
      headerSubtitle: '主動通知待簽核、最新公告、規章與表單協作',
      briefingButton: '🔔 待簽與公告播報',
      briefingTitle: '立即播報目前待簽核單據、最新公告與待填問卷',
      newFormButton: '+ 建立申請單',
      draftsButton: '草稿庫',
      composerPlaceholder: '輸入訊息，或把檔案拖進來…（按 Enter 傳送）',
      sendButton: '傳送',
      voiceStartTitle: '語音輸入',
      voiceStopTitle: '點擊完成語音輸入',
      voiceRecordingHint: '正在聆聽語音… 說完請按「完成」',
      voiceTranscribing: '語音辨識中…',
      attachFileTitle: '上傳檔案或發票圖片',
      attachFileHint: '拖放任意檔案，或按 + 選擇檔案',
      scrollToBottom: '跳至最下方',
      quickPromptsTitle: '常用語句（點擊直接傳送）',
      quickPromptsHeader: '✨ 常用語句（點選立即送出）',
      quickPrompts: [
        { id: 'capabilities', label: '💡 你可以為我做什麼？', prompt: '你可以為我做什麼？請條理清楚地介紹你的核心功能，並舉出具體的操作範例（例如上傳發票自動填表、輸入 @ 標記同仁辦理資產轉移、語音建單與簽核管理等）。' },
        { id: 'pending', label: '📋 查看待我簽核單據', prompt: '請幫我列出目前待我簽核的所有單據與重點摘要' },
        { id: 'progress', label: '📤 查詢我的申請進度', prompt: '請查詢我目前送出的申請單簽核進度，有沒有被退回的單子？' },
        { id: 'announcements', label: '📢 整理最新公司公告', prompt: '請幫我整理目前發布中的公司公告（含置頂、重要度、分類、未讀狀態與重點摘要）' },
        { id: 'assets', label: '💻 查詢名下保管資產', prompt: '請幫我列出目前我名下保管的所有公司資產清單與財產編號' },
      ],
    },
    approvalsPage: {
      title: '簽核管理',
      subtitle:
        '依表單群組歸類顯示；可獨立收合「待我簽核」、「我的申請」或各分類群組，並直接在卡片上快速簽核。',
      tabs: {
        all: '全部',
        toApprove: '待我簽核',
        pendingApproval: '簽核中',
        returned: '已退回',
        approved: '已核准',
      },
      searchPlaceholder: '搜尋單號、申請人、事由…',
      groupFilterLabel: '群組篩選：',
      allGroups: '全部群組',
      toApproveBadge: '待我簽核',
      toApproveSectionTitle: '等待您審核簽核的表單',
      seedDemoButton: '+ 補充待簽範例',
      emptyToApprove: '目前沒有等待您簽核的表單。',
      showAllApplicationsLink: (n) => `顯示全部單據（${n} 件）→`,
      myApplicationsBadge: '我的申請',
      myApplicationsSectionTitle: '我送出的申請單據與簽核進度',
      emptyMyApplicationsNone: '您目前還沒有送出過任何申請表單。',
      emptyMyApplicationsFiltered: '找不到符合篩選條件的申請紀錄。',
      collapseSection: '收合區塊 ▲',
      expandSection: '展開區塊 ▼',
      collapseGroup: '收合群組',
      expandGroup: '展開群組',
      stepBadge: (done, total) => `關卡 ${done}/${total}`,
      applicantPrefix: '申請人：',
      waitingForPrefix: (dur) => `· ${dur}`,
      quickApprove: '✓ 快速簽核',
      approving: '簽核中…',
      approvedDone: '✓ 已簽核通過',
      returnBtn: '退回',
      returning: '退回中…',
      returnedDone: '↩ 已退回申請人',
      confirmReturn: '確認退回',
      returnReasonPlaceholder: '請輸入退回原因（選填，預設：請補充說明後重送）…',
      pendingApproversPrefix: '待簽核人：',
      returnReasonPrefix: '退回原因',
      defaultReturnHint: '請依審核意見修正後重新送出',
      editAndResubmit: '修改重送',
      printShortcut: '🖨️ 列印',
      printingShortcut: '列印準備中…',
    },
    announcementsPage: {
      sectionTitle: '公司資訊',
      title: '公司公告',
      subtitle: '瀏覽公司最新公告與重要通知；直接點擊任一公告卡片即可原地展開閱讀全文與下載附件。',
      allTab: (n) => `全部公告 (${n})`,
      unreadTab: (n) => `未讀 (${n})`,
      pinnedTab: (n) => `📌 置頂 (${n})`,
      helperHint: '點擊任意小卡會自動展開並置中顯示；再點其他小卡可無縫切換放大對象',
      emptyMessage: '目前沒有符合條件的公司公告。',
      pinnedBadge: '📌 置頂',
      priority: {
        urgent: '緊急公告',
        important: '重要公告',
        normal: '一般公告',
      },
      category: {
        general: '一般行政',
        hr: '人資福委',
        finance: '財會稅務',
        it: '資訊安全',
        security: '資訊安全',
        event: '活動福委',
        facility: '總務廠務',
        policy: '制度規章',
      },
      publishedDate: '發布日期：',
      audience: '對象：',
      audienceCompany: '全公司',
      prevBtn: '← 上一則',
      nextBtn: '下一則 →',
      collapseCard: '收合卡片 ✕',
      attachmentsHeader: (n) => `相關附件（${n}）`,
      attachmentsCountBadge: (n) => `📎 ${n} 附件`,
      readBadge: '✓ 已閱讀',
      acknowledgedBadge: '✓ 已確認知悉',
      acknowledgeBtn: '✓ 我已知悉此公告',
      acknowledging: '確認中…',
      unreadBadge: '● 未讀',
      acknowledgedShort: '✓ 已知悉',
      readShort: '已讀',
      clickToExpand: '點擊展開 ⤢',
    },
    regulationsPage: {
      sectionTitle: '公司資訊',
      title: '公司規章與管理辦法',
      subtitle:
        '依職能領域分類彙整台灣智慧駕駛各項內控辦法、出勤差旅、採購核銷、薪酬考核與法務用印規範。您也可直接在 AI 助手詢問任何規章條文。',
      manageBtn: '管理公司規章 →',
      searchPlaceholder: '搜尋規章名稱、文號、條文關鍵字（如：出差住宿、電動車里程、採購比價、特休、用印）…',
      searchBtn: '搜尋規章',
      clearFilterBtn: '清除篩選',
      allCategories: '全部分類總覽',
      emptyMessage: '找不到符合條件的公司規章。',
      totalRegulationsCount: (n) => `共 ${n} 份規章`,
      coreRequiredBadge: '核心必讀',
      versionPrefix: '版次 v',
      effectivePrefix: '核定',
      relatedFormsLabel: '適用表單：',
      ownerDeptPrefix: '權責單位：',
      approverPrefix: '核決：',
      originalPdfLink: '原始 PDF ↗',
      readFullLink: '閱讀完整條文 →',
    },
    surveysPage: {
      sectionTitle: '公司資訊',
      title: '內部問卷',
      pendingSection: '待填寫',
      allSurveysSection: '問卷',
      closesAtPrefix: '截止',
      hasDraft: '已有暫存',
      noOtherSurveys: '沒有其他問卷',
      noSurveys: '目前沒有問卷',
      statusOpen: '進行中',
      statusClosed: '已結束',
    },
    toolsPage: {
      sectionTitle: '工具區',
      title: '實用工具',
      subtitle: '與採購簽核流程互補的小工具入口。點進個別工具開始使用，之後會持續擴充。',
      openTool: '進入工具 →',
      statusReady: '可用',
      statusSoon: '即將推出',
      pdfEditorTitle: 'PDF 編輯器',
      pdfEditorDesc: '上傳 PDF、疊加文字／圖章／螢光筆，匯出或依頁數拆分檔案。',
      comingSoonTitle: '更多工具',
      comingSoonDesc: '之後可在此擴充表單小幫手、批次轉換、浮水印等實用功能。',
    },
    draftsPage: {
      sectionTitle: '我的申請',
      title: '草稿庫',
      subtitle: '與 AI 助手共用同一草稿 ID 與權限。可在此搜尋、開啟完整編輯，或交給 AI 繼續處理。',
      otherFormsLink: '其他申請單',
      aiAssistantLink: 'AI 助手',
    },
    assetsPage: {
      sectionTitle: '財會管理 · 全公司資產',
      title: '全公司財產清冊',
      subtitle: '管理全公司財產與設備清冊（個人名下保管資產請由左下角個人帳號選單查看）。',
    },
    loginPage: {
      subtitle: '電子採購與簽核系統 · 請使用公司 Google 帳號登入',
      googleLoginBtn: '使用 Google 帳號登入',
      workspaceNotice:
        '僅限公司 Workspace 帳號（@turing-drive.com）。點擊後可選擇 Google 帳號；若瀏覽器已登入公司帳號，通常不必再輸入密碼。',
      supportPrefix: '遇到問題請聯絡系統管理員，或返回',
      homeLink: '首頁',
    },
  },

  en: {
    common: {
      appName: 'ACCSYS · Turing Drive e-Procurement & Approval System',
      companyName: 'Turing Drive Inc.',
      search: 'Search',
      reset: 'Reset',
      cancel: 'Cancel',
      confirm: 'Confirm',
      save: 'Save',
      close: 'Close',
      edit: 'Edit',
      delete: 'Delete',
      loading: 'Loading…',
      processing: 'Processing…',
      send: 'Send',
      submit: 'Submit',
      details: 'Details →',
      viewDetails: 'View Details →',
      copy: 'Copy',
      copied: '✓ Copied',
      logout: 'Sign Out',
      language: 'Language',
      itemsUnit: 'items',
      openMenu: 'Open Menu',
      closeMenu: 'Close Menu',
    },
    shell: {
      companyInfoTooltip: 'Company Info (Announcements · Regulations · Surveys)',
      expandSubmenu: 'Expand Submenu',
      collapseSubmenu: 'Collapse Submenu',
      newPrefix: 'New · ',
      account: {
        employeeCode: 'Employee ID',
        department: 'Department',
        directManager: 'Direct Manager',
        titleAndRole: 'Title / Role',
        generalManager: 'General Manager',
        chairman: 'Chairman',
        unboundGws: 'Not linked to Google Workspace',
        custodyAssetsTitle: 'Assigned Custody Assets',
        noCustodyAssets: 'No custody assets assigned to you',
        copyTagTitle: 'Copy Asset Tag',
        companyAssetShortcut: 'Corporate Asset Register →',
        logoutButton: 'Sign Out',
      },
    },
    assistantWidget: {
      title: 'ACCSYS Assistant',
      hoverTooltip: 'ACCSYS Quick Assistant (Hover to view reminders & ask questions)',
      mute1h: 'Mute 1h',
      collapse: 'Collapse',
      mutedNotice: 'Proactive notifications are temporarily muted.',
      emptyNotice: 'No new reminders. Ask a quick question or open the full AI workspace.',
      remindersCount: (n) => `${n} Reminder${n === 1 ? '' : 's'}`,
      dismissAllLater: 'Snooze All',
      viewFullReason: 'View full reason',
      caseNoPrefix: 'Case #',
      resubmit: 'Resubmit',
      view: 'View',
      later: 'Later',
      inputPlaceholder: 'Ask a quick question… (Press Enter twice to send)',
      sendButton: 'Send',
      continueInFull: 'Continue in Full Assistant',
    },
    aiChat: {
      sidebarTitle: 'AI Assistant · Chat History',
      newChat: 'New Chat',
      searchChat: 'Search Chats',
      searchPlaceholder: 'Conversation title…',
      loadMore: 'Load More',
      rename: 'Rename',
      archive: 'Delete',
      archiveConfirm: 'Delete this conversation? It will be removed from your chat list (drafts and submissions will not be deleted).',
      saveShort: 'Save',
      chatListTitle: 'Conversations',
      untitledChat: 'Conversation',
      headerSubtitle: 'Proactive briefings on pending approvals, announcements, regulations & form drafting',
      briefingButton: '🔔 Daily Briefing',
      briefingTitle: 'Get an instant briefing on pending approvals, announcements, and surveys',
      newFormButton: '+ New Form',
      draftsButton: 'Drafts',
      composerPlaceholder: 'Type a message or drop files here… (Press Enter twice to send)',
      sendButton: 'Send',
      voiceStartTitle: 'Voice Input',
      voiceStopTitle: 'Click to finish voice input',
      voiceRecordingHint: 'Listening… Click "Done" when finished',
      voiceTranscribing: 'Transcribing audio…',
      attachFileTitle: 'Upload attachments or invoice photos',
      attachFileHint: 'Drop any files here, or click + to upload',
      scrollToBottom: 'Scroll to bottom',
      quickPromptsTitle: 'Quick Prompts (Click to send)',
      quickPromptsHeader: '✨ Quick Prompts (Click to send immediately)',
      quickPrompts: [
        { id: 'capabilities', label: '💡 What can you do for me?', prompt: 'What can you do for me? Please clearly outline your core features with concrete usage examples (such as uploading invoices to auto-fill forms, typing @ to mention colleagues for asset transfers, voice input, and approval management).' },
        { id: 'pending', label: '📋 Check Pending Approvals', prompt: 'Please list all requests currently waiting for my approval with a brief summary.' },
        { id: 'progress', label: '📤 Track My Applications', prompt: 'Please check the status of my submitted applications and let me know if any were returned.' },
        { id: 'announcements', label: '📢 Latest Announcements', prompt: 'Please summarize all currently published company announcements (including pinned status, priority, category, unread status, and key takeaways).' },
        { id: 'assets', label: '💻 My Custody Assets', prompt: 'Please list all company assets currently under my custody along with their asset tags.' },
      ],
    },
    approvalsPage: {
      title: 'Approval Management',
      subtitle:
        'Grouped by form category. Collapse or expand sections independently and approve or return requests directly inline.',
      tabs: {
        all: 'All',
        toApprove: 'To Approve',
        pendingApproval: 'In Progress',
        returned: 'Returned',
        approved: 'Approved',
      },
      searchPlaceholder: 'Search case #, applicant, summary…',
      groupFilterLabel: 'Group Filter:',
      allGroups: 'All Groups',
      toApproveBadge: 'To Approve',
      toApproveSectionTitle: 'Requests Waiting for Your Approval',
      seedDemoButton: '+ Add Sample Approvals',
      emptyToApprove: 'There are currently no requests waiting for your approval.',
      showAllApplicationsLink: (n) => `Show all applications (${n}) →`,
      myApplicationsBadge: 'My Applications',
      myApplicationsSectionTitle: 'My Submitted Applications & Approval Progress',
      emptyMyApplicationsNone: 'You have not submitted any application forms yet.',
      emptyMyApplicationsFiltered: 'No application records match the current filter.',
      collapseSection: 'Collapse ▲',
      expandSection: 'Expand ▼',
      collapseGroup: 'Collapse Group',
      expandGroup: 'Expand Group',
      stepBadge: (done, total) => `Step ${done}/${total}`,
      applicantPrefix: 'Applicant: ',
      waitingForPrefix: (dur) => `· ${dur}`,
      quickApprove: '✓ Quick Approve',
      approving: 'Approving…',
      approvedDone: '✓ Approved',
      returnBtn: 'Return',
      returning: 'Returning…',
      returnedDone: '↩ Returned',
      confirmReturn: 'Confirm Return',
      returnReasonPlaceholder: 'Enter return reason (optional, default: Please revise and resubmit)…',
      pendingApproversPrefix: 'Pending Approver: ',
      returnReasonPrefix: 'Return Reason',
      defaultReturnHint: 'Please revise according to reviewer comments and resubmit',
      editAndResubmit: 'Edit & Resubmit',
      printShortcut: '🖨️ Print',
      printingShortcut: 'Preparing…',
    },
    announcementsPage: {
      sectionTitle: 'Company Info',
      title: 'Company Announcements',
      subtitle:
        'Browse the latest company announcements and notices. Click any card to expand and center it in-place.',
      allTab: (n) => `All (${n})`,
      unreadTab: (n) => `Unread (${n})`,
      pinnedTab: (n) => `📌 Pinned (${n})`,
      helperHint: 'Click any card to smoothly expand & center; click another card to switch focus',
      emptyMessage: 'No announcements match the selected filter.',
      pinnedBadge: '📌 Pinned',
      priority: {
        urgent: 'Urgent',
        important: 'Important',
        normal: 'General',
      },
      category: {
        general: 'General Admin',
        hr: 'HR & Benefits',
        finance: 'Finance & Tax',
        it: 'IT & Security',
        security: 'Security',
        event: 'Events',
        facility: 'Facilities',
        policy: 'Policies',
      },
      publishedDate: 'Published: ',
      audience: 'Audience: ',
      audienceCompany: 'All Employees',
      prevBtn: '← Prev',
      nextBtn: 'Next →',
      collapseCard: 'Collapse ✕',
      attachmentsHeader: (n) => `Attachments (${n})`,
      attachmentsCountBadge: (n) => `📎 ${n} file${n === 1 ? '' : 's'}`,
      readBadge: '✓ Read',
      acknowledgedBadge: '✓ Acknowledged',
      acknowledgeBtn: '✓ I Acknowledge This Announcement',
      acknowledging: 'Confirming…',
      unreadBadge: '● Unread',
      acknowledgedShort: '✓ Acknowledged',
      readShort: 'Read',
      clickToExpand: 'Expand ⤢',
    },
    regulationsPage: {
      sectionTitle: 'Company Info',
      title: 'Company Regulations & Policies',
      subtitle:
        'Internal control policies, attendance & travel rules, procurement & reimbursement guidelines, compensation, and seal governance. You can also ask the AI Assistant about any clause.',
      manageBtn: 'Manage Regulations →',
      searchPlaceholder: 'Search regulation title, code, or keywords (e.g., travel lodging, EV mileage, quotation)…',
      searchBtn: 'Search',
      clearFilterBtn: 'Clear Filter',
      allCategories: 'All Categories',
      emptyMessage: 'No company regulations match your search.',
      totalRegulationsCount: (n) => `${n} Regulation${n === 1 ? '' : 's'}`,
      coreRequiredBadge: 'Core Policy',
      versionPrefix: 'Ver. v',
      effectivePrefix: 'Effective',
      relatedFormsLabel: 'Applicable Forms:',
      ownerDeptPrefix: 'Owner Dept:',
      approverPrefix: 'Approved by:',
      originalPdfLink: 'Original PDF ↗',
      readFullLink: 'Read Full Policy →',
    },
    surveysPage: {
      sectionTitle: 'Company Info',
      title: 'Internal Surveys',
      pendingSection: 'Pending Your Response',
      allSurveysSection: 'All Surveys',
      closesAtPrefix: 'Closes',
      hasDraft: 'Draft saved',
      noOtherSurveys: 'No other surveys',
      noSurveys: 'No surveys available',
      statusOpen: 'Open',
      statusClosed: 'Closed',
    },
    toolsPage: {
      sectionTitle: 'Tools',
      title: 'Utility Tools',
      subtitle: 'Complementary productivity utilities for procurement and approval workflows.',
      openTool: 'Open Tool →',
      statusReady: 'Ready',
      statusSoon: 'Coming Soon',
      pdfEditorTitle: 'PDF Editor',
      pdfEditorDesc: 'Upload PDFs, overlay text/stamps/highlights, export or split pages.',
      comingSoonTitle: 'More Tools',
      comingSoonDesc: 'Batch converters, watermarking, and form helpers coming soon.',
    },
    draftsPage: {
      sectionTitle: 'My Applications',
      title: 'Draft Library',
      subtitle:
        'Shared with the AI Assistant under the same draft ID and permissions. Search, edit in full, or continue with AI.',
      otherFormsLink: 'Other Application Forms',
      aiAssistantLink: 'AI Assistant',
    },
    assetsPage: {
      sectionTitle: 'Finance · Corporate Assets',
      title: 'Corporate Asset Register',
      subtitle:
        'Manage the company-wide property and equipment register (view your personal custody assets from the bottom-left account menu).',
    },
    loginPage: {
      subtitle: 'e-Procurement & Approval System · Sign in with your corporate Google account',
      googleLoginBtn: 'Sign in with Google',
      workspaceNotice:
        'Restricted to corporate Workspace accounts (@turing-drive.com). Select your company Google account to continue.',
      supportPrefix: 'Need help? Contact your system administrator or return to',
      homeLink: 'Home',
    },
  },

  ja: {
    common: {
      appName: 'ACCSYS · Turing Drive 電子購買・承認システム',
      companyName: '台湾智慧運転 (Turing Drive)',
      search: '検索',
      reset: 'リセット',
      cancel: 'キャンセル',
      confirm: '確認',
      save: '保存',
      close: '閉じる',
      edit: '編集',
      delete: '削除',
      loading: '読み込み中…',
      processing: '処理中…',
      send: '送信',
      submit: '申請する',
      details: '詳細 →',
      viewDetails: '詳細を見る →',
      copy: 'コピー',
      copied: '✓ コピー済',
      logout: 'ログアウト',
      language: '言語',
      itemsUnit: '件',
      openMenu: 'メニューを開く',
      closeMenu: 'メニューを閉じる',
    },
    shell: {
      companyInfoTooltip: '会社情報（社内のお知らせ · 社内規程 · 社内アンケート）',
      expandSubmenu: 'サブメニューを展開',
      collapseSubmenu: 'サブメニューを折りたたむ',
      newPrefix: '新規 · ',
      account: {
        employeeCode: '社員番号',
        department: '所属部門',
        directManager: '直属の上司',
        titleAndRole: '役職／権限',
        generalManager: '総経理',
        chairman: '会長',
        unboundGws: 'Google Workspace 未連携',
        custodyAssetsTitle: '保有・管理資産',
        noCustodyAssets: '現在保有している管理資産はありません',
        copyTagTitle: '資産番号をコピー',
        companyAssetShortcut: '全社資産台帳へ →',
        logoutButton: 'ログアウト',
      },
    },
    assistantWidget: {
      title: 'ACCSYS アシスタント',
      hoverTooltip: 'ACCSYS アシスタント（マウスオーバーで通知・クイック質問を表示）',
      mute1h: '1時間ミュート',
      collapse: '閉じる',
      mutedNotice: '通知を一時ミュートしています。',
      emptyNotice: '新しい通知はありません。短い質問をするか、フル画面で続行できます。',
      remindersCount: (n) => `通知 ${n} 件`,
      dismissAllLater: 'すべて後で',
      viewFullReason: '理由の全文を表示',
      caseNoPrefix: '申請番号',
      resubmit: '再提出・補正',
      view: '表示',
      later: '後で',
      inputPlaceholder: '簡単な質問を入力…（Enter 2回で送信）',
      sendButton: '送信',
      continueInFull: 'AI アシスタント全画面で開く',
    },
    aiChat: {
      sidebarTitle: 'AI アシスタント · 会話履歴',
      newChat: '新しい会話',
      searchChat: '会話を検索',
      searchPlaceholder: '会話のタイトル…',
      loadMore: 'さらに読み込む',
      rename: '名前を変更',
      archive: '削除',
      archiveConfirm: 'この会話を削除しますか？会話リストから削除されます（下書きや申請書は削除されません）。',
      saveShort: '保存',
      chatListTitle: '会話一覧',
      untitledChat: '会話',
      headerSubtitle: '承認待ち・最新のお知らせ・社内規程の照会・申請書作成をサポート',
      briefingButton: '🔔 承認・お知らせ要約',
      briefingTitle: '承認待ち案件、最新のお知らせ、未回答アンケートを今すぐ要約',
      newFormButton: '+ 新規申請',
      draftsButton: '下書き一覧',
      composerPlaceholder: 'メッセージを入力、またはファイルをドロップ…（Enter 2回で送信）',
      sendButton: '送信',
      voiceStartTitle: '音声入力',
      voiceStopTitle: 'クリックして音声入力を完了',
      voiceRecordingHint: '音声を聞き取り中… 話し終えたら「完了」を押してください',
      voiceTranscribing: '音声テキスト変換中…',
      attachFileTitle: '添付ファイルまたは請求書画像をアップロード',
      attachFileHint: 'ファイルをドロップ、または + で選択',
      scrollToBottom: '一番下へ移動',
      quickPromptsTitle: '定型フレーズ（クリックで即送信）',
      quickPromptsHeader: '✨ よく使うフレーズ（クリックで即送信）',
      quickPrompts: [
        { id: 'capabilities', label: '💡 何ができますか？（機能ガイド）', prompt: 'あなたは何ができますか？主な機能と具体的な活用例（請求書アップロードによる自動入力、@メンションでの資産移管、音声入力、承認管理など）をわかりやすく整理して教えてください。' },
        { id: 'pending', label: '📋 承認待ち案件を確認', prompt: '現在私の承認待ちになっているすべての申請書と要約を一覧表示してください' },
        { id: 'progress', label: '📤 自分の申請進捗を確認', prompt: '私が提出した申請書の承認状況と、差戻しされた案件があるか確認してください' },
        { id: 'announcements', label: '📢 最新の社内お知らせを要約', prompt: '現在公開中の社内お知らせ（ピン留め、重要度、カテゴリ、未読状態、要点の要約）をまとめてください' },
        { id: 'assets', label: '💻 保有・管理資産を照会', prompt: '現在私が保有・管理しているすべての会社資産リストと資産番号を表示してください' },
      ],
    },
    approvalsPage: {
      title: '承認管理',
      subtitle:
        'フォームカテゴリ別に分類表示。「承認待ち」「自分の申請」や各グループを個別に折りたたみ、カード上で直接ワンクリック承認が可能です。',
      tabs: {
        all: 'すべて',
        toApprove: '承認待ち（自分）',
        pendingApproval: '承認中',
        returned: '差戻し',
        approved: '承認済',
      },
      searchPlaceholder: '申請番号・申請者・件名で検索…',
      groupFilterLabel: 'グループ絞り込み：',
      allGroups: '全グループ',
      toApproveBadge: '承認待ち',
      toApproveSectionTitle: 'あなたの承認を待っている申請書',
      seedDemoButton: '+ サンプル承認案件を追加',
      emptyToApprove: '現在、承認待ちの申請書はありません。',
      showAllApplicationsLink: (n) => `すべての申請を表示（${n} 件）→`,
      myApplicationsBadge: '自分の申請',
      myApplicationsSectionTitle: '提出した申請書と承認進捗',
      emptyMyApplicationsNone: 'まだ提出された申請書はありません。',
      emptyMyApplicationsFiltered: '条件に一致する申請履歴が見つかりません。',
      collapseSection: 'セクションを閉じる ▲',
      expandSection: 'セクションを開く ▼',
      collapseGroup: 'グループを閉じる',
      expandGroup: 'グループを開く',
      stepBadge: (done, total) => `ステップ ${done}/${total}`,
      applicantPrefix: '申請者：',
      waitingForPrefix: (dur) => `· ${dur}`,
      quickApprove: '✓ クイック承認',
      approving: '承認中…',
      approvedDone: '✓ 承認完了',
      returnBtn: '差戻し',
      returning: '差戻し中…',
      returnedDone: '↩ 差戻し済',
      confirmReturn: '差戻しを確定',
      returnReasonPlaceholder: '差戻し理由を入力（任意、初期値：内容を補足して再提出してください）…',
      pendingApproversPrefix: '承認担当者：',
      returnReasonPrefix: '差戻し理由',
      defaultReturnHint: '審査コメントに従って修正し、再提出してください',
      editAndResubmit: '修正して再提出',
      printShortcut: '🖨️ 印刷',
      printingShortcut: '印刷準備中…',
    },
    announcementsPage: {
      sectionTitle: '会社情報',
      title: '社内のお知らせ',
      subtitle:
        '最新の社内通知や重要なお知らせを閲覧できます。カードをクリックするとその場で中央に拡大表示されます。',
      allTab: (n) => `すべて (${n})`,
      unreadTab: (n) => `未読 (${n})`,
      pinnedTab: (n) => `📌 固定 (${n})`,
      helperHint: 'カードをクリックすると拡大＆中央表示されます。別のカードを押すとスムーズに切り替わります',
      emptyMessage: '条件に一致するお知らせはありません。',
      pinnedBadge: '📌 固定',
      priority: {
        urgent: '緊急',
        important: '重要',
        normal: '一般',
      },
      category: {
        general: '一般総務',
        hr: '人事・福利厚生',
        finance: '財務・税務',
        it: '情報セキュリティ',
        security: '情報セキュリティ',
        event: '社内イベント',
        facility: '総務・ファシリティ',
        policy: '社内規程',
      },
      publishedDate: '公開日：',
      audience: '対象：',
      audienceCompany: '全社',
      prevBtn: '← 前へ',
      nextBtn: '次へ →',
      collapseCard: '閉じる ✕',
      attachmentsHeader: (n) => `添付ファイル（${n}）`,
      attachmentsCountBadge: (n) => `📎 添付 ${n}`,
      readBadge: '✓ 既読',
      acknowledgedBadge: '✓ 確認済',
      acknowledgeBtn: '✓ このお知らせを確認しました',
      acknowledging: '確認中…',
      unreadBadge: '● 未読',
      acknowledgedShort: '✓ 確認済',
      readShort: '既読',
      clickToExpand: '展開する ⤢',
    },
    regulationsPage: {
      sectionTitle: '会社情報',
      title: '社内規程・管理規則',
      subtitle:
        '内部統制、勤怠・出張、購買・経費精算、給与・評価、法務・押印に関する社内規程集です。AI アシスタントに直接条文を質問することも可能です。',
      manageBtn: '社内規程を管理 →',
      searchPlaceholder: '規程名、文書番号、キーワードで検索（例：出張宿泊、マイレージ、相見積、有給休暇、押印）…',
      searchBtn: '検索',
      clearFilterBtn: '条件クリア',
      allCategories: 'すべてのカテゴリ',
      emptyMessage: '条件に一致する社内規程が見つかりません。',
      totalRegulationsCount: (n) => `全 ${n} 件`,
      coreRequiredBadge: '必読規程',
      versionPrefix: '版数 v',
      effectivePrefix: '発効',
      relatedFormsLabel: '対象フォーム：',
      ownerDeptPrefix: '所管部門：',
      approverPrefix: '決裁者：',
      originalPdfLink: '原本 PDF ↗',
      readFullLink: '条文全文を読む →',
    },
    surveysPage: {
      sectionTitle: '会社情報',
      title: '社内アンケート',
      pendingSection: '未回答のアンケート',
      allSurveysSection: 'アンケート一覧',
      closesAtPrefix: '締切',
      hasDraft: '一時保存あり',
      noOtherSurveys: 'その他のアンケートはありません',
      noSurveys: '現在アンケートはありません',
      statusOpen: '受付中',
      statusClosed: '終了',
    },
    toolsPage: {
      sectionTitle: 'ツール',
      title: '便利ツール',
      subtitle: '購買・承認業務を補助するユーティリティツール集です。',
      openTool: 'ツールを開く →',
      statusReady: '利用可能',
      statusSoon: '準備中',
      pdfEditorTitle: 'PDF エディター',
      pdfEditorDesc: 'PDF のアップロード、テキスト・印鑑・マーカーの追加、書き出しやページ分割。',
      comingSoonTitle: 'その他のツール',
      comingSoonDesc: '一括変換、透かし追加、フォーム作成補助などを順次追加予定です。',
    },
    draftsPage: {
      sectionTitle: '自分の申請',
      title: '下書き一覧',
      subtitle:
        'AI アシスタントと同一の下書き ID・権限を共有しています。検索・詳細編集・AI での続きの作成が可能です。',
      otherFormsLink: 'その他の申請書',
      aiAssistantLink: 'AI アシスタント',
    },
    assetsPage: {
      sectionTitle: '財務・会計 · 全社資産',
      title: '全社資産台帳',
      subtitle: '全社の資産および設備台帳を管理します（個人保有の管理資産は左下のアカウントメニューから確認できます）。',
    },
    loginPage: {
      subtitle: '電子購買・承認システム · 会社の Google アカウントでログインしてください',
      googleLoginBtn: 'Google アカウントでログイン',
      workspaceNotice:
        '会社の Workspace アカウント（@turing-drive.com）専用です。クリックして Google アカウントを選択してください。',
      supportPrefix: '問題が発生した場合はシステム管理者へ連絡するか、',
      homeLink: 'ホーム',
    },
  },
};

export function getMessages(locale: Locale): TranslationShape {
  return TRANSLATIONS[locale] ?? TRANSLATIONS[DEFAULT_LOCALE];
}
