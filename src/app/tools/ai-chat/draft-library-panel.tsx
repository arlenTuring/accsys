'use client';

import { useEffect, useState, useTransition } from 'react';
import { abandonDraftAction, listDraftLibraryAction } from '@/lib/ai-chat/actions';

type Props = {
  onOpenDraft: (draft: { id: string; title: string; version: number; formKey: string; status: string }) => void;
};

export function DraftLibraryPanel({ onOpenDraft }: Props) {
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
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-td-border p-3">
        <h3 className="text-sm font-semibold text-td-blue-dark">草稿庫</h3>
        <p className="text-xs text-td-muted">草稿是獨立業務資源；關閉頁籤不會刪除草稿。</p>
        <input
          className="w-full rounded-lg border border-td-border px-3 py-2 text-sm"
          placeholder="搜尋名稱或表單類型"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜尋草稿"
        />
        <div className="flex gap-2 text-xs">
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
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {error && <p className="p-2 text-sm text-amber-800">{error}</p>}
        {pending && items.length === 0 && <p className="p-2 text-sm text-td-muted">載入中…</p>}
        {!pending && !error && items.length === 0 && (
          <p className="p-2 text-sm text-td-muted">沒有符合條件的草稿。</p>
        )}
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-td-border px-3 py-2">
              <button
                type="button"
                className="w-full text-left"
                onClick={() =>
                  onOpenDraft({
                    id: item.id,
                    title: item.title,
                    version: item.version,
                    formKey: item.formKey,
                    status: item.status,
                  })
                }
              >
                <div className="text-sm font-medium text-td-blue-dark">{item.title}</div>
                <div className="text-xs text-td-muted">
                  {item.formKey} · {item.status} · v{item.version}
                </div>
              </button>
              {item.status === 'draft' && (
                <button
                  type="button"
                  className="mt-1 text-xs text-amber-800 underline"
                  onClick={async () => {
                    if (!window.confirm('確定放棄此草稿？此操作不可從頁籤關閉復原。')) return;
                    const res = await abandonDraftAction({ draftId: item.id });
                    if (res.ok) reload(0);
                  }}
                >
                  放棄草稿
                </button>
              )}
            </li>
          ))}
        </ul>
        {items.length < total && (
          <button type="button" className="mt-2 w-full text-sm underline" onClick={() => reload(items.length)}>
            載入更多（{items.length}/{total}）
          </button>
        )}
      </div>
    </div>
  );
}
