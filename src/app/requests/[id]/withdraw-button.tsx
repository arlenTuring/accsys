'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ActionResult = { ok: true } | { ok: false; error: string };

export function WithdrawButton({
  requestId,
  onWithdraw,
  redirectTo,
}: {
  requestId: string;
  onWithdraw: (id: string) => Promise<ActionResult>;
  redirectTo: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (!window.confirm('確定要撤回這張表單嗎？撤回後需重新填寫送出。')) return;
    setBusy(true);
    setError(null);
    const result = await onWithdraw(requestId);
    setBusy(false);
    if (result.ok) {
      router.push(redirectTo);
    } else {
      setError(result.error);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
      >
        {busy ? '撤回中…' : '撤回'}
      </button>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
