'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { inputCls, Req } from '@/app/components/form-fields';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { reviseCustomForm, submitCustomForm, type SubmitResult } from '@/lib/custom-forms/actions';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import {
  allFields,
  isDisplayOnly,
  sourceFieldOf,
  sourceTargets,
  type ColumnType,
  type FieldDef,
  type FormSchema,
  type TableColumn,
} from '@/lib/custom-forms/schema';
import {
  computeFormula,
  isFieldRequired,
  isFieldVisible,
  minDate,
  validateSubmission,
  type NormalizedSubmission,
  type TableValue,
} from '@/lib/custom-forms/validate';
import { BASE_CURRENCY } from '@/lib/exchange-rates';
import { NoticeText } from './notice-text';
import { amountText } from './submission-fields';

export type CustomFormMode =
  | { kind: 'create' }
  | { kind: 'update' | 'resubmit'; id: string; version: number; existingAttachmentCount: number }
  /** Designer preview: runs the same validation, hands the result back and never submits. */
  | { kind: 'preview'; onValid: (value: NormalizedSubmission) => void };

type Values = Record<string, unknown>;

const SPAN: Record<1 | 2 | 3 | 4, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4' };
const white = `${inputCls} !bg-white`;

type TableField = Extract<FieldDef, { type: 'table' }>;

/** A fresh row: select columns start on their default option. */
function newRow(field: TableField): Values {
  return Object.fromEntries(field.columns.filter((c) => c.default !== undefined).map((c) => [c.id, c.default]));
}

/** Exchange-rate columns read 1 on NT$ rows (the server stores 1 whatever was typed). */
function effectiveRow(field: TableField, row: Values): Values {
  const out = { ...row };
  for (const c of field.columns) if (c.rateFor !== undefined && row[c.rateFor] === BASE_CURRENCY) out[c.id] = '1';
  return out;
}

function initialValues(schema: FormSchema, initial?: Values): Values {
  const out: Values = {};
  for (const f of allFields(schema)) {
    if (isDisplayOnly(f)) continue;
    const v = initial?.[f.id];
    if (f.type === 'table') {
      const rows = (v as TableValue | undefined)?.rows ?? [];
      out[f.id] = { rows: rows.length > 0 ? rows.map((r) => ({ ...r })) : [newRow(f)], total: null };
    } else if (f.type === 'boolean') out[f.id] = v === true;
    else if (f.type === 'checkboxes') out[f.id] = Array.isArray(v) ? v : [];
    else if ((f.type === 'select' || f.type === 'radio') && initial === undefined) out[f.id] = f.default ?? '';
    else if ((f.type === 'text' || f.type === 'number') && initial === undefined) out[f.id] = f.default === undefined ? '' : String(f.default);
    else out[f.id] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

/** Picking a source (關聯單據) refills the tables it carries rows into; clearing it empties them. */
function withSource(schema: FormSchema, values: Values, sourceId: unknown, options: PickerOptions): Values {
  const next: Values = { ...values };
  const picked = options.sources.find((o) => o.id === sourceId);
  for (const f of allFields(schema)) {
    if (f.type !== 'table' || !sourceTargets(schema).has(f.id)) continue;
    next[f.id] =
      picked?.table === f.id
        ? { rows: picked.rows.map((r) => ({ ...newRow(f), ...r })), total: null }
        : { rows: [newRow(f)], total: null };
  }
  return next;
}

const cellText = (row: Values | undefined, col: string) => String(row?.[col] ?? '');

/**
 * Keeps dependent values in step with the field just changed: cells limited
 * to ticked options drop unticked ones (a single ticked option fills blank
 * cells); on a register-linked table, picking an asset pre-fills its location
 * and the custodians, and rows follow a changed 新保管人.
 */
function withFollowUps(schema: FormSchema, prev: Values, id: string, v: unknown, options: PickerOptions): Values {
  if (sourceFieldOf(schema)?.id === id) return withSource(schema, { ...prev, [id]: v }, v, options);
  const next: Values = { ...prev, [id]: v };
  const mapRows = (tableId: string, fn: (row: Values, i: number) => Values) => {
    const t = next[tableId] as TableValue | undefined;
    if (t) next[tableId] = { ...t, rows: t.rows.map(fn) };
  };
  for (const f of allFields(schema)) {
    if (f.type !== 'table') continue;
    const cols = f.columns.filter((c) => c.pickFrom?.field === id);
    if (cols.length === 0) continue;
    const ticked = Array.isArray(v) ? (v as string[]) : [];
    mapRows(f.id, (r) => {
      const row = { ...r };
      for (const c of cols) {
        const allowed = (c.options ?? []).map((o) => o.value).filter((x) => ticked.includes(x));
        if (cellText(row, c.id) && !allowed.includes(cellText(row, c.id))) row[c.id] = '';
        if (!cellText(row, c.id) && allowed.length === 1) row[c.id] = allowed[0];
      }
      return row;
    });
  }

  const link = schema.assetRegister;
  if (!link) return next;
  const { asset, newCustodian, newLocation } = link.columns;
  if (id === link.custodians.new) {
    const before = String(prev[id] ?? '');
    mapRows(link.table, (r) => (cellText(r, newCustodian) === '' || cellText(r, newCustodian) === before ? { ...r, [newCustodian]: v } : r));
  }
  if (id === link.table) {
    const before = (prev[id] as TableValue | undefined)?.rows ?? [];
    const byId = new Map(options.assets.map((a) => [a.id, a]));
    mapRows(link.table, (r, i) => {
      const picked = byId.get(cellText(r, asset));
      if (!picked || picked.id === cellText(before[i], asset)) return r;
      const row = { ...r };
      const location = cellText(row, newLocation);
      if (location === '' || location === byId.get(cellText(before[i], asset))?.location) row[newLocation] = picked.location;
      if (cellText(row, newCustodian) === '') row[newCustodian] = String(next[link.custodians.new] ?? '');
      if (!next[link.custodians.original]) next[link.custodians.original] = picked.custodianId;
      return row;
    });
  }
  return next;
}

/** Browser-side preview of a formula / total, same arithmetic as the server (which recomputes both). */
function preview(field: TableField, col: TableColumn, row: Values): string {
  if (!col.formula) return '';
  const eff = effectiveRow(field, row);
  const parts = col.formula.of.map((id) => String(eff[id] ?? '').replace(/,/g, '').trim());
  if (parts.some((p) => p === '')) return '';
  try {
    const result = computeFormula(col, Object.fromEntries(col.formula.of.map((id, i) => [id, parts[i]])), new Map(field.columns.map((c) => [c.id, c])));
    return result === null ? '' : String(result);
  } catch {
    return '';
  }
}

function tableTotal(field: TableField, value: TableValue): number | null {
  if (!field.totalColumn) return null;
  const col = field.columns.find((c) => c.id === field.totalColumn)!;
  return value.rows.reduce((sum, row) => {
    const v = col.formula ? preview(field, col, row) : String(row[col.id] ?? '');
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
}

function Options({ list }: { list: { id: string; label: string }[] }) {
  return (
    <>
      <option value="">請選擇</option>
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );
}

const COLUMN_MIN_WIDTH: Record<ColumnType, string> = {
  text: 'min-w-[5rem]',
  number: 'min-w-[4.5rem]',
  money: 'min-w-[7rem]',
  date: 'min-w-[9rem]',
  select: 'min-w-[6.5rem]',
  employee: 'min-w-[9rem]',
  asset: 'min-w-[14rem]',
  budget_code: 'min-w-[14rem]',
};

/** A table filled from the picked source: `locked` columns come from the source, rows can only be dropped in subset mode. */
type Carried = { locked: Set<string>; subset: boolean };

/** Read-only text of a carried cell. */
function cellLabel(c: TableColumn, v: unknown, options: PickerOptions): string {
  const s = String(v ?? '');
  if (c.type === 'budget_code') return options.budgetCodes.find((o) => o.id === s)?.label ?? s;
  if (c.type === 'employee') return options.employees.find((o) => o.id === s)?.label ?? s;
  if (c.type === 'select') return c.options?.find((o) => o.value === s)?.label ?? s;
  return s;
}

function TableInput({
  field,
  value,
  onChange,
  errors,
  currency,
  options,
  ticked,
  carried,
}: {
  field: TableField;
  value: TableValue;
  onChange: (v: TableValue) => void;
  errors: Record<string, string>;
  /** Picked currency code for a table with a currency field. */
  currency: string | null;
  options: PickerOptions;
  /** Options currently ticked in a checkboxes field (pickFrom columns). */
  ticked: (fieldId: string) => string[];
  carried: Carried | null;
}) {
  const setCell = (i: number, col: string, v: unknown) =>
    onChange({ ...value, rows: value.rows.map((r, idx) => (idx === i ? { ...r, [col]: v } : r)) });
  /** Choices of a select / employee / asset cell: ticked options only, values used on other rows left out. */
  const choices = (c: TableColumn, i: number) => {
    const all =
      c.type === 'employee'
        ? options.employees
        : c.type === 'asset'
          ? options.assets
          : c.type === 'budget_code'
            ? options.budgetCodes
            : (c.options ?? []).filter((o) => !c.pickFrom || ticked(c.pickFrom.field).includes(o.value)).map((o) => ({ id: o.value, label: o.label }));
    if (!c.unique) return all;
    const taken = new Set(value.rows.filter((_, idx) => idx !== i).map((r) => String(r[c.id] ?? '')));
    return all.filter((o) => !taken.has(o.id));
  };
  const total = tableTotal(field, value);
  const totalIndex = field.columns.findIndex((c) => c.id === field.totalColumn);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs text-td-muted">
            <th className="w-10 border border-td-border px-2 py-1.5">#</th>
            {field.columns.map((c) => (
              <th key={c.id} className={`border border-td-border px-2 py-1.5 text-left font-semibold ${COLUMN_MIN_WIDTH[c.type]}`}>
                {c.label}
                {c.required && <Req />}
              </th>
            ))}
            <th className="w-10 border border-td-border" />
          </tr>
        </thead>
        <tbody>
          {value.rows.map((row, i) => (
            <tr key={i}>
              <td className="border border-td-border px-2 text-center text-td-muted">{i + 1}</td>
              {field.columns.map((c) => {
                const err = errors[`${field.id}.${i}.${c.id}`];
                const fixedRate = c.rateFor !== undefined && row[c.rateFor] === BASE_CURRENCY;
                const rowCurrency = c.currencyColumn ? String(row[c.currencyColumn] ?? '') : '';
                return (
                  <td key={c.id} className="border border-td-border p-1 align-top">
                    {c.formula ? (
                      <span className="block px-2 py-2 text-right tabular-nums text-td-blue-dark">{preview(field, c, row) || '—'}</span>
                    ) : carried?.locked.has(c.id) ? (
                      <span
                        className={`block px-2 py-2 text-td-blue-dark ${c.type === 'number' || c.type === 'money' ? 'text-right tabular-nums' : ''}`}
                      >
                        {cellLabel(c, row[c.id], options) || '—'}
                      </span>
                    ) : c.type === 'select' || c.type === 'employee' || c.type === 'asset' || c.type === 'budget_code' ? (
                      <select value={String(row[c.id] ?? '')} onChange={(e) => setCell(i, c.id, e.target.value)} className={white} aria-label={`第 ${i + 1} 列 ${c.label}`}>
                        <Options list={choices(c, i)} />
                      </select>
                    ) : (
                      <div className="flex items-center gap-1">
                        {rowCurrency && <span className="text-xs text-td-muted">{rowCurrency}</span>}
                        <input
                          type={c.type === 'date' ? 'date' : 'text'}
                          inputMode={c.type === 'number' || c.type === 'money' ? 'decimal' : undefined}
                          maxLength={c.type === 'text' ? (c.maxLength ?? 500) : undefined}
                          value={fixedRate ? '1' : String(row[c.id] ?? '')}
                          disabled={fixedRate}
                          onChange={(e) => setCell(i, c.id, e.target.value)}
                          aria-label={`第 ${i + 1} 列 ${c.label}`}
                          className={`${white} ${c.type === 'number' || c.type === 'money' ? 'text-right' : ''} disabled:!bg-slate-100`}
                        />
                      </div>
                    )}
                    {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
                  </td>
                );
              })}
              <td className="border border-td-border text-center">
                {(!carried || (carried.subset && value.rows.length > 1)) && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, rows: value.rows.length > 1 ? value.rows.filter((_, idx) => idx !== i) : [newRow(field)] })}
                    className="text-slate-400 hover:text-red-600"
                    aria-label={`刪除第 ${i + 1} 列`}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
          {total !== null && (
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={totalIndex + 1} className="border border-td-border px-3 py-2 text-right">
                合計
              </td>
              <td className="border border-td-border px-3 py-2 text-right tabular-nums">
                {currency && `${currency} `}
                {amountText(total)}
              </td>
              <td colSpan={field.columns.length - totalIndex} className="border border-td-border" />
            </tr>
          )}
        </tbody>
      </table>
      {carried && <p className="mt-2 text-xs text-td-muted">明細由關聯單據帶入{carried.subset ? '，可移除本次不處理的項目' : ''}。</p>}
      {!carried && value.rows.length < field.maxRows && (
        <button type="button" onClick={() => onChange({ ...value, rows: [...value.rows, newRow(field)] })} className="mt-2 text-sm font-semibold text-td-blue hover:underline">
          ＋ 新增一列
        </button>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  options,
  minDay,
  currency,
  errors,
  labelId,
  ticked,
  carried,
  sourceFixed,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  options: PickerOptions;
  minDay: string | undefined;
  currency: string;
  errors: Record<string, string>;
  labelId: string;
  ticked: (fieldId: string) => string[];
  carried: Carried | null;
  /** Editing: the source stays the one the form was filed with. */
  sourceFixed: boolean;
}) {
  const str = String(value ?? '');
  const a11y = { 'aria-labelledby': labelId, 'aria-invalid': errors[field.id] ? true : undefined };
  switch (field.type) {
    case 'text':
      return (
        <input
          type={field.format === 'email' ? 'email' : field.format === 'phone' ? 'tel' : 'text'}
          inputMode={field.format === 'tax_id' ? 'numeric' : undefined}
          maxLength={field.maxLength}
          value={str}
          onChange={(e) => onChange(e.target.value)}
          className={white}
          {...a11y}
        />
      );
    case 'textarea':
      return (
        <textarea rows={field.rows} maxLength={field.maxLength} value={str} onChange={(e) => onChange(e.target.value)} className={`${white} resize-y`} {...a11y} />
      );
    case 'number':
    case 'money':
      return (
        <div className="flex items-center gap-2">
          {field.type === 'money' && <span className="text-sm text-td-muted">{currency}</span>}
          <input type="text" inputMode="decimal" value={str} onChange={(e) => onChange(e.target.value)} className={`${white} text-right`} {...a11y} />
        </div>
      );
    case 'date':
      return <input type="date" min={minDay} value={str} onChange={(e) => onChange(e.target.value)} className={white} {...a11y} />;
    case 'select':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value)} className={white} {...a11y}>
          <Options list={field.options.map((o) => ({ id: o.value, label: o.label }))} />
        </select>
      );
    case 'radio':
      return (
        <div role="radiogroup" className="flex flex-wrap gap-x-5 gap-y-2" {...a11y}>
          {field.options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-2 text-sm text-td-blue-dark">
              <input type="radio" name={field.id} checked={str === o.value} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      );
    case 'checkboxes': {
      const picked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" className="flex flex-wrap gap-x-5 gap-y-2" {...a11y}>
          {field.options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-2 text-sm text-td-blue-dark">
              <input
                type="checkbox"
                checked={picked.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case 'boolean':
      return (
        <div role="radiogroup" className="flex gap-5" {...a11y}>
          {[true, false].map((b) => (
            <label key={String(b)} className="inline-flex items-center gap-2 text-sm text-td-blue-dark">
              <input type="radio" name={field.id} checked={value === b} onChange={() => onChange(b)} />
              {b ? field.trueLabel : field.falseLabel}
            </label>
          ))}
        </div>
      );
    case 'employee':
    case 'department':
    case 'budget_code':
    case 'project':
    case 'supplier':
    case 'asset': {
      const list =
        field.type === 'budget_code'
          ? options.budgetCodes.filter((o) => !field.budgetScope || o.scope === field.budgetScope)
          : { employee: options.employees, department: options.departments, project: options.projects, supplier: options.suppliers, asset: options.assets }[
              field.type
            ];
      return (
        <select value={str} onChange={(e) => onChange(e.target.value)} className={white} {...a11y}>
          <Options list={list} />
        </select>
      );
    }
    case 'source':
      return (
        <>
          <select value={str} onChange={(e) => onChange(e.target.value)} disabled={sourceFixed} className={`${white} disabled:!bg-slate-100`} {...a11y}>
            <Options list={options.sources} />
          </select>
          {!sourceFixed && options.sources.length === 0 && (
            <p className="mt-1 text-xs text-td-muted">目前沒有可接續的已核准單據（需為本人申請、已核准，且該案件尚未建立此表單）。</p>
          )}
        </>
      );
    case 'table':
      return (
        <TableInput
          field={field}
          value={value as TableValue}
          onChange={onChange}
          errors={errors}
          currency={field.currencyField ? currency : null}
          options={options}
          ticked={ticked}
          carried={carried}
        />
      );
    default:
      return null;
  }
}

export function CustomForm({
  formKey,
  name,
  description,
  schema,
  options,
  today,
  mode,
  initial,
  currentEmployeeId,
  presetSource,
}: {
  formKey: string;
  name: string;
  description: string;
  schema: FormSchema;
  options: PickerOptions;
  today: string;
  mode: CustomFormMode;
  initial?: Values;
  /** Default applicant of a 代為申請 form (the filer themselves). */
  currentEmployeeId?: string;
  /** 關聯單據 picked in advance (「接續」 from the source's page). */
  presetSource?: string;
}) {
  const router = useRouter();
  const link = sourceFieldOf(schema);
  const targets = useMemo(() => sourceTargets(schema), [schema]);
  const [values, setValues] = useState<Values>(() => {
    const start = initialValues(schema, initial);
    return link && presetSource && options.sources.some((o) => o.id === presetSource)
      ? withSource(schema, { ...start, [link.id]: presetSource }, presetSource, options)
      : start;
  });
  const pickedSource = link ? options.sources.find((o) => o.id === values[link.id]) : undefined;
  const carriedOf = (f: FieldDef): Carried | null =>
    pickedSource && pickedSource.table === f.id ? { locked: targets.get(f.id) ?? new Set(), subset: pickedSource.subset } : null;
  const pickApplicant = schema.onBehalf === true && mode.kind !== 'update' && mode.kind !== 'resubmit';
  const [applicantId, setApplicantId] = useState(currentEmployeeId ?? '');
  const [files, setFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const existing = mode.kind === 'update' || mode.kind === 'resubmit' ? mode.existingAttachmentCount : 0;

  /** Which fields show / are required right now, evaluated in order like the server does (tables test their total). */
  const { visible, required, minDates } = useMemo(() => {
    const seen: Values = {};
    const out = { visible: new Set<string>(), required: new Set<string>(), minDates: new Map<string, string>() };
    for (const f of allFields(schema)) {
      if (!isFieldVisible(f, seen)) continue;
      out.visible.add(f.id);
      if (isFieldRequired(f, seen)) out.required.add(f.id);
      const min = minDate(f, seen, today);
      if (min) out.minDates.set(f.id, min);
      if (isDisplayOnly(f)) continue;
      const v = values[f.id];
      seen[f.id] = f.type === 'table' ? tableTotal(f, v as TableValue) : v;
    }
    return out;
  }, [schema, values, today]);
  const currencyOf = (f: FieldDef) => (f.currencyField ? String(values[f.currencyField] ?? '') || '幣別' : 'NT$');

  const ticked = (fieldId: string) => (Array.isArray(values[fieldId]) ? (values[fieldId] as string[]) : []);
  const set = (id: string) => (v: unknown) => {
    setValues((prev) => withFollowUps(schema, prev, id, v, options));
    setErrors((prev) => {
      const stale = Object.keys(prev).filter((k) => k === id || k.startsWith(`${id}.`));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const k of stale) delete next[k];
      return next;
    });
  };

  const onSubmit = async () => {
    setError(null);
    const check = validateSubmission(schema, values, today);
    if (!check.ok) {
      setErrors(check.errors);
      setError('請修正標示的欄位');
      return;
    }
    setErrors({});
    if (check.value.attachmentsRequired && files.length + existing === 0) {
      setError('請上傳附件');
      return;
    }
    if (mode.kind === 'preview') {
      mode.onValid(check.value);
      return;
    }
    const fd = new FormData();
    fd.set(
      'payload',
      JSON.stringify(
        mode.kind === 'create'
          ? { data: values, idempotencyKey, ...(pickApplicant && applicantId ? { applicantEmployeeId: applicantId } : {}) }
          : { data: values, expectedVersion: mode.version }
      )
    );
    files.forEach((f) => fd.append('files', f));
    setSubmitting(true);
    const result: SubmitResult =
      mode.kind === 'create' ? await submitCustomForm(formKey, fd) : await reviseCustomForm(formKey, mode.id, mode.kind, fd);
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    const failed = result.attachmentErrors.length;
    router.push(`/f/${formKey}/${result.submissionId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  return (
    <div className="card !p-0">
      <div className="px-5 py-4">
        <h1 className="text-xl font-bold text-td-blue-dark">{name}</h1>
        {description && <p className="mt-1 text-sm text-td-muted">{description}</p>}
      </div>
      {pickApplicant && (
        <section className="border-t border-dashed border-td-border px-5 py-5">
          <label htmlFor="applicant" className="text-sm font-semibold text-td-blue-dark">
            申請人
            <Req />
          </label>
          <p className="mt-1 text-xs text-td-muted">以經辦身分替其他同仁申請時請改選申請人；申請人需先在系統確認，才會送主管簽核。</p>
          <select id="applicant" value={applicantId} onChange={(e) => setApplicantId(e.target.value)} className={`${white} mt-2 md:w-1/2`}>
            {options.employees.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </section>
      )}
      {schema.sections.map((section) => (
        <section key={section.id} className="border-t border-dashed border-td-border">
          {(section.title || section.description) && (
            <div className="px-5 pt-4">
              {section.title && <h2 className="font-semibold text-td-blue-dark">{section.title}</h2>}
              {section.description && <p className="mt-1 text-xs text-td-muted">{section.description}</p>}
            </div>
          )}
          <div className="grid gap-x-6 gap-y-5 px-5 py-5 md:grid-cols-4">
            {section.fields
              .filter((f) => visible.has(f.id))
              .map((f) => (
                <div key={f.id} className={SPAN[f.width]}>
                  {f.type === 'notice' ? (
                    <div className="rounded border border-td-border bg-slate-50 px-4 py-3">
                      <p className="text-sm font-semibold text-td-blue-dark">{f.label}</p>
                      <p className="mt-1 whitespace-pre-line text-sm leading-6 text-td-blue-dark">
                        <NoticeText text={f.text} />
                      </p>
                    </div>
                  ) : (
                    <>
                      <p id={`field-${f.id}`} className="text-sm font-semibold text-td-blue-dark">
                        {f.label}
                        {required.has(f.id) && <Req />}
                      </p>
                      {f.help && <p className="mt-1 text-xs text-td-muted">{f.help}</p>}
                      <div className="mt-2">
                        {f.type === 'attachments' ? (
                          <PendingFilesField files={files} onChange={setFiles} existingCount={existing} maxFiles={f.maxFiles ?? undefined} />
                        ) : (
                          <FieldInput
                            field={f}
                            value={values[f.id]}
                            onChange={set(f.id)}
                            options={options}
                            minDay={minDates.get(f.id)}
                            currency={currencyOf(f)}
                            errors={errors}
                            labelId={`field-${f.id}`}
                            ticked={ticked}
                            carried={carriedOf(f)}
                            sourceFixed={mode.kind === 'update' || mode.kind === 'resubmit'}
                          />
                        )}
                      </div>
                      {errors[f.id] && <p className="mt-1 text-xs text-red-600">{errors[f.id]}</p>}
                    </>
                  )}
                </div>
              ))}
          </div>
        </section>
      ))}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-td-border px-5 py-4">
        {error && <p className="mr-auto text-sm text-red-600">{error}</p>}
        {mode.kind !== 'preview' && (
          <button type="button" onClick={() => router.back()} className="btn-secondary" disabled={submitting}>
            取消
          </button>
        )}
        <button type="button" onClick={onSubmit} className="btn-primary" disabled={submitting}>
          {submitting
            ? '送出中…'
            : { create: '送出申請', update: '儲存修改', resubmit: '重新送出', preview: '試送出（不會建立資料）' }[mode.kind]}
        </button>
      </div>
    </div>
  );
}
