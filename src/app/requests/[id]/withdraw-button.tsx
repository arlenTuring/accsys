'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmDialog } from '@/app/components/dialog';

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
    if (!(await confirmDialog({ title: '撤回這張表單？', message: '撤回後需重新填寫送出。', confirmLabel: '撤回', tone: 'danger' }))) return;
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
        className="btn border border-red-200 bg-white text-red-700 hover:bg-red-50"
      >
        {busy ? '撤回中…' : '撤回'}
      </button>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
