'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPurchaseOrder } from '@/lib/purchase-orders/actions';
import { classifyItemCategory } from '@/lib/procurement/item-category';
import { requiredQuoteCount } from '@/lib/procurement/quote-requirement';

const PAYMENT_TERMS_OPTIONS = ['預付款', '貨到付款', '月結30天', '月結45天', '月結60天', '其他'];

export function PurchaseOrderForm({
  purchaseRequestId,
  items,
  suppliers,
}: {
  purchaseRequestId: string;
  items: { id: string; description: string; quantity: number; budgetCode: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState('匯款');
  const [paymentTerms, setPaymentTerms] = useState('貨到付款');
  const [expectedDeliveryDays, setExpectedDeliveryDays] = useState('14');
  const [quoteCount, setQuoteCount] = useState('1');
  const [quoteCountReason, setQuoteCountReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = items.reduce((sum, i) => sum + (Number(prices[i.id] ?? 0) || 0) * i.quantity, 0);
  const required = requiredQuoteCount(total);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await createPurchaseOrder({
      purchaseRequestId,
      supplierId,
      paymentMethod,
      paymentTerms,
      expectedDeliveryDays: expectedDeliveryDays === '' ? null : Number(expectedDeliveryDays),
      quoteCount: Number(quoteCount),
      quoteCountReason: quoteCountReason.trim() === '' ? null : quoteCountReason,
      items: items.map((i) => ({
        purchaseRequestItemId: i.id,
        unitPrice: Number(prices[i.id] ?? 0),
      })),
    });
    setSubmitting(false);
    if (result.ok) {
      router.push(`/purchase-orders/${result.orderId}`);
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        預計採購廠商：
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        >
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        付款方式：
        <input
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>
      <label className="block text-sm">
        付款條件：
        <select
          value={paymentTerms}
          onChange={(e) => setPaymentTerms(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        >
          {PAYMENT_TERMS_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        預計交貨天數：
        <input
          type="number"
          value={expectedDeliveryDays}
          onChange={(e) => setExpectedDeliveryDays(e.target.value)}
          className="ml-2 w-24 rounded border px-2 py-1"
        />
      </label>

      {items.map((item) => {
        const unitPrice = Number(prices[item.id] ?? 0) || 0;
        const untaxedAmount = unitPrice * item.quantity;
        const category = classifyItemCategory({ untaxedAmount, soldWithVehicle: false });
        return (
          <div key={item.id} className="space-y-1 rounded border p-3">
            <p className="text-sm">
              {item.budgetCode}｜{item.description}｜數量 {item.quantity}
            </p>
            <input
              type="number"
              value={prices[item.id] ?? ''}
              onChange={(e) => setPrices((prev) => ({ ...prev, [item.id]: e.target.value }))}
              placeholder="單價"
              className="w-32 rounded border px-2 py-1"
            />
            {category === '設備' && untaxedAmount > 0 && (
              <p className="text-xs text-amber-600">
                提醒：未稅金額達 80,000 以上、且非隨車出售者，項目應選「設備」。
              </p>
            )}
          </div>
        );
      })}

      <label className="block text-sm">
        報價單家數：
        <input
          type="number"
          value={quoteCount}
          onChange={(e) => setQuoteCount(e.target.value)}
          className="ml-2 w-20 rounded border px-2 py-1"
        />
        <span className="ml-2 text-xs text-gray-500">
          依採購金額 NT$ {total.toLocaleString()}，門檻為 {required} 家
        </span>
      </label>
      {Number(quoteCount) < required && (
        <label className="block text-sm">
          未檢附其他報價單原因：
          <input
            value={quoteCountReason}
            onChange={(e) => setQuoteCountReason(e.target.value)}
            className="ml-2 w-full rounded border px-2 py-1"
          />
        </label>
      )}

      <p className="text-right font-semibold">總計：NT$ {total.toLocaleString()}</p>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? '送出中…' : '送出簽核'}
      </button>
    </div>
  );
}
