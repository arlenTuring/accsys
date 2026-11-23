export type FeatureFlagKey =
  | 'project_assistant'
  | 'ai_chat'
  | 'global_floating_assistant'
  | 'email_inline_approval'
  | 'procurement_module'
  | 'expense_claim_module'
  | 'seal_request_module'
  | 'budget_management_platform'
  | 'asset_management_module'
  | 'company_info_hub'
  | 'tools_workspace';

export type FeatureFlagCategory =
  | 'AI 與智慧輔助'
  | '郵件與簽核互動'
  | '表單申請與簽核模組'
  | '財會與資產管理模組'
  | '公司資訊與工具箱';

export type FeatureFlagDefinition = {
  key: FeatureFlagKey;
  title: string;
  category: FeatureFlagCategory;
  description: string;
  affectedRoutes: string[];
  defaultEnabled: boolean;
  badgeText?: string;
};

export type FeatureFlagMap = Record<FeatureFlagKey, boolean>;

export const FEATURE_FLAG_DEFINITIONS: FeatureFlagDefinition[] = [
  {
    key: 'project_assistant',
    title: '專案助手（GWS 歷年專案知識庫與共編助手）',
    category: 'AI 與智慧輔助',
    description:
      '左側主導覽列「專案助手」，提供歷年 GWS 專案資料夾檢索、文件預覽與 AI 協作共編功能。關閉或未獲授權時將從導覽列隱藏，並嚴格攔截所有直接網址與 API 存取。',
    affectedRoutes: [
      '/tools/project-assistant',
      '/tools/project-assistant/viewer',
      '/api/projects/*',
    ],
    defaultEnabled: false,
    badgeText: '預設關閉',
  },
  {
    key: 'ai_chat',
    title: 'AI 助手（企業內部 AI 對話與問答助手）',
    category: 'AI 與智慧輔助',
    description:
      '左側主導覽列「AI 助手」，提供公司規章查詢、表單填寫指引與一般工作問答對話。',
    affectedRoutes: ['/tools/ai-chat', '/api/ai-chat/*'],
    defaultEnabled: true,
  },
  {
    key: 'global_floating_assistant',
    title: '全域懸浮小幫手（左下角快速問答視窗）',
    category: 'AI 與智慧輔助',
    description:
      '畫面左下角導覽列之懸浮 AI 輔助按鈕，讓員工在填寫表單或瀏覽頁面時可隨時開啟小視窗詢問。',
    affectedRoutes: ['全站左下角懸浮按鈕'],
    defaultEnabled: true,
  },
  {
    key: 'email_inline_approval',
    title: '郵件內快速簽核（通知信內核准／退回）',
    category: '郵件與簽核互動',
    description:
      '於簽核通知信中嵌入完整單據明細與防誤觸「核准／退回」按鈕，讓簽核人免登入主系統即可完成簽核。',
    affectedRoutes: ['/email-approval'],
    defaultEnabled: true,
  },
  {
    key: 'procurement_module',
    title: '採購流程模組（請購單／採購單／驗收單／採購付款）',
    category: '表單申請與簽核模組',
    description:
      '簽核管理中的四階段採購流程（請購 → 採購 → 驗收 → 付款）表單申請與紀錄頁。',
    affectedRoutes: [
      '/requests/*',
      '/purchase-orders/*',
      '/acceptances/*',
      '/expense-requests/*',
    ],
    defaultEnabled: true,
  },
  {
    key: 'expense_claim_module',
    title: '費用報支與出差旅費模組（各類費用申請／出差報支）',
    category: '表單申請與簽核模組',
    description:
      '部門預算費用、小額費用、產品專案費用、營收專案費用、免走採購付款及出差旅費報支申請。',
    affectedRoutes: ['/expense-claims/*', '/travel-expenses/*'],
    defaultEnabled: true,
  },
  {
    key: 'seal_request_module',
    title: '用印申請模組（合約／一般文件／發票用印）',
    category: '表單申請與簽核模組',
    description:
      '合約協議書、報價單、公文、工商登記與客戶發票之公司印鑑用印申請流程。',
    affectedRoutes: ['/seal-requests/*'],
    defaultEnabled: true,
  },
  {
    key: 'budget_management_platform',
    title: '預算管理平台（主檔管理／建立預算／預算管理／預算分析）',
    category: '財會與資產管理模組',
    description:
      '財會管理下的主檔管理、年度預算規劃派發、各部門／專案預算填報追蹤與預算執行分析。',
    affectedRoutes: ['/budget-codes/*', '/my-tasks/budget'],
    defaultEnabled: true,
  },
  {
    key: 'asset_management_module',
    title: '資產管理與財產盤點模組（全公司財產清冊／財產盤點／資產異動）',
    category: '財會與資產管理模組',
    description:
      '全公司固定資產清冊、員工名下保管資產查詢、資產異動申請單與年度財產盤點作業。',
    affectedRoutes: ['/assets/*', '/asset-transfers/*'],
    defaultEnabled: true,
  },
  {
    key: 'company_info_hub',
    title: '公司資訊專區（公司公告／公司規章／內部問卷）',
    category: '公司資訊與工具箱',
    description:
      '左上角公司品牌圖示入口之全公司公告瀏覽、規章辦法查閱與員工內部問卷填寫。',
    affectedRoutes: ['/announcements', '/regulations', '/surveys'],
    defaultEnabled: true,
  },
  {
    key: 'tools_workspace',
    title: '工具區與 PDF 編輯器（實用工具箱）',
    category: '公司資訊與工具箱',
    description:
      '左側主導覽列「工具區」，包含工具總覽、操作教學與線上 PDF 合併／拆分／簽名編輯器。',
    affectedRoutes: ['/tools', '/tools/guide', '/tools/pdf-editor'],
    defaultEnabled: true,
  },
];

export const ALL_FEATURE_FLAG_KEYS: FeatureFlagKey[] =
  FEATURE_FLAG_DEFINITIONS.map((d) => d.key);

export const DEFAULT_FEATURE_FLAGS: FeatureFlagMap =
  FEATURE_FLAG_DEFINITIONS.reduce((acc, def) => {
    acc[def.key] = def.defaultEnabled;
    return acc;
  }, {} as FeatureFlagMap);

export function getFeatureDefinition(
  key: FeatureFlagKey
): FeatureFlagDefinition | undefined {
  return FEATURE_FLAG_DEFINITIONS.find((d) => d.key === key);
}

/**
 * 根據表單 Key 或分類 Key 判定該表單屬於哪一個全公司系統授權模組。
 * 若該模組未獲授權或已關閉，全公司所有帳號（含系統管理員）皆不可填寫、檢視或透過 AI 建立該表單。
 */
export function resolveFeatureFlagForFormKey(
  rawFormKey: string,
  categoryKey?: string
): FeatureFlagKey | null {
  const key = (rawFormKey || '').trim().toLowerCase();

  if (
    key === 'purchase-request' ||
    key === 'purchase_request' ||
    key === 'purchase-order' ||
    key === 'purchase_order' ||
    key === 'acceptance' ||
    key === 'expense-request' ||
    key === 'expense_request' ||
    key === 'procurement-payment'
  ) {
    return 'procurement_module';
  }

  if (
    key === 'expense-claim' ||
    key === 'department-expense' ||
    key === 'department_expense' ||
    key === 'minor-expense' ||
    key === 'minor_expense' ||
    key === 'project-expense' ||
    key === 'project_expense' ||
    key === 'revenue-expense' ||
    key === 'revenue_expense' ||
    key === 'travel-expense' ||
    key === 'travel_expense' ||
    key === 'business-trip' ||
    key === 'standalone-payment' ||
    key === 'standalone-expense-request' ||
    key === 'standalone_expense_request'
  ) {
    return 'expense_claim_module';
  }

  if (
    key === 'contract-seal' ||
    key === 'contract-seal-request' ||
    key === 'contract_seal_request' ||
    key === 'general-seal' ||
    key === 'general-seal-request' ||
    key === 'general_seal_request' ||
    key === 'invoice-seal' ||
    key === 'invoice-seal-request' ||
    key === 'invoice_seal_request'
  ) {
    return 'seal_request_module';
  }

  if (key === 'budget-request' || key === 'budget-change') {
    return 'budget_management_platform';
  }

  if (key === 'asset-transfer' || key === 'asset_transfer') {
    return 'asset_management_module';
  }

  if (categoryKey === 'procurement') return 'procurement_module';
  if (categoryKey === 'expense') return 'expense_claim_module';
  if (categoryKey === 'seal') return 'seal_request_module';
  if (categoryKey === 'budget') return 'budget_management_platform';
  if (categoryKey === 'asset') return 'asset_management_module';

  return null;
}

/**
 * 嚴格路由守衛對照表：
 * 根據使用者請求的 pathname 判定該路徑屬於哪一個受控功能模組。
 * 若該模組於授權碼或功能開關中為關閉狀態，無論透過導覽列或直接輸入網址（即便是系統管理員）皆會被強制攔截。
 */
export function resolveFeatureFlagForPath(
  rawPathname: string
): FeatureFlagKey | null {
  const pathname = (rawPathname || '/').split('?')[0];

  // 系統管理中的「公告管理／規章管理／問卷管理」亦受「公司資訊專區 (company_info_hub)」全系統授權控管，
  // 若全公司未購買或關閉公司資訊專區，即便是系統管理員亦不得進入管理該模組。
  if (
    pathname === '/admin/announcements' ||
    pathname.startsWith('/admin/announcements/') ||
    pathname === '/admin/regulations' ||
    pathname.startsWith('/admin/regulations/') ||
    pathname === '/admin/surveys' ||
    pathname.startsWith('/admin/surveys/')
  ) {
    return 'company_info_hub';
  }

  // 其餘系統核心管理（功能授權、公司資料、帳號權限、組織簽核、表單設計、信箱設定、系統日誌）、登入認證與簽核追蹤永遠允許進入（避免管理員鎖死自己）
  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/case-tracking') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth')
  ) {
    return null;
  }

  // 1. 專案助手（含獨立預覽器與所有 /api/projects/* API）
  if (
    pathname === '/tools/project-assistant' ||
    pathname.startsWith('/tools/project-assistant/') ||
    pathname.startsWith('/api/projects/')
  ) {
    return 'project_assistant';
  }

  // 2. AI 助手（含 /api/ai-chat/*）
  if (
    pathname === '/tools/ai-chat' ||
    pathname.startsWith('/tools/ai-chat/') ||
    pathname.startsWith('/api/ai-chat/')
  ) {
    return 'ai_chat';
  }

  // 3. 工具區與 PDF 編輯器（排除上面已優先判定的 ai-chat 與 project-assistant）
  if (pathname === '/tools' || pathname.startsWith('/tools/')) {
    return 'tools_workspace';
  }

  // 4. 郵件內快速簽核
  if (
    pathname === '/email-approval' ||
    pathname.startsWith('/email-approval/') ||
    pathname === '/api/email-approval' ||
    pathname.startsWith('/api/email-approval/')
  ) {
    return 'email_inline_approval';
  }

  // 5. 預算管理平台
  if (
    pathname === '/budget-codes' ||
    pathname.startsWith('/budget-codes/') ||
    pathname === '/my-tasks/budget' ||
    pathname.startsWith('/my-tasks/budget/') ||
    pathname.startsWith('/f/budget-request') ||
    pathname.startsWith('/f/budget-change') ||
    pathname.startsWith('/api/budget-codes/')
  ) {
    return 'budget_management_platform';
  }

  // 6. 資產管理與財產盤點模組
  if (
    pathname === '/assets' ||
    pathname.startsWith('/assets/') ||
    pathname === '/asset-transfers' ||
    pathname.startsWith('/asset-transfers/') ||
    pathname.startsWith('/f/asset-transfer') ||
    pathname.startsWith('/api/assets/')
  ) {
    return 'asset_management_module';
  }

  // 7. 採購流程模組（請購、採購、驗收、採購付款）
  if (
    pathname === '/requests' ||
    pathname.startsWith('/requests/') ||
    pathname === '/purchase-orders' ||
    pathname.startsWith('/purchase-orders/') ||
    pathname === '/acceptances' ||
    pathname.startsWith('/acceptances/') ||
    pathname === '/expense-requests' ||
    pathname.startsWith('/expense-requests/') ||
    pathname.startsWith('/f/purchase-request') ||
    pathname.startsWith('/f/purchase-order') ||
    pathname.startsWith('/f/acceptance') ||
    pathname.startsWith('/f/expense-request') ||
    pathname.startsWith('/f/procurement-payment')
  ) {
    return 'procurement_module';
  }

  // 8. 費用報支與出差旅費模組
  if (
    pathname === '/expense-claims' ||
    pathname.startsWith('/expense-claims/') ||
    pathname === '/travel-expenses' ||
    pathname.startsWith('/travel-expenses/') ||
    pathname.startsWith('/f/expense-claim') ||
    pathname.startsWith('/f/business-trip') ||
    pathname.startsWith('/f/standalone-payment') ||
    pathname.startsWith('/f/department-expense') ||
    pathname.startsWith('/f/minor-expense') ||
    pathname.startsWith('/f/project-expense') ||
    pathname.startsWith('/f/revenue-expense') ||
    pathname.startsWith('/f/travel-expense') ||
    pathname.startsWith('/f/standalone-expense-request')
  ) {
    return 'expense_claim_module';
  }

  // 9. 用印申請模組
  if (
    pathname === '/seal-requests' ||
    pathname.startsWith('/seal-requests/') ||
    pathname.startsWith('/f/contract-seal') ||
    pathname.startsWith('/f/general-seal') ||
    pathname.startsWith('/f/invoice-seal')
  ) {
    return 'seal_request_module';
  }

  // 10. 公司資訊專區（公告、規章、問卷）
  if (
    pathname === '/announcements' ||
    pathname.startsWith('/announcements/') ||
    pathname === '/regulations' ||
    pathname.startsWith('/regulations/') ||
    pathname === '/surveys' ||
    pathname.startsWith('/surveys/') ||
    pathname.startsWith('/api/announcements/') ||
    pathname.startsWith('/api/regulations/') ||
    pathname.startsWith('/api/surveys/')
  ) {
    return 'company_info_hub';
  }

  return null;
}
