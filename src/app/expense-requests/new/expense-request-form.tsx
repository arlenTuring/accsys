'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createExpenseRequest, updateExpenseRequest } from '@/lib/expense-requests/actions';

export function ExpenseRequestForm({
  purchaseOrderId,
  sourceItems,
  suppliers,
  mode = 'create',
  expenseRequestId,
  initialValues,
}: {
  purchaseOrderId: string;
  sourceItems: { id: string; description: string; amount: number }[];
  suppliers: { id: string; name: string }[];
  mode?: 'create' | 'edit';
  expenseRequestId?: string;
  initialValues?: {
    payeeType: 'employee' | 'supplier';
    payeeSupplierId: string;
    paymentMethod: string;
    bankName: string;
    bankAccount: string;
    accountName: string;
    invoiceMonth: string;
    expectedPaymentDate: string;
    included: Record<string, boolean>;
  };
}) {
  const router = useRouter();
  const [payeeType, setPayeeType] = useState<'employee' | 'supplier'>(initialValues?.payeeType ?? 'supplier');
  const [payeeSupplierId, setPayeeSupplierId] = useState(initialValues?.payeeSupplierId ?? suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState(initialValues?.paymentMethod ?? '匯款');
  const [bankName, setBankName] = useState(initialValues?.bankName ?? '');
  const [bankAccount, setBankAccount] = useState(initialValues?.bankAccount ?? '');
  const [accountName, setAccountName] = useState(initialValues?.accountName ?? '');
  const [invoiceMonth, setInvoiceMonth] = useState(initialValues?.invoiceMonth ?? '');
  const [expectedPaymentDate, setExpectedPaymentDate] = useState(initialValues?.expectedPaymentDate ?? '');
  const [included, setIncluded] = useState<Record<string, boolean>>(
    initialValues?.included ?? Object.fromEntries(sourceItems.map((i) => [i.id, true]))
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = sourceItems.filter((i) => included[i.id]).reduce((sum, i) => sum + i.amount, 0);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const payload = {
      payeeType,
      payeeSupplierId: payeeType === 'supplier' ? payeeSupplierId : null,
      paymentMethod,
      bankName: payeeType === 'employee' ? bankName : null,
      bankAccount: payeeType === 'employee' ? bankAccount : null,
      accountName: payeeType === 'employee' ? accountName : null,
      invoiceMonth: invoiceMonth.trim() === '' ? null : invoiceMonth,
      expectedPaymentDate: expectedPaymentDate.trim() === '' ? null : expectedPaymentDate,
      includedSourceItemIds: sourceItems.filter((i) => included[i.id]).map((i) => i.id),
    };
    const result =
      mode === 'edit' && expenseRequestId
        ? await updateExpenseRequest(expenseRequestId, payload)
        : await createExpenseRequest({ purchaseOrderId, ...payload });
    setSubmitting(false);
    if (result.ok) {
      router.push(
        mode === 'edit' && expenseRequestId
          ? `/expense-requests/${expenseRequestId}`
          : `/expense-requests/${(result as unknown as { expenseRequestId: string }).expenseRequestId}`
      );
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-4">
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
        發票月份（YYYY-MM，未填期望付款日時用來推算預設日期）：
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

      <div className="space-y-2">
        {sourceItems.map((item) => (
          <label key={item.id} className="flex items-center gap-2 rounded border p-3 text-sm">
            <input
              type="checkbox"
              checked={included[item.id] ?? false}
              onChange={(e) => setIncluded((prev) => ({ ...prev, [item.id]: e.target.checked }))}
            />
            <span className="flex-1">{item.description}</span>
            <span>NT$ {item.amount.toLocaleString()}</span>
          </label>
        ))}
      </div>

      <p className="text-right font-semibold">總計：NT$ {total.toLocaleString()}</p>

      <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
        送出前請自行核對發票/收據買受人抬頭：「台灣智慧駕駛股份有限公司」統編 50773141（國外廠商為
        TURING DRIVE INC.）。系統無法自動判讀單據影像內容，僅提醒您自行檢查。
      </p>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? '送出中…' : mode === 'edit' ? '儲存修改' : '送出簽核'}
      </button>
    </div>
  );
}
