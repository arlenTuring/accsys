'use client';

import type { Condition, ConditionOp } from '@/lib/approval/flow/types';
import { dangerBtn, smallBtn, smallInput } from '../../org/org-ui';

/** What a condition can test: a form field, or an applicant value in flows. */
export type CondKind = 'number' | 'text' | 'date' | 'select' | 'checkboxes' | 'boolean' | 'ref' | 'roles';
export type CondField = { id: string; label: string; kind: CondKind; options: { value: string; label: string }[] };

type Leaf = Extract<Condition, { field: string }>;

export const OP_LABELS: Record<ConditionOp, string> = {
  eq: '等於',
  neq: '不等於',
  gt: '大於',
  gte: '大於或等於',
  lt: '小於',
  lte: '小於或等於',
  in: '是其中之一',
  not_in: '不是其中之一',
  contains: '包含',
  filled: '有填寫',
  empty: '未填寫',
};

const OPS: Record<CondKind, ConditionOp[]> = {
  number: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'filled', 'empty'],
  text: ['eq', 'neq', 'contains', 'filled', 'empty'],
  date: ['eq', 'neq', 'filled', 'empty'],
  select: ['eq', 'neq', 'in', 'not_in', 'filled', 'empty'],
  ref: ['eq', 'neq', 'in', 'not_in', 'filled', 'empty'],
  checkboxes: ['contains', 'filled', 'empty'],
  boolean: ['eq'],
  roles: ['contains', 'empty'],
};

const isLeaf = (c: Condition): c is Leaf => 'field' in c;

/** The editable shape: one all/any group of plain comparisons (or nothing). */
function editable(c: Condition | undefined): { mode: 'all' | 'any'; leaves: Leaf[] } | null {
  if (!c) return { mode: 'all', leaves: [] };
  if (isLeaf(c)) return { mode: 'all', leaves: [c] };
  if ('all' in c && c.all.every(isLeaf)) return { mode: 'all', leaves: c.all as Leaf[] };
  if ('any' in c && c.any.every(isLeaf)) return { mode: 'any', leaves: c.any as Leaf[] };
  return null;
}

function defaultValue(field: CondField, op: ConditionOp): unknown {
  if (op === 'filled' || op === 'empty') return undefined;
  if (op === 'in' || op === 'not_in') return field.options[0] ? [field.options[0].value] : [];
  if (field.kind === 'boolean') return true;
  if (field.kind === 'number') return 0;
  return field.options[0]?.value ?? '';
}

function leafFor(field: CondField, op?: ConditionOp): Leaf {
  const o = op && OPS[field.kind].includes(op) ? op : OPS[field.kind][0];
  const value = defaultValue(field, o);
  return value === undefined ? { field: field.id, op: o } : { field: field.id, op: o, value };
}

function valueText(field: CondField | undefined, v: unknown): string {
  const one = (x: unknown) => {
    if (typeof x === 'boolean') return x ? '是' : '否';
    return field?.options.find((o) => o.value === x)?.label ?? String(x ?? '');
  };
  return Array.isArray(v) ? v.map(one).join('、') : one(v);
}

/** One line for canvas cards, e.g. 「金額 大於 100000 且 出借印鑑 等於 是」. */
export function conditionSummary(c: Condition | undefined, fields: CondField[]): string {
  if (!c) return '';
  if ('all' in c) return c.all.length === 0 ? '（尚未設定條件）' : c.all.map((x) => conditionSummary(x, fields)).join(' 且 ');
  if ('any' in c) return c.any.length === 0 ? '（尚未設定條件）' : c.any.map((x) => conditionSummary(x, fields)).join(' 或 ');
  if ('not' in c) return `非（${conditionSummary(c.not, fields)}）`;
  const f = fields.find((x) => x.id === c.field);
  const name = f?.label ?? `（找不到欄位 ${c.field}）`;
  if (c.op === 'filled' || c.op === 'empty') return `${name} ${OP_LABELS[c.op]}`;
  return `${name} ${OP_LABELS[c.op]} ${valueText(f, c.value)}`;
}

export function ConditionEditor({
  value,
  onChange,
  fields,
  emptyText,
  allowEmpty,
}: {
  value: Condition | undefined;
  onChange: (c: Condition | undefined) => void;
  fields: CondField[];
  emptyText: string;
  /** Nothing set = undefined (e.g. always shown); otherwise an empty group is kept so publishing flags it. */
  allowEmpty: boolean;
}) {
  const state = editable(value);
  if (!state) {
    return (
      <div className="space-y-2 rounded border border-dashed border-td-border p-2 text-xs text-td-muted">
        <p>進階條件：{conditionSummary(value, fields)}</p>
        <button type="button" className={dangerBtn} onClick={() => onChange(allowEmpty ? undefined : { all: [] })}>
          清除並重新設定
        </button>
      </div>
    );
  }
  const emit = (mode: 'all' | 'any', leaves: Leaf[]) => {
    if (leaves.length === 0) onChange(allowEmpty ? undefined : { all: [] });
    else onChange(mode === 'all' ? { all: leaves } : { any: leaves });
  };
  const setLeaf = (i: number, leaf: Leaf) => emit(state.mode, state.leaves.map((l, j) => (j === i ? leaf : l)));

  return (
    <div className="space-y-2">
      {state.leaves.length === 0 && <p className="text-xs text-td-muted">{emptyText}</p>}
      {state.leaves.length > 1 && (
        <select className={smallInput} value={state.mode} onChange={(e) => emit(e.target.value as 'all' | 'any', state.leaves)} aria-label="條件組合方式">
          <option value="all">以下全部符合（且）</option>
          <option value="any">以下任一符合（或）</option>
        </select>
      )}
      {state.leaves.map((leaf, i) => {
        const field = fields.find((f) => f.id === leaf.field);
        return (
          <div key={i} className="space-y-1 rounded border border-td-border bg-slate-50 p-2">
            <div className="flex gap-1">
              <select
                className={smallInput}
                aria-label="條件欄位"
                value={field ? leaf.field : ''}
                onChange={(e) => {
                  const f = fields.find((x) => x.id === e.target.value);
                  if (f) setLeaf(i, leafFor(f, leaf.op));
                }}
              >
                {!field && <option value="">（找不到欄位 {leaf.field}）</option>}
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button type="button" className={dangerBtn} aria-label="刪除條件" onClick={() => emit(state.mode, state.leaves.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            {field && (
              <div className="flex gap-1">
                <select
                  className={`${smallInput} !w-36 shrink-0`}
                  aria-label="比較方式"
                  value={leaf.op}
                  onChange={(e) => setLeaf(i, leafFor(field, e.target.value as ConditionOp))}
                >
                  {OPS[field.kind].map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <ValueInput field={field} leaf={leaf} onChange={(v) => setLeaf(i, { ...leaf, value: v })} />
              </div>
            )}
          </div>
        );
      })}
      {fields.length > 0 ? (
        <button type="button" className={smallBtn} onClick={() => emit(state.mode, [...state.leaves, leafFor(fields[0])])}>
          ＋ 條件
        </button>
      ) : (
        <p className="text-xs text-td-muted">沒有可以作為條件的欄位。</p>
      )}
    </div>
  );
}

function ValueInput({ field, leaf, onChange }: { field: CondField; leaf: Leaf; onChange: (v: unknown) => void }) {
  if (leaf.op === 'filled' || leaf.op === 'empty') return null;
  if (leaf.op === 'in' || leaf.op === 'not_in') {
    const picked = Array.isArray(leaf.value) ? leaf.value.map(String) : [];
    return (
      <select
        multiple
        size={Math.min(5, Math.max(2, field.options.length))}
        className={smallInput}
        aria-label="比較值（可複選）"
        value={picked}
        onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
      >
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'boolean') {
    return (
      <select className={smallInput} aria-label="比較值" value={leaf.value === false ? 'false' : 'true'} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    );
  }
  if (field.options.length > 0) {
    return (
      <select className={smallInput} aria-label="比較值" value={String(leaf.value ?? '')} onChange={(e) => onChange(e.target.value)}>
        {!field.options.some((o) => o.value === leaf.value) && <option value={String(leaf.value ?? '')}>（請選擇）</option>}
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'number') {
    return (
      <input
        className={smallInput}
        type="number"
        aria-label="比較值"
        value={typeof leaf.value === 'number' ? leaf.value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }
  return (
    <input
      className={smallInput}
      type={field.kind === 'date' ? 'date' : 'text'}
      aria-label="比較值"
      maxLength={200}
      value={String(leaf.value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
