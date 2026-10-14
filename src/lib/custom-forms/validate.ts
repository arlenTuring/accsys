import { evaluateCondition } from '@/lib/approval/flow/condition';
import type { Condition, OrgSnapshot } from '@/lib/approval/flow/types';
import { BASE_CURRENCY, parseRateMicros, rateOutOfBounds } from '@/lib/exchange-rates';
import { addCents, centsToDecimal, MAX_CENTS, MoneyError, toCents, type Cents } from '@/lib/money';
import {
  allFields,
  isDisplayOnly,
  SOURCE_ROW_KEY,
  sourceTargets,
  type BudgetScope,
  type FieldDef,
  type FormSchema,
  type RuleCompareOp,
  type TableColumn,
} from './schema';

/**
 * Server-side validation of a submission against its definition version.
 * Values the client computed (formula columns, totals) are ignored and
 * recomputed; values of hidden fields are dropped. Client-safe, so the form
 * renderer runs the same rules for instant feedback.
 */

export type TableValue = { rows: Record<string, unknown>[]; total: string | number | null };
export type SubmissionData = Record<string, unknown>;

export type NormalizedSubmission = {
  data: SubmissionData;
  /** Values the approval flow sees: tables are reduced to their total. */
  flowFields: Record<string, unknown>;
  promoted: { totalAmount: string | null; budgetCodeId: string | null; projectId: string | null };
  /** Ids to check against live data (exists / active, budget codes of the field's scope) inside the transaction. */
  refs: {
    employees: string[];
    departments: string[];
    budgetCodes: string[];
    projects: string[];
    suppliers: string[];
    /** Must still be in the register (保管中 / 出借中). */
    assets: string[];
    budgetScopes: { id: string; scope: BudgetScope }[];
    /** Budget codes of one table column that must share a budget owner. */
    sameOwner: { label: string; ids: string[] }[];
  };
  /** Whether a visible attachments field requires at least one file. */
  attachmentsRequired: boolean;
};

export type ValidationResult = { ok: true; value: NormalizedSubmission } | { ok: false; errors: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-() #]{6,30}$/;
const TAX_ID = /^\d{8}$/;
const BANK_ACCOUNT = /^[0-9 -]{4,30}$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const EMPTY_ORG: OrgSnapshot = {
  employees: new Map(),
  departments: new Map(),
  levels: new Map(),
  jobRoles: new Map(),
  jobRoleBindings: [],
  groups: new Map(),
  delegations: [],
  budgetOwners: new Map(),
  assetCustodians: new Map(),
};

/** A condition on plain field values (no applicant or organisation lookups). */
export const holds = (cond: Condition, values: Record<string, unknown>) =>
  evaluateCondition(cond, { applicantEmployeeId: '', filerEmployeeId: '', departmentId: '', formKey: null, today: '', fields: values }, EMPTY_ORG);

/** visibleWhen only tests earlier form fields (the schema parser enforces it). */
export function isFieldVisible(field: FieldDef, values: Record<string, unknown>): boolean {
  return !field.visibleWhen || holds(field.visibleWhen, values);
}

/** `required`, or `requiredWhen` holding for the earlier values. */
export function isFieldRequired(field: FieldDef, values: Record<string, unknown>): boolean {
  return field.required || (!!field.requiredWhen && holds(field.requiredWhen, values));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Earliest date a date field accepts right now (for the date picker), or undefined. */
export function minDate(field: FieldDef, values: Record<string, unknown>, today: string): string | undefined {
  if (field.type !== 'date') return undefined;
  let min = field.notBeforeToday ? today : undefined;
  for (const r of field.rules ?? []) {
    if (r.when && !holds(r.when, values)) continue;
    const bound =
      r.check.kind === 'min_days_from_today'
        ? addDays(today, r.check.days)
        : r.check.kind === 'compare' && (r.check.op === 'gte' || r.check.op === 'gt')
          ? (values[r.check.field] as string | undefined)
          : undefined;
    if (typeof bound === 'string' && isValidDate(bound) && (!min || bound > min)) min = bound;
  }
  return min;
}

function compare(a: number | string, op: RuleCompareOp, b: number | string): boolean {
  if (op === 'gte') return a >= b;
  if (op === 'gt') return a > b;
  if (op === 'lte') return a <= b;
  return a < b;
}

/** Cross-field rules of a field whose own value is already valid and non-empty. */
function checkRules(field: FieldDef, v: unknown, values: Record<string, unknown>, today: string) {
  for (const r of field.rules ?? []) {
    if (r.when && !holds(r.when, values)) continue;
    if (r.check.kind === 'min_days_from_today') {
      if ((v as string) < addDays(today, r.check.days)) bad(r.message);
      continue;
    }
    if (r.check.kind === 'not_equal') {
      if (String(v).trim() === r.check.value.trim()) bad(r.message);
      continue;
    }
    const other = values[r.check.field];
    if (other === null || other === undefined || other === '') continue;
    if (field.type === 'date') {
      if (!compare(v as string, r.check.op, String(other))) bad(r.message);
    } else {
      const a = Number(v);
      const b = Number(other);
      if (Number.isFinite(a) && Number.isFinite(b) && !compare(a, r.check.op, b)) bad(r.message);
    }
  }
}

function isValidDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

class FieldError extends Error {}
const bad = (msg: string): never => {
  throw new FieldError(msg);
};

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') bad('格式不正確');
  const s = (v as string).trim();
  if (s.length > max) bad(`最多 ${max} 字`);
  if (CONTROL.test(s)) bad('含有不允許的字元');
  return s;
}

function num(v: unknown, decimals: number, min: number | null, max: number | null): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) bad('需為數字');
  if (Math.abs(n) > 1e12) bad('數字過大');
  if (Number(n.toFixed(decimals)) !== n) bad(decimals === 0 ? '需為整數' : `最多 ${decimals} 位小數`);
  if (min !== null && n < min) bad(`不可小於 ${min}`);
  if (max !== null && n > max) bad(`不可大於 ${max}`);
  return n;
}

function cents(v: unknown, max: number | null): Cents {
  let c: Cents;
  try {
    c = toCents(typeof v === 'string' ? v.replace(/,/g, '') : v);
  } catch (err) {
    return bad(err instanceof MoneyError ? err.message : '金額格式不正確');
  }
  if (c < 0) bad('金額不可為負數');
  if (max !== null && c > Math.round(max * 100)) bad(`不可超過 ${max.toLocaleString('en-US')}`);
  return c;
}

function option(v: unknown, opts: { value: string }[]): string {
  if (typeof v !== 'string' || !opts.some((o) => o.value === v)) bad('選項不正確');
  return v as string;
}

function uuid(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) bad('選擇的項目無效');
  return (v as string).toLowerCase();
}

/** cents × factor (at most `decimals` places), rounded half-up away from zero to whole cents — exact integer arithmetic. */
function scaleCents(c: Cents, factor: number, decimals: number): Cents {
  const [whole, frac = ''] = Math.abs(factor).toFixed(decimals).split('.');
  const scale = BigInt(10 ** decimals);
  const product = BigInt(Math.abs(c)) * (BigInt(whole) * scale + BigInt(frac || '0'));
  const rounded = (product + scale / BigInt(2)) / scale;
  if (rounded > BigInt(MAX_CENTS)) bad('計算結果超出上限');
  const sign = Math.sign(c) * Math.sign(factor) < 0 ? -1 : 1;
  return (sign * Number(rounded)) as Cents;
}

/**
 * Applies one formula to a row of normalized values; money × number is
 * rounded half-up to whole cents. Exported for the form's live preview,
 * which passes raw input and treats a throw as "not computable yet".
 */
export function computeFormula(col: TableColumn, row: Record<string, unknown>, byId: Map<string, TableColumn>): unknown {
  const [a, b] = col.formula!.of.map((id) => ({ col: byId.get(id)!, value: row[id] }));
  if (a.value === null || a.value === undefined || b.value === null || b.value === undefined) return null;
  if (col.type === 'money') {
    const money = a.col.type === 'money' ? a : b;
    const factor = a.col.type === 'money' ? b : a;
    const n = Number(factor.value);
    if (!Number.isFinite(n)) bad('需為數字');
    return centsToDecimal(scaleCents(toCents(money.value), n, factor.col.decimals ?? 0));
  }
  const decimals = col.decimals ?? 0;
  const product = Number(a.value) * Number(b.value);
  if (!Number.isFinite(product) || Math.abs(product) > 1e12) bad('計算結果超出上限');
  return Number(product.toFixed(decimals));
}

function cell(col: TableColumn, v: unknown): unknown {
  if (blank(v)) {
    if (col.required) bad('必填');
    return null;
  }
  switch (col.type) {
    case 'text':
      return str(v, col.maxLength ?? 500);
    case 'number':
      return num(v, col.decimals ?? 0, col.min ?? null, null);
    case 'money': {
      const c = cents(v, null);
      if (col.min !== undefined && col.min !== null && c < Math.round(col.min * 100)) bad(`不可小於 ${col.min.toLocaleString('en-US')}`);
      return centsToDecimal(c);
    }
    case 'date':
      if (typeof v !== 'string' || !isValidDate(v)) bad('日期格式不正確');
      return v;
    case 'select':
      return option(v, col.options ?? []);
    case 'employee':
    case 'asset':
    case 'budget_code':
      return uuid(v);
  }
}

/** Index of the source row a carried-over row came from, or null. */
export function sourceRowOf(row: Record<string, unknown>): number | null {
  const v = row[SOURCE_ROW_KEY];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000 ? v : null;
}

/** pickFrom: the row's option must be one of those ticked in the checkboxes field. */
function checkPicked(col: TableColumn, v: unknown, values: Record<string, unknown>, schemaField: (id: string) => FieldDef | undefined) {
  const ticked = values[col.pickFrom!.field];
  if (Array.isArray(ticked) && ticked.includes(v)) return;
  bad(`需為已勾選的「${schemaField(col.pickFrom!.field)?.label ?? ''}」之一`);
}

/** Exchange-rate cell: 1 for NT$, otherwise required, > 0 and plausible for the row's currency. */
function rateCell(col: TableColumn, v: unknown, currency: unknown): number | null {
  if (currency === BASE_CURRENCY) return 1;
  const decimals = col.decimals ?? 0;
  if (blank(currency)) return blank(v) ? null : num(v, decimals, null, null);
  if (blank(v)) bad('外幣請填匯率');
  const n = num(v, decimals, col.min ?? null, null);
  const micros = n > 0 ? parseRateMicros(n.toFixed(decimals)) : null;
  if (micros === null) bad('匯率必須是大於 0 的數字（最多 6 位小數）');
  const outOfBounds = rateOutOfBounds(String(currency), micros!);
  if (outOfBounds) bad(outOfBounds);
  return n;
}

function checkColumnRules(col: TableColumn, v: unknown, row: Record<string, unknown>, values: Record<string, unknown>) {
  for (const r of col.rules ?? []) {
    if (r.when && !r.when.in.includes(String(row[r.when.column] ?? ''))) continue;
    if (r.check.kind === 'max') {
      if (Number(v) > r.check.value) bad(r.message);
      continue;
    }
    const other = values[r.check.field];
    if (other === null || other === undefined || other === '') continue;
    const ok = col.type === 'date' ? compare(String(v), r.check.op, String(other)) : compare(Number(v), r.check.op, Number(other));
    if (!ok) bad(r.message);
  }
}

/** A row nobody filled in: every input is blank or still its default (rate columns follow the currency). */
export function isUntouchedRow(columns: TableColumn[], row: Record<string, unknown>): boolean {
  if (sourceRowOf(row) !== null) return false;
  return columns.every((c) => c.formula || c.rateFor !== undefined || blank(row[c.id]) || (c.default !== undefined && row[c.id] === c.default));
}

type FieldLookup = (id: string) => FieldDef | undefined;

function table(
  field: Extract<FieldDef, { type: 'table' }>,
  v: unknown,
  errors: Record<string, string>,
  values: Record<string, unknown>,
  fieldOf: FieldLookup,
  carried: boolean
): TableValue {
  const rawRows = v && typeof v === 'object' && Array.isArray((v as TableValue).rows) ? (v as TableValue).rows : Array.isArray(v) ? v : null;
  if (v !== undefined && v !== null && rawRows === null) bad('格式不正確');
  const byId = new Map(field.columns.map((c) => [c.id, c]));
  const inputColumns = field.columns.filter((c) => !c.formula);
  const rows: Record<string, unknown>[] = [];
  for (const raw of rawRows ?? []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('格式不正確');
    const r = raw as Record<string, unknown>;
    if (isUntouchedRow(field.columns, r)) continue;
    if (rows.length >= field.maxRows) bad(`最多 ${field.maxRows} 列`);
    const row: Record<string, unknown> = {};
    const lineNo = rows.length + 1;
    const failed = new Set<string>();
    const attempt = (col: TableColumn, run: () => void) => {
      try {
        run();
      } catch (err) {
        if (!(err instanceof FieldError)) throw err;
        errors[`${field.id}.${lineNo - 1}.${col.id}`] = `第 ${lineNo} 列「${col.label}」：${err.message}`;
        row[col.id] = null;
        failed.add(col.id);
      }
    };
    for (const col of inputColumns) {
      if (col.financeFill) {
        row[col.id] = null;
        continue;
      }
      attempt(col, () => {
        row[col.id] = col.rateFor !== undefined ? rateCell(col, r[col.id], row[col.rateFor]) : cell(col, r[col.id]);
        if (row[col.id] === null) return;
        if (col.pickFrom) checkPicked(col, row[col.id], values, fieldOf);
        if (col.unique) {
          const twin = rows.findIndex((prev) => prev[col.id] === row[col.id]);
          if (twin !== -1) bad(`與第 ${twin + 1} 列重複`);
        }
      });
    }
    for (const col of field.columns.filter((c) => c.formula)) {
      attempt(col, () => {
        const result = computeFormula(col, row, byId);
        row[col.id] = result;
        if (result !== null && col.min !== undefined && col.min !== null && Number(result) < col.min) {
          bad(`不可小於 ${col.min.toLocaleString('en-US')}`);
        }
      });
    }
    for (const col of field.columns) {
      if (!col.rules || failed.has(col.id) || row[col.id] === null) continue;
      attempt(col, () => checkColumnRules(col, row[col.id], row, values));
    }
    const src = carried ? sourceRowOf(r) : null;
    if (src !== null) row[SOURCE_ROW_KEY] = src;
    rows.push(row);
  }
  const minRows = Math.max(field.minRows, field.required ? 1 : 0);
  if (rows.length < minRows) bad(`至少需要 ${minRows} 列`);
  for (const col of field.columns) {
    if (!col.pickFrom?.coverAll) continue;
    const src = fieldOf(col.pickFrom.field);
    const ticked = values[col.pickFrom.field];
    for (const code of Array.isArray(ticked) ? ticked : []) {
      if (rows.some((r) => r[col.id] === code)) continue;
      const name = src?.type === 'checkboxes' ? (src.options.find((o) => o.value === code)?.label ?? code) : code;
      bad(`已勾選「${name}」，但沒有任何一列的「${col.label}」是「${name}」`);
    }
  }

  let total: string | number | null = null;
  if (field.totalColumn) {
    const col = byId.get(field.totalColumn)!;
    const values = rows.map((r) => r[col.id]).filter((x) => x !== null && x !== undefined);
    if (col.type === 'money') {
      try {
        total = centsToDecimal(addCents(...values.map((x) => toCents(x)), 0 as Cents));
      } catch {
        bad('合計超出上限');
      }
    } else {
      total = Number(values.reduce((s: number, x) => s + Number(x), 0).toFixed(col.decimals ?? 0));
    }
    if (field.maxTotal && total !== null && Number(total) > field.maxTotal.value) bad(field.maxTotal.message);
  }
  return { rows, total };
}

function value(
  field: FieldDef,
  v: unknown,
  today: string,
  errors: Record<string, string>,
  earlier: Record<string, unknown>,
  fieldOf: FieldLookup,
  carried: boolean
): unknown {
  if (field.type === 'table') return table(field, v, errors, earlier, fieldOf, carried);
  if (field.type === 'boolean') {
    if (v === undefined || v === null) return false;
    if (typeof v !== 'boolean') bad('格式不正確');
    return v;
  }
  if (field.type === 'checkboxes') {
    const list = v === undefined || v === null ? [] : Array.isArray(v) ? v : bad('格式不正確');
    const picked = [...new Set((list as unknown[]).map((x) => option(x, field.options)))];
    const min = Math.max(field.minSelected, field.required ? 1 : 0);
    if (picked.length < min) bad(min === 1 ? '請至少選擇一項' : `請至少選擇 ${min} 項`);
    if (field.maxSelected !== null && picked.length > field.maxSelected) bad(`最多選擇 ${field.maxSelected} 項`);
    return field.options.map((o) => o.value).filter((x) => picked.includes(x));
  }
  if (blank(v)) {
    if (field.required) bad('必填');
    return field.type === 'text' || field.type === 'textarea' ? '' : null;
  }
  switch (field.type) {
    case 'text': {
      const s = str(v, field.maxLength);
      if (field.format === 'email' && !EMAIL.test(s)) bad('Email 格式不正確');
      if (field.format === 'phone' && !PHONE.test(s)) bad('電話格式不正確');
      if (field.format === 'tax_id' && !TAX_ID.test(s)) bad('統一編號需為 8 碼數字');
      if (field.format === 'bank_account' && !BANK_ACCOUNT.test(s)) bad('銀行帳號需為 4–30 碼數字（可含空格或連字號）');
      if (field.format === 'year_month' && !YEAR_MONTH.test(s)) bad('格式需為 YYYY-MM');
      return s;
    }
    case 'textarea':
      return str(v, field.maxLength);
    case 'number':
      return num(v, field.decimals, field.min, field.max);
    case 'money':
      return centsToDecimal(cents(v, field.max));
    case 'date':
      if (typeof v !== 'string' || !isValidDate(v)) bad('日期格式不正確');
      if (field.notBeforeToday && (v as string) < today) bad('不可早於今天');
      return v;
    case 'select':
    case 'radio':
      return option(v, field.options);
    case 'employee':
    case 'department':
    case 'budget_code':
    case 'project':
    case 'supplier':
    case 'asset':
    case 'source':
      return uuid(v);
    default:
      return null;
  }
}

export function validateSubmission(schema: FormSchema, raw: unknown, today: string): ValidationResult {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const data: SubmissionData = {};
  const flowFields: Record<string, unknown> = {};
  const refs: NormalizedSubmission['refs'] = {
    employees: [],
    departments: [],
    budgetCodes: [],
    projects: [],
    suppliers: [],
    assets: [],
    budgetScopes: [],
    sameOwner: [],
  };
  const promoted: NormalizedSubmission['promoted'] = { totalAmount: null, budgetCodeId: null, projectId: null };
  let attachmentsRequired = false;
  const declaredFields = new Map(allFields(schema).map((f) => [f.id, f]));
  const fieldOf = (id: string) => declaredFields.get(id);
  const carriedTables = sourceTargets(schema);

  for (const declared of allFields(schema)) {
    if (!isFieldVisible(declared, flowFields)) continue;
    const field = { ...declared, required: isFieldRequired(declared, flowFields) } as FieldDef;
    if (field.type === 'attachments') {
      attachmentsRequired = field.required;
      continue;
    }
    if (isDisplayOnly(field)) continue;
    try {
      const v = value(field, input[field.id], today, errors, flowFields, fieldOf, carriedTables.has(field.id));
      if (v !== null && v !== '' && field.rules) checkRules(field, v, flowFields, today);
      data[field.id] = v;
      flowFields[field.id] = field.type === 'table' ? (v as TableValue).total : v;
      if (typeof v === 'string' && UUID.test(v)) {
        if (field.type === 'employee') refs.employees.push(v);
        if (field.type === 'department') refs.departments.push(v);
        if (field.type === 'budget_code') refs.budgetCodes.push(v);
        if (field.type === 'budget_code' && field.budgetScope) refs.budgetScopes.push({ id: v, scope: field.budgetScope });
        if (field.type === 'project') refs.projects.push(v);
        if (field.type === 'supplier') refs.suppliers.push(v);
        if (field.type === 'asset') refs.assets.push(v);
      }
      if (field.type === 'table') {
        const rows = (v as TableValue).rows;
        for (const row of rows) {
          for (const col of field.columns) {
            const cellValue = row[col.id];
            if (typeof cellValue !== 'string') continue;
            if (col.type === 'employee') refs.employees.push(cellValue);
            if (col.type === 'asset') refs.assets.push(cellValue);
            if (col.type === 'budget_code') refs.budgetCodes.push(cellValue);
          }
        }
        for (const col of field.columns.filter((c) => c.type === 'budget_code')) {
          const ids = rows.map((r) => r[col.id]).filter((x): x is string => typeof x === 'string');
          flowFields[`${field.id}.${col.id}`] = ids;
          if (col.sameOwner && ids.length > 0) refs.sameOwner.push({ label: field.label, ids });
        }
      }
      if (field.semantic === 'amount') {
        const amount = field.type === 'table' ? (v as TableValue).total : v;
        promoted.totalAmount = amount === null || amount === undefined ? null : String(amount);
      }
      if (field.semantic === 'budget_code') promoted.budgetCodeId = (v as string | null) ?? null;
      if (field.semantic === 'project') promoted.projectId = (v as string | null) ?? null;
    } catch (err) {
      if (!(err instanceof FieldError)) throw err;
      errors[field.id] = `「${field.label}」：${err.message}`;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { data, flowFields, promoted, refs, attachmentsRequired } };
}

/** One line for an Abort / toast: the first few field errors. */
export function summarizeErrors(errors: Record<string, string>): string {
  const list = Object.values(errors);
  return list.length > 3 ? `${list.slice(0, 3).join('；')}（另有 ${list.length - 3} 項）` : list.join('；');
}
