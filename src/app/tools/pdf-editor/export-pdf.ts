import { renderStampPng } from './stamps';
import type { Annotation, NoteAnnotation, PageSize, TextAnnotation } from './types';

type PdfLib = typeof import('pdf-lib');

async function getPdfLib(): Promise<PdfLib> {
  return import('pdf-lib');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const n = Number.parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of paragraph) {
      const trial = current + ch;
      if (ctx.measureText(trial).width > maxWidth && current) {
        lines.push(current);
        current = ch;
      } else {
        current = trial;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [''];
}

/** Rasterize CJK-capable text via browser canvas (pdf-lib WinAnsi cannot encode Chinese). */
async function renderTextPng(options: {
  content: string;
  color: string;
  fontSize: number;
  bold?: boolean;
  widthPx: number;
  heightPx: number;
  padding?: number;
  background?: string | null;
  borderColor?: string | null;
}): Promise<Uint8Array> {
  const {
    content,
    color,
    fontSize,
    bold,
    widthPx,
    heightPx,
    padding = 4,
    background = null,
    borderColor = null,
  } = options;

  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(widthPx * dpr));
  canvas.height = Math.max(2, Math.round(heightPx * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立匯出畫布');

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, widthPx, heightPx);

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, widthPx, heightPx);
  }
  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, widthPx - 1, heightPx - 1);
  }

  ctx.fillStyle = color;
  ctx.font = `${bold ? '700' : '400'} ${fontSize}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Heiti TC", sans-serif`;
  ctx.textBaseline = 'top';

  const maxWidth = Math.max(8, widthPx - padding * 2);
  const lines = wrapLines(ctx, content || ' ', maxWidth);
  const lineHeight = fontSize * 1.25;
  let y = padding;
  for (const line of lines) {
    if (y + lineHeight > heightPx) break;
    ctx.fillText(line, padding, y);
    y += lineHeight;
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 匯出失敗'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function embedDataUrlImage(
  pdfDoc: import('pdf-lib').PDFDocument,
  src: string
) {
  const bytes = await fetch(src).then((r) => r.arrayBuffer());
  if (src.startsWith('data:image/png') || src.includes('image/png')) {
    return pdfDoc.embedPng(bytes);
  }
  return pdfDoc.embedJpg(bytes);
}

export async function exportAnnotatedPdf(
  originalBytes: ArrayBuffer,
  annotations: Annotation[],
  pageSizes: PageSize[]
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    const page = pages[ann.pageIndex];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const display = pageSizes[ann.pageIndex];
    const displayW = display?.width ?? pw;
    const displayH = display?.height ?? ph;

    const x = ann.x * pw;
    const yTop = ann.y * ph;
    const w = ann.width * pw;
    const h = ann.height * ph;
    const y = ph - yTop - h;

    const widthPx = Math.max(2, ann.width * displayW);
    const heightPx = Math.max(2, ann.height * displayH);

    if (ann.type === 'text') {
      const textAnn = ann as TextAnnotation;
      const png = await renderTextPng({
        content: textAnn.content,
        color: textAnn.color,
        fontSize: textAnn.fontSize,
        bold: textAnn.bold,
        widthPx,
        heightPx,
        background: null,
      });
      const img = await pdfDoc.embedPng(png);
      page.drawImage(img, { x, y, width: w, height: h });
    } else if (ann.type === 'rect') {
      const stroke = hexToRgb(ann.strokeColor);
      const fill = hexToRgb(ann.fillColor);
      const hasFill = ann.fillColor !== 'transparent' && !ann.fillColor.endsWith('00');
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: rgb(stroke.r, stroke.g, stroke.b),
        borderWidth: ann.strokeWidth,
        color: hasFill ? rgb(fill.r, fill.g, fill.b) : undefined,
        opacity: hasFill ? 0.15 : 1,
        borderOpacity: 1,
      });
    } else if (ann.type === 'highlight') {
      const color = hexToRgb(ann.color);
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(color.r, color.g, color.b),
        opacity: 0.35,
        borderWidth: 0,
      });
    } else if (ann.type === 'note') {
      const noteAnn = ann as NoteAnnotation;
      const png = await renderTextPng({
        content: noteAnn.content,
        color: '#0F2D5C',
        fontSize: 12,
        widthPx,
        heightPx,
        padding: 6,
        background: noteAnn.color,
        borderColor: '#E8A838',
      });
      const img = await pdfDoc.embedPng(png);
      page.drawImage(img, { x, y, width: w, height: h });
    } else if (ann.type === 'stamp') {
      const png = await renderStampPng(ann.kind, ann.color, widthPx, heightPx);
      const img = await pdfDoc.embedPng(png);
      page.drawImage(img, { x, y, width: w, height: h });
    } else if (ann.type === 'image' && ann.src) {
      const embedded = await embedDataUrlImage(pdfDoc, ann.src);
      page.drawImage(embedded, { x, y, width: w, height: h });
    }
  }

  return pdfDoc.save();
}

/** Split a PDF into chunks of `pagesPerFile` pages. e.g. 10 pages / 3 → 4 files. */
export async function splitPdfByPageCount(
  pdfBytes: ArrayBuffer | Uint8Array,
  pagesPerFile: number
): Promise<{ startPage: number; endPage: number; bytes: Uint8Array }[]> {
  const { PDFDocument } = await getPdfLib();
  const per = Math.max(1, Math.floor(pagesPerFile));
  const src = await PDFDocument.load(pdfBytes);
  const total = src.getPageCount();
  if (total === 0) return [];

  const chunks: { startPage: number; endPage: number; bytes: Uint8Array }[] = [];
  for (let start = 0; start < total; start += per) {
    const end = Math.min(total, start + per);
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const part = await PDFDocument.create();
    const copied = await part.copyPages(src, indices);
    for (const page of copied) part.addPage(page);
    chunks.push({
      startPage: start + 1,
      endPage: end,
      bytes: await part.save(),
    });
  }
  return chunks;
}

export function downloadPdfBytes(bytes: Uint8Array, downloadName: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
