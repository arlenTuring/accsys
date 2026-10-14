import { isUuid } from '@/lib/authz/forms';
import { addDays, isIsoDate } from '@/lib/seal-requests/validate';

// Input checks for the organisation admin screens (no database access).

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const CODE = /^[a-z][a-z0-9_]{0,39}$/;
const DEPT_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

function text(v: unknown, label: string, max: number, required = true): Parsed<string> {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) return { ok: false, error: `請填寫${label}` };
  if (s.length > max) return { ok: false, error: `${label}最多 ${max} 字` };
  if (CONTROL.test(s)) return { ok: false, error: `${label}含有不允許的字元` };
  return { ok: true, value: s };
}

const optionalId = (v: unknown): string | null | undefined => (v === null || v === undefined || v === '' ? null : isUuid(v) ? v : undefined);

export type LevelInput = { code: string; name: string; rank: number };

export function parseLevel(raw: unknown, creating: boolean): Parsed<LevelInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const code = typeof r.code === 'string' ? r.code.trim() : '';
  if (creating && !CODE.test(code)) return { ok: false, error: '層級代號需為小寫英文字母開頭的英數字或底線（最多 40 字）' };
  const name = text(r.name, '層級名稱', 30);
  if (!name.ok) return name;
  const rank = Number(r.rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 1000) return { ok: false, error: '層級高低需為 1–1000 的整數（數字越大越高）' };
  return { ok: true, value: { code, name: name.value, rank } };
}

export type DepartmentInput = {
  code: string;
  name: string;
  parentId: string | null;
  orgLevelId: string | null;
  managerId: string | null;
  sortOrder: number;
};

export function parseDepartment(raw: unknown, creating: boolean): Parsed<DepartmentInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const code = typeof r.code === 'string' ? r.code.trim() : '';
  if (creating && !DEPT_CODE.test(code)) return { ok: false, error: '部門代號需為 1–20 個英數字、底線或連字號' };
  const name = text(r.name, '部門名稱', 40);
  if (!name.ok) return name;
  const parentId = optionalId(r.parentId);
  const orgLevelId = optionalId(r.orgLevelId);
  const managerId = optionalId(r.managerId);
  if (parentId === undefined || orgLevelId === undefined || managerId === undefined) return { ok: false, error: '選擇的資料不正確，請重新整理' };
  const sortOrder = r.sortOrder === undefined || r.sortOrder === '' ? 0 : Number(r.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return { ok: false, error: '排序需為 0–9999 的整數' };
  return { ok: true, value: { code, name: name.value, parentId, orgLevelId, managerId, sortOrder } };
}

export type JobRoleInput = { code: string; name: string; description: string };

export function parseJobRole(raw: unknown, creating: boolean): Parsed<JobRoleInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const code = typeof r.code === 'string' ? r.code.trim() : '';
  if (creating && !CODE.test(code)) return { ok: false, error: '職務代號需為小寫英文字母開頭的英數字或底線（最多 40 字）' };
  const name = text(r.name, '職務名稱', 30);
  if (!name.ok) return name;
  const description = text(r.description, '說明', 200, false);
  if (!description.ok) return description;
  return { ok: true, value: { code, name: name.value, description: description.value } };
}

export type GroupInput = { name: string; description: string };

export function parseGroup(raw: unknown): Parsed<GroupInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = text(r.name, '群組名稱', 40);
  if (!name.ok) return name;
  const description = text(r.description, '說明', 200, false);
  if (!description.ok) return description;
  return { ok: true, value: { name: name.value, description: description.value } };
}

export const MAX_GROUP_MEMBERS = 30;

/** Ordered, distinct employee ids. */
export function parseMemberIds(raw: unknown): Parsed<string[]> {
  if (!Array.isArray(raw) || !raw.every(isUuid)) return { ok: false, error: '成員資料不正確，請重新整理' };
  if (new Set(raw).size !== raw.length) return { ok: false, error: '同一位員工不能重複加入' };
  if (raw.length > MAX_GROUP_MEMBERS) return { ok: false, error: `群組最多 ${MAX_GROUP_MEMBERS} 位成員` };
  return { ok: true, value: raw };
}

export const MAX_DELEGATION_DAYS = 366;

export type DelegationInput = {
  delegatorId: string;
  delegateId: string;
  startsOn: string;
  endsOn: string;
  /** null = every form */
  formKeys: string[] | null;
  reason: string;
};

export function parseDelegation(raw: unknown, today: string): Parsed<DelegationInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isUuid(r.delegatorId) || !isUuid(r.delegateId)) return { ok: false, error: '請選擇被代理人與代理人' };
  if (r.delegatorId === r.delegateId) return { ok: false, error: '代理人不能是本人' };
  if (!isIsoDate(r.startsOn) || !isIsoDate(r.endsOn)) return { ok: false, error: '請填寫正確的起訖日期' };
  if (r.endsOn < r.startsOn) return { ok: false, error: '結束日期不能早於開始日期' };
  if (r.endsOn < today) return { ok: false, error: '結束日期不能早於今天' };
  if (r.endsOn > addDays(r.startsOn, MAX_DELEGATION_DAYS - 1)) return { ok: false, error: `代理期間最長 ${MAX_DELEGATION_DAYS} 天` };
  let formKeys: string[] | null = null;
  if (r.formKeys !== null && r.formKeys !== undefined) {
    if (!Array.isArray(r.formKeys) || r.formKeys.length === 0 || !r.formKeys.every((k) => typeof k === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(k))) {
      return { ok: false, error: '請選擇代理的表單，或選擇「全部表單」' };
    }
    formKeys = [...new Set(r.formKeys as string[])];
  }
  const reason = text(r.reason, '代理原因', 200, false);
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: { delegatorId: r.delegatorId, delegateId: r.delegateId, startsOn: r.startsOn, endsOn: r.endsOn, formKeys, reason: reason.value },
  };
}

type Period = { startsOn: string; endsOn: string; formKeys: string[] | null };

/** Two delegations of one person collide when their dates and form scopes both overlap. */
export function delegationsOverlap(a: Period, b: Period): boolean {
  if (a.endsOn < b.startsOn || b.endsOn < a.startsOn) return false;
  if (a.formKeys === null || b.formKeys === null) return true;
  return a.formKeys.some((k) => b.formKeys!.includes(k));
}

/** `id` and every department below it. */
export function subtreeOf(id: string, departments: { id: string; parentId: string | null }[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of departments) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}
