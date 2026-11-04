'use client';

import { useState, useTransition } from 'react';
import { removeDraftFileAction } from '@/lib/ai-chat/actions';
import { formatBytesLabel } from '@/lib/attachments/policy';
import { PhotoEditor } from './photo-editor';

export type DraftAttachedFile = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  attachedAt: string;
  sourceStagedId?: string | null;
  activeEditId?: string | null;
  checkState?: 'none' | 'running' | 'done';
  checkSummary?: string | null;
  /** Approved-document PDF: opened through its own link, not editable. */
  href?: string;
};

type Props = {
  draftId: string;
  draftVersion: number;
  conversationId: string;
  files: DraftAttachedFile[];
  /** A saved edit, a restore or a remove changed the draft. */
  onChanged?: (info?: { version?: number }) => void;
};

/** Compact draft attachment cards: thumb, name, size, edit, ×. */
export function DraftAttachedFiles({ draftId, draftVersion, conversationId, files, onChanged }: Props) {
  const [editing, setEditing] = useState<DraftAttachedFile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (files.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-td-border bg-slate-50/80 px-3 py-2 text-sm">
        <p className="font-semibold text-td-blue-dark">附件</p>
        <p className="mt-1 text-xs text-td-muted">
          尚無檔案。在對話選檔後會自動壓縮並檢查，再按「加入附件」。
        </p>
      </section>
    );
  }

  function removeOne(file: DraftAttachedFile) {
    setError(null);
    setBusyId(file.id);
    start(async () => {
      const res = await removeDraftFileAction({
        conversationId,
        draftId,
        expectedVersion: draftVersion,
        fileId: file.id,
      });
      setBusyId(null);
      if (!res.ok) {
        setError(res.message ?? res.error);
        return;
      }
      onChanged?.({ version: res.draft.version });
    });
  }

  return (
    <section className="space-y-2 rounded-xl border border-td-border bg-white px-3 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-td-blue-dark">附件（{files.length}）</p>
        <div className="flex items-center gap-2 text-xs">
          <p className="text-td-muted">送出時寫入正式單據</p>
          <button
            type="button"
            className="underline"
            disabled={pending || busyId !== null}
            onClick={() => {
              if (!window.confirm(`確定移除這張草稿的全部 ${files.length} 個附件？`)) return;
              setError(null);
              setBusyId('all');
              start(async () => {
                const res = await removeDraftFileAction({
                  conversationId,
                  draftId,
                  expectedVersion: draftVersion,
                  removeAll: true,
                });
                setBusyId(null);
                if (!res.ok) {
                  setError(res.message ?? res.error);
                  return;
                }
                onChanged?.({ version: res.draft.version });
              });
            }}
          >
            移除全部
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-amber-800">
          {error}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="草稿已夾帶附件">
        {files.map((f) => {
          const href = f.href ?? `/api/ai-chat/draft-files/${draftId}/${f.id}`;
          const isHeic = /^image\/hei[cf]/.test(f.mimeType);
          const isImage = isHeic || /^image\/(jpeg|png|webp)/.test(f.mimeType);
          const busy = busyId === f.id || pending;
          return (
            <li
              key={f.id}
              className="relative flex flex-col overflow-hidden rounded-lg border border-td-border bg-slate-50 text-xs"
            >
              <button
                type="button"
                className="absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/90 text-base text-white disabled:opacity-50"
                aria-label={`移除附件 ${f.fileName}`}
                disabled={busy || !!f.href}
                title={f.href ? '核准文件請用對話工具移除' : '移除'}
                onClick={() => removeOne(f)}
              >
                {busyId === f.id ? '…' : '×'}
              </button>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="relative flex h-24 items-center justify-center bg-slate-100"
                title="預覽／開啟"
              >
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${href}?preview=1&v=${f.activeEditId ?? 'orig'}`}
                    alt={f.fileName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="px-2 text-center text-td-muted">
                    {f.mimeType.includes('pdf') ? 'PDF' : '檔案'}
                  </span>
                )}
              </a>
              <div className="space-y-1 p-2">
                <p className="truncate font-medium text-td-blue-dark" title={f.fileName}>
                  {f.fileName}
                </p>
                <p className="text-td-muted">{formatBytesLabel(f.fileSizeBytes)}</p>
                {isImage && !f.href && (
                  <button type="button" className="underline" onClick={() => setEditing(f)}>
                    編輯
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <PhotoEditor
          target={{
            kind: 'draft_file',
            sourceId: editing.id,
            fileName: editing.fileName,
            originalUrl: `/api/ai-chat/draft-files/${draftId}/${editing.id}?original=1&preview=1`,
          }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
