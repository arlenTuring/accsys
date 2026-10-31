'use client';

import { useState } from 'react';
import { restoreOriginalAction, startStagedCheckAction } from '@/lib/ai-chat/actions-staged-invoice';
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
  files: DraftAttachedFile[];
  /** A saved edit, a restore or a recheck changed the draft. */
  onChanged?: () => void;
};

/** Files copied from chat staging onto this draft (server-backed). */
export function DraftAttachedFiles({ draftId, files, onChanged }: Props) {
  const [editing, setEditing] = useState<DraftAttachedFile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (files.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-td-border bg-slate-50/80 px-3 py-2 text-sm">
        <p className="font-semibold text-td-blue-dark">已夾帶預覽</p>
        <p className="mt-1 text-xs text-td-muted">
          尚無檔案。在對話中選檔後按「確認並檢查」，通過後預覽會出現在這裡。
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-xl border border-td-border bg-white px-3 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-td-blue-dark">已夾帶預覽（{files.length}）</p>
        <p className="text-xs text-td-muted">送出時會寫入正式單據</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="草稿已夾帶附件">
        {files.map((f) => {
          const href = f.href ?? `/api/ai-chat/draft-files/${draftId}/${f.id}`;
          const isHeic = /^image\/hei[cf]/.test(f.mimeType);
          const isImage = isHeic || /^image\/(jpeg|png|webp)/.test(f.mimeType);
          return (
            <li
              key={f.id}
              className="flex flex-col overflow-hidden rounded-lg border border-td-border bg-slate-50 text-xs"
            >
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="relative flex h-24 items-center justify-center bg-slate-100"
                title="預覽／開啟"
              >
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${href}?preview=1&v=${f.activeEditId ?? 'orig'}`} alt={f.fileName} className="h-full w-full object-cover" />
                ) : (
                  <span className="px-2 text-center text-td-muted">
                    {f.mimeType.includes('pdf') ? 'PDF' : '檔案'}
                  </span>
                )}
              </a>
              <div className="space-y-0.5 p-2">
                <p className="truncate font-medium text-td-blue-dark" title={f.fileName}>
                  {f.fileName}
                </p>
                <p className="text-td-muted">
                  {formatBytesLabel(f.fileSizeBytes)}
                  {f.activeEditId ? ' · 已編輯' : ''}
                </p>
                {f.activeEditId && (
                  <a className="underline" href={`${href}?original=1${isHeic ? '&preview=1' : ''}`} target="_blank" rel="noreferrer">
                    看原圖
                  </a>
                )}
                {f.sourceStagedId && f.checkState === 'none' && (
                  <p className="text-amber-800">
                    圖片已變更，先前的 AI 檢查已失效。
                    <button
                      type="button"
                      className="ml-1 underline"
                      disabled={busy === f.id}
                      onClick={async () => {
                        setBusy(f.id);
                        await startStagedCheckAction({ stagedIds: [f.sourceStagedId!], targetDraftId: draftId });
                        setBusy(null);
                        onChanged?.();
                      }}
                    >
                      重新檢查
                    </button>
                  </p>
                )}
                {f.checkState === 'running' && <p className="text-td-muted">AI 檢查中…（重新載入草稿可看結果）</p>}
                {f.checkState === 'done' && f.checkSummary && <p className="text-td-muted">{f.checkSummary}</p>}
                {isImage && !f.href && (
                  <div className="flex gap-2 pt-0.5">
                    <button type="button" className="underline" onClick={() => setEditing(f)}>
                      編輯
                    </button>
                    {f.activeEditId && (
                      <button
                        type="button"
                        className="underline"
                        disabled={busy === f.id}
                        onClick={async () => {
                          setBusy(f.id);
                          await restoreOriginalAction({ kind: 'draft_file', sourceId: f.id });
                          setBusy(null);
                          onChanged?.();
                        }}
                      >
                        還原原圖
                      </button>
                    )}
                  </div>
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
