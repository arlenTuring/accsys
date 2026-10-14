'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createStandaloneExpenseRequest } from '@/lib/expense-requests/actions';
import { STANDALONE_EXPENSE_REQUEST_LIMIT } from '@/lib/expense-requests/constants';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';

type Row = { description: string; amount: string };
const emptyRow: Row = { description: '', amount: '' };

export function StandaloneExpenseRequestForm({
  budgetCodes,
  suppliers,
}: {
  budgetCodes: BudgetCodeListItem[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [budgetCodeId, setBudgetCodeId] = useState(budgetCodes[0]?.id ?? '');
  const [payeeType, setPayeeType] = useState<'employee' | 'supplier'>('supplier');
  const [payeeSupplierId, setPayeeSupplierId] = useState(suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState('匯款');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState('');
  const [expectedPaymentDate, setExpectedPaymentDate] = useState('');
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);
  // One key per form instance: a double submit or retry cannot create a second request.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const overLimit = total >= STANDALONE_EXPENSE_REQUEST_LIMIT;

  const setRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await createStandaloneExpenseRequest({
      budgetCodeId,
      payeeType,
      payeeSupplierId: payeeType === 'supplier' ? payeeSupplierId : null,
      paymentMethod,
      bankName: payeeType === 'employee' ? bankName : null,
      bankAccount: payeeType === 'employee' ? bankAccount : null,
      accountName: payeeType === 'employee' ? accountName : null,
      invoiceMonth: invoiceMonth.trim() === '' ? null : invoiceMonth,
      expectedPaymentDate: expectedPaymentDate.trim() === '' ? null : expectedPaymentDate,
      // Decimal strings as typed; the server converts them to exact cents.
      items: rows.map((r) => ({ description: r.description, amount: r.amount.trim() })),
      idempotencyKey,
    });
    setSubmitting(false);
    if (result.ok) {
      router.push(`/expense-requests/${result.expenseRequestId}`);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-4">
      <p className="rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-700">
        免走採購流程：總金額須低於 NT$ {STANDALONE_EXPENSE_REQUEST_LIMIT.toLocaleString()}。
      </p>

      <label className="block text-sm">
        預算編號：
        <select
          value={budgetCodeId}
          onChange={(e) => setBudgetCodeId(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        >
          {budgetCodes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}｜{b.departmentName ?? b.projectName}｜{b.category}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        付款對象：
        <select
          value={payeeType}
          onChange={(e) => setPayeeType(e.target.value as 'employee' | 'supplier')}
          className="ml-2 rounded border px-2 py-1"
        >
          <option value="supplier">廠商</option>
          <option value="employee">員工代墊（本人）</option>
        </select>
      </label>

      {payeeType === 'supplier' ? (
        <label className="block text-sm">
          廠商：
          <select
            value={payeeSupplierId}
            onChange={(e) => setPayeeSupplierId(e.target.value)}
            className="ml-2 rounded border px-2 py-1"
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="block text-sm">
            銀行名稱：
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            銀行帳號：
            <input
              value={bankAccount}
              onChange={(e) => setBankAccount(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            戶名：
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="ml-2 rounded border px-2 py-1"
            />
          </label>
        </>
      )}

      <label className="block text-sm">
        付款方式：
        <input
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>
      <label className="block text-sm">
        發票月份（YYYY-MM）：
        <input
          value={invoiceMonth}
          onChange={(e) => setInvoiceMonth(e.target.value)}
          placeholder="2026-07"
          className="ml-2 rounded border px-2 py-1"
        />
      </label>
      <label className="block text-sm">
        期望付款日：
        <input
          type="date"
          value={expectedPaymentDate}
          onChange={(e) => setExpectedPaymentDate(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>

      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 rounded border p-3">
          <input
            value={row.description}
            onChange={(e) => setRow(i, { description: e.target.value })}
            placeholder="說明"
            className="flex-1 rounded border px-2 py-1"
          />
          <input
            type="number"
            value={row.amount}
            onChange={(e) => setRow(i, { amount: e.target.value })}
            placeholder="金額"
            className="w-32 rounded border px-2 py-1"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              className="rounded border px-2 text-sm"
            >
              移除
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
        className="rounded border px-3 py-1 text-sm"
      >
        + 新增一項
      </button>

      <p className={`text-right font-semibold ${overLimit ? 'text-red-600' : ''}`}>
        總計：NT$ {total.toLocaleString()}
        {overLimit && '（已達門檻，請改用一般採購流程）'}
      </p>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || overLimit}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? '送出中…' : '送出簽核'}
      </button>
    </div>
  );
}
