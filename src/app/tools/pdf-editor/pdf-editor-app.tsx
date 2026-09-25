'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnnotationLayer } from './annotation-layer';
import {
  DEFAULT_HIGHLIGHT,
  DEFAULT_NOTE_COLOR,
  DEFAULT_RECT_STROKE,
  DEFAULT_STAMP_COLOR,
  DEFAULT_TEXT_COLOR,
  STAMP_PRESETS,
  type Annotation,
  type EditorTool,
  type PageSize,
  type StampKind,
  type TextAnnotation,
} from './types';
import { StampGlyph } from './stamps';

type PdfPageView = {
  pageIndex: number;
  imageUrl: string;
  width: number;
  height: number;
};

function uid() {
  return `ann_${Math.random().toString(36).slice(2, 10)}`;
}

export function PdfEditorApp() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<PdfPageView[]>([]);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [tool, setTool] = useState<EditorTool>('select');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [fontSize, setFontSize] = useState(16);
  const [textBold, setTextBold] = useState(false);
  const [markColor, setMarkColor] = useState(DEFAULT_HIGHLIGHT);
  const [stampKind, setStampKind] = useState<StampKind>('check');
  const [stampColor, setStampColor] = useState(DEFAULT_STAMP_COLOR);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [pagesPerFile, setPagesPerFile] = useState(3);
  const [drawStart, setDrawStart] = useState<{
    pageIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [draftBox, setDraftBox] = useState<{
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const selected = useMemo(
    () => annotations.find((a) => a.id === selectedId) ?? null,
    [annotations, selectedId]
  );

  const loadPdf = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('請上傳 PDF 檔案');
      return;
    }
    setLoading(true);
    setError(null);
    setAnnotations([]);
    setSelectedId(null);
    setEditMode(false);
    setTool('select');
    try {
      const { loadAndRenderPdf } = await import('./load-pdf');
      const { bytes, pages: rendered } = await loadAndRenderPdf(file);
      setPdfBytes(bytes);
      setFileName(file.name);
      setPages(rendered);
      setPageSizes(rendered.map((p) => ({ width: p.width, height: p.height })));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '無法讀取 PDF');
      setPdfBytes(null);
      setPages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void loadPdf(file);
    },
    [loadPdf]
  );

  const updateAnnotation = useCallback((next: Annotation) => {
    setAnnotations((prev) => prev.map((a) => (a.id === next.id ? next : a)));
  }, []);

  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const duplicateAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => {
      const src = prev.find((a) => a.id === id);
      if (!src) return prev;
      const offset = 0.03;
      const clone: Annotation = {
        ...src,
        id: uid(),
        x: Math.min(1 - src.width, src.x + offset),
        y: Math.min(1 - src.height, src.y + offset),
      };
      setSelectedId(clone.id);
      return [...prev, clone];
    });
  }, []);

  const addTextAt = (pageIndex: number, x: number, y: number) => {
    const ann: TextAnnotation = {
      id: uid(),
      type: 'text',
      pageIndex,
      x: Math.min(0.72, Math.max(0, x)),
      y: Math.min(0.9, Math.max(0, y)),
      width: 0.28,
      height: 0.06,
      content: '',
      color: textColor,
      fontSize,
      bold: textBold,
    };
    setAnnotations((prev) => [...prev, ann]);
    setSelectedId(ann.id);
    setTool('select');
  };

  const addNoteAt = (pageIndex: number, x: number, y: number) => {
    const ann: Annotation = {
      id: uid(),
      type: 'note',
      pageIndex,
      x: Math.min(0.75, Math.max(0, x)),
      y: Math.min(0.82, Math.max(0, y)),
      width: 0.22,
      height: 0.14,
      content: '',
      color: DEFAULT_NOTE_COLOR,
    };
    setAnnotations((prev) => [...prev, ann]);
    setSelectedId(ann.id);
    setTool('select');
  };

  const addStampAt = (pageIndex: number, x: number, y: number) => {
    const preset = STAMP_PRESETS.find((p) => p.kind === stampKind) ?? STAMP_PRESETS[0];
    const size = preset.defaultSize;
    const height =
      stampKind === 'line' ? Math.max(0.012, size * 0.15) : size;
    const width = stampKind === 'line' ? size : size;
    const ann: Annotation = {
      id: uid(),
      type: 'stamp',
      kind: stampKind,
      color: stampColor,
      pageIndex,
      x: Math.min(1 - width, Math.max(0, x - width / 2)),
      y: Math.min(1 - height, Math.max(0, y - height / 2)),
      width,
      height,
    };
    setAnnotations((prev) => [...prev, ann]);
    setSelectedId(ann.id);
    setTool('select');
  };

  const onPageClick = (pageIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!editMode) return;
    const el = pageRefs.current.get(pageIndex);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (tool === 'text') {
      addTextAt(pageIndex, x, y);
      return;
    }
    if (tool === 'note') {
      addNoteAt(pageIndex, x, y);
      return;
    }
    if (tool === 'stamp') {
      addStampAt(pageIndex, x, y);
      return;
    }
    if (tool === 'select') {
      setSelectedId(null);
    }
  };

  const onPagePointerDown = (pageIndex: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!editMode || (tool !== 'rect' && tool !== 'highlight')) return;
    if ((e.target as HTMLElement).closest('[data-annotation]')) return;
    const el = pageRefs.current.get(pageIndex);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrawStart({ pageIndex, x, y });
    setDraftBox({ pageIndex, x, y, width: 0, height: 0 });
    el.setPointerCapture(e.pointerId);
  };

  const onPagePointerMove = (pageIndex: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawStart || drawStart.pageIndex !== pageIndex) return;
    const el = pageRefs.current.get(pageIndex);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x2 = (e.clientX - rect.left) / rect.width;
    const y2 = (e.clientY - rect.top) / rect.height;
    const x = Math.min(drawStart.x, x2);
    const y = Math.min(drawStart.y, y2);
    setDraftBox({
      pageIndex,
      x,
      y,
      width: Math.abs(x2 - drawStart.x),
      height: Math.abs(y2 - drawStart.y),
    });
  };

  const onPagePointerUp = (pageIndex: number) => {
    if (!drawStart || drawStart.pageIndex !== pageIndex || !draftBox) {
      setDrawStart(null);
      setDraftBox(null);
      return;
    }
    if (draftBox.width > 0.01 && draftBox.height > 0.008) {
      const id = uid();
      if (tool === 'highlight') {
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            type: 'highlight',
            pageIndex,
            x: draftBox.x,
            y: draftBox.y,
            width: draftBox.width,
            height: draftBox.height,
            color: markColor,
          },
        ]);
      } else {
        setAnnotations((prev) => [
          ...prev,
          {
            id,
            type: 'rect',
            pageIndex,
            x: draftBox.x,
            y: draftBox.y,
            width: draftBox.width,
            height: draftBox.height,
            strokeColor: DEFAULT_RECT_STROKE,
            fillColor: 'transparent',
            strokeWidth: 2,
          },
        ]);
      }
      setSelectedId(id);
      setTool('select');
    }
    setDrawStart(null);
    setDraftBox(null);
  };

  const onPickImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('請選擇圖片檔');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const pageIndex = selected?.pageIndex ?? 0;
      const ann: Annotation = {
        id: uid(),
        type: 'image',
        pageIndex,
        x: 0.1,
        y: 0.1,
        width: 0.35,
        height: 0.25,
        src,
      };
      setAnnotations((prev) => [...prev, ann]);
      setSelectedId(ann.id);
      setTool('select');
      setEditMode(true);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!selected || selected.type !== 'text') return;
    setTextColor(selected.color);
    setFontSize(selected.fontSize);
    setTextBold(!!selected.bold);
  }, [selected]);

  useEffect(() => {
    if (!selected || selected.type !== 'stamp') return;
    setStampKind(selected.kind);
    setStampColor(selected.color);
  }, [selected]);

  const patchSelectedText = (patch: Partial<Pick<TextAnnotation, 'color' | 'fontSize' | 'bold'>>) => {
    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.id !== selectedId || a.type !== 'text') return a;
        return { ...a, ...patch };
      })
    );
  };

  const openExportDialog = () => {
    if (!pdfBytes) return;
    setError(null);
    setShowExportDialog(true);
  };

  const splitPreviewCount = useMemo(() => {
    const total = pages.length;
    const per = Math.max(1, Math.floor(pagesPerFile) || 1);
    if (total === 0) return 0;
    return Math.ceil(total / per);
  }, [pages.length, pagesPerFile]);

  const handleExport = async () => {
    if (!pdfBytes) return;
    setExporting(true);
    setError(null);
    try {
      const source = pdfBytes.slice(0);
      const baseName = (fileName ?? 'document').replace(/\.pdf$/i, '');

      const { downloadPdfBytes, exportAnnotatedPdf, splitPdfByPageCount } = await import(
        './export-pdf'
      );

      let finalBytes: Uint8Array;
      if (annotations.length > 0) {
        finalBytes = await exportAnnotatedPdf(source, annotations, pageSizes);
      } else {
        finalBytes = new Uint8Array(source);
      }

      if (splitEnabled) {
        const per = Math.max(1, Math.floor(pagesPerFile) || 1);
        const chunks = await splitPdfByPageCount(finalBytes, per);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const name = `${baseName}-edited-p${chunk.startPage}-${chunk.endPage}.pdf`;
          downloadPdfBytes(chunk.bytes, name);
          // Stagger downloads so browsers don't block subsequent files
          if (i < chunks.length - 1) {
            await new Promise((r) => setTimeout(r, 350));
          }
        }
      } else {
        downloadPdfBytes(finalBytes, `${baseName}-edited.pdf`);
      }

      setShowExportDialog(false);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '匯出失敗');
    } finally {
      setExporting(false);
    }
  };

  const clearDoc = () => {
    setPdfBytes(null);
    setPages([]);
    setPageSizes([]);
    setAnnotations([]);
    setSelectedId(null);
    setFileName(null);
    setEditMode(false);
    setTool('select');
    setError(null);
    setShowExportDialog(false);
  };

  return (
    <main className="page-shell !max-w-7xl">
      <section className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">
            <Link href="/tools" className="hover:text-td-blue">
              工具區
            </Link>
            {' / '}
            PDF
          </p>
          <h1 className="page-title">PDF 編輯器</h1>
          <p className="page-subtitle">
            瀏覽器無法像 Word 一樣直接改 PDF 內文；此處以「疊加註解」方式加入文字、圖片、框線與螢光筆，再匯出新檔。
          </p>
        </div>
        <Link href="/tools" className="btn-ghost text-sm">
          ← 返回工具區
        </Link>
      </section>

      {error && !pdfBytes && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!pdfBytes && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`card flex min-h-[360px] flex-col items-center justify-center border-dashed text-center transition ${
            dragOver ? 'border-td-blue bg-td-blue-light/50' : 'border-td-border'
          }`}
        >
          <p className="text-lg font-semibold text-td-blue-dark">拖曳 PDF 到此處</p>
          <p className="mt-2 text-sm text-td-muted">或從本機選擇檔案</p>
          <button
            type="button"
            className="btn-primary mt-6"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            {loading ? '載入中…' : '選擇 PDF'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadPdf(f);
            }}
          />
        </div>
      )}

      {pdfBytes && (
        <div className="sticky top-16 z-30 -mx-4 mb-4 border-b border-td-border bg-td-surface/95 px-4 py-3 shadow-sm backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={editMode ? 'btn-primary' : 'btn-secondary'}
              onClick={() => {
                setEditMode((v) => !v);
                if (editMode) setTool('select');
              }}
            >
              {editMode ? '結束編輯' : '編輯'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={exporting}
              title="匯出 PDF（可選拆分）"
              onClick={openExportDialog}
            >
              {exporting ? '匯出中…' : '匯出 PDF'}
            </button>
            <button type="button" className="btn-ghost" onClick={clearDoc}>
              重新選擇檔案
            </button>
            {fileName && (
              <span className="ml-auto truncate text-xs text-td-muted sm:max-w-[40%]">
                {fileName}
                {pages.length > 0 ? ` · ${pages.length} 頁` : ''}
                {annotations.length > 0 ? ` · ${annotations.length} 個註解` : ''}
              </span>
            )}
          </div>

          {editMode && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-td-border/80 pt-3">
              <ToolButton active={tool === 'select'} onClick={() => setTool('select')} label="選取" />
              <ToolButton active={tool === 'text'} onClick={() => setTool('text')} label="文字" />
              <ToolButton
                active={tool === 'image'}
                onClick={() => {
                  setTool('image');
                  imageInputRef.current?.click();
                }}
                label="圖片"
              />
              <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} label="框線" />
              <ToolButton
                active={tool === 'highlight'}
                onClick={() => setTool('highlight')}
                label="螢光筆"
              />
              <ToolButton active={tool === 'note'} onClick={() => setTool('note')} label="便利貼" />
              <ToolButton active={tool === 'stamp'} onClick={() => setTool('stamp')} label="圖章" />

              <span className="mx-1 hidden h-6 w-px bg-td-border sm:inline" />

              {(tool === 'stamp' || selected?.type === 'stamp') && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {STAMP_PRESETS.map((preset) => (
                    <button
                      key={preset.kind}
                      type="button"
                      title={preset.label}
                      onClick={() => {
                        setStampKind(preset.kind);
                        setTool('stamp');
                        if (selected?.type === 'stamp') {
                          updateAnnotation({ ...selected, kind: preset.kind });
                        }
                      }}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border p-1.5 ${
                        stampKind === preset.kind ||
                        (selected?.type === 'stamp' && selected.kind === preset.kind)
                          ? 'border-td-blue bg-td-blue-light'
                          : 'border-td-border bg-white hover:bg-td-surface'
                      }`}
                    >
                      <StampGlyph kind={preset.kind} color={stampColor} />
                    </button>
                  ))}
                  <label className="ml-1 flex items-center gap-1.5 text-xs text-td-muted">
                    顏色
                    <input
                      type="color"
                      value={stampColor}
                      onChange={(e) => {
                        const color = e.target.value;
                        setStampColor(color);
                        if (selected?.type === 'stamp') {
                          updateAnnotation({ ...selected, color });
                        }
                      }}
                      className="h-8 w-10 cursor-pointer rounded border border-td-border bg-white"
                    />
                  </label>
                </div>
              )}

              {(tool === 'text' || selected?.type === 'text') && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-td-muted">
                    顏色
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => {
                        const color = e.target.value;
                        setTextColor(color);
                        patchSelectedText({ color });
                      }}
                      className="h-8 w-10 cursor-pointer rounded border border-td-border bg-white"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-td-muted">
                    字級
                    <input
                      type="number"
                      min={6}
                      max={72}
                      value={fontSize}
                      onChange={(e) => {
                        const next = Math.min(72, Math.max(6, Number(e.target.value) || 6));
                        setFontSize(next);
                        patchSelectedText({ fontSize: next });
                      }}
                      className="w-16 rounded-md border border-td-border px-2 py-1.5 text-sm text-td-blue-dark"
                    />
                  </label>
                  <button
                    type="button"
                    className={`btn-ghost !px-3 ${textBold ? '!bg-td-blue-light !text-td-blue' : ''}`}
                    onClick={() => {
                      const next = !textBold;
                      setTextBold(next);
                      patchSelectedText({ bold: next });
                    }}
                  >
                    粗體
                  </button>
                </>
              )}

              {(tool === 'highlight' || selected?.type === 'highlight') && (
                <label className="flex items-center gap-1.5 text-xs text-td-muted">
                  螢光色
                  <input
                    type="color"
                    value={markColor}
                    onChange={(e) => {
                      setMarkColor(e.target.value);
                      if (selected?.type === 'highlight') {
                        updateAnnotation({ ...selected, color: e.target.value });
                      }
                    }}
                    className="h-8 w-10 cursor-pointer rounded border border-td-border bg-white"
                  />
                </label>
              )}

              {selected && (
                <>
                  <button
                    type="button"
                    className="btn-secondary !py-1.5"
                    onClick={() => duplicateAnnotation(selected.id)}
                  >
                    複製選取
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !text-red-600 hover:!bg-red-50"
                    onClick={() => deleteAnnotation(selected.id)}
                  >
                    刪除選取
                  </button>
                </>
              )}

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickImage(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </div>
      )}

      {pdfBytes && (
        <div className="space-y-6">
          <p className="text-sm text-td-muted">
            {editMode && tool === 'text' && '點擊頁面放置文字框；用上方「⠿ 拖曳」移動'}
            {editMode && tool === 'note' && '點擊頁面放置便利貼；用上方把手拖曳'}
            {editMode && tool === 'stamp' && '選圖章後點頁面放置；可拖曳縮放'}
            {editMode && (tool === 'rect' || tool === 'highlight') && '在頁面上拖曳繪製'}
            {editMode && selectedId && ' · 按「完成」或點空白處／Esc 結束編輯'}
            {!editMode && '往下滑瀏覽各頁；上方工具列會固定顯示'}
          </p>

          {pages.map((page) => (
            <div key={page.pageIndex} className="card !p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-td-muted">
                第 {page.pageIndex + 1} 頁
              </p>
              <div
                ref={(el) => {
                  if (el) pageRefs.current.set(page.pageIndex, el);
                  else pageRefs.current.delete(page.pageIndex);
                }}
                data-annotation-page
                className="relative mx-auto overflow-hidden rounded-md border border-td-border bg-white shadow-sm"
                style={{ width: page.width, maxWidth: '100%' }}
                onClick={(e) => onPageClick(page.pageIndex, e)}
                onPointerDown={(e) => onPagePointerDown(page.pageIndex, e)}
                onPointerMove={(e) => onPagePointerMove(page.pageIndex, e)}
                onPointerUp={() => onPagePointerUp(page.pageIndex)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.imageUrl}
                  alt={`第 ${page.pageIndex + 1} 頁`}
                  className="block h-auto w-full select-none"
                  style={{ aspectRatio: `${page.width} / ${page.height}` }}
                  draggable={false}
                />

                {annotations
                  .filter((a) => a.pageIndex === page.pageIndex)
                  .map((ann) => (
                    <div key={ann.id} data-annotation>
                      <AnnotationLayer
                        annotation={ann}
                        selected={selectedId === ann.id}
                        editable={editMode}
                        pageWidth={page.width}
                        pageHeight={page.height}
                        onSelect={setSelectedId}
                        onDeselect={() => setSelectedId(null)}
                        onChange={updateAnnotation}
                        onDelete={deleteAnnotation}
                        onDuplicate={duplicateAnnotation}
                      />
                    </div>
                  ))}

                {draftBox && draftBox.pageIndex === page.pageIndex && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-td-blue bg-td-blue/10"
                    style={{
                      left: draftBox.x * page.width,
                      top: draftBox.y * page.height,
                      width: draftBox.width * page.width,
                      height: draftBox.height * page.height,
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {showExportDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-td-blue-dark/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-dialog-title"
          onClick={() => !exporting && setShowExportDialog(false)}
        >
          <div
            className="card w-full max-w-md shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="export-dialog-title" className="text-lg font-bold text-td-blue-dark">
              匯出設定
            </h2>
            <p className="mt-1 text-sm text-td-muted">
              目前共 {pages.length} 頁
              {annotations.length > 0
                ? `，含 ${annotations.length} 個註解`
                : '（尚未加入註解，將匯出原檔）'}
            </p>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-td-border bg-td-surface px-3 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-td-blue"
                checked={splitEnabled}
                onChange={(e) => setSplitEnabled(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-semibold text-td-blue-dark">拆分 PDF</span>
                <span className="mt-0.5 block text-xs text-td-muted">
                  依固定頁數切成多個檔案下載
                </span>
              </span>
            </label>

            {splitEnabled && (
              <div className="mt-4 space-y-2">
                <label className="flex flex-col gap-1.5 text-sm text-td-blue-dark">
                  每份幾頁
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, pages.length)}
                    value={pagesPerFile}
                    onChange={(e) =>
                      setPagesPerFile(Math.max(1, Number(e.target.value) || 1))
                    }
                    className="w-28 rounded-md border border-td-border px-3 py-2 text-sm"
                  />
                </label>
                <p className="rounded-md bg-td-blue-light/60 px-3 py-2 text-sm text-td-blue-dark">
                  {pages.length} 頁 ÷ 每份 {Math.max(1, Math.floor(pagesPerFile) || 1)} 頁 →{' '}
                  <strong>會下載 {splitPreviewCount} 個檔案</strong>
                  {pages.length > 0 && (
                    <span className="mt-1 block text-xs text-td-muted">
                      例如：
                      {Array.from({ length: Math.min(4, splitPreviewCount) }, (_, i) => {
                        const per = Math.max(1, Math.floor(pagesPerFile) || 1);
                        const start = i * per + 1;
                        const end = Math.min(pages.length, (i + 1) * per);
                        return `第 ${start}–${end} 頁`;
                      }).join('、')}
                      {splitPreviewCount > 4 ? '…' : ''}
                    </span>
                  )}
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={exporting}
                onClick={() => setShowExportDialog(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={exporting || pages.length === 0}
                onClick={() => void handleExport()}
              >
                {exporting
                  ? '匯出中…'
                  : splitEnabled
                    ? `確認匯出（${splitPreviewCount} 個檔）`
                    : '確認匯出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ToolButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-lg bg-td-blue px-3 py-1.5 text-sm font-semibold text-white'
          : 'rounded-lg border border-td-border bg-white px-3 py-1.5 text-sm font-medium text-td-blue-dark hover:bg-td-blue-light'
      }
    >
      {label}
    </button>
  );
}
