'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ViewerItem = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  /** Prefer controlled preview URL; download is optional. */
  previewUrl: string;
  downloadUrl?: string;
  analysisSummary?: string | null;
  confirmationNote?: string | null;
};

type Props = {
  items: ViewerItem[];
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
};

const SCAN_FAIL_HINT = '無法預覽：格式不支援、轉換未完成，或權限不足。';

export function AttachmentViewer({ items, initialIndex = 0, open, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown>; destroy: () => Promise<void> } | null>(
    null
  );
  const objectUrlRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const item = items[index] ?? null;

  const cleanup = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setImageUrl(null);
    const doc = pdfDocRef.current;
    pdfDocRef.current = null;
    void doc?.destroy().catch(() => undefined);
  }, []);

  const loadItem = useCallback(async () => {
    if (!item) return;
    cleanup();
    setStatus('loading');
    setError(null);
    setPage(1);
    setPageCount(0);
    setScale(1);
    setRotation(0);

    try {
      const res = await fetch(item.previewUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.message === 'string' ? body.message : SCAN_FAIL_HINT);
        setStatus('failed');
        return;
      }
      const mime = res.headers.get('Content-Type')?.split(';')[0]?.trim() || item.mimeType;
      const buf = await res.arrayBuffer();

      if (mime === 'application/pdf') {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(buf),
          useSystemFonts: true,
          isEvalSupported: false,
          disableAutoFetch: true,
          disableStream: false,
        });
        const doc = await loadingTask.promise;
        pdfDocRef.current = doc as typeof pdfDocRef.current;
        setPageCount(doc.numPages);
        setStatus('ready');
        return;
      }

      if (mime.startsWith('image/')) {
        const blob = new Blob([buf], { type: mime });
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setImageUrl(url);
        setStatus('ready');
        return;
      }

      setError('此格式無法站內預覽');
      setStatus('failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : SCAN_FAIL_HINT);
      setStatus('failed');
    }
  }, [item, cleanup]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setIndex(initialIndex);
  }, [open, initialIndex]);

  useEffect(() => {
    if (!open) {
      cleanup();
      return;
    }
    void loadItem();
    return () => cleanup();
  }, [open, index, loadItem, cleanup]);

  useEffect(() => {
    if (!open || status !== 'ready' || !pdfDocRef.current || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const doc = pdfDocRef.current!;
      const pdfPage = (await doc.getPage(page)) as {
        getViewport: (o: { scale: number; rotation: number }) => { width: number; height: number };
        render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
          promise: Promise<void>;
        };
      };
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: scale * 1.2, rotation });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    })().catch(() => {
      if (!cancelled) {
        setError('PDF 頁面渲染失敗');
        setStatus('failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, status, page, scale, rotation]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) setIndex((i) => i + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, index, items.length]);

  useEffect(() => {
    if (!open) {
      restoreFocusRef.current?.focus?.();
    }
  }, [open]);

  if (!open || !item) return null;

  const shellClass = fullscreen
    ? 'fixed inset-0 z-[80] flex flex-col bg-black/90'
    : 'fixed inset-y-0 right-0 z-[80] flex w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-xl';

  return (
    <div className={shellClass} role="dialog" aria-modal="true" aria-label="附件預覽">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{item.fileName}</p>
          <p className="text-xs text-slate-500">
            {item.mimeType} · {(item.fileSizeBytes / 1024).toFixed(1)} KB
            {items.length > 1 ? ` · ${index + 1}/${items.length}` : ''}
          </p>
        </div>
        <button type="button" className="btn-secondary !py-1" disabled={index <= 0} onClick={() => setIndex((i) => i - 1)}>
          上一個
        </button>
        <button
          type="button"
          className="btn-secondary !py-1"
          disabled={index >= items.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          下一個
        </button>
        <button type="button" className="btn-secondary !py-1" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
          放大
        </button>
        <button type="button" className="btn-secondary !py-1" onClick={() => setScale((s) => Math.max(0.4, s - 0.2))}>
          縮小
        </button>
        <button type="button" className="btn-secondary !py-1" onClick={() => setScale(1)}>
          符合寬度
        </button>
        <button type="button" className="btn-secondary !py-1" onClick={() => setRotation((r) => (r + 90) % 360)}>
          旋轉
        </button>
        {pageCount > 0 && (
          <>
            <button type="button" className="btn-secondary !py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              上一頁
            </button>
            <span className="text-xs">
              <input
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= pageCount) setPage(n);
                }}
                className="w-12 rounded border px-1 py-0.5 text-center"
              />
              / {pageCount}
            </span>
            <button
              type="button"
              className="btn-secondary !py-1"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              下一頁
            </button>
          </>
        )}
        <button type="button" className="btn-secondary !py-1" onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? '縮小檢視' : '全螢幕'}
        </button>
        {item.downloadUrl && (
          <a href={item.downloadUrl} className="btn-secondary !py-1" download>
            下載原檔
          </a>
        )}
        <button
          type="button"
          className="btn-primary !py-1"
          onClick={() => {
            cleanup();
            onClose();
          }}
        >
          關閉
        </button>
      </header>

      {(item.analysisSummary || item.confirmationNote) && (
        <div className="space-y-1 border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {item.analysisSummary && <p>AI 檢查：{item.analysisSummary}</p>}
          {item.confirmationNote && <p>申請人確認：{item.confirmationNote}</p>}
        </div>
      )}

      <div className="relative flex-1 overflow-auto bg-slate-100 p-4">
        {status === 'loading' && <p className="text-sm text-slate-600">載入預覽中…</p>}
        {status === 'failed' && <p className="text-sm text-red-700">{error ?? SCAN_FAIL_HINT}</p>}
        {status === 'ready' && imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={item.fileName}
            style={{ transform: `scale(${scale}) rotate(${rotation}deg)`, transformOrigin: 'top left' }}
            className="max-w-none"
          />
        )}
        {status === 'ready' && pageCount > 0 && <canvas ref={canvasRef} className="mx-auto bg-white shadow" />}
      </div>
    </div>
  );
}
