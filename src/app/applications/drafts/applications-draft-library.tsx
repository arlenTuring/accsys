'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import {
  abandonDraftAction,
  duplicateDraftAction,
  listDraftLibraryAction,
  repairDraftAttachmentCopyAction,
} from '@/lib/ai-chat/actions';

export function ApplicationsDraftLibrary() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'draft' | 'submitted' | 'all'>('draft');
  const [items, setItems] = useState<
    Array<{
      id: string;
      title: string;
      formKey: string;
      status: string;
      version: number;
      updatedAt: string;
      summary: string;
    }>
  >([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reload(offset = 0) {
    start(async () => {
      const res = await listDraftLibraryAction({ query, status, offset });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
    });
  }

  useEffect(() => {
    const t = window.setTimeout(() => reload(0), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status]);

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[12rem] flex-1 rounded border px-3 py-2 text-sm"
          placeholder="搜尋標題或表單類型"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜尋草稿"
        />
        {(
          [
            ['draft', '草稿'],
            ['submitted', '已送出'],
            ['all', '全部'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={status === v ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
            onClick={() => setStatus(v)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-amber-800">{error}</p>}
      {pending && items.length === 0 && <p className="text-sm text-td-muted">載入中…</p>}
      {!pending && !error && items.length === 0 && (
        <p className="text-sm text-td-muted">沒有符合條件的草稿。</p>
      )}
      <ul className="divide-y divide-td-border">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-td-blue-dark">{item.title}</p>
              <p className="text-xs text-td-muted">
                {item.formKey} · {item.status} · 更新{' '}
                {new Date(item.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
              </p>
              {item.summary && <p className="line-clamp-2 text-sm text-td-muted">{item.summary}</p>}
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {item.status === 'draft' && (
                <>
                  <Link className="btn-primary text-xs" href={`/applications/drafts/${item.id}`}>
                    開啟編輯
                  </Link>
                  <Link
                    className="btn-secondary text-xs"
                    href={`/tools/ai-chat?draft=${encodeURIComponent(item.id)}`}
                  >
                    交給 AI 繼續
                  </Link>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() =>
                      start(async () => {
                        const res = await duplicateDraftAction({ draftId: item.id });
                        if (!res.ok) setError(res.error);
                        else reload(0);
                      })
                    }
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() =>
                      start(async () => {
                        if (!window.confirm('確定放棄此草稿？')) return;
                        const res = await abandonDraftAction({ draftId: item.id });
                        if (!res.ok) setError(res.error);
                        else reload(0);
                      })
                    }
                  >
                    放棄
                  </button>
                </>
              )}
              {item.status === 'submitted' && (
                <>
                  <Link className="underline" href={`/applications/drafts/${item.id}`}>
                    查看
                  </Link>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() =>
                      start(async () => {
                        const res = await repairDraftAttachmentCopyAction({ draftId: item.id });
                        if (!res.ok) setError(res.error);
                        else if (res.copyFailures > 0) setError(`仍有 ${res.copyFailures} 個附件複製失敗，請到單據頁補傳。`);
                        else setError(null);
                      })
                    }
                  >
                    重試附件複製
                  </button>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() =>
                      start(async () => {
                        const res = await duplicateDraftAction({ draftId: item.id });
                        if (!res.ok) setError(res.error);
                        else reload(0);
                      })
                    }
                  >
                    複製為新草稿
                  </button>
                </>
              )}
              {item.status !== 'draft' && item.status !== 'submitted' && (
                <Link className="underline" href={`/applications/drafts/${item.id}`}>
                  查看
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {items.length < total && (
        <button type="button" className="text-sm underline" onClick={() => reload(items.length)}>
          載入更多
        </button>
      )}
    </div>
  );
}
