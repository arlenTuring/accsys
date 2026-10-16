/**
 * App capability keys. Assigned to 權限角色 (access roles), not 職務類別
 * (job roles — those only resolve approval steps and form filing visibility).
 *
 * System presets: staff (none), finance (read + finance), admin (all).
 */

export const PERMISSION_GROUPS = [
  { id: 'forms', label: '單據與附件' },
  { id: 'finance', label: '財會' },
  { id: 'designer', label: '表單設計器' },
  { id: 'admin', label: '系統管理' },
] as const;

export type PermissionGroupId = (typeof PERMISSION_GROUPS)[number]['id'];

export const PERMISSIONS = {
  'forms.read_all': {
    group: 'forms',
    label: '讀取所有表單與附件',
    description: '不限申請人／簽核人，可開啟任何單據與附件（財會與管理員預設有）。',
  },
  'forms.sensitive': {
    group: 'forms',
    label: '檢視敏感欄位',
    description: '看到未遮罩的敏感欄位（例如帳戶資訊）；一般只給財會與管理員。',
  },
  'finance.budget': {
    group: 'finance',
    label: '預算編號與專案',
    description: '維護預算編號、專案與年度預算。',
  },
  'finance.cases': {
    group: 'finance',
    label: '全公司簽核追蹤',
    description: '查看與匯出全公司案件 pipeline。',
  },
  'finance.assets': {
    group: 'finance',
    label: '財產保管清冊',
    description: '查看與維護財產保管人、地點與狀態。',
  },
  'forms.design': {
    group: 'designer',
    label: '表單設計器',
    description: '新增、編輯、發佈、暫停與重新發佈自訂表單。',
  },
  'forms.delete': {
    group: 'designer',
    label: '刪除表單',
    description: '刪除或隱藏表單（含已有單據、暫停後隱藏）。建議只給少數負責人。',
  },
  'org.manage': {
    group: 'admin',
    label: '組織與簽核設定',
    description: '部門、組織層級、職務類別、員工群組、代理人與流程模擬。',
  },
  'org.directory': {
    group: 'admin',
    label: '人員同步審核',
    description: '審核 Google Directory／匯入的人員異動。',
  },
  'org.access_roles': {
    group: 'admin',
    label: '權限角色',
    description: '建立、修改與停用權限角色及其權限組合。',
  },
  'accounts.manage': {
    group: 'admin',
    label: '帳號與身份綁定',
    description: '核准 Google 綁定、停權／復權、指派權限角色。',
  },
  'master_data.manage': {
    group: 'admin',
    label: '主檔資料',
    description: '維護供應商等主檔。',
  },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SYSTEM_ROLE_CODES = ['staff', 'finance', 'admin'] as const;
export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && value in PERMISSIONS;
}

export function isSystemRoleCode(value: string): value is SystemRoleCode {
  return (SYSTEM_ROLE_CODES as readonly string[]).includes(value);
}

/** Default permission sets for the three built-in roles (seed + admin always-all). */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleCode, readonly Permission[]> = {
  staff: [],
  finance: ['forms.read_all', 'forms.sensitive', 'finance.budget', 'finance.cases', 'finance.assets'],
  admin: ALL_PERMISSIONS,
};

export const SYSTEM_ROLE_META: Record<SystemRoleCode, { name: string; description: string }> = {
  staff: { name: '一般員工', description: '可填寫與簽核自己相關的表單；沒有系統管理或財會選單。' },
  finance: { name: '財會', description: '可讀取所有單據、檢視敏感欄位，並使用財會管理功能。' },
  admin: { name: '系統管理員', description: '擁有全部權限；不可刪除或停用，權限固定為全部。' },
};

export function permissionsByGroup(): { group: (typeof PERMISSION_GROUPS)[number]; items: { key: Permission; label: string; description: string }[] }[] {
  return PERMISSION_GROUPS.map((group) => ({
    group,
    items: ALL_PERMISSIONS.filter((key) => PERMISSIONS[key].group === group.id).map((key) => ({
      key,
      label: PERMISSIONS[key].label,
      description: PERMISSIONS[key].description,
    })),
  }));
}

export function hasPermission(held: ReadonlySet<string> | readonly string[] | null | undefined, permission: Permission): boolean {
  if (!held) return false;
  if (held instanceof Set) return held.has(permission);
  return (held as readonly string[]).includes(permission);
}

export function hasAnyPermission(held: ReadonlySet<string> | readonly string[] | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => hasPermission(held, p));
}

/** Nav / layout: any finance-area capability. */
export const FINANCE_NAV_PERMISSIONS = ['finance.budget', 'finance.cases', 'finance.assets', 'forms.read_all'] as const satisfies readonly Permission[];

/** Nav / layout: any system-admin area capability. */
export const ADMIN_NAV_PERMISSIONS = [
  'org.manage',
  'org.directory',
  'org.access_roles',
  'accounts.manage',
  'master_data.manage',
  'forms.design',
  'forms.delete',
] as const satisfies readonly Permission[];
