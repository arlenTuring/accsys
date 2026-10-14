/**
 * Who may file a form. {} = every employee; otherwise the applicant's
 * department is listed, or they hold one of the listed job roles (anywhere).
 */
export type Visibility = { departmentIds?: string[]; jobRoles?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_]{0,39}$/;

export function parseVisibility(raw: unknown): { ok: true; value: Visibility } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '可見範圍格式不正確' };
  const v = raw as Record<string, unknown>;
  const out: Visibility = {};
  for (const [key, pattern] of [
    ['departmentIds', UUID],
    ['jobRoles', CODE],
  ] as const) {
    const list = v[key];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list) || list.length > 200 || !list.every((x) => typeof x === 'string' && pattern.test(x))) {
      return { ok: false, error: '可見範圍格式不正確' };
    }
    if (list.length > 0) out[key] = [...new Set(list as string[])];
  }
  return { ok: true, value: out };
}

export function isRestricted(v: Visibility): boolean {
  return (v.departmentIds?.length ?? 0) > 0 || (v.jobRoles?.length ?? 0) > 0;
}

export function canFile(v: Visibility, employee: { departmentId: string; jobRoles: string[] }): boolean {
  if (!isRestricted(v)) return true;
  return (v.departmentIds ?? []).includes(employee.departmentId) || employee.jobRoles.some((r) => (v.jobRoles ?? []).includes(r));
}
