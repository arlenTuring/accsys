'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPurchaseRequest, updatePurchaseRequest } from '@/lib/purchase-requests/actions';

export type BudgetCodeOption = {
  id: string;
  code: string;
  category: string;
  departmentName: string;
  ownerId: string;
  ownerName: string;
};

type Row = {
  budgetCodeId: string;
  itemCategory: string;
  description: string;
  quantity: string;
  estimatedAmount: string;
};

const emptyRow: Row = {
  budgetCodeId: '',
  itemCategory: '',
  description: '',
  quantity: '1',
  estimatedAmount: '',
};

export function PurchaseRequestForm({
  budgetCodes,
  mode = 'create',
  requestId,
  initialNeededWithinDays,
  initialRows,
  expectedVersion,
}: {
  budgetCodes: BudgetCodeOption[];
  mode?: 'create' | 'edit';
  requestId?: string;
  initialNeededWithinDays?: number | null;
  initialRows?: Row[];
  /** Version the edit started from; the server refuses stale edits. */
  expectedVersion?: number;
}) {
  const router = useRouter();
  // One key per form instance: a double submit or retry cannot create a second request.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState<Row[]>(initialRows ?? [{ ...emptyRow }]);
  const [neededWithinDays, setNeededWithinDays] = useState(
    initialNeededWithinDays != null ? String(initialNeededWithinDays) : '30'
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const byId = new Map(budgetCodes.map((b) => [b.id, b]));

  const setRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const onPickBudget = (index: number, budgetCodeId: string) => {
    const bc = byId.get(budgetCodeId);
    setRow(index, { budgetCodeId, itemCategory: bc?.category ?? '' });
  };

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const payload = {
      neededWithinDays: neededWithinDays === '' ? null : Number(neededWithinDays),
      items: rows.map((r) => ({
        budgetCodeId: r.budgetCodeId,
        description: r.description,
        quantity: Number(r.quantity),
        // Sent as the typed decimal string; the server converts it to exact cents.
        estimatedAmount: r.estimatedAmount.trim(),
      })),
    };
    const result =
      mode === 'edit' && requestId
        ? await updatePurchaseRequest(requestId, { ...payload, expectedVersion: expectedVersion ?? 0 })
        : await createPurchaseRequest({ ...payload, idempotencyKey });
    setSubmitting(false);
    if (result.ok) {
      router.push(
        mode === 'edit' && requestId
          ? `/requests/${requestId}`
          : `/requests/${(result as unknown as { requestId: string }).requestId}`
      );
    } else {
      setError(result.error);
    }
  };

  const total = rows.reduce((sum, r) => sum + (Number(r.estimatedAmount) || 0), 0);

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        預計需求天數：
        <input
          type="number"
          value={neededWithinDays}
          onChange={(e) => setNeededWithinDays(e.target.value)}
          className="ml-2 w-24 rounded border px-2 py-1"
        />
      </label>

      {rows.map((row, i) => {
        const bc = byId.get(row.budgetCodeId);
        const amount = Number(row.estimatedAmount) || 0;
        const materialWarning = row.itemCategory === '材料' && amount >= 80000;
        return (
          <div key={i} className="space-y-2 rounded border p-3">
            <div className="flex items-center gap-2">
              <span className="w-8 text-sm text-gray-500">第 {i + 1} 項</span>
              <select
                value={row.budgetCodeId}
                onChange={(e) => onPickBudget(i, e.target.value)}
                className="flex-1 rounded border px-2 py-1"
              >
                <option value="">選擇預算編號</option>
                {budgetCodes.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}｜{b.category}｜{b.departmentName}｜負責人：{b.ownerName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <span className="flex w-24 items-center rounded border bg-gray-50 px-2 py-1 text-sm text-gray-600">
                {row.itemCategory || '項目'}
              </span>
              <input
                value={row.description}
                onChange={(e) => setRow(i, { description: e.target.value })}
                placeholder="說明"
                className="flex-1 rounded border px-2 py-1"
              />
              <input
                type="number"
                value={row.quantity}
                onChange={(e) => setRow(i, { quantity: e.target.value })}
                placeholder="數量"
                className="w-20 rounded border px-2 py-1"
              />
              <input
                type="number"
                value={row.estimatedAmount}
                onChange={(e) => setRow(i, { estimatedAmount: e.target.value })}
                placeholder="預估費用"
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
            {bc && <p className="text-xs text-gray-500">預算負責人：{bc.ownerName}</p>}
            {materialWarning && (
              <p className="text-xs text-amber-600">
                提醒：未稅金額達 80,000 以上、且非隨車出售者，項目應選「設備」。
              </p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
        className="rounded border px-3 py-1 text-sm"
      >
        + 新增一項
      </button>

      <p className="text-right font-semibold">總計：NT$ {total.toLocaleString()}</p>

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
