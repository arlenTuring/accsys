'use client';

import {
  BUDGET_SCOPE_LABELS,
  BUDGET_SCOPES,
  SCHEMA_LIMITS,
  type ColumnRule,
  type ColumnType,
  type FieldDef,
  type FieldOption,
  type FieldRule,
  type FieldSemantic,
  type FormSchema,
  type RuleCompareOp,
  type TableColumn,
} from '@/lib/custom-forms/schema';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { FIELD_TYPE_LABELS, newColumn, uniqueId } from '@/lib/form-builder/blank';
import type { BuilderSourceForm } from '@/lib/form-builder/queries';
import { dangerBtn, smallBtn, smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { ConditionEditor, type CondField } from './condition-editor';
import { SourceRulesEditor } from './source-rules-editor';

const SEMANTICS: Partial<Record<FieldDef['type'], { value: FieldSemantic; label: string }>> = {
  money: { value: 'amount', label: '這是單據金額（財會追蹤、金額條件）' },
  table: { value: 'amount', label: '合計是單據金額（財會追蹤、金額條件）' },
  budget_code: { value: 'budget_code', label: '這是主要預算編號' },
  project: { value: 'project', label: '這是主要專案' },
};

const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: '文字' },
  { value: 'number', label: '數字' },
  { value: 'money', label: '金額' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '下拉選單' },
  { value: 'employee', label: '員工' },
  { value: 'asset', label: '財產' },
  { value: 'budget_code', label: '預算編號' },
];
const UNIQUE_TYPES: readonly ColumnType[] = ['text', 'select', 'employee', 'asset'];

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-td-blue-dark">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function move<T>(list: T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function OptionsEditor({ options, onChange }: { options: FieldOption[]; onChange: (o: FieldOption[]) => void }) {
  return (
    <div className="space-y-1">
      {options.map((o, i) => (
        <div key={i} className="flex gap-1">
          <input
            className={`${smallInput} !w-24 shrink-0 font-mono`}
            aria-label={`第 ${i + 1} 個選項代碼`}
            value={o.value}
            maxLength={100}
            onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <input
            className={smallInput}
            aria-label={`第 ${i + 1} 個選項名稱`}
            value={o.label}
            maxLength={100}
            onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <button type="button" className={smallBtn} aria-label="上移" onClick={() => onChange(move(options, i, -1))}>
            ↑
          </button>
          <button type="button" className={smallBtn} aria-label="下移" onClick={() => onChange(move(options, i, 1))}>
            ↓
          </button>
          <button type="button" className={dangerBtn} aria-label="刪除選項" onClick={() => onChange(options.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className={smallBtn}
        onClick={() => {
          const value = uniqueId('opt', options.map((o) => o.value));
          onChange([...options, { value, label: `選項 ${options.length + 1}` }]);
        }}
      >
        ＋ 選項
      </button>
      <p className="text-xs text-td-muted">代碼存進單據資料（建議用英數字）；名稱是畫面顯示的文字。</p>
    </div>
  );
}

function ColumnRulesEditor({
  column,
  columns,
  onChange,
  condFields,
}: {
  column: TableColumn;
  columns: TableColumn[];
  onChange: (rules: ColumnRule[] | undefined) => void;
  condFields: CondField[];
}) {
  const rules = column.rules ?? [];
  const targets = condFields.filter((f) => f.kind === (column.type === 'date' ? 'date' : 'number'));
  const selects = columns.filter((c) => c.type === 'select' && c.id !== column.id);
  const emit = (next: ColumnRule[]) => onChange(next.length > 0 ? next : undefined);
  const setRule = (i: number, r: ColumnRule) => emit(rules.map((x, j) => (j === i ? r : x)));
  const setWhen = (i: number, r: ColumnRule, when: ColumnRule['when']) => setRule(i, when ? { ...r, when } : { check: r.check, message: r.message });
  return (
    <div className="space-y-1 text-xs">
      {rules.map((r, i) => {
        const whenCol = r.when ? selects.find((c) => c.id === r.when!.column) : undefined;
        return (
          <div key={i} className="space-y-1 rounded border border-dashed border-td-border p-1">
            <div className="flex gap-1">
              {r.check.kind === 'max' ? (
                <label className="flex flex-1 items-center gap-1">
                  不可大於
                  <input
                    className={`${smallInput} !w-28`}
                    type="number"
                    min={0}
                    aria-label="上限"
                    value={r.check.value}
                    onChange={(e) => setRule(i, { ...r, check: { kind: 'max', value: Number(e.target.value) } })}
                  />
                </label>
              ) : (
                <>
                  <select
                    className={`${smallInput} !w-36 shrink-0`}
                    aria-label="比較方式"
                    value={r.check.op}
                    onChange={(e) => r.check.kind === 'compare' && setRule(i, { ...r, check: { ...r.check, op: e.target.value as RuleCompareOp } })}
                  >
                    {(Object.keys(COMPARE_LABELS) as RuleCompareOp[]).map((op) => (
                      <option key={op} value={op}>
                        {COMPARE_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  <select
                    className={smallInput}
                    aria-label="比較的欄位"
                    value={r.check.field}
                    onChange={(e) => r.check.kind === 'compare' && setRule(i, { ...r, check: { ...r.check, field: e.target.value } })}
                  >
                    {!targets.some((t) => r.check.kind === 'compare' && t.id === r.check.field) && <option value="">選擇欄位</option>}
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button type="button" className={dangerBtn} aria-label="刪除規則" onClick={() => emit(rules.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <input
              className={smallInput}
              aria-label="不符合時的提示訊息"
              placeholder="不符合時的提示訊息"
              maxLength={SCHEMA_LIMITS.ruleMessage}
              value={r.message}
              onChange={(e) => setRule(i, { ...r, message: e.target.value })}
            />
            {selects.length > 0 && (
              <div className="space-y-1">
                <label className="flex items-center gap-1">
                  只檢查
                  <select
                    className={`${smallInput} !w-32`}
                    aria-label="適用條件欄"
                    value={r.when?.column ?? ''}
                    onChange={(e) => {
                      const col = selects.find((c) => c.id === e.target.value);
                      setWhen(i, r, col ? { column: col.id, in: col.options?.[0] ? [col.options[0].value] : [] } : undefined);
                    }}
                  >
                    <option value="">每一列</option>
                    {selects.map((c) => (
                      <option key={c.id} value={c.id}>
                        「{c.label}」為下列選項的列
                      </option>
                    ))}
                  </select>
                </label>
                {whenCol && r.when && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pl-2">
                    {(whenCol.options ?? []).map((o) => (
                      <Check
                        key={o.value}
                        label={o.label}
                        checked={r.when!.in.includes(o.value)}
                        onChange={(v) => setWhen(i, r, { column: whenCol.id, in: v ? [...r.when!.in, o.value] : r.when!.in.filter((x) => x !== o.value) })}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {rules.length < SCHEMA_LIMITS.rules && (
        <div className="flex flex-wrap gap-1">
          {targets.length > 0 && (
            <button type="button" className={smallBtn} onClick={() => emit([...rules, { check: { kind: 'compare', op: 'gte', field: targets[0].id }, message: '' }])}>
              ＋ 和前面的欄位比較
            </button>
          )}
          {column.type !== 'date' && (
            <button type="button" className={smallBtn} onClick={() => emit([...rules, { check: { kind: 'max', value: 10000 }, message: '' }])}>
              ＋ 上限
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnsEditor({
  field,
  onChange,
  condFields,
}: {
  field: Extract<FieldDef, { type: 'table' }>;
  onChange: (f: FieldDef) => void;
  condFields: CondField[];
}) {
  const cols = field.columns;
  const setCols = (columns: TableColumn[]) => {
    const totalColumn = columns.some((c) => c.id === field.totalColumn) ? field.totalColumn : null;
    onChange({ ...field, columns, totalColumn });
  };
  const setCol = (i: number, p: Partial<TableColumn>) => setCols(cols.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const numeric = cols.filter((c) => c.type === 'number' || c.type === 'money');
  return (
    <div className="space-y-2">
      {cols.map((c, i) => (
        <div key={i} className="space-y-2 rounded border border-td-border bg-slate-50 p-2">
          <div className="flex gap-1">
            <input
              className={`${smallInput} !w-24 shrink-0 font-mono`}
              aria-label={`第 ${i + 1} 欄代號`}
              value={c.id}
              maxLength={40}
              onChange={(e) => setCol(i, { id: e.target.value })}
            />
            <input className={smallInput} aria-label={`第 ${i + 1} 欄名稱`} value={c.label} maxLength={60} onChange={(e) => setCol(i, { label: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${smallInput} !w-28`}
              aria-label={`第 ${i + 1} 欄類型`}
              value={c.type}
              onChange={(e) => {
                const type = e.target.value as ColumnType;
                setCol(i, {
                  type,
                  options: type === 'select' ? (c.options?.length ? c.options : [{ value: 'opt1', label: '選項 1' }]) : undefined,
                  decimals: type === 'number' ? (c.decimals ?? 0) : undefined,
                  formula: type === 'number' || type === 'money' ? c.formula : undefined,
                  default: type === 'select' ? c.default : undefined,
                  maxLength: type === 'text' ? c.maxLength : undefined,
                  rateFor: type === 'number' ? c.rateFor : undefined,
                  currencyColumn: type === 'money' ? c.currencyColumn : undefined,
                  unique: UNIQUE_TYPES.includes(type) ? c.unique : undefined,
                  pickFrom: type === 'select' ? c.pickFrom : undefined,
                  sameOwner: type === 'budget_code' ? c.sameOwner : undefined,
                  rules: undefined,
                });
              }}
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {!c.formula && <Check label="必填" checked={c.required} onChange={(v) => setCol(i, { required: v })} />}
            {UNIQUE_TYPES.includes(c.type) && (
              <Check label="不可重複" checked={c.unique === true} onChange={(v) => setCol(i, { unique: v || undefined })} />
            )}
            {c.type === 'budget_code' && (
              <Check label="各列需同一位預算負責人" checked={c.sameOwner === true} onChange={(v) => setCol(i, { sameOwner: v || undefined })} />
            )}
            {c.type === 'number' && (
              <label className="flex items-center gap-1 text-xs">
                小數位
                <input
                  className={`${smallInput} !w-14`}
                  type="number"
                  min={0}
                  max={6}
                  value={c.decimals ?? 0}
                  onChange={(e) => setCol(i, { decimals: Number(e.target.value) })}
                />
              </label>
            )}
            {(c.type === 'number' || c.type === 'money') && !c.formula && (
              <label className="flex items-center gap-1 text-xs">
                最小值
                <input
                  className={`${smallInput} !w-20`}
                  type="number"
                  min={c.type === 'money' ? 0 : undefined}
                  value={c.min ?? ''}
                  onChange={(e) => setCol(i, { min: numOrNull(e.target.value) })}
                />
              </label>
            )}
            <span className="ml-auto flex gap-1">
              <button type="button" className={smallBtn} aria-label="左移" onClick={() => setCols(move(cols, i, -1))}>
                ↑
              </button>
              <button type="button" className={smallBtn} aria-label="右移" onClick={() => setCols(move(cols, i, 1))}>
                ↓
              </button>
              <button type="button" className={dangerBtn} aria-label="刪除欄" onClick={() => setCols(cols.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          </div>
          {(c.type === 'number' || c.type === 'money') && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <Check
                label="自動計算（兩欄相乘）"
                checked={!!c.formula}
                onChange={(v) => {
                  const others = numeric.filter((x) => x.id !== c.id && !x.formula);
                  setCol(i, v ? { formula: { op: 'multiply', of: [others[0]?.id ?? '', others[1]?.id ?? others[0]?.id ?? ''] }, required: false } : { formula: undefined });
                }}
              />
              {c.formula &&
                ([0, 1] as const).map((k) => (
                  <span key={k} className="flex items-center gap-1">
                    {k === 1 && '×'}
                    <select
                      className={`${smallInput} !w-24`}
                      aria-label={k === 0 ? '相乘的第一欄' : '相乘的第二欄'}
                      value={c.formula!.of[k]}
                      onChange={(e) => {
                        const of = [...c.formula!.of] as [string, string];
                        of[k] = e.target.value;
                        setCol(i, { formula: { op: 'multiply', of } });
                      }}
                    >
                      <option value="">選擇欄位</option>
                      {numeric
                        .filter((x) => x.id !== c.id && !x.formula)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                    </select>
                  </span>
                ))}
            </div>
          )}
          {c.type === 'text' && (
            <label className="flex items-center gap-1 text-xs">
              字數上限
              <input
                className={`${smallInput} !w-20`}
                type="number"
                min={1}
                max={SCHEMA_LIMITS.textMax}
                value={c.maxLength ?? 500}
                onChange={(e) => setCol(i, { maxLength: Number(e.target.value) })}
              />
            </label>
          )}
          {c.type === 'number' && !c.formula && (
            <label className="flex items-center gap-1 text-xs">
              匯率欄，依幣別
              <select
                className={`${smallInput} !w-32`}
                value={c.rateFor ?? ''}
                onChange={(e) => setCol(i, { rateFor: e.target.value || undefined, decimals: e.target.value ? Math.max(c.decimals ?? 0, 4) : c.decimals })}
              >
                <option value="">不是匯率</option>
                {cols.slice(0, i).filter((x) => x.type === 'select').map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {c.rateFor && <p className="text-xs text-td-muted">選 TWD 時固定為 1；外幣必填，並檢查是否在合理匯率範圍內。</p>}
          {c.type === 'money' && (
            <label className="flex items-center gap-1 text-xs">
              幣別依
              <select className={`${smallInput} !w-32`} value={c.currencyColumn ?? ''} onChange={(e) => setCol(i, { currencyColumn: e.target.value || undefined })}>
                <option value="">同整張明細</option>
                {cols.filter((x) => x.type === 'select').map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {c.type === 'select' && (
            <>
              <OptionsEditor options={c.options ?? []} onChange={(options) => setCol(i, { options })} />
              <label className="flex items-center gap-1 text-xs">
                新增列時預設
                <select className={`${smallInput} !w-32`} value={c.default ?? ''} onChange={(e) => setCol(i, { default: e.target.value || undefined })}>
                  <option value="">不預選</option>
                  {(c.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-wrap items-center gap-1 text-xs">
                只能選已勾選的
                <select
                  className={`${smallInput} !w-36`}
                  value={c.pickFrom?.field ?? ''}
                  onChange={(e) => setCol(i, { pickFrom: e.target.value ? { field: e.target.value, coverAll: c.pickFrom?.coverAll ?? false } : undefined })}
                >
                  <option value="">不限定</option>
                  {condFields
                    .filter((f) => f.kind === 'checkboxes')
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                </select>
              </label>
              {c.pickFrom && (
                <Check
                  label="每個勾選的選項都要至少一列使用"
                  checked={c.pickFrom.coverAll}
                  onChange={(v) => setCol(i, { pickFrom: { field: c.pickFrom!.field, coverAll: v } })}
                />
              )}
            </>
          )}
          {(c.type === 'date' || c.type === 'number' || c.type === 'money') && (
            <ColumnRulesEditor column={c} columns={cols} onChange={(rules) => setCol(i, { rules })} condFields={condFields} />
          )}
        </div>
      ))}
      <button type="button" className={smallBtn} onClick={() => setCols([...cols, newColumn(cols.map((c) => c.id))])}>
        ＋ 欄位
      </button>
      <div className="grid grid-cols-2 gap-2">
        <Field label="最少列數">
          <input className={smallInput} type="number" min={0} value={field.minRows} onChange={(e) => onChange({ ...field, minRows: Number(e.target.value) })} />
        </Field>
        <Field label="最多列數">
          <input className={smallInput} type="number" min={1} value={field.maxRows} onChange={(e) => onChange({ ...field, maxRows: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="合計欄">
        <select className={smallInput} value={field.totalColumn ?? ''} onChange={(e) => onChange({ ...field, totalColumn: e.target.value || null })}>
          <option value="">不顯示合計</option>
          {numeric.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

const COMPARE_LABELS: Record<RuleCompareOp, string> = { gte: '不可早於／不可小於', gt: '必須晚於／必須大於', lte: '不可晚於／不可大於', lt: '必須早於／必須小於' };

function RulesEditor({
  field,
  rules,
  onChange,
  condFields,
}: {
  field: Extract<FieldDef, { type: 'date' | 'number' | 'money' | 'text' | 'textarea' }>;
  rules: FieldRule[];
  onChange: (r: FieldRule[] | undefined) => void;
  condFields: CondField[];
}) {
  const isText = field.type === 'text' || field.type === 'textarea';
  const targets = condFields.filter((f) => f.kind === (field.type === 'date' ? 'date' : 'number'));
  const emit = (next: FieldRule[]) => onChange(next.length > 0 ? next : undefined);
  const setRule = (i: number, r: FieldRule) => emit(rules.map((x, j) => (j === i ? r : x)));
  return (
    <div className="space-y-2">
      {rules.length === 0 && <p className="text-xs text-td-muted">沒有額外檢查。</p>}
      {rules.map((r, i) => (
        <div key={i} className="space-y-2 rounded border border-td-border bg-slate-50 p-2">
          <div className="flex gap-1">
            <select
              className={smallInput}
              aria-label="規則類型"
              value={r.check.kind}
              onChange={(e) =>
                setRule(i, {
                  ...r,
                  check: e.target.value === 'min_days_from_today' ? { kind: 'min_days_from_today', days: 2 } : { kind: 'compare', op: 'gte', field: targets[0]?.id ?? '' },
                })
              }
            >
              {isText ? (
                <option value="not_equal">不可填入特定內容</option>
              ) : (
                <>
                  {field.type === 'date' && <option value="min_days_from_today">至少在今天之後幾天</option>}
                  <option value="compare">和前面的欄位比較</option>
                </>
              )}
            </select>
            <button type="button" className={dangerBtn} aria-label="刪除規則" onClick={() => emit(rules.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
          {r.check.kind === 'not_equal' ? (
            <label className="flex items-center gap-1 text-xs">
              不可填入
              <input
                className={smallInput}
                maxLength={200}
                aria-label="不可填入的內容"
                value={r.check.value}
                onChange={(e) => setRule(i, { ...r, check: { kind: 'not_equal', value: e.target.value } })}
              />
            </label>
          ) : r.check.kind === 'min_days_from_today' ? (
            <label className="flex items-center gap-1 text-xs">
              今天起至少
              <input
                className={`${smallInput} !w-16`}
                type="number"
                min={0}
                max={365}
                value={r.check.days}
                onChange={(e) => setRule(i, { ...r, check: { kind: 'min_days_from_today', days: Number(e.target.value) } })}
              />
              天
            </label>
          ) : (
            <div className="flex gap-1">
              <select
                className={`${smallInput} !w-40 shrink-0`}
                aria-label="比較方式"
                value={r.check.op}
                onChange={(e) => r.check.kind === 'compare' && setRule(i, { ...r, check: { ...r.check, op: e.target.value as RuleCompareOp } })}
              >
                {(Object.keys(COMPARE_LABELS) as RuleCompareOp[]).map((op) => (
                  <option key={op} value={op}>
                    {COMPARE_LABELS[op]}
                  </option>
                ))}
              </select>
              <select
                className={smallInput}
                aria-label="比較的欄位"
                value={r.check.field}
                onChange={(e) => r.check.kind === 'compare' && setRule(i, { ...r, check: { ...r.check, field: e.target.value } })}
              >
                {!targets.some((t) => r.check.kind === 'compare' && t.id === r.check.field) && <option value="">選擇欄位</option>}
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <input
            className={smallInput}
            aria-label="不符合時的提示訊息"
            placeholder="不符合時的提示訊息"
            maxLength={SCHEMA_LIMITS.ruleMessage}
            value={r.message}
            onChange={(e) => setRule(i, { ...r, message: e.target.value })}
          />
          <div>
            <p className="text-xs text-td-muted">何時檢查</p>
            <ConditionEditor
              value={r.when}
              onChange={(when) => setRule(i, when ? { ...r, when } : { check: r.check, message: r.message })}
              fields={condFields}
              emptyText="一律檢查。"
              allowEmpty
            />
          </div>
        </div>
      ))}
      {rules.length < SCHEMA_LIMITS.rules && (
        <button
          type="button"
          className={smallBtn}
          onClick={() =>
            emit([
              ...rules,
              isText
                ? { check: { kind: 'not_equal', value: '' }, message: '' }
                : field.type === 'date'
                  ? { check: { kind: 'min_days_from_today', days: 2 }, message: '日期需至少在今天之後 2 天' }
                  : { check: { kind: 'compare', op: 'gte', field: targets[0]?.id ?? '' }, message: '' },
            ])
          }
        >
          ＋ 檢查規則
        </button>
      )}
    </div>
  );
}

export function FieldProps({
  field,
  onChange,
  idLocked,
  condFields,
  schema,
  sourceForms,
  options,
  sections,
  sectionId,
  onMoveToSection,
}: {
  field: FieldDef;
  onChange: (f: FieldDef) => void;
  /** The id was published: data of old submissions is stored under it. */
  idLocked: boolean;
  condFields: CondField[];
  schema: FormSchema;
  sourceForms: BuilderSourceForm[];
  options: PickerOptions;
  sections: { id: string; title: string }[];
  sectionId: string;
  onMoveToSection: (sectionId: string) => void;
}) {
  const set = (p: Record<string, unknown>) => onChange({ ...field, ...p } as FieldDef);
  const semantic = SEMANTICS[field.type];
  const valueField = field.type !== 'notice' && field.type !== 'attachments';
  const isSource = field.type === 'source';

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs font-semibold text-td-muted">{FIELD_TYPE_LABELS[field.type]}</p>
      <Field label="欄位名稱">
        <input className={smallInput} value={field.label} maxLength={60} onChange={(e) => set({ label: e.target.value })} />
      </Field>
      <Field
        label="欄位代號"
        hint={idLocked ? '已發佈過，代號不能修改（舊單據的資料存在這個代號下）' : '英文字母開頭，只含英數字與底線；流程與條件用代號參考欄位'}
      >
        <input className={`${smallInput} font-mono`} value={field.id} maxLength={40} disabled={idLocked} onChange={(e) => set({ id: e.target.value })} />
      </Field>
      {field.type === 'notice' ? (
        <Field label="說明內容">
          <textarea className={`${smallInput} resize-y`} rows={6} maxLength={2000} value={field.text} onChange={(e) => set({ text: e.target.value })} />
        </Field>
      ) : (
        <Field label="填寫提示">
          <input className={smallInput} value={field.help} maxLength={300} onChange={(e) => set({ help: e.target.value })} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="寬度（4 欄格線）">
          <select className={smallInput} value={field.width} onChange={(e) => set({ width: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((w) => (
              <option key={w} value={w}>
                {w === 4 ? '整列' : `${w} / 4`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="所在區段">
          <select className={smallInput} value={sectionId} onChange={(e) => onMoveToSection(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.id}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {valueField && field.type !== 'boolean' && !isSource && <Check label="必填" checked={field.required} onChange={(v) => set({ required: v })} />}
      {field.type === 'source' && (
        <Field label="來源表單" hint="一律必填、一律顯示；每張表單最多一個關聯單據欄位">
          <SourceRulesEditor field={field} schema={schema} sourceForms={sourceForms} options={options} onChange={onChange} />
        </Field>
      )}
      {field.type === 'attachments' && <Check label="至少上傳一個檔案" checked={field.required} onChange={(v) => set({ required: v })} />}
      {valueField && field.type !== 'table' && <Check label="顯示在詳情頁表頭" checked={field.showInHeader} onChange={(v) => set({ showInHeader: v })} />}
      {semantic && (
        <Check label={semantic.label} checked={field.semantic === semantic.value} onChange={(v) => set({ semantic: v ? semantic.value : undefined })} />
      )}

      {field.type === 'text' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="格式">
            <select className={smallInput} value={field.format} onChange={(e) => set({ format: e.target.value })}>
              <option value="plain">一般文字</option>
              <option value="email">Email</option>
              <option value="phone">電話</option>
              <option value="tax_id">統一編號</option>
            </select>
          </Field>
          <Field label="字數上限">
            <input className={smallInput} type="number" min={1} max={2000} value={field.maxLength} onChange={(e) => set({ maxLength: Number(e.target.value) })} />
          </Field>
          <Field label="預設內容（新單據預先填好）">
            <input
              className={smallInput}
              maxLength={field.maxLength}
              value={field.default ?? ''}
              onChange={(e) => set({ default: e.target.value === '' ? undefined : e.target.value })}
            />
          </Field>
        </div>
      )}
      {field.type === 'textarea' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="字數上限">
            <input className={smallInput} type="number" min={1} max={10000} value={field.maxLength} onChange={(e) => set({ maxLength: Number(e.target.value) })} />
          </Field>
          <Field label="顯示列數">
            <input className={smallInput} type="number" min={2} max={20} value={field.rows} onChange={(e) => set({ rows: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      {(field.type === 'text' || field.type === 'textarea') && (
        <div>
          <Check label="敏感資料（如銀行帳號）" checked={field.sensitive === true} onChange={(v) => set({ sensitive: v || undefined })} />
          <p className="mt-1 text-xs text-td-muted">申請人、經辦、財會與管理員看得到完整內容；簽核人等其他人只看到末四碼數字。</p>
        </div>
      )}
      {(field.type === 'select' || field.type === 'radio') && (
        <Field label="預設選項" hint="新單據一開始就選好的選項">
          <select className={smallInput} value={field.default ?? ''} onChange={(e) => set({ default: e.target.value || undefined })}>
            <option value="">不預選</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {field.type === 'budget_code' && (
        <Field label="預算範圍" hint="只列出這個範圍的預算編號，送出時也會再檢查">
          <select className={smallInput} value={field.budgetScope ?? ''} onChange={(e) => set({ budgetScope: e.target.value || undefined })}>
            <option value="">全部預算</option>
            {BUDGET_SCOPES.map((s) => (
              <option key={s} value={s}>
                {BUDGET_SCOPE_LABELS[s]}預算
              </option>
            ))}
          </select>
        </Field>
      )}
      {field.type === 'number' && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="最小值">
            <input className={smallInput} type="number" value={field.min ?? ''} onChange={(e) => set({ min: numOrNull(e.target.value) })} />
          </Field>
          <Field label="最大值">
            <input className={smallInput} type="number" value={field.max ?? ''} onChange={(e) => set({ max: numOrNull(e.target.value) })} />
          </Field>
          <Field label="小數位">
            <input className={smallInput} type="number" min={0} max={4} value={field.decimals} onChange={(e) => set({ decimals: Number(e.target.value) })} />
          </Field>
          <Field label="預設值">
            <input className={smallInput} type="number" value={field.default ?? ''} onChange={(e) => set({ default: numOrNull(e.target.value) ?? undefined })} />
          </Field>
        </div>
      )}
      {field.type === 'money' && (
        <Field label="金額上限（空白為不限）">
          <input className={smallInput} type="number" min={0} value={field.max ?? ''} onChange={(e) => set({ max: numOrNull(e.target.value) })} />
        </Field>
      )}
      {(field.type === 'money' || field.type === 'table') && (
        <Field label="幣別欄位" hint="選了幣別欄位，金額就以該欄選的幣別顯示，不再是 NT$；不能同時勾選「單據金額」">
          <select
            className={smallInput}
            value={field.currencyField ?? ''}
            onChange={(e) => set({ currencyField: e.target.value || undefined })}
          >
            <option value="">新台幣（NT$）</option>
            {condFields
              .filter((f) => f.kind === 'select')
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
          </select>
        </Field>
      )}
      {field.type === 'date' && <Check label="不可早於今天" checked={field.notBeforeToday} onChange={(v) => set({ notBeforeToday: v })} />}
      {(field.type === 'select' || field.type === 'radio' || field.type === 'checkboxes') && (
        <Field label="選項">
          <OptionsEditor options={field.options ?? []} onChange={(options) => set({ options })} />
        </Field>
      )}
      {field.type === 'checkboxes' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="最少選幾項">
            <input className={smallInput} type="number" min={0} value={field.minSelected} onChange={(e) => set({ minSelected: Number(e.target.value) })} />
          </Field>
          <Field label="最多選幾項（空白不限）">
            <input className={smallInput} type="number" min={1} value={field.maxSelected ?? ''} onChange={(e) => set({ maxSelected: numOrNull(e.target.value) })} />
          </Field>
        </div>
      )}
      {field.type === 'boolean' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="「是」的文字">
            <input className={smallInput} maxLength={20} value={field.trueLabel} onChange={(e) => set({ trueLabel: e.target.value })} />
          </Field>
          <Field label="「否」的文字">
            <input className={smallInput} maxLength={20} value={field.falseLabel} onChange={(e) => set({ falseLabel: e.target.value })} />
          </Field>
        </div>
      )}
      {field.type === 'table' && (
        <Field label="明細欄位">
          <ColumnsEditor field={field} onChange={onChange} condFields={condFields} />
        </Field>
      )}
      {field.type === 'attachments' && (
        <Field label="檔案數上限（空白為 20）">
          <input className={smallInput} type="number" min={1} max={20} value={field.maxFiles ?? ''} onChange={(e) => set({ maxFiles: numOrNull(e.target.value) })} />
        </Field>
      )}

      {(field.type === 'date' || field.type === 'number' || field.type === 'money' || field.type === 'text' || field.type === 'textarea') && (
        <div className="border-t border-dashed border-td-border pt-3">
          <p className="text-xs font-semibold text-td-blue-dark">檢查規則</p>
          <p className="mb-2 text-xs text-td-muted">送出時額外檢查；不符合就顯示提示訊息，不能送出。</p>
          <RulesEditor field={field} rules={field.rules ?? []} onChange={(rules) => set({ rules })} condFields={condFields} />
        </div>
      )}

      {valueField && field.type !== 'boolean' && !isSource && (
        <div className="border-t border-dashed border-td-border pt-3">
          <p className="text-xs font-semibold text-td-blue-dark">條件必填</p>
          <p className="mb-2 text-xs text-td-muted">符合條件時改為必填（即使上面沒勾「必填」）。</p>
          <ConditionEditor value={field.requiredWhen} onChange={(c) => set({ requiredWhen: c })} fields={condFields} emptyText="不另設條件。" allowEmpty />
        </div>
      )}

      {!isSource && (
        <div className="border-t border-dashed border-td-border pt-3">
          <p className="text-xs font-semibold text-td-blue-dark">顯示條件</p>
          <p className="mb-2 text-xs text-td-muted">只能參考排在這個欄位前面的欄位；隱藏時不必填，也不會存進單據。</p>
          <ConditionEditor value={field.visibleWhen} onChange={(c) => set({ visibleWhen: c })} fields={condFields} emptyText="一律顯示。" allowEmpty />
        </div>
      )}
    </div>
  );
}
