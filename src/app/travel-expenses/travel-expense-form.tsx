'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FieldRow, Info, Req, inputCls, readOnlyCls } from '@/app/components/form-fields';
import { AddRowButton, TrashButton, cellInputCls, tdCls, thCls } from '@/app/components/line-item-table';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { centsToNumber, toCents, type Cents } from '@/lib/money';
import { reviseTravelExpense, submitTravelExpense } from '@/lib/travel-expenses/actions';
import { TRAVEL_COST_CATEGORIES, TRAVEL_CURRENCIES } from '@/lib/travel-expenses/constants';
import {
  convertToTwdCents,
  isIsoDate,
  parseRateMicros,
  parseTravelExpenseInput,
  type TravelCostItemInput,
  type TravelExpenseInput,
  type TravelReportItemInput,
} from '@/lib/travel-expenses/validate';
import type { TravelBudgetOption } from '@/lib/travel-expenses/queries';

export type TravelExpenseFormMode =
  | { kind: 'create' }
  | { kind: 'update' | 'resubmit'; travelExpenseId: string; version: number; existingAttachmentCount: number };

const emptyReport = (tripDate = ''): TravelReportItemInput => ({ tripDate, location: '', itinerary: '', timeSlot: '' });
const emptyCost = (): TravelCostItemInput => ({
  expenseDate: '',
  category: '交通費',
  fromStation: '',
  toStation: '',
  mileage: '',
  summary: '',
  currency: 'TWD',
  amount: '',
  exchangeRate: '',
});

const fmtMoney = (n: number) => n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => iso.replaceAll('-', '/');

/** NT$ for one cost row, or null while the row is incomplete. */
function rowTwdCents(row: TravelCostItemInput): Cents | null {
  let amount: Cents;
  try {
    amount = toCents(row.amount.trim());
  } catch {
    return null;
  }
  if (amount <= 0) return null;
  const rate = parseRateMicros(row.currency === 'TWD' ? '1' : row.exchangeRate);
  if (rate === null) return null;
  try {
    return convertToTwdCents(amount, rate);
  } catch {
    return null;
  }
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last && out.length < 50) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function TravelExpenseForm({
  applicantName,
  departmentName,
  formDate,
  budgetOptions,
  mode,
  initial,
}: {
  applicantName: string;
  departmentName: string;
  formDate: string;
  budgetOptions: TravelBudgetOption[];
  mode: TravelExpenseFormMode;
  initial?: TravelExpenseInput;
}) {
  const router = useRouter();
  const [budgetCodeId, setBudgetCodeId] = useState(initial?.budgetCodeId ?? budgetOptions[0]?.id ?? '');
  const [advanceAmount, setAdvanceAmount] = useState(initial?.advanceAmount ?? '0');
  const [tripStartDate, setTripStartDate] = useState(initial?.tripStartDate ?? '');
  const [tripEndDate, setTripEndDate] = useState(initial?.tripEndDate ?? '');
  const [purpose, setPurpose] = useState(initial?.purpose ?? '');
  const [tripOrderNo, setTripOrderNo] = useState(initial?.tripOrderNo ?? '');
  const [companions, setCompanions] = useState(initial?.companions ?? '');
  const [reportItems, setReportItems] = useState<TravelReportItemInput[]>(initial?.reportItems ?? [emptyReport()]);
  const [costItems, setCostItems] = useState<TravelCostItemInput[]>(initial?.costItems ?? [emptyCost()]);
  const [files, setFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existingAttachments = mode.kind === 'create' ? 0 : mode.existingAttachmentCount;

  const rowTotals = useMemo(() => costItems.map(rowTwdCents), [costItems]);
  const totalCents = rowTotals.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  const advanceCents = (() => {
    try {
      return advanceAmount.trim() === '' ? 0 : toCents(advanceAmount.trim());
    } catch {
      return 0;
    }
  })();
  const balance = centsToNumber((totalCents - advanceCents) as Cents);

  const setReport = (i: number, patch: Partial<TravelReportItemInput>) =>
    setReportItems((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const setCost = (i: number, patch: Partial<TravelCostItemInput>) =>
    setCostItems((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const canFillDays = isIsoDate(tripStartDate) && isIsoDate(tripEndDate) && tripEndDate >= tripStartDate;
  const fillDays = () => {
    if (!canFillDays) return;
    setReportItems((prev) => {
      const filled = prev.filter((r) => r.location || r.itinerary || r.timeSlot);
      const have = new Set(filled.map((r) => r.tripDate));
      const added = daysBetween(tripStartDate, tripEndDate)
        .filter((d) => !have.has(d))
        .map((d) => emptyReport(d));
      return [...filled, ...added].sort((a, b) => a.tripDate.localeCompare(b.tripDate));
    });
  };

  const onSubmit = async () => {
    setError(null);
    const input: TravelExpenseInput = {
      budgetCodeId,
      advanceAmount,
      tripStartDate,
      tripEndDate,
      purpose,
      tripOrderNo,
      companions,
      reportItems,
      costItems,
    };
    if (!budgetCodeId) return setError('請選擇預算來源');
    const parsed = parseTravelExpenseInput(input);
    if (!parsed.ok) return setError(parsed.error);
    if (files.length + existingAttachments === 0) return setError('請上傳至少一個附件（報支單據、購票證明等）');

    const formData = new FormData();
    formData.set(
      'payload',
      JSON.stringify(mode.kind === 'create' ? { ...input, idempotencyKey } : { ...input, expectedVersion: mode.version })
    );
    for (const f of files) formData.append('files', f);

    setSubmitting(true);
    const result =
      mode.kind === 'create'
        ? await submitTravelExpense(formData)
        : await reviseTravelExpense(mode.travelExpenseId, mode.kind, formData);
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    const failed = result.attachmentErrors.length;
    router.push(`/travel-expenses/${result.travelExpenseId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  const submitLabel = mode.kind === 'create' ? '確認送出' : mode.kind === 'update' ? '儲存修改並重新送簽' : '重新送出';

  return (
    <div className="card !p-0">
      <h1 className="border-b border-td-border px-5 py-4 text-xl font-bold text-td-blue-dark">出差報告暨旅費報支單</h1>

      <div className="grid divide-y divide-dashed divide-td-border md:grid-cols-3 md:divide-x md:divide-y-0">
        <Field label="申請人" required>
          <input value={applicantName} readOnly className={readOnlyCls} />
        </Field>
        <Field label="部門" required>
          <input value={departmentName} readOnly className={readOnlyCls} />
        </Field>
        <Field label="填表日期" required>
          <input value={fmtDate(formDate)} readOnly className={readOnlyCls} />
        </Field>
      </div>

      <FieldRow cols={2}>
        <Field label="預算來源" required hint="專案(簡稱)/部門+預算負責人">
          {budgetOptions.length === 0 ? (
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">目前沒有可用的預算來源，請聯絡財會建立預算編號。</p>
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
        <Field label="預支金額" hint="如於出差前已先向公司暫借旅費，請填入暫借之金額">
          <input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={advanceAmount}
            onChange={(e) => setAdvanceAmount(e.target.value)}
            className={inputCls}
          />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="出差期間" required>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={tripStartDate}
              onChange={(e) => {
                setTripStartDate(e.target.value);
                if (!tripEndDate || e.target.value > tripEndDate) setTripEndDate(e.target.value);
              }}
              className={inputCls}
              aria-label="出差起始日"
            />
            <span className="text-td-muted">~</span>
            <input
              type="date"
              value={tripEndDate}
              min={tripStartDate || undefined}
              onChange={(e) => setTripEndDate(e.target.value)}
              className={inputCls}
              aria-label="出差結束日"
            />
          </div>
        </Field>
        <Field label="出差事由" required>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="請輸入文字" className={inputCls} />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="本人核准之公出差旅單編號" required>
          <input value={tripOrderNo} onChange={(e) => setTripOrderNo(e.target.value)} placeholder="請輸入文字" className={inputCls} />
        </Field>
        <Field label="同行者名字及核准之公出差旅單編號" required hint="若沒有同行者，請填入「無」">
          <textarea
            value={companions}
            onChange={(e) => setCompanions(e.target.value)}
            placeholder="請輸入文字"
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </Field>
      </FieldRow>

      <section className="border-t border-dashed border-td-border px-5 py-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">出差報告</h2>
          {canFillDays && (
            <button type="button" onClick={fillDays} className="text-xs font-medium text-td-blue hover:underline">
              依出差期間帶入每日日期
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className={`${thCls} w-10`} />
                <th className={`${thCls} w-10`}>#</th>
                <th className={`${thCls} w-44`}>
                  日期<Req />
                </th>
                <th className={thCls}>
                  出差地<Req />
                </th>
                <th className={thCls}>
                  行程說明<Req />
                </th>
                <th className={`${thCls} w-44`}>
                  出差時間區段<Req />
                </th>
              </tr>
            </thead>
            <tbody>
              {reportItems.map((r, i) => (
                <tr key={i}>
                  <td className={`${tdCls} text-center`}>
                    <TrashButton
                      onClick={() => setReportItems((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={reportItems.length === 1}
                    />
                  </td>
                  <td className={`${tdCls} text-center text-sm text-td-muted`}>{i + 1}</td>
                  <td className={tdCls}>
                    <input
                      type="date"
                      value={r.tripDate}
                      min={tripStartDate || undefined}
                      max={tripEndDate || undefined}
                      onChange={(e) => setReport(i, { tripDate: e.target.value })}
                      className={cellInputCls}
                    />
                  </td>
                  <td className={tdCls}>
                    <input value={r.location} onChange={(e) => setReport(i, { location: e.target.value })} placeholder="請輸入文字" className={cellInputCls} />
                  </td>
                  <td className={tdCls}>
                    <input value={r.itinerary} onChange={(e) => setReport(i, { itinerary: e.target.value })} placeholder="請輸入文字" className={cellInputCls} />
                  </td>
                  <td className={tdCls}>
                    <input
                      value={r.timeSlot}
                      onChange={(e) => setReport(i, { timeSlot: e.target.value })}
                      placeholder="例：09:00-18:00"
                      className={cellInputCls}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddRowButton onClick={() => setReportItems((prev) => [...prev, emptyReport()])} disabled={reportItems.length >= 50} />
      </section>

      <section className="border-t border-dashed border-td-border px-5 py-6">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">出差旅費結算</h2>
        <div className="overflow-x-auto pb-1">
          <table className="w-full min-w-[1280px] border-collapse">
            <thead>
              <tr>
                <th className={`${thCls} w-10`} />
                <th className={`${thCls} w-10`}>#</th>
                <th className={`${thCls} w-40`}>
                  日期<Req />
                </th>
                <th className={`${thCls} w-32`}>
                  類別<Req />
                  <Info text="交通費請填起訖站（自行開車請填里程）；住宿費、膳雜費與其他費用不需填起訖站。" />
                </th>
                <th className={`${thCls} w-32`}>起站</th>
                <th className={`${thCls} w-32`}>迄站</th>
                <th className={`${thCls} w-24`}>里程</th>
                <th className={thCls}>
                  摘要<Req />
                  <Info text="簡述費用內容，例如：高鐵台北－左營、○○飯店住宿 2 晚、計程車往返客戶端。" />
                </th>
                <th className={`${thCls} w-32`}>
                  幣別<Req />
                  <Info text="國外出差以實際支付的幣別填寫，並填入匯率，系統會自動換算新臺幣金額。" />
                </th>
                <th className={`${thCls} w-32`}>
                  金額<Req />
                </th>
                <th className={`${thCls} w-28`}>匯率</th>
                <th className={`${thCls} w-32`}>新臺幣金額</th>
              </tr>
            </thead>
            <tbody>
              {costItems.map((c, i) => {
                const isTransport = c.category === '交通費';
                const isTwd = c.currency === 'TWD';
                const twd = rowTotals[i];
                return (
                  <tr key={i}>
                    <td className={`${tdCls} text-center`}>
                      <TrashButton
                        onClick={() => setCostItems((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={costItems.length === 1}
                      />
                    </td>
                    <td className={`${tdCls} text-center text-sm text-td-muted`}>{i + 1}</td>
                    <td className={tdCls}>
                      <input type="date" value={c.expenseDate} onChange={(e) => setCost(i, { expenseDate: e.target.value })} className={cellInputCls} />
                    </td>
                    <td className={tdCls}>
                      <select
                        value={c.category}
                        onChange={(e) =>
                          setCost(
                            i,
                            e.target.value === '交通費'
                              ? { category: e.target.value }
                              : { category: e.target.value, fromStation: '', toStation: '', mileage: '' }
                          )
                        }
                        className={`${cellInputCls} !bg-white`}
                      >
                        {TRAVEL_COST_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <input
                        value={c.fromStation}
                        onChange={(e) => setCost(i, { fromStation: e.target.value })}
                        placeholder="請輸入文字"
                        disabled={!isTransport}
                        className={cellInputCls}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        value={c.toStation}
                        onChange={(e) => setCost(i, { toStation: e.target.value })}
                        placeholder="請輸入文字"
                        disabled={!isTransport}
                        className={cellInputCls}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={c.mileage}
                        onChange={(e) => setCost(i, { mileage: e.target.value })}
                        placeholder="0"
                        disabled={!isTransport}
                        className={`${cellInputCls} text-right`}
                      />
                    </td>
                    <td className={tdCls}>
                      <input value={c.summary} onChange={(e) => setCost(i, { summary: e.target.value })} placeholder="請輸入文字" className={cellInputCls} />
                    </td>
                    <td className={tdCls}>
                      <select
                        value={c.currency}
                        onChange={(e) => setCost(i, { currency: e.target.value, exchangeRate: e.target.value === 'TWD' ? '' : c.exchangeRate })}
                        className={`${cellInputCls} !bg-white`}
                      >
                        {TRAVEL_CURRENCIES.map((cur) => (
                          <option key={cur.code} value={cur.code}>
                            {cur.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={c.amount}
                        onChange={(e) => setCost(i, { amount: e.target.value })}
                        placeholder="0"
                        className={`${cellInputCls} text-right`}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        inputMode="decimal"
                        value={isTwd ? '1' : c.exchangeRate}
                        onChange={(e) => setCost(i, { exchangeRate: e.target.value })}
                        placeholder="例：32.15"
                        disabled={isTwd}
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
        <AddRowButton onClick={() => setCostItems((prev) => [...prev, emptyCost()])} disabled={costItems.length >= 50} />
      </section>

      <FieldRow cols={2}>
        <Field label="合計" required>
          <input value={fmtMoney(centsToNumber(totalCents as Cents))} readOnly className={`${readOnlyCls} text-right font-semibold`} />
          {advanceCents > 0 && (
            <p className="mt-2 text-xs text-td-muted">
              已預支 NT$ {fmtMoney(centsToNumber(advanceCents as Cents))}，
              {balance >= 0 ? (
                <span className="font-semibold text-td-blue-dark">公司應補發 NT$ {fmtMoney(balance)}</span>
              ) : (
                <span className="font-semibold text-status-returned">應退還公司 NT$ {fmtMoney(-balance)}</span>
              )}
            </p>
          )}
        </Field>
        <Field
          label="附件(一個檔案上限2MB，可上傳多個檔案)"
          required
          hint="請上傳相關費用報支附件 (以悠遊卡等搭乘大眾交通工具者，請檢附購票證明；國外差旅請附上機票、登機證、購票證明/收據)"
        >
          <PendingFilesField files={files} onChange={setFiles} existingCount={existingAttachments} />
        </Field>
      </FieldRow>

      <div className="border-t border-dashed border-td-border px-5 py-5">
        <p className="text-sm font-semibold text-td-blue-dark">提醒</p>
        <p className="mt-2 text-sm text-td-blue-dark">完成線上簽核流程後，請印出核准之出差報告暨旅費報支單，連同原始附件繳交給會計做帳，謝謝。</p>
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
