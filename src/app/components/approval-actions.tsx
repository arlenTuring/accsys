'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Result = { ok: true } | { ok: false; error: string };

/** Approve / return panel for the current approver; the server actions re-check everything. */
export function ApprovalActions({
  formId,
  version,
  onApprove,
  onReturn,
}: {
  formId: string;
  version: number;
  onApprove: (id: string, expectedVersion: number) => Promise<Result>;
  onReturn: (id: string, reason: string, expectedVersion: number) => Promise<Result>;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<Result>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <section className="card border-td-blue/30 bg-td-blue-light/40 print:hidden">
      <h2 className="mb-3 font-semibold text-td-blue-dark">您是目前的簽核人</h2>
      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => run(() => onApprove(formId, version))}
          disabled={busy}
          className="btn bg-status-approved text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          核准
        </button>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="退回原因（退回時必填）"
          className="flex-1 rounded border border-td-border bg-white px-3 py-2 text-sm focus:border-td-blue focus:outline-none"
        />
        <button
          type="button"
          onClick={() => (reason.trim() === '' ? setError('請填寫退回原因') : run(() => onReturn(formId, reason, version)))}
          disabled={busy}
          className="btn border border-red-200 bg-white text-red-700 hover:bg-red-50"
        >
          退回
        </button>
      </div>
    </section>
  );
}
