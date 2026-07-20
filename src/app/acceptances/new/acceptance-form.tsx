'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAcceptance, updateAcceptance } from '@/lib/acceptances/actions';

export function AcceptanceForm({
  purchaseOrderId,
  items,
  suppliers,
  mode = 'create',
  acceptanceId,
  initialValues,
}: {
  purchaseOrderId: string;
  items: { id: string; description: string; quantity: number }[];
  suppliers: { id: string; name: string }[];
  mode?: 'create' | 'edit';
  acceptanceId?: string;
  initialValues?: {
    contractorSupplierId: string;
    acceptanceDate: string;
    passFail: Record<string, 'pass' | 'fail'>;
  };
}) {
  const router = useRouter();
  const [contractorSupplierId, setContractorSupplierId] = useState(
    initialValues?.contractorSupplierId ?? suppliers[0]?.id ?? ''
  );
  const [acceptanceDate, setAcceptanceDate] = useState(
    initialValues?.acceptanceDate ?? new Date().toISOString().slice(0, 10)
  );
  const [passFail, setPassFail] = useState<Record<string, 'pass' | 'fail'>>(
    initialValues?.passFail ?? Object.fromEntries(items.map((i) => [i.id, 'pass' as const]))
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result =
      mode === 'edit' && acceptanceId
        ? await updateAcceptance(acceptanceId, {
            contractorSupplierId,
            acceptanceDate,
            items: items.map((i) => ({ acceptanceItemId: i.id, passFail: passFail[i.id] ?? 'pass' })),
          })
        : await createAcceptance({
            purchaseOrderId,
            contractorSupplierId,
            acceptanceDate,
            items: items.map((i) => ({ purchaseOrderItemId: i.id, passFail: passFail[i.id] ?? 'pass' })),
          });
    setSubmitting(false);
    if (result.ok) {
      router.push(
        mode === 'edit' && acceptanceId
          ? `/acceptances/${acceptanceId}`
          : `/acceptances/${(result as unknown as { acceptanceId: string }).acceptanceId}`
      );
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        承攬廠商：
        <select
          value={contractorSupplierId}
          onChange={(e) => setContractorSupplierId(e.target.value)}
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
        驗收日期：
        <input
          type="date"
          value={acceptanceDate}
          onChange={(e) => setAcceptanceDate(e.target.value)}
          className="ml-2 rounded border px-2 py-1"
        />
      </label>

      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded border p-3 text-sm">
          <span className="flex-1">
            {item.description}｜數量 {item.quantity}
          </span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`pass-fail-${item.id}`}
              checked={(passFail[item.id] ?? 'pass') === 'pass'}
              onChange={() => setPassFail((prev) => ({ ...prev, [item.id]: 'pass' }))}
            />
            Pass
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`pass-fail-${item.id}`}
              checked={(passFail[item.id] ?? 'pass') === 'fail'}
              onChange={() => setPassFail((prev) => ({ ...prev, [item.id]: 'fail' }))}
            />
            Fail
          </label>
        </div>
      ))}

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
