import type { Condition, FlowContext, OrgSnapshot } from './types';

const isBlank = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

function same(a: unknown, b: unknown): boolean {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na === nb;
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return typeof a === 'string' && typeof b === 'string' && a === b;
}

/** Applicant-derived values a condition may test, besides plain form fields. */
export function systemValue(field: string, ctx: FlowContext, org: OrgSnapshot): unknown {
  const dept = org.departments.get(ctx.departmentId);
  switch (field) {
    case '$applicant.id':
      return ctx.applicantEmployeeId;
    case '$filer.id':
      return ctx.filerEmployeeId;
    case '$applicant.department':
      return ctx.departmentId;
    case '$applicant.orgLevel':
      return dept?.levelCode ?? null;
    case '$applicant.jobRoles':
      return [
        ...new Set(org.jobRoleBindings.filter((b) => b.employeeId === ctx.applicantEmployeeId).map((b) => b.jobRole)),
      ];
    default:
      return undefined;
  }
}

function valueOf(field: string, ctx: FlowContext, org: OrgSnapshot): unknown {
  return field.startsWith('$') ? systemValue(field, ctx, org) : ctx.fields[field];
}

/** Missing values never satisfy a comparison (except neq / not_in / empty). */
export function evaluateCondition(cond: Condition, ctx: FlowContext, org: OrgSnapshot): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, ctx, org));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, ctx, org));
  if ('not' in cond) return !evaluateCondition(cond.not, ctx, org);

  const actual = valueOf(cond.field, ctx, org);
  const expected = cond.value;
  switch (cond.op) {
    case 'filled':
      return !isBlank(actual);
    case 'empty':
      return isBlank(actual);
    case 'eq':
      return Array.isArray(actual) ? false : same(actual, expected);
    case 'neq':
      return Array.isArray(actual) ? true : !same(actual, expected);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      if (a === null || b === null) return false;
      if (cond.op === 'gt') return a > b;
      if (cond.op === 'gte') return a >= b;
      if (cond.op === 'lt') return a < b;
      return a <= b;
    }
    case 'in':
      return Array.isArray(expected) && !isBlank(actual) && expected.some((e) => same(actual, e));
    case 'not_in':
      return !(Array.isArray(expected) && !isBlank(actual) && expected.some((e) => same(actual, e)));
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => same(a, expected));
      return typeof actual === 'string' && typeof expected === 'string' && expected !== '' && actual.includes(expected);
    default:
      return false;
  }
}
