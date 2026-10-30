'use client';

import { formatBytesLabel } from '@/lib/attachments/policy';

export type DraftAttachedFile = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  attachedAt: string;
};

type Props = {
  draftId: string;
  files: DraftAttachedFile[];
};

/** Files copied from chat staging onto this draft (server-backed). */
export function DraftAttachedFiles({ draftId, files }: Props) {
  if (files.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-td-border bg-slate-50/80 px-3 py-2 text-sm">
        <p className="font-semibold text-td-blue-dark">已夾帶預覽</p>
        <p className="mt-1 text-xs text-td-muted">
          尚無檔案。左側圖片就緒後按「夾入右側草稿」，預覽會出現在這裡。
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
          const href = `/api/ai-chat/draft-files/${draftId}/${f.id}`;
          const isImage = /^image\/(jpeg|png|webp)/.test(f.mimeType);
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
                  <img src={href} alt="" className="h-full w-full object-cover" />
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
                <p className="text-td-muted">{formatBytesLabel(f.fileSizeBytes)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
