'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FieldRow, Info, Req, inputCls } from '@/app/components/form-fields';
import { AddRowButton, TrashButton, cellInputCls, tdCls, thCls } from '@/app/components/line-item-table';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { reviseInvoiceSealRequest, submitInvoiceSealRequest } from '@/lib/invoice-seals/actions';
import {
  BUSINESS_TAX_RATE,
  INVOICE_CURRENCIES,
  INVOICE_SEALS,
  INVOICE_TYPES,
  MAX_INVOICE_LINES,
} from '@/lib/invoice-seals/constants';
import { lineAmount, parseInvoiceSealInput, type InvoiceItemInput, type InvoiceSealInput } from '@/lib/invoice-seals/validate';
import { centsToNumber, type Cents } from '@/lib/money';
import type { SealPartyOptions } from '@/lib/seal-requests/queries';
import { SealPartyRow, SealReminderBlock, SealSubmitBar, sendSealForm, type SealFormMode } from '../seal-form-parts';

const NO_FILES = '請上傳開立依據（合約或報價單）';
const REMINDER = '完成線上簽核流程後，請印出核准之用印申請單，連同開立依據，提供給會計，謝謝。';

const emptyItem = (currency = 'TWD'): InvoiceItemInput => ({ itemName: '', quantity: '', currency, unitPrice: '' });
const fmt = (cents: number) => centsToNumber(cents as Cents).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const toInput = (cents: number) => String(centsToNumber(cents as Cents));

export function InvoiceSealForm({
  currentEmployee,
  parties,
  applicationDate,
  mode,
  initial,
}: {
  currentEmployee: { id: string; departmentId: string };
  parties: SealPartyOptions;
  applicationDate: string;
  mode: SealFormMode;
  initial?: InvoiceSealInput;
}) {
  const router = useRouter();
  const [party, setParty] = useState({
    applicantEmployeeId: initial?.applicantEmployeeId ?? currentEmployee.id,
    departmentId: initial?.departmentId ?? currentEmployee.departmentId,
  });
  const [invoiceType, setInvoiceType] = useState<string>(initial?.invoiceType ?? INVOICE_TYPES[0].code);
  const [seal, setSeal] = useState<string>(initial?.seal ?? INVOICE_SEALS[0].code);
  const [customer, setCustomer] = useState({
    customerName: initial?.customerName ?? '',
    customerTaxId: initial?.customerTaxId ?? '',
    customerAddress: initial?.customerAddress ?? '',
    customerPhone: initial?.customerPhone ?? '',
  });
  const [items, setItems] = useState<InvoiceItemInput[]>(initial?.items ?? [emptyItem()]);
  const [totalAmount, setTotalAmount] = useState(initial?.totalAmount ?? '');
  const [files, setFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existingAttachments = mode.kind === 'create' ? 0 : mode.existingAttachmentCount;
  const amounts = useMemo(() => items.map(lineAmount), [items]);
  const untaxed = amounts.every((a) => a !== null) ? amounts.reduce<number>((sum, a) => sum + a!, 0) : null;
  const currency = items[0]?.currency ?? 'TWD';
  const singleCurrency = items.every((it) => it.currency === currency);
  // Uniform invoices are issued in whole NT dollars.
  const taxed = currency === 'TWD' && invoiceType !== 'export_invoice' && untaxed !== null
    ? Math.round((untaxed * (1 + BUSINESS_TAX_RATE)) / 100) * 100
    : null;

  const setCustomerField = (key: keyof typeof customer, value: string) => setCustomer((c) => ({ ...c, [key]: value }));
  const setItem = (i: number, patch: Partial<InvoiceItemInput>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const onSubmit = async () => {
    setError(null);
    const input: InvoiceSealInput = { ...party, invoiceType, seal, ...customer, items, totalAmount };
    const parsed = parseInvoiceSealInput(input);
    if (!parsed.ok) return setError(parsed.error);
    if (files.length + existingAttachments === 0) return setError(NO_FILES);

    setSubmitting(true);
    const result = await sendSealForm({
      mode,
      input,
      files,
      idempotencyKey,
      submit: submitInvoiceSealRequest,
      revise: reviseInvoiceSealRequest,
    });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    const failed = result.attachmentErrors.length;
    router.push(`/seal-requests/invoices/${result.sealRequestId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  return (
    <div className="card !p-0">
      <h1 className="px-5 py-4 text-xl font-bold text-td-blue-dark">用印申請單(開立發票/Invoice)</h1>

      <SealPartyRow value={party} onChange={setParty} parties={parties} applicationDate={applicationDate} />

      <FieldRow cols={2}>
        <Field label="發票形式" required>
          <select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} className={`${inputCls} !bg-white`}>
            {INVOICE_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="印鑑名稱" required>
          <select value={seal} onChange={(e) => setSeal(e.target.value)} className={`${inputCls} !bg-white`}>
            {INVOICE_SEALS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="客戶名稱" required>
          <input
            value={customer.customerName}
            onChange={(e) => setCustomerField('customerName', e.target.value)}
            placeholder="請輸入文字"
            className={inputCls}
          />
        </Field>
        <Field label="客戶統編" required hint="對象為個人或國外客戶不須提供，請填0">
          <input
            value={customer.customerTaxId}
            onChange={(e) => setCustomerField('customerTaxId', e.target.value.trim())}
            placeholder="請輸入文字"
            inputMode="numeric"
            maxLength={8}
            className={inputCls}
          />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="客戶地址" required>
          <input
            value={customer.customerAddress}
            onChange={(e) => setCustomerField('customerAddress', e.target.value)}
            placeholder="請輸入文字"
            className={inputCls}
          />
        </Field>
        <Field label="客戶電話" required>
          <input
            value={customer.customerPhone}
            onChange={(e) => setCustomerField('customerPhone', e.target.value)}
            placeholder="請輸入文字"
            inputMode="tel"
            className={inputCls}
          />
        </Field>
      </FieldRow>

      <section className="border-t border-dashed border-td-border px-5 py-6">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">開立資訊</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className={`${thCls} w-10`} />
                <th className={`${thCls} w-10`}>#</th>
                <th className={thCls}>
                  品名<Req />
                </th>
                <th className={`${thCls} w-28`}>
                  數量<Req />
                </th>
                <th className={`${thCls} w-36`}>
                  幣別<Req />
                </th>
                <th className={`${thCls} w-40`}>
                  未稅單價<Req />
                  <Info text="不含營業稅的單價；數量 × 未稅單價 = 未稅金額。" />
                </th>
                <th className={`${thCls} w-40`}>未稅金額</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className={`${tdCls} text-center`}>
                    <TrashButton
                      onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={items.length === 1}
                    />
                  </td>
                  <td className={`${tdCls} text-center text-sm text-td-muted`}>{i + 1}</td>
                  <td className={tdCls}>
                    <input value={it.itemName} onChange={(e) => setItem(i, { itemName: e.target.value })} placeholder="請輸入文字" className={cellInputCls} />
                  </td>
                  <td className={tdCls}>
                    <input
                      value={it.quantity}
                      onChange={(e) => setItem(i, { quantity: e.target.value })}
                      placeholder="0"
                      inputMode="numeric"
                      className={`${cellInputCls} text-right`}
                    />
                  </td>
                  <td className={tdCls}>
                    <select value={it.currency} onChange={(e) => setItem(i, { currency: e.target.value })} className={`${cellInputCls} !bg-white`}>
                      {INVOICE_CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdCls}>
                    <input
                      value={it.unitPrice}
                      onChange={(e) => setItem(i, { unitPrice: e.target.value })}
                      placeholder="0"
                      inputMode="decimal"
                      className={`${cellInputCls} text-right`}
                    />
                  </td>
                  <td className={`${tdCls} text-right text-sm font-medium text-td-blue-dark`}>
                    {amounts[i] === null ? <span className="text-slate-400">0</span> : fmt(amounts[i]!)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!singleCurrency && <p className="mt-2 text-xs text-red-600">同一張發票的品項幣別需一致</p>}
        <AddRowButton
          onClick={() => setItems((prev) => [...prev, emptyItem(prev[prev.length - 1]?.currency)])}
          disabled={items.length >= MAX_INVOICE_LINES}
        />
      </section>

      <FieldRow cols={2}>
        <Field label="含稅總計" required hint="客戶為臺灣公司，請填含稅總額">
          <input
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            placeholder="0"
            inputMode="decimal"
            className={inputCls}
          />
          {untaxed !== null && untaxed > 0 && singleCurrency && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-td-muted">
              <span>
                未稅金額合計 {currency} {fmt(untaxed)}
                {taxed !== null && `；加 5% 營業稅為 ${fmt(taxed)}`}
              </span>
              <button
                type="button"
                onClick={() => setTotalAmount(toInput(taxed ?? untaxed))}
                className="font-medium text-td-blue hover:underline"
              >
                帶入{taxed !== null ? '含稅金額' : '未稅合計'}
              </button>
            </p>
          )}
        </Field>
        <Field label="開立依據(一個檔案上限2MB，可上傳多個檔案)" required hint="合約或報價單">
          <PendingFilesField files={files} onChange={setFiles} existingCount={existingAttachments} />
        </Field>
      </FieldRow>

      <div className="border-t border-dashed border-td-border">
        <SealReminderBlock text={REMINDER} />
      </div>

      <SealSubmitBar mode={mode} error={error} submitting={submitting} onSubmit={onSubmit} />
    </div>
  );
}
