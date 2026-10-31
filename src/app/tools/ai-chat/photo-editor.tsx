'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFileEditStateAction, restoreOriginalAction } from '@/lib/ai-chat/actions-staged-invoice';
import {
  EMPTY_EDIT,
  fromOutput,
  isEmptyEdit,
  outputSize,
  pushState,
  redo,
  rotateRight,
  startHistory,
  toOutput,
  undo,
  type Annotation,
  type EditState,
  type History,
  type Point,
} from './photo-geometry';

export type EditTarget = {
  kind: 'staged' | 'draft_file';
  sourceId: string;
  fileName: string;
  /** Original image; HEIC comes through the server's JPEG view. */
  originalUrl: string;
};

type Tool = 'pan' | 'crop' | 'rect' | 'arrow' | 'text' | 'free';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'pan', label: '檢視' },
  { id: 'crop', label: '裁切' },
  { id: 'rect', label: '框選' },
  { id: 'arrow', label: '箭頭' },
  { id: 'text', label: '文字' },
  { id: 'free', label: '手繪' },
];

const INK = '#d92d20';

/** Draws the picture: rotation and crop always; annotations only for the visible output. */
function renderTo(canvas: HTMLCanvasElement, img: HTMLImageElement, s: EditState, withAnnotations: boolean) {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const size = outputSize(srcW, srcH, s);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.scale(size.scale, size.scale);
  ctx.translate(-size.crop.x * size.rw, -size.crop.y * size.rh);
  ctx.translate(size.rw / 2, size.rh / 2);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.drawImage(img, -srcW / 2, -srcH / 2);
  ctx.restore();
  if (!withAnnotations) return;

  const px = (p: Point) => {
    const o = toOutput(p, s);
    return { x: o.x * size.width, y: o.y * size.height };
  };
  const unit = Math.max(size.width, size.height) / 400;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(2, unit * 1.5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of s.annotations) {
    if (a.kind === 'rect') {
      const p = px(a.a);
      const q = px(a.b);
      ctx.strokeRect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(p.x - q.x), Math.abs(p.y - q.y));
    } else if (a.kind === 'arrow') {
      const p = px(a.a);
      const q = px(a.b);
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      const head = Math.max(10, unit * 8);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - head * Math.cos(angle - 0.5), q.y - head * Math.sin(angle - 0.5));
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - head * Math.cos(angle + 0.5), q.y - head * Math.sin(angle + 0.5));
      ctx.stroke();
    } else if (a.kind === 'text') {
      const p = px(a.at);
      ctx.font = `600 ${Math.max(14, unit * 10)}px system-ui, "Noto Sans TC", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(a.text, p.x, p.y);
    } else if (a.points.length > 1) {
      ctx.beginPath();
      a.points.forEach((pt, i) => {
        const p = px(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

export function PhotoEditor({ target, onClose, onSaved }: { target: EditTarget; onClose: () => void; onSaved: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [savedState, setSavedState] = useState<EditState>(EMPTY_EDIT);
  const [history, setHistory] = useState<History>(startHistory(EMPTY_EDIT));
  const [tool, setTool] = useState<Tool>('pan');
  const [zoom, setZoom] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);
  const [draftShape, setDraftShape] = useState<Annotation | null>(null);
  const [cropBox, setCropBox] = useState<{ a: Point; b: Point } | null>(null);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragStart = useRef<Point | null>(null);

  const present = history.present;
  const dirty = Boolean(cropBox) || JSON.stringify(present) !== JSON.stringify(savedState);

  // Load the saved operations and the original picture; editing always starts from the original.
  useEffect(() => {
    let alive = true;
    void getFileEditStateAction({ kind: target.kind, sourceId: target.sourceId }).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setActiveEditId(res.state.activeEditId);
      const ops = res.state.operations as unknown as EditState | null;
      const start = ops ? { rotation: ops.rotation, crop: ops.crop, annotations: ops.annotations ?? [] } : EMPTY_EDIT;
      setSavedState(start);
      setHistory(startHistory(start));
    });
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      imgRef.current = img;
      setReady(true);
    };
    img.onerror = () => alive && setLoadError('無法載入圖片，原檔沒有受到影響。');
    img.src = target.originalUrl;
    return () => {
      alive = false;
    };
  }, [target]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const shown = useMemo<EditState>(
    () => (showOriginal ? EMPTY_EDIT : draftShape ? { ...present, annotations: [...present.annotations, draftShape] } : present),
    [showOriginal, draftShape, present]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && imgRef.current && ready) renderTo(canvas, imgRef.current, shown, true);
  }, [ready, shown]);

  const pointer = useCallback(
    (e: React.PointerEvent): Point => {
      const box = canvasRef.current!.getBoundingClientRect();
      const o = { x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) };
      return fromOutput(o, present);
    },
    [present]
  );

  const change = (next: EditState) => setHistory((h) => pushState(h, next));

  const onDown = (e: React.PointerEvent) => {
    if (showOriginal || tool === 'pan') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointer(e);
    if (tool === 'text') {
      setTextAt(p);
      setText('');
      return;
    }
    dragStart.current = p;
    if (tool === 'free') setDraftShape({ kind: 'free', points: [p] });
    if (tool === 'crop') setCropBox({ a: p, b: p });
  };

  const onMove = (e: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const p = pointer(e);
    if (tool === 'rect' || tool === 'arrow') setDraftShape({ kind: tool, a: start, b: p });
    else if (tool === 'free') setDraftShape((d) => (d?.kind === 'free' ? { ...d, points: [...d.points, p] } : d));
    else if (tool === 'crop') setCropBox({ a: start, b: p });
  };

  const onUp = () => {
    dragStart.current = null;
    if (draftShape) {
      const keep = draftShape.kind === 'free' ? draftShape.points.length > 1 : true;
      if (keep) change({ ...present, annotations: [...present.annotations, draftShape] });
      setDraftShape(null);
    }
  };

  /** A selected crop is meant to count: moving on or saving applies it instead of dropping it silently. */
  const commitCrop = (): EditState => {
    if (!cropBox) return present;
    const a = cropBox.a;
    const b = cropBox.b;
    const crop = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    setCropBox(null);
    if (crop.w < 0.02 || crop.h < 0.02) {
      setError('裁切範圍太小。');
      return present;
    }
    const next = { ...present, crop };
    change(next);
    return next;
  };

  const applyCrop = () => {
    commitCrop();
    setTool('pan');
  };

  const addText = () => {
    if (textAt && text.trim()) change({ ...present, annotations: [...present.annotations, { kind: 'text', at: textAt, text: text.trim().slice(0, 200) }] });
    setTextAt(null);
    setText('');
  };

  const close = () => {
    if (dirty && !window.confirm('修改尚未儲存，確定離開？原檔與已存版本都不會改變。')) return;
    onClose();
  };

  const save = async () => {
    if (!imgRef.current) return;
    const final = commitCrop();
    setSaving(true);
    setError(null);
    try {
      if (isEmptyEdit(final)) {
        // Nothing left to apply: same as restoring the original.
        const res = await restoreOriginalAction({ kind: target.kind, sourceId: target.sourceId });
        if (!res.ok) throw new Error(res.error);
      } else {
        const out = document.createElement('canvas');
        renderTo(out, imgRef.current, final, true);
        const analysis = document.createElement('canvas');
        renderTo(analysis, imgRef.current, final, false);
        const [outBlob, anaBlob] = await Promise.all([toBlob(out), toBlob(analysis)]);
        if (!outBlob || !anaBlob) throw new Error('無法產生圖片');
        const fd = new FormData();
        fd.set('kind', target.kind);
        fd.set('sourceId', target.sourceId);
        fd.set('expectedEditId', activeEditId ?? '');
        fd.set('operations', JSON.stringify(final));
        fd.set('output', outBlob, 'output.jpg');
        fd.set('analysis', anaBlob, 'analysis.jpg');
        const http = await fetch('/api/ai-chat/file-edits', { method: 'POST', body: fd, credentials: 'same-origin' });
        const body = (await http.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!http.ok || !body.ok) throw new Error(body.error ?? '儲存失敗');
      }
      setSavedState(final);
      onSaved();
    } catch (err) {
      const reason = err instanceof TypeError ? '連線中斷' : err instanceof Error ? err.message : '請再試一次';
      setError(`尚未儲存：${reason}。編輯內容仍保留，原檔沒有變更。`);
    } finally {
      setSaving(false);
    }
  };

  const btn = 'rounded border border-td-border bg-white px-2 py-1 text-xs disabled:opacity-40';
  return (
    <div role="dialog" aria-modal="true" aria-label={`編輯 ${target.fileName}`} className="fixed inset-0 z-50 flex flex-col bg-slate-900/80 p-2 sm:p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-td-border p-2">
          <span className="mr-2 max-w-40 truncate text-sm font-semibold text-td-blue-dark" title={target.fileName}>
            {target.fileName}
          </span>
          <div role="toolbar" aria-label="工具" className="flex flex-wrap gap-1">
            {TOOLS.map((t) => (
              <button key={t.id} type="button" aria-pressed={tool === t.id} className={`${btn} ${tool === t.id ? '!bg-td-blue !text-white' : ''}`} onClick={() => {
                  commitCrop();
                  setTool(t.id);
                }}>
                {t.label}
              </button>
            ))}
            <button type="button" className={btn} onClick={() => change({ ...present, rotation: rotateRight(present.rotation) })}>
              旋轉 90°
            </button>
            <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
              放大
            </button>
            <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
              縮小
            </button>
            <button type="button" className={btn} disabled={history.past.length === 0} onClick={() => setHistory(undo)}>
              復原
            </button>
            <button type="button" className={btn} disabled={history.future.length === 0} onClick={() => setHistory(redo)}>
              重做
            </button>
            <button type="button" className={btn} onClick={() => change(EMPTY_EDIT)}>
              還原原圖
            </button>
            <button type="button" aria-pressed={showOriginal} className={btn} onClick={() => setShowOriginal((v) => !v)}>
              {showOriginal ? '看編輯版' : '看原圖'}
            </button>
          </div>
        </div>
        {tool === 'crop' && cropBox && (
          <div className="flex items-center gap-2 border-b border-td-border bg-sky-50 px-2 py-1 text-xs">
            已選取裁切範圍。
            <button type="button" className={btn} onClick={applyCrop}>
              套用裁切
            </button>
            <button type="button" className={btn} onClick={() => setCropBox(null)}>
              取消
            </button>
          </div>
        )}
        {textAt && (
          <div className="flex items-center gap-2 border-b border-td-border bg-sky-50 px-2 py-1 text-xs">
            <label htmlFor="photo-note">文字</label>
            <input id="photo-note" autoFocus className="min-w-0 flex-1 rounded border border-td-border px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addText()} />
            <button type="button" className={btn} onClick={addText}>
              加上
            </button>
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-auto bg-slate-100 p-2">
          {loadError ? (
            <p role="alert" className="p-4 text-sm text-red-700">
              {loadError}
            </p>
          ) : !ready ? (
            <p className="p-4 text-sm text-td-muted">載入圖片中…</p>
          ) : (
            <div className="relative mx-auto" style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? 900 : undefined }}>
              <canvas
                ref={canvasRef}
                aria-label="圖片編輯區"
                data-tool={tool}
                className={`block h-auto w-full touch-none bg-white ${tool === 'pan' ? '' : 'cursor-crosshair'}`}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
              />
              {cropBox && (() => {
                const p = toOutput(cropBox.a, present);
                const q = toOutput(cropBox.b, present);
                return (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute border-2 border-dashed border-sky-500 bg-sky-400/10"
                    style={{ left: `${Math.min(p.x, q.x) * 100}%`, top: `${Math.min(p.y, q.y) * 100}%`, width: `${Math.abs(p.x - q.x) * 100}%`, height: `${Math.abs(p.y - q.y) * 100}%` }}
                  />
                );
              })()}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-td-border p-2">
          {error && (
            <p role="alert" className="mr-auto text-xs text-red-700">
              {error}
            </p>
          )}
          {!error && <p className="mr-auto text-xs text-td-muted">{dirty ? '有尚未儲存的修改。原檔不會被覆寫。' : '原檔不會被覆寫。'}</p>}
          <button type="button" className="btn-secondary text-sm" onClick={close} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn-primary text-sm" onClick={() => void save()} disabled={saving || !ready || !dirty}>
            {saving ? '儲存中…' : '儲存編輯'}
          </button>
        </div>
      </div>
    </div>
  );
}
