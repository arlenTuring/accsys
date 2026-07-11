'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateAcceptanceItemPropertyTag } from '@/lib/acceptances/actions';

export function PropertyTagForm({ itemId, initialValue }: { itemId: string; initialValue: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setError(null);
    setSaving(true);
    const result = await updateAcceptanceItemPropertyTag(itemId, value);
    setSaving(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="財產編號"
        className="w-28 rounded border px-1 py-0.5 text-xs"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
      >
        儲存
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
