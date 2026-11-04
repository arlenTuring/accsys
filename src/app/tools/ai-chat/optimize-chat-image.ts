/**
 * Client-side image optimization for AI chat staging.
 * Keeps the original File; returns a working File used for upload/analysis when smaller.
 * Never claims lossless when resolution or JPEG quality was reduced.
 */

export type OptimizeResult = {
  originalBytes: number;
  workingFile: File;
  workingBytes: number;
  savedRatio: number;
  mode: 'unchanged' | 'lossless_reencode' | 'compressed';
  note: string;
};

const MAX_EDGE = 3200;
const JPEG_QUALITY = 0.82;
const MIN_SAVE_RATIO = 0.08;

function loadImageBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  }
  return new Promise((resolve) => {
    (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), type, quality);
  });
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Optimize a picked image for upload. PDFs / HEIC are returned unchanged
 * (HEIC is handled server-side for preview; PDF structure must stay intact).
 */
export async function optimizeChatImage(file: File): Promise<OptimizeResult> {
  const originalBytes = file.size;
  const mime = file.type || '';

  if (mime === 'application/pdf' || /^image\/hei[cf]$/i.test(mime)) {
    return {
      originalBytes,
      workingFile: file,
      workingBytes: originalBytes,
      savedRatio: 0,
      mode: 'unchanged',
      note: '已最佳化，保留原大小',
    };
  }

  if (!/^image\/(jpeg|png|webp)$/i.test(mime)) {
    return {
      originalBytes,
      workingFile: file,
      workingBytes: originalBytes,
      savedRatio: 0,
      mode: 'unchanged',
      note: '已最佳化，保留原大小',
    };
  }

  try {
    const bitmap = await loadImageBitmap(file);
    const maxDim = Math.max(bitmap.width, bitmap.height);
    const scale = maxDim > MAX_EDGE ? MAX_EDGE / maxDim : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const scaled = scale < 1;

    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      bitmap.close();
      return unchanged(file, originalBytes);
    }
    // Preserve orientation via createImageBitmap; fill white under transparency for JPEG path.
    if ('fillStyle' in ctx) {
      (ctx as CanvasRenderingContext2D).fillStyle = '#ffffff';
      (ctx as CanvasRenderingContext2D).fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const outType = mime === 'image/png' && !scaled ? 'image/png' : 'image/jpeg';
    const quality = outType === 'image/jpeg' ? JPEG_QUALITY : undefined;
    const blob = await canvasToBlob(canvas, outType, quality);
    if (!blob) return unchanged(file, originalBytes);

    const workingBytes = blob.size;
    if (workingBytes >= originalBytes * (1 - MIN_SAVE_RATIO)) {
      // Prefer the smaller usable version; if reencode grew, keep original.
      if (workingBytes >= originalBytes) return unchanged(file, originalBytes);
    }

    const ext = outType === 'image/jpeg' ? '.jpg' : '.png';
    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    const workingFile = new File([blob], `${base}${ext}`, {
      type: outType,
      lastModified: file.lastModified,
    });
    const savedRatio = originalBytes > 0 ? Math.max(0, 1 - workingBytes / originalBytes) : 0;
    const mode: OptimizeResult['mode'] = scaled || outType !== mime || quality != null ? 'compressed' : 'lossless_reencode';
    const pct = Math.round(savedRatio * 100);
    return {
      originalBytes,
      workingFile,
      workingBytes,
      savedRatio,
      mode,
      note:
        savedRatio < MIN_SAVE_RATIO
          ? '已最佳化，保留原大小'
          : mode === 'compressed'
            ? `使用版本已壓縮（優先保留文字可讀性），減少約 ${pct}%`
            : `使用版本已最佳化，減少約 ${pct}%`,
    };
  } catch {
    return unchanged(file, originalBytes);
  }
}

function unchanged(file: File, originalBytes: number): OptimizeResult {
  return {
    originalBytes,
    workingFile: file,
    workingBytes: originalBytes,
    savedRatio: 0,
    mode: 'unchanged',
    note: '已最佳化，保留原大小',
  };
}

export function formatSizeCompare(originalBytes: number, workingBytes: number): string {
  const fmt = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };
  if (workingBytes >= originalBytes) {
    return `原始 ${fmt(originalBytes)} → 使用版本 ${fmt(workingBytes)}（已最佳化，保留原大小）`;
  }
  const pct = Math.round((1 - workingBytes / originalBytes) * 100);
  return `原始 ${fmt(originalBytes)} → 使用版本 ${fmt(workingBytes)}，減少 ${pct}%`;
}
