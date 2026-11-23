'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TwoTierBudgetSelect } from '@/app/components/two-tier-budget-select';
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

  const lineTotal = (r: Row) => {
    const qty = Number(r.quantity);
    const unit = Number(r.estimatedAmount);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unit) || unit <= 0) return 0;
    return Math.round(qty * unit * 100) / 100;
  };

  const onSubmit = async () => {
    setError(null);
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      const qty = Number(r.quantity);
      const unit = Number(r.estimatedAmount);
      if (r.quantity.trim() !== '' && Number.isFinite(qty) && qty < 0) {
        setError(`第 ${i + 1} 項的「數量」不可為負數（目前輸入：${r.quantity}），請修改為正整數`);
        return;
      }
      if (r.estimatedAmount.trim() !== '' && Number.isFinite(unit) && unit < 0) {
        setError(`第 ${i + 1} 項的「單價」不可為負數（目前輸入：${r.estimatedAmount}），請修改為正數`);
        return;
      }
    }
    setSubmitting(true);
    const payload = {
      neededWithinDays: neededWithinDays === '' ? null : Number(neededWithinDays),
      items: rows.map((r) => {
        const subtotal = lineTotal(r);
        return {
          budgetCodeId: r.budgetCodeId,
          description: r.description,
          quantity: Number(r.quantity),
          // Sent as the computed subtotal (quantity * unitPrice) decimal string; the server converts it to exact cents.
          estimatedAmount: subtotal > 0 ? String(subtotal) : '0',
        };
      }),
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

  const total = rows.reduce((sum, r) => sum + lineTotal(r), 0);

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        預計需求天數：
        <input
          type="number"
          min="1"
          value={neededWithinDays}
          onKeyDown={(e) => {
            if (e.key === '-' || e.key === '－' || e.key === 'e' || e.key === 'E') e.preventDefault();
          }}
          onChange={(e) => setNeededWithinDays(e.target.value.replace(/[-－]/g, ''))}
          className="ml-2 w-24 rounded border px-2 py-1"
        />
      </label>

      {rows.map((row, i) => {
        const bc = byId.get(row.budgetCodeId);
        const amount = lineTotal(row);
        const materialWarning = row.itemCategory === '材料' && amount >= 80000;
        return (
          <div key={i} className="space-y-2 rounded border p-3">
            <div className="flex items-center gap-2">
              <span className="w-8 text-sm text-gray-500">第 {i + 1} 項</span>
              <div className="flex-1">
                <TwoTierBudgetSelect
                  value={row.budgetCodeId}
                  onChange={(val) => onPickBudget(i, val)}
                  options={budgetCodes.map((b) => ({
                    id: b.id,
                    label: `${b.code}｜${b.category}｜${b.departmentName}｜負責人：${b.ownerName}`,
                    groupName: b.departmentName || '通用預算',
                    itemLabel: `${b.category}｜${b.code}（負責人：${b.ownerName}）`,
                  }))}
                  className="w-full rounded border px-2 py-1"
                  ariaLabel={`第 ${i + 1} 項預算編號`}
                  compact
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex w-24 items-center rounded border bg-gray-50 px-2 py-1 text-sm text-gray-600">
                {row.itemCategory || '項目'}
              </span>
              <input
                value={row.description}
                onChange={(e) => setRow(i, { description: e.target.value })}
                placeholder="說明"
                className="min-w-[180px] flex-1 rounded border px-2 py-1"
              />
              <input
                type="number"
                min="1"
                value={row.quantity}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === '－' || e.key === 'e' || e.key === 'E') e.preventDefault();
                }}
                onChange={(e) => setRow(i, { quantity: e.target.value.replace(/[-－]/g, '') })}
                placeholder="數量"
                aria-label={`第 ${i + 1} 項數量`}
                className="w-20 rounded border px-2 py-1"
              />
              <span className="text-sm text-gray-400">×</span>
              <input
                type="number"
                min="0"
                step="any"
                value={row.estimatedAmount}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === '－' || e.key === 'e' || e.key === 'E') e.preventDefault();
                }}
                onChange={(e) => setRow(i, { estimatedAmount: e.target.value.replace(/[-－]/g, '') })}
                placeholder="單價"
                aria-label={`第 ${i + 1} 項單價`}
                className="w-32 rounded border px-2 py-1"
              />
              <span className="min-w-[110px] text-right text-sm font-medium text-gray-700">
                小計：NT$ {amount.toLocaleString()}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  className="rounded border px-2 py-1 text-sm"
                >
                  移除
                </button>
              )}
            </div>
            {bc && <p className="text-xs text-gray-500">預算負責人：{bc.ownerName}</p>}
            {row.quantity.trim() !== '' && Number(row.quantity) < 0 && (
              <p className="text-xs text-red-600">
                ⚠️ 第 {i + 1} 項的「數量」不可為負數（目前輸入：{row.quantity}），請修改為正整數
              </p>
            )}
            {row.estimatedAmount.trim() !== '' && Number(row.estimatedAmount) < 0 && (
              <p className="text-xs text-red-600">
                ⚠️ 第 {i + 1} 項的「單價」不可為負數（目前輸入：{row.estimatedAmount}），請修改為正數
              </p>
            )}
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
