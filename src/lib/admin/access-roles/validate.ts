import { ALL_PERMISSIONS, isPermission, isSystemRoleCode, type Permission } from '@/lib/authz/permissions';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const CODE = /^[a-z][a-z0-9_]{0,39}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

export type AccessRoleInput = {
  code: string;
  name: string;
  description: string;
  permissions: Permission[];
};

export function parseAccessRole(raw: unknown, creating: boolean): Parsed<AccessRoleInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const description = typeof r.description === 'string' ? r.description.trim() : '';
  if (!name || name.length > 30 || CONTROL.test(name)) return { ok: false, error: '名稱需為 1–30 字' };
  if (description.length > 200 || CONTROL.test(description)) return { ok: false, error: '說明最多 200 字' };

  let code = typeof r.code === 'string' ? r.code.trim() : '';
  if (creating) {
    if (!CODE.test(code)) return { ok: false, error: '代號需為小寫英文字母開頭、最多 40 字的英數與底線' };
    if (isSystemRoleCode(code)) return { ok: false, error: 'staff、finance、admin 為系統內建代號，請換一個' };
  } else {
    code = '';
  }

  const rawPerms = Array.isArray(r.permissions) ? r.permissions : [];
  const permissions: Permission[] = [];
  const seen = new Set<string>();
  for (const p of rawPerms) {
    if (!isPermission(p)) return { ok: false, error: '含有未知的權限項目' };
    if (seen.has(p)) continue;
    seen.add(p);
    permissions.push(p);
  }
  // Reject unknown extras already handled; ensure we only keep catalog keys.
  if (permissions.some((p) => !(ALL_PERMISSIONS as string[]).includes(p))) {
    return { ok: false, error: '含有未知的權限項目' };
  }

  return { ok: true, value: { code, name, description, permissions } };
}
