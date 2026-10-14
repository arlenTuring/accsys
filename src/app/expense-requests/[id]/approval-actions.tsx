'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveExpenseRequestStep,
  returnExpenseRequestStep,
} from '@/lib/expense-requests/actions';

export function ApprovalActions({ expenseRequestId, version }: { expenseRequestId: string; version: number }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onApprove = async () => {
    setBusy(true);
    setError(null);
    const result = await approveExpenseRequestStep(expenseRequestId, version);
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  const onReturn = async () => {
    if (reason.trim() === '') {
      setError('請填寫退回原因');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await returnExpenseRequestStep(expenseRequestId, reason, version);
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <section className="rounded border border-blue-200 bg-blue-50 p-4">
      <h2 className="mb-2 font-semibold">您是目前的簽核人</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="rounded bg-green-600 px-4 py-2 text-white disabled:opacity-50"
        >
          核准
        </button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="退回原因"
          className="flex-1 rounded border px-2 py-1"
        />
        <button
          type="button"
          onClick={onReturn}
          disabled={busy}
          className="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
        >
          退回
        </button>
      </div>
    </section>
  );
}
