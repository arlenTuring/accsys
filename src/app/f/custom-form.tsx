'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { inputCls, Req } from '@/app/components/form-fields';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { TwoTierBudgetSelect } from '@/app/components/two-tier-budget-select';
import {
  DraftAttachedFiles,
  type DraftAttachedFile,
} from '@/app/tools/ai-chat/draft-attached-files';
import { attachmentFieldLabel, normalizeAttachmentFieldLabel } from '@/lib/attachments/policy';
import { reviseCustomForm, submitCustomForm, type SubmitResult } from '@/lib/custom-forms/actions';
import { BUDGET_REQUEST_KEY } from '@/lib/custom-forms/migrated/budget';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import type { EmployeeFilingScope } from '@/lib/filing-agents/queries';
import { deleteFormDraftAction, saveFormDraftAction } from '@/lib/form-drafts/actions';
import type { SavedFormDraft } from '@/lib/form-drafts/service';
import {
  adjustableSourceTargets,
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
  summarizeErrors,
  validateSubmission,
  type TableValue,
} from '@/lib/custom-forms/validate';
import { BASE_CURRENCY } from '@/lib/exchange-rates';
import { BudgetRequestItemsEditor } from './budget-request-items-editor';
import { NoticeText } from './notice-text';
import { amountText } from './submission-fields';

export type CustomFormMode =
  | { kind: 'create' }
  | { kind: 'update' | 'resubmit'; id: string; version: number; existingAttachmentCount: number }
  /** Designer preview: can be filled in, has no submit button. */
  | { kind: 'preview' }
  /** AI assistant draft panel: save/submit via provided callbacks (not createSubmission directly). */
  | {
      kind: 'ai_draft';
      draftId: string;
      expectedVersion: number;
      conversationId: string;
      /** Chat→draft copies already on this draft (shown inside 附件). */
      attachedFiles?: DraftAttachedFile[];
      submitLabel?: string;
      saveState?: 'idle' | 'saving' | 'saved' | 'error';
      /** Panel-provided save status (version, time, or why it is not saved). */
      saveNote?: string;
      /** A file of this draft was edited, restored or re-checked. */
      onFilesChanged?: (info?: { version?: number }) => void;
      onSave: (data: Record<string, unknown>, expectedVersion: number) => Promise<void>;
      onSubmitDocument: (data: Record<string, unknown>, expectedVersion: number, files: File[]) => Promise<void>;
    };

type Values = Record<string, unknown>;

export const SPAN: Record<1 | 2 | 3 | 4, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4' };
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

export function initialValues(schema: FormSchema, initial?: Values): Values {
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
  const byId = new Map(field.columns.map((c) => [c.id, c]));
  const parts = col.formula.of.map((id) => {
    const raw = String(eff[id] ?? '').replace(/,/g, '').trim();
    return raw !== '' ? raw : String(byId.get(id)?.default ?? '');
  });
  if (parts.some((p) => p === '')) return '';
  try {
    const result = computeFormula(col, Object.fromEntries(col.formula.of.map((id, i) => [id, parts[i]])), byId);
    return result === null ? '' : String(result);
  } catch {
    return '';
  }
}

function tableTotal(field: TableField, value: TableValue): number | null {
  const col = field.columns.find((c) => c.id === field.totalColumn);
  if (!col) return null;
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
type Carried = {
  locked: Set<string>;
  subset: boolean;
  childCount?: number;
  sourceTotalAmount?: number | null;
  totalUsedAmount?: number;
  remainingAmount?: number | null;
};

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
  columnLabel,
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
  columnLabel?: (c: TableColumn) => ReactNode;
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
  const projectedCumulative =
    carried?.sourceTotalAmount !== null && carried?.sourceTotalAmount !== undefined
      ? (carried.totalUsedAmount ?? 0) + (total ?? 0)
      : null;
  const overSourceTotal =
    projectedCumulative !== null &&
    carried?.sourceTotalAmount !== null &&
    carried?.sourceTotalAmount !== undefined &&
    projectedCumulative > carried.sourceTotalAmount + 0.005;

  return (
    <div className="overflow-x-auto">
      {carried && carried.sourceTotalAmount !== null && carried.sourceTotalAmount !== undefined && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/60 px-3.5 py-2 text-xs text-td-blue-dark">
          <span>
            📊 <strong>來源單據分批追蹤：</strong>
            原單總額 <strong className="tabular-nums">NT$ {amountText(carried.sourceTotalAmount)}</strong>
            {' · '}已開立 <strong className="tabular-nums">{carried.childCount ?? 0}</strong> 張（累計{' '}
            <strong className="tabular-nums">NT$ {amountText(carried.totalUsedAmount ?? 0)}</strong>）
            {' · '}剩餘額度{' '}
            <strong className="tabular-nums text-emerald-700">
              NT$ {amountText(carried.remainingAmount ?? carried.sourceTotalAmount)}
            </strong>
          </span>
          {overSourceTotal && (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
              ⚠️ 累計金額（NT$ {amountText(projectedCumulative!)}）超過來源單據總額，請確認報價差異
            </span>
          )}
        </div>
      )}
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs text-td-muted">
            <th className="w-10 border border-td-border px-2 py-1.5">#</th>
            {field.columns.map((c) => (
              <th key={c.id} className={`border border-td-border px-2 py-1.5 text-left font-semibold ${COLUMN_MIN_WIDTH[c.type]}`}>
                {columnLabel ? columnLabel(c) : c.label}
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
                const rawStr = String(row[c.id] ?? '').trim();
                const isNeg =
                  (c.type === 'money' || (c.type === 'number' && (c.min ?? 0) >= 0)) &&
                  rawStr.startsWith('-') &&
                  !Number.isNaN(Number(rawStr.replace(/,/g, ''))) &&
                  Number(rawStr.replace(/,/g, '')) < 0;
                const liveNegErr = isNeg
                  ? `第 ${i + 1} 列「${c.label}」：${c.type === 'money' ? '金額不可為負數' : '不可為負數'}`
                  : undefined;
                let liveMaxPrompt: string | undefined;
                if (c.formula && c.rules && c.rules.length > 0) {
                  const previewStr = preview(field, c, row);
                  const numericVal = previewStr ? Number(previewStr.replace(/,/g, '')) : NaN;
                  if (Number.isFinite(numericVal)) {
                    for (const rule of c.rules) {
                      if (rule.check.kind === 'max' && numericVal > rule.check.value) {
                        const condOk =
                          !rule.when ||
                          rule.when.in.includes(String(row[rule.when.column] ?? ''));
                        if (condOk) {
                          liveMaxPrompt = rule.message || `不可超過 ${rule.check.value.toLocaleString('en-US')}`;
                          break;
                        }
                      }
                    }
                  }
                }
                const err = errors[`${field.id}.${i}.${c.id}`] ?? liveNegErr ?? liveMaxPrompt;
                const fixedRate = c.rateFor !== undefined && row[c.rateFor] === BASE_CURRENCY;
                const rowCurrency = c.currencyColumn ? String(row[c.currencyColumn] ?? '') : '';
                return (
                  <td key={c.id} className="border border-td-border p-1 align-top">
                    {c.formula ? (
                      <span className="block px-2 py-2 text-right tabular-nums text-td-blue-dark">{preview(field, c, row) || '—'}</span>
                    ) : c.financeFill ? (
                      <span className="block px-2 py-2 text-xs text-td-muted">核准後由財會填寫</span>
                    ) : carried?.locked.has(c.id) ? (
                      <span
                        className={`block px-2 py-2 text-td-blue-dark ${c.type === 'number' || c.type === 'money' ? 'text-right tabular-nums' : ''}`}
                      >
                        {cellLabel(c, row[c.id], options) || '—'}
                      </span>
                    ) : c.type === 'budget_code' ? (
                      <TwoTierBudgetSelect
                        value={String(row[c.id] ?? '')}
                        onChange={(val) => setCell(i, c.id, val)}
                        options={choices(c, i)}
                        className={white}
                        ariaLabel={`第 ${i + 1} 列 ${c.label}`}
                        compact
                      />
                    ) : c.type === 'select' || c.type === 'employee' || c.type === 'asset' ? (
                      <select value={String(row[c.id] ?? '')} onChange={(e) => setCell(i, c.id, e.target.value)} className={white} aria-label={`第 ${i + 1} 列 ${c.label}`}>
                        <Options list={choices(c, i)} />
                      </select>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          {rowCurrency && <span className="text-xs text-td-muted">{rowCurrency}</span>}
                          <input
                            type={c.type === 'date' ? 'date' : 'text'}
                            inputMode={c.type === 'number' || c.type === 'money' ? 'decimal' : undefined}
                            maxLength={c.type === 'text' ? (c.maxLength ?? 500) : undefined}
                            value={fixedRate ? '1' : String(row[c.id] ?? '')}
                            disabled={fixedRate}
                            onKeyDown={(e) => {
                              if (
                                (c.type === 'money' || (c.type === 'number' && (c.min ?? 0) >= 0)) &&
                                (e.key === '-' || e.key === '－')
                              ) {
                                e.preventDefault();
                              }
                            }}
                            onChange={(e) => {
                              const nextVal =
                                c.type === 'money' || (c.type === 'number' && (c.min ?? 0) >= 0)
                                  ? e.target.value.replace(/[-－]/g, '')
                                  : e.target.value;
                              setCell(i, c.id, nextVal);
                            }}
                            aria-label={`第 ${i + 1} 列 ${c.label}`}
                            className={`${white} ${c.type === 'number' || c.type === 'money' ? 'text-right' : ''} ${err ? '!border-red-500 !bg-red-50' : ''} disabled:!bg-slate-100`}
                          />
                        </div>
                        {c.id === 'quantity' && typeof row._maxQty === 'number' && (
                          <span className="px-1 text-[11px] text-td-muted">
                            原核准 {row._maxQty} · 已開 {Number(row._usedQty ?? 0)} · 剩餘可開{' '}
                            <strong className={Number(row._remainingQty ?? 0) === 0 ? 'text-amber-700' : 'text-emerald-700'}>
                              {Number(row._remainingQty ?? 0)}
                            </strong>
                          </span>
                        )}
                        {c.id === 'amount' && typeof row._sourceAmount === 'number' && Number(row._usedAmount ?? 0) > 0 && (
                          <span className="px-1 text-[11px] text-td-muted">
                            原金額 {amountText(row._sourceAmount)} · 已請 {amountText(Number(row._usedAmount ?? 0))} · 剩餘{' '}
                            <strong className="text-emerald-700">{amountText(Number(row._remainingAmount ?? 0))}</strong>
                          </span>
                        )}
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

export function FieldInput({
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
  columnLabel,
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
  /** Designer canvas: replaces the plain header text of table columns. */
  columnLabel?: (c: TableColumn) => ReactNode;
}) {
  const str = String(value ?? '');
  const a11y = { 'aria-labelledby': labelId, 'aria-invalid': errors[field.id] ? true : undefined };
  switch (field.type) {
    case 'text':
      return (
        <input
          type={field.format === 'email' ? 'email' : field.format === 'phone' ? 'tel' : 'text'}
          inputMode={field.format === 'tax_id' || field.format === 'bank_account' ? 'numeric' : undefined}
          placeholder={field.format === 'year_month' ? '2026-07' : undefined}
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
    case 'money': {
      const disallowNegative = field.type === 'money' || (field.min ?? 0) >= 0;
      return (
        <div className="flex items-center gap-2">
          {field.type === 'money' && <span className="text-sm text-td-muted">{currency}</span>}
          <input
            type="text"
            inputMode="decimal"
            value={str}
            onKeyDown={(e) => {
              if (disallowNegative && (e.key === '-' || e.key === '－')) {
                e.preventDefault();
              }
            }}
            onChange={(e) =>
              onChange(disallowNegative ? e.target.value.replace(/[-－]/g, '') : e.target.value)
            }
            className={`${white} text-right`}
            {...a11y}
          />
        </div>
      );
    }
    case 'date':
      return <input type="date" min={minDay} value={str} onChange={(e) => onChange(e.target.value)} className={white} {...a11y} />;
    case 'datetime':
      return <input type="datetime-local" value={str} onChange={(e) => onChange(e.target.value)} className={white} {...a11y} />;
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
    case 'budget_code': {
      const list = options.budgetCodes.filter((o) => !field.budgetScope || o.scope === field.budgetScope);
      return (
        <TwoTierBudgetSelect
          value={str}
          onChange={(val) => onChange(val)}
          options={list}
          className={white}
          ariaLabelledBy={labelId}
          ariaInvalid={errors[field.id] ? true : undefined}
        />
      );
    }
    case 'employee':
    case 'department':
    case 'project':
    case 'supplier':
    case 'asset': {
      const list = {
        employee: options.employees,
        department: options.departments,
        project: options.projects,
        supplier: options.suppliers,
        asset: options.assets,
      }[field.type];
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
          columnLabel={columnLabel}
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
  filingScope,
  savedDrafts,
  initialDraftId,
  initialApplicantId,
  clonedFromFormNumber,
  skipDraftRestore,
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
  /** 經辦人／代為申請可選範圍與部門篩選 */
  filingScope?: EmployeeFilingScope;
  /** 使用者在此表單已暫存的草稿清單 */
  savedDrafts?: SavedFormDraft[];
  /** 從「我的申請紀錄 > 草稿」點入時預先載入的草稿 ID */
  initialDraftId?: string | null;
  /** 複製舊單或草稿帶入的申請人 ID */
  initialApplicantId?: string | null;
  /** 從舊單複製時顯示來源單號提示 */
  clonedFromFormNumber?: string | null;
  /** 當從「我的資產管理」複選資產帶入、複製舊單或指定關聯單據時，不讓 localStorage 舊草稿覆蓋本次帶入的明細 */
  skipDraftRestore?: boolean;
}) {
  const router = useRouter();
  const link = sourceFieldOf(schema);
  const targets = useMemo(() => sourceTargets(schema), [schema]);
  const adjustableTargets = useMemo(() => adjustableSourceTargets(schema), [schema]);
  const [values, setValues] = useState<Values>(() => {
    const start = initialValues(schema, initial);
    return link && presetSource && options.sources.some((o) => o.id === presetSource)
      ? withSource(schema, { ...start, [link.id]: presetSource }, presetSource, options)
      : start;
  });
  const pickedSource = link ? options.sources.find((o) => o.id === values[link.id]) : undefined;
  const carriedOf = (f: FieldDef): Carried | null => {
    if (!pickedSource || pickedSource.table !== f.id) return null;
    const allTargeted = targets.get(f.id) ?? new Set<string>();
    const adjustable = adjustableTargets.get(f.id) ?? new Set<string>();
    const locked = new Set([...allTargeted].filter((colId) => !adjustable.has(colId)));
    return {
      locked,
      subset: pickedSource.subset,
      childCount: pickedSource.childCount,
      sourceTotalAmount: pickedSource.sourceTotalAmount,
      totalUsedAmount: pickedSource.totalUsedAmount,
      remainingAmount: pickedSource.remainingAmount,
    };
  };
  const pickApplicant =
    formKey !== 'budget-request' &&
    (schema.onBehalf === true || filingScope?.hasAssignments === true) &&
    mode.kind !== 'update' &&
    mode.kind !== 'resubmit';
  const [applicantId, setApplicantId] = useState(
    initialApplicantId && (schema.onBehalf === true || filingScope?.applicants.some((a) => a.id === initialApplicantId))
      ? initialApplicantId
      : (currentEmployeeId ?? '')
  );
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');
  const [draftList, setDraftList] = useState<SavedFormDraft[]>(savedDrafts ?? []);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialDraftId ?? null);
  const activeDraftIdRef = useRef<string | null>(initialDraftId ?? null);
  useEffect(() => {
    activeDraftIdRef.current = activeDraftId;
  }, [activeDraftId]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    initialDraftId ? 'saved' : 'idle'
  );
  const [lastAutoSavedTime, setLastAutoSavedTime] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(
    initialDraftId ? '已自動載入您上次填寫的草稿，所有變更皆會即時自動儲存，關閉視窗下次進入亦可無縫接續。' : null
  );
  const localStorageKey = `accsys:live-draft:${formKey}:${currentEmployeeId ?? 'anon'}`;
  const isFirstRenderRef = useRef(true);
  const lastSavedSnapshotRef = useRef<string>(JSON.stringify({ values, applicantId }));
  const [files, setFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const existing = mode.kind === 'update' || mode.kind === 'resubmit' ? mode.existingAttachmentCount : 0;

  const selectableDepartments = useMemo(() => {
    if (!filingScope) return [];
    const seen = new Map<string, string>();
    for (const a of filingScope.applicants) {
      if (!seen.has(a.departmentId)) seen.set(a.departmentId, a.departmentName);
    }
    return [...seen.entries()].map(([id, deptName]) => ({ id, name: deptName }));
  }, [filingScope]);

  const applicantChoices = useMemo(() => {
    if (filingScope && filingScope.applicants.length > 0) {
      const filtered =
        selectedDeptFilter === 'ALL'
          ? filingScope.applicants
          : filingScope.applicants.filter(
              (a) => a.departmentId === selectedDeptFilter || a.id === applicantId
            );
      return filtered.map((a) => ({
        id: a.id,
        label: a.label,
      }));
    }
    return options.employees;
  }, [filingScope, selectedDeptFilter, applicantId, options.employees]);

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
    setValues((prev) => {
      const next = withFollowUps(schema, prev, id, v, options);
      if (formKey === 'budget-request' && id === 'targetDepartmentId' && typeof v === 'string' && v) {
        const dept = options.departments.find((d) => d.id === v);
        if (dept?.managerEmployeeId && !next.ownerEmployeeId) {
          next.ownerEmployeeId = dept.managerEmployeeId;
        }
      }
      return next;
    });
    setErrors((prev) => {
      const stale = Object.keys(prev).filter((k) => k === id || k.startsWith(`${id}.`));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const k of stale) delete next[k];
      return next;
    });
  };

  // Restore any unsynced localStorage snapshot if newer or if no server draft was loaded yet
  useEffect(() => {
    if (mode.kind !== 'create' || typeof window === 'undefined' || skipDraftRestore) return;
    try {
      const raw = window.localStorage.getItem(localStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        draftId?: string | null;
        applicantId?: string;
        values?: Values;
        savedAt?: number;
      };
      if (!parsed.values) return;
      const matchedServerDraft = initialDraftId
        ? (savedDrafts ?? []).find((d) => d.id === initialDraftId)
        : undefined;
      const serverUpdatedMs = matchedServerDraft ? new Date(matchedServerDraft.updatedAt).getTime() : 0;
      if (!initialDraftId || (parsed.savedAt && parsed.savedAt > serverUpdatedMs + 1500)) {
        const restored = initialValues(schema, parsed.values);
        setValues(restored);
        if (parsed.applicantId) setApplicantId(parsed.applicantId);
        if (!activeDraftIdRef.current && parsed.draftId) {
          setActiveDraftId(parsed.draftId);
          activeDraftIdRef.current = parsed.draftId;
        }
        lastSavedSnapshotRef.current = JSON.stringify({
          values: restored,
          applicantId: parsed.applicantId ?? applicantId,
        });
        setAutoSaveState('saved');
        setDraftNotice('已自動還原您上次離開時尚未送出的填寫進度（支援即時自動儲存）。');
      }
    } catch {
      // ignore localStorage read errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time auto-save: immediately persist to localStorage and debounce sync to server form_drafts
  useEffect(() => {
    if (mode.kind !== 'create') return;
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    const currentSnapshot = JSON.stringify({ values, applicantId });
    if (currentSnapshot === lastSavedSnapshotRef.current) return;

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          localStorageKey,
          JSON.stringify({
            draftId: activeDraftIdRef.current,
            applicantId,
            values,
            savedAt: Date.now(),
          })
        );
      } catch {
        // ignore storage quota errors
      }
    }

    setAutoSaveState('saving');
    const timer = window.setTimeout(async () => {
      try {
        const res = await saveFormDraftAction({
          draftId: activeDraftIdRef.current,
          formType: 'custom',
          formKey,
          formLabel: name,
          applicantEmployeeId: pickApplicant && applicantId ? applicantId : (currentEmployeeId ?? null),
          data: values,
        });
        if (res.ok) {
          lastSavedSnapshotRef.current = currentSnapshot;
          activeDraftIdRef.current = res.draft.id;
          setActiveDraftId(res.draft.id);
          setDraftList((prev) => [res.draft, ...prev.filter((d) => d.id !== res.draft.id)]);
          const nowStr = new Date(res.draft.updatedAt).toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
          setLastAutoSavedTime(nowStr);
          setAutoSaveState('saved');
          if (typeof window !== 'undefined') {
            try {
              window.localStorage.setItem(
                localStorageKey,
                JSON.stringify({
                  draftId: res.draft.id,
                  applicantId,
                  values,
                  savedAt: new Date(res.draft.updatedAt).getTime(),
                })
              );
            } catch {
              // ignore
            }
          }
        } else {
          setAutoSaveState('error');
        }
      } catch {
        setAutoSaveState('error');
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [values, applicantId, mode.kind, formKey, name, pickApplicant, currentEmployeeId, localStorageKey]);

  const onSubmit = async () => {
    setError(null);
    const check = validateSubmission(schema, values, today);
    if (!check.ok) {
      setErrors(check.errors);
      setError(`請修正標示的欄位：${summarizeErrors(check.errors)}`);
      return;
    }
    setErrors({});
    const draftAttached =
      mode.kind === 'ai_draft' ? (mode.attachedFiles?.length ?? 0) : 0;
    if (check.value.attachmentsRequired && files.length + existing + draftAttached === 0) {
      setError('請上傳附件');
      return;
    }
    if (mode.kind === 'preview') return;
    if (mode.kind === 'ai_draft') {
      setSubmitting(true);
      try {
        await mode.onSubmitDocument(values, mode.expectedVersion, files);
      } catch (err) {
        setSubmitting(false);
        setError(err instanceof Error ? err.message : '送出失敗');
        return;
      }
      setSubmitting(false);
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
    if (mode.kind === 'create' && activeDraftId) {
      await deleteFormDraftAction(activeDraftId).catch(() => null);
    }
    if (mode.kind === 'create' && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(localStorageKey);
      } catch {
        // ignore
      }
    }
    const failed = result.attachmentErrors.length;
    router.push(`/f/${formKey}/${result.submissionId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  const onSaveUserDraft = async () => {
    if (mode.kind !== 'create') return;
    setError(null);
    setDraftNotice(null);
    setSavingDraft(true);
    try {
      const res = await saveFormDraftAction({
        draftId: activeDraftId,
        formType: 'custom',
        formKey,
        formLabel: name,
        applicantEmployeeId: pickApplicant && applicantId ? applicantId : (currentEmployeeId ?? null),
        data: values,
      });
      setSavingDraft(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setActiveDraftId(res.draft.id);
      activeDraftIdRef.current = res.draft.id;
      lastSavedSnapshotRef.current = JSON.stringify({ values, applicantId });
      setDraftList((prev) => [res.draft, ...prev.filter((d) => d.id !== res.draft.id)]);
      const nowStr = new Date(res.draft.updatedAt).toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setLastAutoSavedTime(nowStr);
      setAutoSaveState('saved');
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            localStorageKey,
            JSON.stringify({
              draftId: res.draft.id,
              applicantId,
              values,
              savedAt: new Date(res.draft.updatedAt).getTime(),
            })
          );
        } catch {
          // ignore
        }
      }
      setDraftNotice(`草稿「${res.draft.title}」已於 ${nowStr} 暫存！可隨時於「我的申請紀錄 > 草稿」繼續編輯。`);
    } catch (err) {
      setSavingDraft(false);
      setError(err instanceof Error ? err.message : '草稿儲存失敗');
    }
  };

  const onLoadUserDraft = (d: SavedFormDraft) => {
    const restored = initialValues(schema, d.data);
    setValues(restored);
    if (d.applicantEmployeeId) setApplicantId(d.applicantEmployeeId);
    setActiveDraftId(d.id);
    activeDraftIdRef.current = d.id;
    lastSavedSnapshotRef.current = JSON.stringify({
      values: restored,
      applicantId: d.applicantEmployeeId ?? applicantId,
    });
    setErrors({});
    setError(null);
    setAutoSaveState('saved');
    setDraftNotice(`已載入草稿「${d.title}」。`);
  };

  const onDeleteUserDraft = async (draftIdToDelete: string) => {
    const res = await deleteFormDraftAction(draftIdToDelete);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraftList((prev) => prev.filter((d) => d.id !== draftIdToDelete));
    if (activeDraftId === draftIdToDelete) {
      setActiveDraftId(null);
      activeDraftIdRef.current = null;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(localStorageKey);
        } catch {
          // ignore
        }
      }
      setDraftNotice('已刪除暫存草稿。');
    }
  };

  const onAiDraftSave = async () => {
    if (mode.kind !== 'ai_draft') return;
    setError(null);
    try {
      await mode.onSave(values, mode.expectedVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗');
    }
  };

  const budgetHeaderSummary = useMemo(() => {
    if (formKey !== 'budget-request') return null;
    const fyStr = String(values.fiscalYear ?? '116').trim();
    const fyNum = Number(fyStr);
    const west = Number.isFinite(fyNum) && fyNum > 0 && fyNum < 1911 ? fyNum + 1911 : fyNum;
    const fyLabel = Number.isFinite(west) && west > 1911 ? `${fyStr} 年度 (${west})` : `${fyStr} 年度`;
    const isProject = values.budgetScope === 'project';
    const scopeLabel = isProject ? '專案預算表' : '部門預算表';
    const targetLabel = isProject
      ? options.projects.find((p) => p.id === String(values.targetProjectId ?? ''))?.label || '—'
      : options.departments.find((d) => d.id === String(values.targetDepartmentId ?? ''))?.label || '—';
    const ownerLabel =
      options.employees.find((e) => e.id === String(values.ownerEmployeeId ?? ''))?.label || '—';
    return {
      fyLabel,
      isProject,
      scopeLabel,
      targetLabel,
      ownerLabel,
    };
  }, [
    formKey,
    values.fiscalYear,
    values.budgetScope,
    values.targetDepartmentId,
    values.targetProjectId,
    values.ownerEmployeeId,
    options.departments,
    options.projects,
    options.employees,
  ]);

  return (
    <div className="card !p-0">
      {formKey === 'budget-request' && budgetHeaderSummary ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <h1 className="mr-1.5 text-base font-bold text-td-blue-dark">{name}</h1>
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700">
              <span className="text-slate-400">年度</span>
              <span>{budgetHeaderSummary.fyLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700">
              <span className="text-slate-400">類型</span>
              <span>{budgetHeaderSummary.scopeLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700">
              <span className="text-slate-400">{budgetHeaderSummary.isProject ? '專案' : '部門'}</span>
              <span className="max-w-[16rem] truncate">{budgetHeaderSummary.targetLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700">
              <span className="text-slate-400">負責人</span>
              <span>{budgetHeaderSummary.ownerLabel}</span>
            </span>
            <span
              className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-500"
              title="基本歸屬資訊由財會部門派發時核定鎖定"
            >
              🔒 財會核定
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode.kind === 'create' && (
              <div
                role="status"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                  autoSaveState === 'saving'
                    ? 'border-blue-200 bg-blue-50 text-td-blue'
                    : autoSaveState === 'saved'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : autoSaveState === 'error'
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    autoSaveState === 'saving'
                      ? 'animate-pulse bg-td-blue'
                      : autoSaveState === 'saved'
                        ? 'bg-emerald-500'
                        : autoSaveState === 'error'
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                  }`}
                />
                {autoSaveState === 'saving'
                  ? '自動儲存中…'
                  : autoSaveState === 'saved'
                    ? `已自動儲存${lastAutoSavedTime ? ` (${lastAutoSavedTime})` : ''}`
                    : autoSaveState === 'error'
                      ? '已暫存本機'
                      : '即時自動儲存'}
              </div>
            )}
            <a
              href="/my-tasks/budget"
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-td-blue hover:bg-blue-50"
            >
              ← 返回待辦
            </a>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div>
            <h1 className="text-xl font-bold text-td-blue-dark">{name}</h1>
            {description && <p className="mt-1 text-sm text-td-muted">{description}</p>}
          </div>
          {mode.kind === 'create' && (
            <div
              role="status"
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                autoSaveState === 'saving'
                  ? 'border-blue-200 bg-blue-50 text-td-blue'
                  : autoSaveState === 'saved'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : autoSaveState === 'error'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  autoSaveState === 'saving'
                    ? 'animate-pulse bg-td-blue'
                    : autoSaveState === 'saved'
                      ? 'bg-emerald-500'
                      : autoSaveState === 'error'
                        ? 'bg-amber-500'
                        : 'bg-slate-400'
                }`}
              />
              {autoSaveState === 'saving'
                ? '正在即時自動儲存…'
                : autoSaveState === 'saved'
                  ? `已即時儲存${lastAutoSavedTime ? ` (${lastAutoSavedTime})` : ''} · 關閉後重開可繼續填寫`
                  : autoSaveState === 'error'
                    ? '已暫存於本機（待連線同步）'
                    : '支援即時自動儲存 · 關閉視窗不遺失'}
            </div>
          )}
        </div>
      )}
      {clonedFromFormNumber && (
        <div className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2.5 text-xs text-td-blue-dark">
          <span>
            📋 已從舊單據 <strong className="mono-case font-semibold">{clonedFromFormNumber}</strong> 複製表單內容，請確認並修改需要調整的欄位後再送出或暫存草稿。
          </span>
        </div>
      )}
      {draftNotice && (
        <div className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
          <span>✓ {draftNotice}</span>
          <button type="button" onClick={() => setDraftNotice(null)} className="text-emerald-700 hover:underline">
            關閉
          </button>
        </div>
      )}
      {mode.kind === 'create' && draftList.length > 0 && formKey !== 'budget-request' && (
        <section className="border-t border-dashed border-td-border bg-amber-50/40 px-5 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-900">
              📝 您在此表單有 {draftList.length} 筆已暫存草稿（點擊即可載入繼續編輯，送出後自動清除）：
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {draftList.map((d) => {
              const isCurrent = activeDraftId === d.id;
              return (
                <div
                  key={d.id}
                  className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${
                    isCurrent
                      ? 'border-td-blue bg-blue-50 font-semibold text-td-blue-dark'
                      : 'border-amber-200 bg-white text-slate-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onLoadUserDraft(d)}
                    className="hover:text-td-blue hover:underline"
                  >
                    {isCurrent ? '● 編輯中：' : ''}
                    {d.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteUserDraft(d.id)}
                    className="text-slate-400 hover:text-red-600"
                    title="刪除此草稿"
                    aria-label={`刪除草稿 ${d.title}`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {pickApplicant && (
        <section className="border-t border-dashed border-td-border px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="applicant" className="text-sm font-semibold text-td-blue-dark">
              申請人（經辦人代為申請）
              <Req />
            </label>
            {filingScope?.hasAssignments && (
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-td-blue">
                已授權經辦人
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-td-muted">
            以經辦人身分替其他同仁或部門申請時，請先篩選部門或直接改選申請人；代填送出後，系統會先送交「申請人本人簽核確認」，再依序送交部門主管、預算負責人、總經理、董事長（逾 10 萬）簽核。
          </p>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {filingScope && selectableDepartments.length > 1 && (
              <div>
                <label htmlFor="applicant-dept-filter" className="block text-xs font-medium text-td-muted">
                  依部門篩選申請人
                </label>
                <select
                  id="applicant-dept-filter"
                  value={selectedDeptFilter}
                  onChange={(e) => {
                    const deptId = e.target.value;
                    setSelectedDeptFilter(deptId);
                    if (deptId !== 'ALL') {
                      const firstInDept = filingScope.applicants.find((a) => a.departmentId === deptId);
                      if (firstInDept) setApplicantId(firstInDept.id);
                    }
                  }}
                  className={`${white} mt-1`}
                >
                  <option value="ALL">全部可代填部門（{filingScope.applicants.length} 人）</option>
                  {selectableDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              {filingScope && selectableDepartments.length > 1 && (
                <label htmlFor="applicant" className="block text-xs font-medium text-td-muted">
                  選擇申請人
                </label>
              )}
              <select
                id="applicant"
                value={applicantId}
                onChange={(e) => setApplicantId(e.target.value)}
                className={`${white} mt-1`}
              >
                {applicantChoices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}
      {schema.sections
        .filter((section) => !(formKey === 'budget-request' && section.id === 'basic'))
        .map((section) => {
          const isBudgetItemsSection = formKey === 'budget-request' && section.id === 'itemsSection';
          return (
        <section
          key={section.id}
          className={isBudgetItemsSection ? '' : 'border-t border-dashed border-td-border'}
        >
          {!isBudgetItemsSection && (section.title || section.description) && (
            <div className="px-5 pt-4">
              {section.title && (
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-td-blue-dark">{section.title}</h2>
                </div>
              )}
              {section.description && (
                <p className="mt-1 text-xs text-td-muted">{section.description}</p>
              )}
            </div>
          )}
          <div className={`grid gap-x-6 gap-y-5 px-5 ${isBudgetItemsSection ? 'py-3' : 'py-5'} md:grid-cols-4`}>
            {section.fields
              .filter((f) => visible.has(f.id) && !(formKey === 'budget-request' && f.id === 'reason'))
              .map((f) => {
                const isLockedBudgetHeaderField =
                  formKey === 'budget-request' &&
                  (f.id === 'fiscalYear' ||
                    f.id === 'budgetScope' ||
                    f.id === 'targetDepartmentId' ||
                    f.id === 'targetProjectId' ||
                    f.id === 'ownerEmployeeId');
                const hideBudgetTableLabel = formKey === 'budget-request' && f.type === 'table' && f.id === 'items';

                let lockedBudgetDisplay = '';
                if (isLockedBudgetHeaderField) {
                  if (f.id === 'fiscalYear') {
                    const fyStr = String(values.fiscalYear ?? '116').trim();
                    const fyNum = Number(fyStr);
                    const west = Number.isFinite(fyNum) && fyNum > 0 && fyNum < 1911 ? fyNum + 1911 : fyNum;
                    lockedBudgetDisplay = Number.isFinite(west) && west > 1911 ? `${fyStr} 年度（${west} 年度）` : `${fyStr} 年度`;
                  } else if (f.id === 'budgetScope') {
                    lockedBudgetDisplay =
                      values.budgetScope === 'project'
                        ? '專案預算表（營收／產品專案預算表）'
                        : '部門預算表（年度部門預算表）';
                  } else if (f.id === 'targetDepartmentId') {
                    lockedBudgetDisplay =
                      options.departments.find((d) => d.id === String(values.targetDepartmentId ?? ''))?.label ||
                      '—';
                  } else if (f.id === 'targetProjectId') {
                    lockedBudgetDisplay =
                      options.projects.find((p) => p.id === String(values.targetProjectId ?? ''))?.label ||
                      '—';
                  } else if (f.id === 'ownerEmployeeId') {
                    lockedBudgetDisplay =
                      options.employees.find((e) => e.id === String(values.ownerEmployeeId ?? ''))?.label ||
                      '—';
                  }
                }

                return (
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
                      {!hideBudgetTableLabel && (
                        <p id={`field-${f.id}`} className="text-sm font-semibold text-td-blue-dark">
                          {f.type === 'attachments'
                            ? attachmentFieldLabel(
                                normalizeAttachmentFieldLabel(f.label).replace(/[（(].*$/, '').trim() || '附件'
                              )
                            : f.label}
                          {!isLockedBudgetHeaderField && required.has(f.id) && <Req />}
                        </p>
                      )}
                      {!isLockedBudgetHeaderField && !hideBudgetTableLabel && f.help && (
                        <p className="mt-1 text-xs text-td-muted">{f.help}</p>
                      )}
                      <div className={hideBudgetTableLabel ? '' : 'mt-2'}>
                        {isLockedBudgetHeaderField ? (
                          <div
                            className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-100/90 px-3 py-2 text-sm font-semibold text-slate-800 select-none"
                            title="此欄位由財會部門派發預算編列單時核定，填報人不可更動"
                          >
                            <span className="truncate">{lockedBudgetDisplay}</span>
                            <span className="shrink-0 rounded bg-slate-200/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              🔒 財會核定
                            </span>
                          </div>
                        ) : f.type === 'attachments' ? (
                          <div className="space-y-3">
                            {mode.kind === 'ai_draft' && (
                              <DraftAttachedFiles
                                draftId={mode.draftId}
                                draftVersion={mode.expectedVersion}
                                conversationId={mode.conversationId}
                                files={mode.attachedFiles ?? []}
                                onChanged={mode.onFilesChanged}
                              />
                            )}
                            <PendingFilesField
                              files={files}
                              onChange={setFiles}
                              existingCount={existing + (mode.kind === 'ai_draft' ? (mode.attachedFiles?.length ?? 0) : 0)}
                              maxFiles={f.maxFiles ?? undefined}
                            />
                          </div>
                        ) : formKey === 'budget-request' && f.type === 'table' && f.id === 'items' ? (
                          <BudgetRequestItemsEditor
                            field={f}
                            value={(values[f.id] as TableValue) ?? { rows: [] }}
                            onChange={(v) => set(f.id)(v)}
                            errors={errors}
                            options={options}
                            fiscalYear={String(values.fiscalYear ?? '')}
                            budgetScope={String(values.budgetScope ?? 'department')}
                            targetDepartmentId={String(values.targetDepartmentId ?? '')}
                            targetProjectId={String(values.targetProjectId ?? '')}
                          />
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
                );
              })}
          </div>
        </section>
          );
        })}
      {mode.kind === 'ai_draft' && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-td-border px-5 py-4">
          {error && <p className="mr-auto text-sm text-red-600">{error}</p>}
          <span role="status" className={`mr-auto text-xs ${mode.saveState === 'error' ? 'font-semibold text-red-700' : 'text-td-muted'}`}>
            {mode.saveNote ?? (mode.saveState === 'saving'
              ? '儲存中…'
              : mode.saveState === 'saved'
                ? '已儲存'
                : mode.saveState === 'error'
                  ? '儲存失敗'
                  : '草稿會與對話同步')}
          </span>
          <button type="button" onClick={onAiDraftSave} className="btn-secondary" disabled={submitting || mode.saveState === 'saving'}>
            儲存草稿
          </button>
          <button type="button" onClick={onSubmit} className="btn-primary" disabled={submitting || mode.saveState === 'saving'}>
            {submitting ? '送出中…' : (mode.submitLabel ?? '送出單據')}
          </button>
        </div>
      )}
      {mode.kind !== 'preview' && mode.kind !== 'ai_draft' && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-td-border px-5 py-4">
          {error && <p className="mr-auto text-sm text-red-600">{error}</p>}
          <button type="button" onClick={() => router.back()} className="btn-secondary" disabled={submitting || savingDraft}>
            取消
          </button>
          {mode.kind === 'create' && (
            <button
              type="button"
              onClick={onSaveUserDraft}
              className="btn-secondary"
              disabled={submitting || savingDraft}
            >
              {savingDraft ? '暫存中…' : activeDraftId ? '更新草稿' : '暫存草稿'}
            </button>
          )}
          <button type="button" onClick={onSubmit} className="btn-primary" disabled={submitting || savingDraft}>
            {submitting ? '送出中…' : { create: '送出申請', update: '儲存修改', resubmit: '重新送出' }[mode.kind]}
          </button>
        </div>
      )}
    </div>
  );
}
