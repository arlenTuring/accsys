import type { ReactNode } from 'react';
import { isDisplayOnly, type FieldDef, type FormSchema, type TableColumn } from '@/lib/custom-forms/schema';
import type { TableValue } from '@/lib/custom-forms/validate';

const SPAN: Record<1 | 2 | 3 | 4, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4' };

/** Whole amounts without decimals (like the other forms), otherwise always two: 35.50, not 35.5. */
export function amountText(v: unknown): string {
  const n = Number(v);
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const money = (v: unknown, currency = 'NT$') => (v === null || v === undefined || v === '' ? '—' : `${currency} ${amountText(v)}`);

/** Currency label of a money / table field: the picked code when it has a currency field, else NT$. */
const currencyOf = (field: FieldDef, data: Record<string, unknown> | undefined) => {
  const code = field.currencyField ? data?.[field.currencyField] : undefined;
  return typeof code === 'string' && code ? code : 'NT$';
};
const day = (v: unknown) => (typeof v === 'string' && v ? v.replaceAll('-', '/') : '—');

function cellText(col: TableColumn, v: unknown, row: Record<string, unknown>, labels: Record<string, string>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (col.type === 'employee' || col.type === 'asset') return labels[String(v)] ?? '（資料已移除）';
  if (col.type === 'money') {
    const code = col.currencyColumn ? row[col.currencyColumn] : undefined;
    return typeof code === 'string' && code ? `${code} ${amountText(v)}` : amountText(v);
  }
  if (col.type === 'date') return day(v);
  if (col.type === 'select') return col.options?.find((o) => o.value === v)?.label ?? String(v);
  return String(v);
}

/** One stored value as display text (unknown option codes and missing references show as-is). */
export function fieldText(field: FieldDef, v: unknown, labels: Record<string, string>, data?: Record<string, unknown>): ReactNode {
  switch (field.type) {
    case 'money':
      return money(v, currencyOf(field, data));
    case 'date':
      return day(v);
    case 'select':
    case 'radio':
      return field.options.find((o) => o.value === v)?.label ?? (v ? String(v) : '—');
    case 'checkboxes': {
      const list = Array.isArray(v) ? v : [];
      return list.length ? list.map((x) => field.options.find((o) => o.value === x)?.label ?? String(x)).join('、') : '—';
    }
    case 'boolean':
      return v === true ? field.trueLabel : field.falseLabel;
    case 'employee':
    case 'department':
    case 'budget_code':
    case 'project':
    case 'supplier':
    case 'asset':
      return typeof v === 'string' && v ? (labels[v] ?? '（資料已移除）') : '—';
    case 'number':
      return v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
    default:
      return typeof v === 'string' && v ? v : '—';
  }
}

function TableView({
  field,
  value,
  currency,
  labels,
}: {
  field: Extract<FieldDef, { type: 'table' }>;
  value: TableValue | undefined;
  currency: string;
  labels: Record<string, string>;
}) {
  const rows = value?.rows ?? [];
  if (rows.length === 0) return <p className="text-sm text-td-muted">—</p>;
  const totalIndex = field.totalColumn ? field.columns.findIndex((c) => c.id === field.totalColumn) : -1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs text-td-muted">
            <th className="w-10 border border-td-border px-2 py-1.5">#</th>
            {field.columns.map((c) => (
              <th key={c.id} className="border border-td-border px-2 py-1.5 text-left font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="border border-td-border px-2 py-1.5 text-center text-td-muted">{i + 1}</td>
              {field.columns.map((c) => (
                <td key={c.id} className={`border border-td-border px-2 py-1.5 ${c.type === 'money' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}>
                  {cellText(c, r[c.id], r, labels)}
                </td>
              ))}
            </tr>
          ))}
          {totalIndex >= 0 && (
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={totalIndex + 1} className="border border-td-border px-3 py-2 text-right">
                合計
              </td>
              <td className="border border-td-border px-2 py-2 text-right tabular-nums">
                {field.columns[totalIndex].type === 'money' ? money(value?.total, currency) : String(value?.total ?? '—')}
              </td>
              {totalIndex < field.columns.length - 1 && <td colSpan={field.columns.length - totalIndex - 1} className="border border-td-border" />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Read-only fields of a submission; fields that were hidden when it was submitted have no value and are skipped. */
export function SubmissionFields({ schema, data, labels }: { schema: FormSchema; data: Record<string, unknown>; labels: Record<string, string> }) {
  return (
    <>
      {schema.sections.map((section) => {
        const fields = section.fields.filter((f) => !isDisplayOnly(f) && f.id in data);
        if (fields.length === 0) return null;
        return (
          <section key={section.id} className="card">
            {section.title && <h2 className="mb-4 font-semibold text-td-blue-dark">{section.title}</h2>}
            <dl className="grid gap-x-8 gap-y-4 md:grid-cols-4">
              {fields.map((f) => (
                <div key={f.id} className={SPAN[f.type === 'table' ? 4 : f.width]}>
                  <dt className="text-xs font-semibold text-td-muted">{f.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-td-blue-dark">
                    {f.type === 'table' ? (
                      <TableView field={f} value={data[f.id] as TableValue | undefined} currency={currencyOf(f, data)} labels={labels} />
                    ) : (
                      fieldText(f, data[f.id], labels, data)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </>
  );
}
