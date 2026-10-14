'use client';

import { useRef, useState } from 'react';
import { BATCH_FILE_MAX_BYTES, BATCH_TOTAL_MAX_BYTES } from '@/lib/attachments/batch';
import { MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/validate';

const ALLOWED_EXT = /\.(pdf|png|jpe?g)$/i;

export const fmtFileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Files picked (click, drag and drop, or +) to be sent together with a form.
 * Checks extension and size in the browser; the server re-checks the bytes.
 */
export function PendingFilesField({
  files,
  onChange,
  existingCount = 0,
  maxFiles = MAX_ATTACHMENTS_PER_FORM,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  existingCount?: number;
  maxFiles?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (!ALLOWED_EXT.test(f.name)) {
        setError(`「${f.name}」格式不支援，請上傳 PDF、PNG 或 JPG`);
        continue;
      }
      if (f.size > BATCH_FILE_MAX_BYTES) {
        setError(`「${f.name}」超過 2 MB 上限（${fmtFileSize(f.size)}）`);
        continue;
      }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
    }
    if (existingCount + next.length > maxFiles) {
      setError(`附件最多 ${maxFiles} 個`);
      return;
    }
    if (next.reduce((s, f) => s + f.size, 0) > BATCH_TOTAL_MAX_BYTES) {
      setError('單次送出的附件合計不可超過 10 MB，其餘請送出後於明細頁補傳');
      return;
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            add(e.dataTransfer.files);
          }}
          className={`flex flex-1 items-center gap-3 rounded border border-dashed px-4 py-2.5 text-left text-sm transition ${
            dragOver ? 'border-td-apex bg-td-apex-light' : 'border-td-apex/70 hover:bg-td-apex-light/60'
          }`}
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-td-apex-dark">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
              <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
            檔案上傳
          </span>
          <span className="text-td-muted">檔案大小上限2MB，可拖曳多個檔案到此處</span>
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title="新增檔案"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-lg leading-none text-td-blue-dark hover:bg-slate-200"
        >
          +
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => add(e.target.files)}
        />
      </div>
      <p className="mt-2 text-xs text-td-muted">
        格式：PDF、PNG、JPG（單檔 2 MB 以內，每張表單最多 {maxFiles} 個檔案）
      </p>
      {existingCount > 0 && (
        <p className="mt-1 text-xs text-td-muted">此表單已有 {existingCount} 個附件，可在明細頁查看；這裡可再補充新檔案。</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-td-border rounded border border-td-border">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate text-td-blue-dark">{f.name}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-td-muted">
                {fmtFileSize(f.size)}
                <button
                  type="button"
                  onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                  className="text-slate-400 hover:text-red-600"
                  aria-label={`移除 ${f.name}`}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
