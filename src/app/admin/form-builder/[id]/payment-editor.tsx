'use client';

import type { FieldDef, FormSchema, PaymentLink } from '@/lib/custom-forms/schema';
import { smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { allSchemaFields } from './designer-model';

/**
 * 付款排程 settings: the 付款對象 choice (option codes employee / supplier)
 * plus the optional 發票月份 / 期望付款日 fields. The schema parser checks
 * types and required flags when the draft is saved.
 */
export function PaymentEditor({ schema, setSchema }: { schema: FormSchema; setSchema: (s: FormSchema) => void }) {
  const link = schema.payment;
  const fields = allSchemaFields(schema);
  const choices = fields.filter((f): f is Extract<FieldDef, { type: 'select' | 'radio' }> => f.type === 'select' || f.type === 'radio');
  const months = fields.filter((f) => f.type === 'text' && f.format === 'year_month');
  const dates = fields.filter((f) => f.type === 'date');

  const update = (next: PaymentLink | undefined) => {
    const out = { ...schema };
    if (next) out.payment = next;
    else delete out.payment;
    setSchema(out);
  };
  const enable = () =>
    update({
      payeeType: choices.find((f) => f.options.some((o) => o.value === 'supplier'))?.id ?? choices[0]?.id ?? '',
      invoiceMonth: months[0]?.id ?? null,
      expectedPaymentDate: dates[0]?.id ?? null,
    });

  const optional = (label: string, key: 'invoiceMonth' | 'expectedPaymentDate', list: FieldDef[], hint: string) => (
    <Field label={label}>
      <select className={smallInput} value={link?.[key] ?? ''} onChange={(e) => update({ ...link!, [key]: e.target.value || null })}>
        <option value="">（不使用）</option>
        {list.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-td-muted">{hint}</p>
    </Field>
  );

  return (
    <div className="border-t border-dashed border-td-border pt-3">
      <label className="flex items-start gap-2 text-td-blue-dark">
        <input type="checkbox" className="mt-1" checked={!!link} onChange={(e) => (e.target.checked ? enable() : update(undefined))} />
        <span>
          付款排程
          <span className="block text-xs text-td-muted">
            送出時：期望付款日留空則依發票月份帶入次月 25 日；再依付款對象排入撥款批次（廠商每月 25 日，員工每月 15 日／30 日），顯示於詳情頁。
          </span>
        </span>
      </label>
      {link && (
        <div className="mt-3 space-y-2">
          <Field label="付款對象">
            <select className={smallInput} value={link.payeeType} onChange={(e) => update({ ...link, payeeType: e.target.value })}>
              <option value="">選擇欄位</option>
              {choices.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-td-muted">下拉選單或單選、必填、不設顯示條件；選項代碼為 employee 與 supplier</p>
          </Field>
          {optional('發票月份', 'invoiceMonth', months, '格式為「年月（YYYY-MM）」的文字欄位')}
          {optional('期望付款日', 'expectedPaymentDate', dates, '日期欄位')}
        </div>
      )}
    </div>
  );
}
