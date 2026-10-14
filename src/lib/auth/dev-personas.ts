export type DevPersonaId = 'staff' | 'manager' | 'finance' | 'admin';

/** Display data only; the login emails stay server-side (dev-persona-emails.ts). */
export type DevPersona = {
  id: DevPersonaId;
  label: string;
  name: string;
  title: string;
  department: string;
  roleLabel: string;
  description: string;
  highlights: string[];
};

export const DEV_PERSONAS: DevPersona[] = [
  {
    id: 'staff',
    label: '一般員工',
    name: '林小明',
    title: '軟體工程師',
    department: '研發部',
    roleLabel: '申請人',
    description: '提交請購、追蹤自己的案件進度，收到退回後修改重送。',
    highlights: ['我的請購／採購／驗收', '新增申請', '查看簽核狀態'],
  },
  {
    id: 'manager',
    label: '部門主管',
    name: '王主管',
    title: '研發部經理',
    department: '研發部',
    roleLabel: '簽核人',
    description: '審核轄下員工的請購與採購，待簽核佇列會優先顯示。',
    highlights: ['待我簽核', '部門案件審核', '核准或退回附註'],
  },
  {
    id: 'finance',
    label: '財會人員',
    name: '陳財會',
    title: '財務專員',
    department: '財務部',
    roleLabel: '財會',
    description: '追蹤全公司案件 pipeline、管理預算編號，並處理費用申請簽核。',
    highlights: ['簽核追蹤', '預算編號管理', '費用申請審核'],
  },
  {
    id: 'admin',
    label: '系統管理員',
    name: '本機開發者',
    title: '資訊管理',
    department: '本機開發',
    roleLabel: 'Admin',
    description: '完整權限：財會功能 + 主檔管理，並可擔任總經理／董事長層級簽核。',
    highlights: ['全部模組', '主檔資料', '高額案件簽核'],
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
