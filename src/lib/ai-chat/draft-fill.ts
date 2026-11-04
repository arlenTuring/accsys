import { randomUUID } from 'node:crypto';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { allFields, isDisplayOnly, type FieldDef, type FormSchema, type TableColumn } from '@/lib/custom-forms/schema';
import { isUntouchedRow, validateSubmission, type TableValue } from '@/lib/custom-forms/validate';

/**
 * Deterministic side of conversational form filling. The model proposes
 * field values in plain structured arguments; this module decides what is
 * actually stored: it maps labels to option values, resolves reference names
 * to ids only when exactly one legal choice matches, normalizes dates to the
 * form's wall-time format (Asia/Taipei), applies table row operations by
 * stable row id, and validates the result with the same validator the formal
 * submit uses (required checks relaxed, so a partial draft can be saved).
 * Anything it cannot accept is reported back, never silently stored.
 */

export const ROW_ID_KEY = '_rid';
export const COMPANY_TIME_ZONE = 'Asia/Taipei';

export type FieldSet = { field: string; value?: unknown; values?: unknown[] };
export type RowCell = { column: string; value: unknown };
export type RowOp = { op: 'add' | 'update' | 'delete'; table: string; row_id?: string; cells?: RowCell[] };
export type FillRequest = { set?: FieldSet[]; clear?: string[]; rows?: RowOp[] };

export type FillIssue = {
  field: string;
  label: string;
  code: 'unknown_field' | 'read_only' | 'invalid' | 'ambiguous' | 'not_found' | 'row_not_found';
  message: string;
  /** Legal choices for ambiguous / not_found references and bad options (at most 8). */
  candidates?: { id: string; label: string }[];
};

export type FillPlan = {
  /** Data to store (only valid changes applied). */
  data: Record<string, unknown>;
  /** Field ids whose stored value changed. */
  changed: string[];
  rejected: FillIssue[];
};

type Choice = { id: string; label: string };

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

function referenceChoices(type: string, options: PickerOptions): Choice[] | null {
  switch (type) {
    case 'employee':
      return options.employees;
    case 'department':
      return options.departments;
    case 'project':
      return options.projects;
    case 'supplier':
      return options.suppliers;
    case 'budget_code':
      return options.budgetCodes;
    case 'asset':
      return options.assets;
    case 'source':
      return options.sources;
    default:
      return null;
  }
}

/** Name parts a person may say for a choice: full label, label without the（dept）suffix, code, name. */
function aliases(c: Choice): string[] {
  const label = c.label.trim();
  const stripped = label.replace(/（[^）]*）$/, '').trim();
  const out = [label, stripped];
  const m = stripped.match(/^(\S+)\s+(.+)$/);
  if (m) {
    out.push(m[1], m[2]);
    // Also strip trailing parenthetical model spec like "MacBook Pro 16\" (M4 Max)" -> "MacBook Pro 16\""
    const withoutParen = m[2].replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (withoutParen) out.push(withoutParen);
  }
  // 「部門：主管（名稱｜代碼）」: each part can be what the person says.
  out.push(...label.split(/[：｜（）]/));
  return out.map(norm).filter(Boolean);
}

type Resolved = { ok: true; value: string } | { ok: false; code: 'ambiguous' | 'not_found'; candidates: Choice[] };

/**
 * Resolves when a single choice matches unambiguously:
 * 1) Exact id match
 * 2) Exact alias match with no other wider match
 * 3) Single partial match when query is specific enough (>= 3 normalized chars)
 */
export function resolveReference(raw: string, choices: Choice[]): Resolved {
  const q = raw.trim().replace(/^[@＠]+/, '').trim();
  const byId = choices.find((c) => c.id.toLowerCase() === q.toLowerCase());
  if (byId) return { ok: true, value: byId.id };
  const nq = norm(q);
  const exact = choices.filter((c) => aliases(c).includes(nq));
  const partial = choices.filter((c) => aliases(c).some((a) => a.includes(nq) || (nq.length >= 2 && nq.includes(a))));
  const wider = choices.filter((c) => !exact.includes(c) && aliases(c).some((a) => a.includes(nq)));
  if (exact.length === 1 && wider.length === 0) return { ok: true, value: exact[0].id };
  if (partial.length === 1 && nq.length >= 3) return { ok: true, value: partial[0].id };
  if (partial.length > 0) return { ok: false, code: 'ambiguous', candidates: [...exact, ...partial.filter((c) => !exact.includes(c))].slice(0, 8) };
  // No containment either way: offer choices sharing a two-character run so the user can still pick.
  const grams = new Set(Array.from({ length: Math.max(nq.length - 1, 0) }, (_, i) => nq.slice(i, i + 2)));
  const near = choices.filter((c) => aliases(c).some((a) => [...grams].some((g) => a.includes(g))));
  return { ok: false, code: 'not_found', candidates: near.slice(0, 8) };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Wall time in Asia/Taipei for an absolute instant. */
function taipeiWallTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: COMPANY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Form datetime fields store Asia/Taipei wall time `YYYY-MM-DDTHH:mm`.
 * Accepts `YYYY-MM-DD[T ]HH:mm[:ss][offset]`; an explicit offset is converted
 * to Taipei time, no offset means Taipei time already. Seconds must be zero.
 */
export function normalizeDateTime(raw: string): string | null {
  const m = raw.trim().replace(/\//g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tz] = m;
  if (s && Number(s) !== 0) return null;
  const wall = `${y}-${pad(Number(mo))}-${pad(Number(d))}T${pad(Number(h))}:${mi}`;
  if (!tz) return wall;
  const iso = `${wall}:00${tz.toUpperCase() === 'Z' ? 'Z' : tz.length === 5 ? `${tz.slice(0, 3)}:${tz.slice(3)}` : tz}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : taipeiWallTime(date);
}

export function normalizeDate(raw: string): string | null {
  const m = raw.trim().replace(/\//g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` : null;
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

class CoerceError extends Error {
  constructor(
    readonly code: FillIssue['code'],
    message: string,
    readonly candidates?: Choice[]
  ) {
    super(message);
  }
}

function pickOption(raw: unknown, options: { value: string; label: string }[]): string {
  const s = asText(raw);
  if (s === null) throw new CoerceError('invalid', '需為選項之一');
  const hit = options.find((o) => o.value === s) ?? options.find((o) => norm(o.label) === norm(s) || norm(o.value) === norm(s));
  if (!hit) throw new CoerceError('invalid', `不是合法選項（可選：${options.map((o) => o.label).join('、')}）`, options.map((o) => ({ id: o.value, label: o.label })));
  return hit.value;
}

function coerceMoney(raw: unknown): string {
  const s = asText(raw)?.replace(/[,\s]|NT\$|新臺幣|新台幣|元/gi, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) throw new CoerceError('invalid', '金額需為數字');
  return s;
}

/** Turns one model-supplied value into what the form stores (before the shared validator runs). */
function coerce(type: string, raw: unknown, opts: { options?: { value: string; label: string }[]; picker: PickerOptions }): unknown {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
  switch (type) {
    case 'datetime': {
      const v = asText(raw) && normalizeDateTime(asText(raw)!);
      if (!v) throw new CoerceError('invalid', '日期時間格式需為 YYYY-MM-DDTHH:mm（台北時間）');
      return v;
    }
    case 'date': {
      const v = asText(raw) && normalizeDate(asText(raw)!);
      if (!v) throw new CoerceError('invalid', '日期格式需為 YYYY-MM-DD');
      return v;
    }
    case 'money':
      return coerceMoney(raw);
    case 'number': {
      const s = asText(raw)?.replace(/,/g, '').trim();
      if (!s || !/^-?\d+(\.\d+)?$/.test(s)) throw new CoerceError('invalid', '需為數字');
      return Number(s);
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = norm(String(raw));
      if (['true', '是', 'yes', '1'].includes(s)) return true;
      if (['false', '否', 'no', '0'].includes(s)) return false;
      throw new CoerceError('invalid', '需為是或否');
    }
    case 'select':
    case 'radio':
      return pickOption(raw, opts.options ?? []);
    case 'text':
    case 'textarea': {
      const s = asText(raw);
      if (s === null) throw new CoerceError('invalid', '需為文字');
      return s.trim();
    }
    default: {
      const choices = referenceChoices(type, opts.picker);
      if (!choices) throw new CoerceError('invalid', '此欄位不能由助手填寫');
      const s = asText(raw);
      if (!s) throw new CoerceError('invalid', '需為名稱或代碼');
      const r = resolveReference(s, choices);
      if (r.ok) return r.value;
      throw new CoerceError(
        r.code,
        r.code === 'ambiguous'
          ? `「${s}」有多個可能的選擇，請使用者指定`
          : /^[0-9a-f-]{36}$/i.test(s.trim())
            ? '所選項目不存在，或您無權選用'
            : `找不到「${s}」，或您無權選用`,
        r.candidates
      );
    }
  }
}

function issue(field: string, label: string, err: unknown): FillIssue {
  if (err instanceof CoerceError) {
    return { field, label, code: err.code, message: err.message, ...(err.candidates?.length ? { candidates: err.candidates.slice(0, 8) } : {}) };
  }
  return { field, label, code: 'invalid', message: err instanceof Error ? err.message : '格式不正確' };
}

function tableValue(v: unknown): TableValue {
  if (v && typeof v === 'object' && Array.isArray((v as TableValue).rows)) {
    return { rows: (v as TableValue).rows.map((r) => ({ ...r })), total: (v as TableValue).total ?? null };
  }
  return { rows: [], total: null };
}

/** Row by stable id, or `#n` (1-based position) for rows saved before ids existed. */
function findRow(rows: Record<string, unknown>[], rowId: string | undefined): number {
  if (!rowId) return -1;
  const pos = rowId.match(/^#(\d+)$/);
  if (pos) return Number(pos[1]) - 1 < rows.length ? Number(pos[1]) - 1 : -1;
  return rows.findIndex((r) => r[ROW_ID_KEY] === rowId);
}

/** Every stored row carries a stable id the model and UI can address. */
export function withRowIds(table: TableValue): TableValue {
  return { ...table, rows: table.rows.map((r) => (typeof r[ROW_ID_KEY] === 'string' ? r : { ...r, [ROW_ID_KEY]: randomUUID().slice(0, 8) })) };
}

function newRow(columns: TableColumn[]): Record<string, unknown> {
  const row: Record<string, unknown> = { [ROW_ID_KEY]: randomUUID().slice(0, 8) };
  for (const c of columns) if (c.default !== undefined) row[c.id] = c.default;
  return row;
}

/** Required-ness switched off so a partial draft validates; values, formats and rules still apply. */
export function relaxSchema(schema: FormSchema): FormSchema {
  return {
    ...schema,
    sections: schema.sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        const out = { ...f, required: false, requiredWhen: undefined } as FieldDef;
        if (out.type === 'table') {
          return {
            ...out,
            minRows: 0,
            columns: out.columns.map((c) => ({
              ...c,
              required: false,
              pickFrom: c.pickFrom ? { ...c.pickFrom, coverAll: false } : undefined,
            })),
          };
        }
        if (out.type === 'checkboxes') return { ...out, minSelected: 0 };
        return out;
      }),
    })),
  };
}

/** Field id of a validator error key (`field` or `table.row.column`). */
const errorField = (key: string) => key.split('.')[0];

/**
 * Applies a fill request to `current` and returns what may be stored.
 * Invalid changes are dropped (field restored to its previous value) and
 * reported; valid ones are kept, so known information is never lost because
 * of one bad value.
 */
export function planFill(schema: FormSchema, picker: PickerOptions, current: Record<string, unknown>, req: FillRequest, today: string): FillPlan {
  const fields = new Map(allFields(schema).map((f) => [f.id, f]));
  const data: Record<string, unknown> = { ...current };
  const touched = new Set<string>();
  const rejected: FillIssue[] = [];
  const labelOf = (id: string) => fields.get(id)?.label ?? id;

  const writable = (id: string): FieldDef | null => {
    const f = fields.get(id);
    if (!f) {
      rejected.push({ field: id, label: id, code: 'unknown_field', message: '此表單沒有這個欄位' });
      return null;
    }
    if (isDisplayOnly(f)) {
      rejected.push({ field: id, label: f.label, code: 'read_only', message: '此欄位不能由助手填寫' });
      return null;
    }
    return f;
  };

  for (const s of req.set ?? []) {
    const f = writable(String(s.field));
    if (!f) continue;
    if (f.type === 'table') {
      rejected.push({ field: f.id, label: f.label, code: 'invalid', message: '明細請用列操作（rows）新增、修改或刪除' });
      continue;
    }
    try {
      if (f.type === 'checkboxes') {
        const list = s.values ?? (s.value === undefined || s.value === null ? [] : String(s.value).split(/[,、，]/));
        data[f.id] = list.map((v) => pickOption(v, f.options));
      } else {
        data[f.id] = coerce(f.type, s.value, { options: 'options' in f ? f.options : undefined, picker });
      }
      touched.add(f.id);
    } catch (err) {
      rejected.push(issue(f.id, f.label, err));
    }
  }

  for (const id of req.clear ?? []) {
    const f = writable(String(id));
    if (!f) continue;
    data[f.id] = f.type === 'table' ? { rows: [], total: null } : f.type === 'checkboxes' ? [] : null;
    touched.add(f.id);
  }

  for (const op of req.rows ?? []) {
    const f = writable(String(op.table));
    if (!f) continue;
    if (f.type !== 'table') {
      rejected.push({ field: f.id, label: f.label, code: 'invalid', message: '這不是明細表格欄位' });
      continue;
    }
    const table = withRowIds(tableValue(data[f.id]));
    const cols = new Map(f.columns.map((c) => [c.id, c]));
    const applyCells = (row: Record<string, unknown>) => {
      for (const cell of op.cells ?? []) {
        const col = cols.get(String(cell.column));
        if (!col) throw new CoerceError('unknown_field', `明細沒有「${cell.column}」欄`);
        if (col.formula) throw new CoerceError('read_only', `「${col.label}」由系統計算`);
        try {
          row[col.id] = coerce(col.type, cell.value, { options: col.options, picker });
          if (col.pickFrom && typeof row[col.id] === 'string' && row[col.id]) {
            const pickFieldId = col.pickFrom.field;
            const prevArr = Array.isArray(data[pickFieldId]) ? (data[pickFieldId] as string[]) : [];
            if (!prevArr.includes(row[col.id] as string)) {
              data[pickFieldId] = [...prevArr, row[col.id] as string];
              touched.add(pickFieldId);
            }
          }
        } catch (err) {
          if (err instanceof CoerceError) throw new CoerceError(err.code, `「${col.label}」${err.message}`, err.candidates);
          throw err;
        }
      }
    };
    try {
      if (op.op === 'add') {
        const row = newRow(f.columns);
        applyCells(row);
        table.rows.push(row);
      } else {
        const idx = findRow(tableValue(data[f.id]).rows, op.row_id);
        if (idx === -1) throw new CoerceError('row_not_found', `找不到明細列 ${op.row_id ?? '(未指定)'}`);
        if (op.op === 'delete') table.rows.splice(idx, 1);
        else applyCells(table.rows[idx]);
      }
      data[f.id] = table;
      touched.add(f.id);
    } catch (err) {
      rejected.push(issue(f.id, f.label, err));
    }
  }

  // Shared validator, required checks off. A touched field that still fails is
  // restored to its previous value and reported; repeat until stable (rules may
  // depend on other fields).
  const relaxed = relaxSchema(schema);
  for (let pass = 0; pass < 5; pass++) {
    const check = validateSubmission(relaxed, data, today);
    if (check.ok) {
      for (const id of touched) {
        const f = fields.get(id);
        if (f?.type === 'table') data[id] = attachRowIds(f, data[id], check.value.data[id] as TableValue);
        else data[id] = check.value.data[id];
      }
      break;
    }
    const bad = [...new Set(Object.keys(check.errors).map(errorField))].filter((id) => touched.has(id));
    if (bad.length === 0) break; // errors only in fields this request did not touch: keep as is, report via missing/invalid
    for (const id of bad) {
      const msgs = Object.entries(check.errors)
        .filter(([k]) => errorField(k) === id)
        .map(([, m]) => m);
      rejected.push({ field: id, label: labelOf(id), code: 'invalid', message: msgs.join('；') });
      data[id] = current[id];
      touched.delete(id);
    }
  }

  const changed = [...touched].filter((id) => JSON.stringify(data[id]) !== JSON.stringify(current[id]));
  return { data, changed, rejected };
}

/** The validator drops row ids and untouched rows; put the ids back on the rows it kept. */
function attachRowIds(field: Extract<FieldDef, { type: 'table' }>, raw: unknown, normalized: TableValue): TableValue {
  const kept = tableValue(raw).rows.filter((r) => !isUntouchedRow(field.columns, r));
  return {
    rows: normalized.rows.map((r, i) => ({ ...r, [ROW_ID_KEY]: kept[i]?.[ROW_ID_KEY] ?? randomUUID().slice(0, 8) })),
    total: normalized.total,
  };
}

export type DraftStatusReport = {
  /** Required (and conditionally required) fields still empty. */
  missing: { field: string; label: string }[];
  /** Stored values the formal validator rejects (e.g. older drafts). */
  invalid: { field: string; label: string; message: string }[];
  readyToSubmit: boolean;
};

/** Same validator as the formal submit: what is still missing or wrong. */
export function draftStatus(schema: FormSchema, data: Record<string, unknown>, today: string): DraftStatusReport {
  const fields = new Map(allFields(schema).map((f) => [f.id, f]));
  const full = validateSubmission(schema, data, today);
  if (full.ok) return { missing: [], invalid: [], readyToSubmit: true };
  const relaxed = validateSubmission(relaxSchema(schema), data, today);
  const invalidKeys = new Set(relaxed.ok ? [] : Object.keys(relaxed.errors));
  const missing: DraftStatusReport['missing'] = [];
  const invalid: DraftStatusReport['invalid'] = [];
  const seen = new Set<string>();
  for (const [key, message] of Object.entries(full.errors)) {
    const id = errorField(key);
    const label = fields.get(id)?.label ?? id;
    if (invalidKeys.has(key)) invalid.push({ field: key, label, message });
    else if (!seen.has(id)) {
      seen.add(id);
      missing.push({ field: id, label });
    }
  }
  return { missing, invalid, readyToSubmit: false };
}

/** Human-readable stored value for receipts and the model's work state. */
export function displayValue(field: FieldDef | undefined, value: unknown, picker: PickerOptions): string {
  if (value === null || value === undefined || value === '') return '（空白）';
  if (!field) return String(value);
  if (field.type === 'datetime' && typeof value === 'string') return value.replace('T', ' ');
  if ((field.type === 'select' || field.type === 'radio') && typeof value === 'string') return field.options.find((o) => o.value === value)?.label ?? value;
  if (field.type === 'money') return `NT$${Number(value).toLocaleString('en-US')}`;
  const choices = referenceChoices(field.type, picker);
  if (choices && typeof value === 'string') return choices.find((c) => c.id === value)?.label ?? value;
  if (field.type === 'table') {
    const t = tableValue(value);
    return `${t.rows.length} 列${t.total !== null && t.total !== undefined ? `，合計 ${t.total}` : ''}`;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
