'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { syncDefaultRegulationsAction } from '@/lib/regulations/actions';

export function SyncDriveRegulationsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function handleSync() {
    setMsg(null);
    startTransition(async () => {
      const res = await syncDefaultRegulationsAction();
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      if (res.inserted > 0) {
        setMsg(`已從公司 Google Drive 補齊 ${res.inserted} 份規章並同步至 AI 知識庫！`);
      } else {
        setMsg(`全部 ${res.totalDefaults} 份 Google Drive 核心規章皆已在庫，並已刷新 AI 索引。`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {msg && <span className="text-xs font-medium text-emerald-700">{msg}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={handleSync}
        className="btn-secondary text-sm"
      >
        {pending ? '同步中…' : '同步 Google Drive 規章庫 & 刷新 AI 索引'}
      </button>
    </div>
  );
}
