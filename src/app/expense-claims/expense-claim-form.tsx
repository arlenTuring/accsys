'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FieldRow, Info, Req, inputCls, readOnlyCls } from '@/app/components/form-fields';
import { AddRowButton, TrashButton, cellInputCls, tdCls, thCls } from '@/app/components/line-item-table';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { reviseExpenseClaim, submitExpenseClaim } from '@/lib/expense-claims/actions';
import {
  MAX_EXPENSE_CLAIM_LINES,
  NO_REMITTANCE,
  PAYEE_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  filingDeadline,
  suggestPaymentDate,
  type PayeeType,
} from '@/lib/expense-claims/constants';
import { EDITIONS, type ExpenseEdition } from '@/lib/expense-claims/editions';
import type { ExpenseBudgetOption, PayeeSupplierOption } from '@/lib/expense-claims/queries';
import {
  parseExpenseClaimInput,
  rowTwdCents,
  type ExpenseClaimInput,
  type ExpenseClaimItemInput,
} from '@/lib/expense-claims/validate';
import { centsToNumber, type Cents } from '@/lib/money';
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';
import { TRAVEL_CURRENCIES } from '@/lib/travel-expenses/constants';
import { isIsoDate } from '@/lib/travel-expenses/validate';

export type ExpenseClaimFormMode =
  | { kind: 'create' }
  | { kind: 'update' | 'resubmit'; claimId: string; version: number; existingAttachmentCount: number };

const NOTICES = [
  '發票或收據買受人需為台灣智慧駕駛股份有限公司、統一編號為50773141，國外INVOICE或RECEIPT買受人需為TURING DRIVE INC.。',
  '賣方名稱、統一編號、地址、電話應清晰可辨認；發票或收據若有書寫錯誤、塗改或模糊不清者均無效，需請賣方重新開立。',
  '數量乘以單價應等於總金額並應與中文大寫金額相同；發票和免用統一發票收據的總計中文大寫處，請寫"零壹貳參肆伍陸柒捌玖"。',
  '各式憑證請另外拿紙黏貼並附於費用申請單之後，憑證重要資訊請勿覆蓋。',
  '費用申請單每項填寫單一憑證資訊，並於原始憑證註記項次以便查詢，切勿合併填寫。',
];

const fmtMoney = (n: number) => n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => iso.replaceAll('-', '/');

export function ExpenseClaimForm({
  edition,
  applicantName,
  today,
  applicationDate,
  departments,
  budgetOptions,
  suppliers,
  mode,
  initial,
}: {
  edition: ExpenseEdition;
  applicantName: string;
  today: string;
  applicationDate: string;
  departments: { id: string; name: string }[];
  budgetOptions: ExpenseBudgetOption[];
  suppliers: PayeeSupplierOption[];
  mode: ExpenseClaimFormMode;
  initial: Pick<ExpenseClaimInput, 'departmentId'> & Partial<ExpenseClaimInput>;
}) {
  const router = useRouter();
  const config = EDITIONS[edition];
  const followsDepartment = config.budgetScope === 'department';
  const budgetFor = (departmentId: string) => {
    if (!followsDepartment) return undefined;
    const name = departments.find((d) => d.id === departmentId)?.name;
    return budgetOptions.find((b) => b.scopeName === name)?.id;
  };
  const emptyItem = (): ExpenseClaimItemInput => ({
    category: config.categories[0],
    description: '',
    currency: 'TWD',
    exchangeRate: '1',
    amount: '',
  });
  const initialPayee = (initial.payeeType as PayeeType | undefined) ?? config.defaultPayee;

  const departmentId = initial.departmentId;
  const [budgetCodeId, setBudgetCodeId] = useState(
    initial.budgetCodeId ?? budgetFor(initial.departmentId) ?? budgetOptions[0]?.id ?? ''
  );
  const [items, setItems] = useState<ExpenseClaimItemInput[]>(initial.items ?? [emptyItem()]);
  const [remark, setRemark] = useState(initial.remark ?? '');
  const [payeeType, setPayeeType] = useState<PayeeType>(initialPayee);
  const [payeeSupplierId, setPayeeSupplierId] = useState(initial.payeeSupplierId ?? '');
  const [expectedPaymentDate, setExpectedPaymentDate] = useState(
    initial.expectedPaymentDate ?? suggestPaymentDate(today, initialPayee)
  );
  const [paymentMethod, setPaymentMethod] = useState(initial.paymentMethod ?? 'transfer');
  const [remittanceInfo, setRemittanceInfo] = useState(initial.remittanceInfo ?? '');
  const [files, setFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existingAttachments = mode.kind === 'create' ? 0 : mode.existingAttachmentCount;
  const rowTotals = useMemo(() => items.map(rowTwdCents), [items]);
  const totalCents = rowTotals.reduce<number>((sum, c) => sum + (c ?? 0), 0);

  const suggested = suggestPaymentDate(today, payeeType);
  const deadline = isIsoDate(expectedPaymentDate) ? filingDeadline(expectedPaymentDate) : null;
  const deadlinePassed = deadline !== null && deadline < today;

  const setItem = (i: number, patch: Partial<ExpenseClaimItemInput>) =>
    setItems((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const changePayee = (next: PayeeType) => {
    if (expectedPaymentDate === suggestPaymentDate(today, payeeType)) setExpectedPaymentDate(suggestPaymentDate(today, next));
    setPayeeType(next);
    if (next === 'applicant') setPayeeSupplierId('');
  };

  const changeMethod = (next: string) => {
    setPaymentMethod(next);
    if (next !== 'transfer' && remittanceInfo.trim() === '') setRemittanceInfo(NO_REMITTANCE);
    if (next === 'transfer' && remittanceInfo.trim() === NO_REMITTANCE) setRemittanceInfo('');
  };

  const onSubmit = async () => {
    setError(null);
    const input: ExpenseClaimInput = {
      departmentId,
      budgetCodeId,
      items,
      remark,
      payeeType,
      payeeSupplierId,
      expectedPaymentDate,
      paymentMethod,
      remittanceInfo,
    };
    if (!departmentId) return setError('請選擇申請部門');
    if (!budgetCodeId) return setError('請選擇預算來源');
    const parsed = parseExpenseClaimInput(edition, input, today);
    if (!parsed.ok) return setError(parsed.error);
    if (files.length + existingAttachments === 0) return setError('請上傳相關費用報支附件');

    const formData = new FormData();
    formData.set(
      'payload',
      JSON.stringify(mode.kind === 'create' ? { ...input, idempotencyKey } : { ...input, expectedVersion: mode.version })
    );
    for (const f of files) formData.append('files', f);

    setSubmitting(true);
    const result =
      mode.kind === 'create'
        ? await submitExpenseClaim(edition, formData)
        : await reviseExpenseClaim(edition, mode.claimId, mode.kind, formData);
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    const failed = result.attachmentErrors.length;
    router.push(`${FORM_ROUTE_PREFIX[config.formType]}/${result.claimId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  const submitLabel = mode.kind === 'create' ? '確認送出' : mode.kind === 'update' ? '儲存修改並重新送簽' : '重新送出';

  return (
    <div className="card !p-0">
      <h1 className="border-b border-td-border px-5 py-4 text-xl font-bold text-td-blue-dark">{config.label}</h1>

      <div className="grid divide-y divide-dashed divide-td-border md:grid-cols-2 md:divide-x md:divide-y-0">
        <Field label="申請日期" required>
          <input value={fmtDate(applicationDate)} readOnly className={readOnlyCls} />
        </Field>
        <Field label="申請人" required>
          <input value={applicantName} readOnly className={readOnlyCls} />
        </Field>
      </div>

      <FieldRow cols={2}>
        <Field label="申請部門" required hint="申請人所屬部門，部門主管為第一關簽核人">
          <input value={departments.find((d) => d.id === departmentId)?.name ?? ''} readOnly aria-label="申請部門" className={readOnlyCls} />
        </Field>
        <Field label="預算來源" required hint={config.budgetHint}>
          {budgetOptions.length === 0 ? (
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
              目前沒有可用的{followsDepartment ? '部門' : '專案'}預算，請聯絡財會建立預算編號。
            </p>
          ) : (
            <select value={budgetCodeId} onChange={(e) => setBudgetCodeId(e.target.value)} className={`${inputCls} !bg-white`}>
              {budgetOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </FieldRow>

      <section className="border-t border-dashed border-td-border px-5 py-6">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">請款內容</h2>
        <div className="overflow-x-auto pb-1">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr>
                <th className={`${thCls} w-10`} />
                <th className={`${thCls} w-10`}>#</th>
                <th className={`${thCls} w-56`}>
                  項目<Req />
                </th>
                <th className={thCls}>
                  內容或說明<Req />
                  <Info text="每列填寫單一憑證，簡述費用內容並註明憑證號碼，例如：10月部門聚餐（發票 AB12345678）。" />
                </th>
                <th className={`${thCls} w-32`}>
                  幣別<Req />
                  <Info text="依憑證上的幣別選擇；外幣請同時填入匯率，系統會自動換算新臺幣小計。" />
                </th>
                <th className={`${thCls} w-28`}>
                  匯率<Req />
                  <Info text="新臺幣固定為 1；外幣請填付款當日或信用卡帳單上的匯率（最多 6 位小數）。" />
                </th>
                <th className={`${thCls} w-36`}>
                  金額<Req />
                </th>
                <th className={`${thCls} w-36`}>小計</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => {
                const isTwd = r.currency === 'TWD';
                const twd = rowTotals[i];
                return (
                  <tr key={i}>
                    <td className={`${tdCls} text-center`}>
                      <TrashButton onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} disabled={items.length === 1} />
                    </td>
                    <td className={`${tdCls} text-center text-sm text-td-muted`}>{i + 1}</td>
                    <td className={tdCls}>
                      <select
                        value={r.category}
                        onChange={(e) => setItem(i, { category: e.target.value })}
                        aria-label={`第 ${i + 1} 列項目`}
                        className={`${cellInputCls} !bg-white`}
                      >
                        {config.categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <input
                        value={r.description}
                        onChange={(e) => setItem(i, { description: e.target.value })}
                        placeholder="請輸入文字"
                        aria-label={`第 ${i + 1} 列內容或說明`}
                        className={cellInputCls}
                      />
                    </td>
                    <td className={tdCls}>
                      <select
                        value={r.currency}
                        onChange={(e) =>
                          setItem(i, { currency: e.target.value, exchangeRate: e.target.value === 'TWD' ? '1' : r.currency === 'TWD' ? '' : r.exchangeRate })
                        }
                        aria-label={`第 ${i + 1} 列幣別`}
                        className={`${cellInputCls} !bg-white`}
                      >
                        {TRAVEL_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        inputMode="decimal"
                        value={isTwd ? '1' : r.exchangeRate}
                        onChange={(e) => setItem(i, { exchangeRate: e.target.value })}
                        placeholder="例：32.15"
                        disabled={isTwd}
                        aria-label={`第 ${i + 1} 列匯率`}
                        className={`${cellInputCls} text-right`}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={r.amount}
                        onChange={(e) => setItem(i, { amount: e.target.value })}
                        placeholder="0"
                        aria-label={`第 ${i + 1} 列金額`}
                        className={`${cellInputCls} text-right`}
                      />
                    </td>
                    <td className={`${tdCls} text-right text-sm font-medium text-td-blue-dark`}>
                      {twd === null ? <span className="text-slate-400">—</span> : fmtMoney(centsToNumber(twd))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <AddRowButton onClick={() => setItems((prev) => [...prev, emptyItem()])} disabled={items.length >= MAX_EXPENSE_CLAIM_LINES} />
      </section>

      <FieldRow cols={2}>
        <Field label="總金額" required>
          <input value={`NT$ ${fmtMoney(centsToNumber(totalCents as Cents))}`} readOnly className={`${readOnlyCls} text-right font-semibold`} />
        </Field>
        <Field label="備註">
          <textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="請輸入文字" rows={3} className={`${inputCls} resize-y`} />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="付款對象" required>
          <select value={payeeType} onChange={(e) => changePayee(e.target.value as PayeeType)} className={`${inputCls} !bg-white`}>
            {Object.entries(PAYEE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {payeeType === 'supplier' && (
            <select
              value={payeeSupplierId}
              onChange={(e) => setPayeeSupplierId(e.target.value)}
              aria-label="付款廠商"
              className={`${inputCls} mt-2 !bg-white`}
            >
              <option value="">請選擇廠商</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="期望付款日"
          required
          hint={
            <>
              1.員工代墊付款日為每月15號與30號、廠商付款日為次月25號。
              <br />
              2.收件截止日為付款前5個工作日。
            </>
          }
        >
          <input
            type="date"
            value={expectedPaymentDate}
            min={today}
            onChange={(e) => setExpectedPaymentDate(e.target.value)}
            aria-label="期望付款日"
            className={inputCls}
          />
          <p className="mt-2 text-xs text-td-muted">
            {deadline && !deadlinePassed && <>收件截止日 {fmtDate(deadline)}。</>}
            {expectedPaymentDate !== suggested && (
              <button type="button" onClick={() => setExpectedPaymentDate(suggested)} className="font-medium text-td-blue hover:underline">
                帶入建議付款日 {fmtDate(suggested)}
              </button>
            )}
          </p>
          {deadlinePassed && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
              此付款日的收件截止日（{fmtDate(deadline!)}）已過，實際付款日可能順延。
            </p>
          )}
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="付款方式" required>
          <select value={paymentMethod} onChange={(e) => changeMethod(e.target.value)} className={`${inputCls} !bg-white`}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="匯款資訊" required hint='請填入"銀行名稱+銀行戶名+銀行帳號"；若不是選擇匯款，請填入"無"'>
          <textarea
            value={remittanceInfo}
            onChange={(e) => setRemittanceInfo(e.target.value)}
            placeholder="例：台灣銀行 信義分行 王小明 012345678901"
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="附件(一個檔案上限2MB，可上傳多個檔案)" required hint="請上傳相關費用報支附件">
          <PendingFilesField files={files} onChange={setFiles} existingCount={existingAttachments} />
        </Field>
        <div className="px-5 py-5">
          <p className="text-sm font-semibold text-td-blue-dark">注意事項</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-td-blue-dark">
            {NOTICES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </div>
      </FieldRow>

      <div className="border-t border-dashed border-td-border px-5 py-5">
        <p className="text-sm font-semibold text-td-blue-dark">提醒</p>
        <p className="mt-2 text-sm text-td-blue-dark">完成線上簽核流程後，請印出核准之費用申請單，連同原始附件繳交給會計做帳，謝謝。</p>
      </div>

      <div className="flex flex-col items-center gap-3 border-t border-dashed border-td-border px-5 py-8">
        {error && <p className="w-full max-w-xl rounded bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || budgetOptions.length === 0}
          className="btn-primary min-w-[160px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '送出中…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
