'use client';

import type { PickerOptions } from '@/lib/custom-forms/queries';
import type { FieldDef, FormSchema, SourceRowMap, SourceRule, TableColumn } from '@/lib/custom-forms/schema';
import type { BuilderSourceForm } from '@/lib/form-builder/queries';
import { dangerBtn, smallBtn, smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { ConditionEditor, type CondField } from './condition-editor';
import { allSchemaFields, condFieldOf } from './designer-model';

type SourceField = Extract<FieldDef, { type: 'source' }>;
type TableField = Extract<FieldDef, { type: 'table' }>;

const MAX_RULES = 5;

const tablesOf = (schema: FormSchema): TableField[] => allSchemaFields(schema).filter((f): f is TableField => f.type === 'table');

/** Columns a carried row may fill: typed by the applicant otherwise, so not computed. */
const fillable = (t: TableField | undefined): TableColumn[] => (t?.columns ?? []).filter((c) => !c.formula && c.rateFor === undefined);

function RowsEditor({
  rows,
  onChange,
  targets,
  source,
}: {
  rows: SourceRowMap;
  onChange: (rows: SourceRowMap | undefined) => void;
  targets: TableField[];
  source: FormSchema | undefined;
}) {
  const into = targets.find((t) => t.id === rows.table);
  const sourceTables = source ? tablesOf(source) : [];
  const from = sourceTables.find((t) => t.id === rows.from);
  const selects = (from?.columns ?? []).filter((c) => c.type === 'select');
  const filterCol = selects.find((c) => c.id === rows.filter?.column);
  const mapped = (to: string) => rows.columns.find((m) => m.to === to)?.from ?? '';
  const setMap = (to: string, fromCol: string) =>
    onChange({ ...rows, columns: [...rows.columns.filter((m) => m.to !== to), ...(fromCol ? [{ to, from: fromCol }] : [])] });
  return (
    <div className="space-y-2 rounded border border-dashed border-td-border p-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <Field label="帶入到本表明細">
          <select className={smallInput} value={rows.table} onChange={(e) => onChange({ ...rows, table: e.target.value, columns: [] })}>
            {!into && <option value="">選擇明細表</option>}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="來源明細">
          <select className={smallInput} value={rows.from} onChange={(e) => onChange({ ...rows, from: e.target.value, columns: [], filter: undefined })}>
            {!from && <option value="">選擇來源明細</option>}
            {sourceTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="帶入方式">
        <select className={smallInput} value={rows.mode} onChange={(e) => onChange({ ...rows, mode: e.target.value as SourceRowMap['mode'] })}>
          <option value="all">全部帶入（不可增刪列）</option>
          <option value="subset">可移除部分列（不可新增列）</option>
        </select>
      </Field>
      {selects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          只帶入
          <select
            className={`${smallInput} !w-32`}
            aria-label="篩選欄"
            value={rows.filter?.column ?? ''}
            onChange={(e) => {
              const col = selects.find((c) => c.id === e.target.value);
              onChange({ ...rows, filter: col ? { column: col.id, value: col.options?.[0]?.value ?? '' } : undefined });
            }}
          >
            <option value="">每一列</option>
            {selects.map((c) => (
              <option key={c.id} value={c.id}>
                「{c.label}」為
              </option>
            ))}
          </select>
          {filterCol && rows.filter && (
            <select
              className={`${smallInput} !w-28`}
              aria-label="篩選值"
              value={rows.filter.value}
              onChange={(e) => onChange({ ...rows, filter: { column: filterCol.id, value: e.target.value } })}
            >
              {(filterCol.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {filterCol && '的列'}
        </div>
      )}
      {into && from && (
        <div className="space-y-1">
          <p className="font-semibold text-td-blue-dark">欄位對應（帶入的欄位申請人不能修改）</p>
          {fillable(into).map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <span className="w-24 shrink-0 truncate">{c.label}</span>←
              <select className={smallInput} aria-label={`${c.label} 的來源欄`} value={mapped(c.id)} onChange={(e) => setMap(c.id, e.target.value)}>
                <option value="">不帶入（申請人填寫）</option>
                {from.columns
                  .filter((x) => x.type === c.type)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <button type="button" className={dangerBtn} onClick={() => onChange(undefined)}>
        不帶入明細
      </button>
    </div>
  );
}

/** 關聯單據 rules: which approved forms this one continues, when, and which rows it carries over. */
export function SourceRulesEditor({
  field,
  schema,
  sourceForms,
  options,
  onChange,
}: {
  field: SourceField;
  schema: FormSchema;
  sourceForms: BuilderSourceForm[];
  options: PickerOptions;
  onChange: (f: FieldDef) => void;
}) {
  const rules = field.sources;
  const emit = (sources: SourceRule[]) => onChange({ ...field, sources });
  const setRule = (i: number, r: SourceRule) => emit(rules.map((x, j) => (j === i ? r : x)));
  const fields = allSchemaFields(schema);
  const at = fields.findIndex((f) => f.id === field.id);
  const targets = fields.slice(at + 1).filter((f): f is TableField => f.type === 'table' && !f.visibleWhen);
  const formOf = (key: string) => sourceForms.find((f) => f.key === key);
  const condFieldsOf = (s: FormSchema | undefined): CondField[] =>
    s ? allSchemaFields(s).map((f) => condFieldOf(f, options)).filter((f): f is CondField => f !== null) : [];

  return (
    <div className="space-y-2">
      {rules.length === 0 && <p className="text-xs text-red-600">請至少加入一個來源表單。</p>}
      {rules.map((r, i) => {
        const src = formOf(r.form);
        return (
          <div key={i} className="space-y-2 rounded border border-td-border bg-slate-50 p-2">
            <div className="flex gap-1">
              <select className={smallInput} aria-label="來源表單" value={r.form} onChange={(e) => setRule(i, { form: e.target.value })}>
                {!src && <option value={r.form}>{r.form ? `${r.form}（找不到）` : '選擇來源表單'}</option>}
                {sourceForms.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                    {f.published ? '' : '（尚未發佈）'}
                  </option>
                ))}
              </select>
              <button type="button" className={dangerBtn} aria-label="刪除來源" onClick={() => emit(rules.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            {src && !src.published && <p className="text-xs text-amber-700">來源表單需先發佈，這張表單才能發佈。</p>}
            <div>
              <p className="text-xs text-td-muted">來源單據需符合（依來源表單的欄位）</p>
              <ConditionEditor
                value={r.when}
                onChange={(when) => setRule(i, { ...r, when: when ?? undefined })}
                fields={condFieldsOf(src?.schema)}
                emptyText="不限條件。"
                allowEmpty
              />
            </div>
            <label className="flex flex-wrap items-center gap-1 text-xs">
              案件已有核准的
              <select
                className={`${smallInput} !w-40`}
                aria-label="已有核准的單據時不可選"
                value={r.unlessCaseHas ?? ''}
                onChange={(e) => setRule(i, { ...r, unlessCaseHas: e.target.value || undefined })}
              >
                <option value="">（不限）</option>
                {sourceForms.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </select>
              時不可選這張來源
            </label>
            {r.rows ? (
              <RowsEditor rows={r.rows} onChange={(rows) => setRule(i, { ...r, rows })} targets={targets} source={src?.schema} />
            ) : (
              <button
                type="button"
                className={smallBtn}
                disabled={targets.length === 0}
                title={targets.length === 0 ? '請先在關聯單據之後加入明細表' : undefined}
                onClick={() =>
                  setRule(i, {
                    ...r,
                    rows: { table: targets[0]?.id ?? '', from: (src ? tablesOf(src.schema)[0]?.id : undefined) ?? '', columns: [], mode: 'all' },
                  })
                }
              >
                ＋ 帶入來源明細
              </button>
            )}
          </div>
        );
      })}
      {rules.length < MAX_RULES && (
        <button type="button" className={smallBtn} onClick={() => emit([...rules, { form: sourceForms[0]?.key ?? '' }])}>
          ＋ 來源表單
        </button>
      )}
      <p className="text-xs text-td-muted">
        申請人只能選自己申請、已核准的來源單據；新單據併入來源的案件，同一案件每張表單只能建立一次（撤回的也算）。
      </p>
    </div>
  );
}
