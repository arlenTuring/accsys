export type DevPersonaId =
  | 'staff'
  | 'manager'
  | 'budget_owner'
  | 'new_custodian'
  | 'new_manager'
  | 'general_affairs'
  | 'finance'
  | 'gm'
  | 'chairman'
  | 'admin';

/** Display data only; the login emails stay server-side (dev-persona-emails.ts). */
export type DevPersona = {
  id: DevPersonaId;
  stageBadge: string;
  label: string;
  name: string;
  employeeCode: string;
  title: string;
  department: string;
  roleLabel: string;
  description: string;
  highlights: string[];
};

/**
 * 第 39 條：完整涵蓋每一關簽核流程的測試帳號（10 大關卡角色）。
 * 涵蓋：
 * - 一般表單（第 19 條）：申請人(staff) → 部門主管(manager) → 預算負責人(budget_owner) → 總經理(gm) → 超過 10 萬送董事長(chairman)
 * - 資產異動（第 36、37 條）：申請人/原保管人 → 原部門主管 → 新保管人(new_custodian) → 新部門主管(new_manager) → 資產管理人/總務(general_affairs) → 財會(finance) → 總經理/董事長
 * - 用印申請（第 38 條）：申請人 → 部門主管 → 用印管理人(general_affairs) → 總經理 → 董事長
 * - 財產保管清冊雙階盤點（第 35 條）：待確認人/保管人(staff/new_custodian) → 檢核人(finance/general_affairs)
 */
export const DEV_PERSONAS: DevPersona[] = [
  {
    id: 'staff',
    stageBadge: '第 1 關｜起單申請人',
    label: '一般員工（原保管人）',
    name: '阮振瑋',
    employeeCode: '0017',
    title: '工程經理',
    department: '自動駕駛系統部',
    roleLabel: '申請人 / 待確認人',
    description: '提交請購、採購、驗收、費用申請、用印、資產異動，並執行名下財產盤點「待確認人確認」。',
    highlights: ['起單申請', '名下財產待確認人確認', '退回修改重送'],
  },
  {
    id: 'manager',
    stageBadge: '第 2 關｜原部門主管',
    label: '部門主管（自動駕駛系統部）',
    name: '楊為任',
    employeeCode: '0053',
    title: '軟體研發副總',
    department: '自動駕駛系統部',
    roleLabel: '原部門主管',
    description: '審核自動駕駛系統部同仁的請購、採購、費用、公出差旅、用印與資產異動第一關主管簽核。',
    highlights: ['部門主管簽核', '部門預算預設負責人', '轄下部門財產檢視'],
  },
  {
    id: 'budget_owner',
    stageBadge: '第 3 關｜預算負責人',
    label: '預算負責人（產品經理）',
    name: '張晏銘',
    employeeCode: '0060',
    title: '產品經理',
    department: '產品部',
    roleLabel: '預算負責人',
    description: '擔任產品專案與營收專案預算代碼之負責人，簽核所有動支該專案預算的請購與費用申請單。',
    highlights: ['專案預算負責人簽核', '預算申請與變更', '跨部門專案控管'],
  },
  {
    id: 'new_custodian',
    stageBadge: '資產異動關｜新保管人',
    label: '跨部門新保管人',
    name: '賴昭宇',
    employeeCode: '0046',
    title: '資深車輛開發工程師',
    department: '車輛開發部',
    roleLabel: '新保管人',
    description: '在資產異動（移轉／借出）流程中擔任接收財產的「新保管人」確認關卡。',
    highlights: ['資產移轉新保管人簽認', '跨部門設備點交', '名下財產確認'],
  },
  {
    id: 'new_manager',
    stageBadge: '資產異動關｜新部門主管',
    label: '跨部門新主管（車輛開發部）',
    name: '陳冠文',
    employeeCode: '0032',
    title: '副總經理',
    department: '車輛開發部',
    roleLabel: '新部門主管',
    description: '在跨部門資產異動流程中擔任「新保管部門主管」簽核關卡。',
    highlights: ['跨部門資產接收主管簽核', '車輛開發部主管審核'],
  },
  {
    id: 'general_affairs',
    stageBadge: '總務／用印／資產管理關',
    label: '行政總務（用印／資產管理）',
    name: '汪怡伶',
    employeeCode: '0075',
    title: '行政總務專員',
    department: '管理部',
    roleLabel: '用印 / 資產管理人',
    description: '負責用印申請（大小章／合約章／發票章）審核，以及資產異動／報廢之總務資產管理關卡。',
    highlights: ['用印管理人簽核', '資產異動總務核對', '財編標籤管理'],
  },
  {
    id: 'finance',
    stageBadge: '財會／驗收財編／盤點檢核關',
    label: '財會人員（檢核人）',
    name: '許雲茹',
    employeeCode: '0009',
    title: '行政財會',
    department: '管理部',
    roleLabel: '財會 / 盤點檢核人',
    description: '負責驗收單填寫財產編號、費用與採購付款審核、預算代號維護，以及財產清冊第二階「檢核人再確認」。',
    highlights: ['財產清冊檢核人再確認', '驗收單填財產編號', '預算代號與撥款管理'],
  },
  {
    id: 'gm',
    stageBadge: '第 4 關｜總經理／執行長',
    label: '執行長（總經理）',
    name: '沈大維',
    employeeCode: '0002',
    title: '執行長',
    department: '總經理室',
    roleLabel: '總經理',
    description: '全公司一般表單、資產報廢／出售、用印申請與預算案之總經理決行關卡。',
    highlights: ['總經理簽核決行', '10 萬元以下最終核准', '全公司案件總覽'],
  },
  {
    id: 'chairman',
    stageBadge: '第 5 關｜董事長（>10萬）',
    label: '董事長',
    name: '陳維隆',
    employeeCode: '0001',
    title: '董事長',
    department: '董事長室',
    roleLabel: '董事長',
    description: '單筆或總額超過 NT$ 100,000 之表單、重要合約用印與年度預算案之最高核准關卡。',
    highlights: ['超過 10 萬元最高決行', '合約用印與預算核定'],
  },
  {
    id: 'admin',
    stageBadge: '全權限｜系統管理員',
    label: '系統管理員',
    name: '吳旭東',
    employeeCode: '0065',
    title: '協理',
    department: '管理部',
    roleLabel: 'Admin',
    description: '完整權限：表單設計器、權限角色設定、組織架構、財產清冊與全系統管理。',
    highlights: ['全部模組權限', '表單與簽核流程設計', '主檔與系統設定'],
  },
];

/** UI hint only (inlined into client bundles). Never use this to authorize. */
export function isDevLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_LOGIN === 'true';
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackOrigin(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(raw.trim()).hostname);
  } catch {
    return false;
  }
}

/**
 * The request's Host header names a loopback host. Blocks DNS rebinding and a
 * dev server opened on a LAN address; a client that forges Host itself is not
 * stopped by this, only by the server listening on loopback.
 */
export function isLoopbackHostHeader(host: string | null): boolean {
  if (!host) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/**
 * Server-side gate for /auth/dev. Requires `next dev` (NODE_ENV=development),
 * the explicit opt-in flag AND a loopback APP_ORIGIN, so a test/staging/
 * production build, a dev server without the flag, or a dev server published
 * under a shared hostname can never hand out sessions without Google login.
 */
export function isDevLoginAllowed(
  env: { NODE_ENV?: string; NEXT_PUBLIC_DEV_LOGIN?: string; APP_ORIGIN?: string } = process.env
): boolean {
  return (
    env.NODE_ENV === 'development' &&
    env.NEXT_PUBLIC_DEV_LOGIN === 'true' &&
    isLoopbackOrigin(env.APP_ORIGIN)
  );
}
