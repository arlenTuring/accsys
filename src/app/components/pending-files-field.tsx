'use client';

import { useEffect, useRef, useState } from 'react';
import { BATCH_FILE_MAX_BYTES, BATCH_TOTAL_MAX_BYTES } from '@/lib/attachments/batch';
import { optimizeImageForUpload } from '@/lib/attachments/client-image-optimize';
import { formatBytesLabel } from '@/lib/attachments/policy';
import { MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/validate';

const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|heic|heif|docx|xlsx|pptx)$/i;
const IMAGE_PREVIEW = /^image\/(jpeg|png|webp|gif)$/i;

export const fmtFileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function fileKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

/**
 * Files picked (click, drag and drop, or +) to be sent together with a form.
 * Photos are downscaled in-browser before they join the list.
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    setPreviews((prev) => {
      const next: Record<string, string> = {};
      const keep = new Set<string>();
      for (const f of files) {
        const k = fileKey(f);
        keep.add(k);
        if (IMAGE_PREVIEW.test(f.type)) {
          next[k] = prev[k] ?? URL.createObjectURL(f);
        }
      }
      for (const [k, url] of Object.entries(prev)) {
        if (!keep.has(k)) URL.revokeObjectURL(url);
      }
      return next;
    });
  }, [files]);

  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => {
    return () => {
      for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
    };
  }, []);

  const add = async (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    setError(null);
    setNote(null);
    const incomingList = Array.from(incoming);
    if (existingCount + files.length + incomingList.length > maxFiles) {
      setError(`附件最多 ${maxFiles} 個，未靜默丟棄超出檔案——請減少後再選`);
      return;
    }

    setBusy(true);
    try {
      const next = [...files];
      let optimizedCount = 0;
      for (const raw of incomingList) {
        if (!ALLOWED_EXT.test(raw.name)) {
          setError(`「${raw.name}」格式不支援（PDF／JPEG／PNG／WebP／HEIC／Office）`);
          continue;
        }
        const { file: f, optimized } = await optimizeImageForUpload(raw);
        if (optimized) optimizedCount += 1;
        if (f.size > BATCH_FILE_MAX_BYTES) {
          setError(`「${f.name}」超過 ${formatBytesLabel(BATCH_FILE_MAX_BYTES)} 上限（${fmtFileSize(f.size)}）`);
          continue;
        }
        if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
        next.push(f);
      }
      if (next.reduce((s, x) => s + x.size, 0) > BATCH_TOTAL_MAX_BYTES) {
        setError(
          `單次送出的附件合計不可超過 ${formatBytesLabel(BATCH_TOTAL_MAX_BYTES)}，其餘請送出後於明細頁補傳`
        );
        return;
      }
      onChange(next);
      if (optimizedCount > 0) {
        setNote(`已自動降低 ${optimizedCount} 張照片解析度以節省儲存空間`);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void add(e.dataTransfer.files);
          }}
          className={`flex flex-1 items-center gap-3 rounded border border-dashed px-4 py-2.5 text-left text-sm transition disabled:opacity-60 ${
            dragOver ? 'border-td-apex bg-td-apex-light' : 'border-td-apex/70 hover:bg-td-apex-light/60'
          }`}
        >
          <span className="inline-flex items-center gap-1.5 font-semibold text-td-apex-dark">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
              <path d="M10.75 3.75a.75.75 0 00-1.5 0v5.5h-5.5a.75.75 0 000 1.5h5.5v5.5a.75.75 0 001.5 0v-5.5h5.5a.75.75 0 000-1.5h-5.5v-5.5z" />
            </svg>
            {busy ? '處理照片中…' : '加入附件'}
          </span>
          <span className="text-td-muted">或拖放到此處</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.xlsx,.pptx,image/*"
          className="hidden"
          onChange={(e) => void add(e.target.files)}
        />
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      {note && !error && <p className="mt-1 text-xs text-td-muted">{note}</p>}
      {files.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" aria-label="已選附件">
          {files.map((f) => {
            const k = fileKey(f);
            const thumb = previews[k];
            return (
              <li
                key={k}
                className="flex flex-col overflow-hidden rounded-lg border border-td-border bg-white text-xs"
              >
                <div className="relative flex h-24 items-center justify-center bg-slate-100">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="px-2 text-center text-td-muted">
                      {/\.pdf$/i.test(f.name)
                        ? 'PDF'
                        : /\.(docx?|xlsx?|pptx?)$/i.test(f.name)
                          ? 'Office'
                          : '檔案'}
                    </span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-1 p-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-td-blue-dark" title={f.name}>
                      {f.name}
                    </p>
                    <p className="text-td-muted">{fmtFileSize(f.size)}</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-red-700 underline"
                    onClick={() => onChange(files.filter((x) => x !== f))}
                  >
                    移除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-xs text-td-muted">
        格式：PDF、JPEG、PNG、WebP、HEIC／HEIF、DOCX／XLSX／PPTX（單檔{' '}
        {formatBytesLabel(BATCH_FILE_MAX_BYTES)} 以內，每張表單最多 {maxFiles} 個；單次合計{' '}
        {formatBytesLabel(BATCH_TOTAL_MAX_BYTES)}）。大圖會在上傳前自動降低解析度。
      </p>
    </>
  );
}
