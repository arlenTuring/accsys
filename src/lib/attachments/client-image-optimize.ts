/**
 * Browser-only photo downscale before upload (forms + AI chat).
 * Shrinks long edge and re-encodes JPEG/WebP so storage / chat payloads stay smaller.
 * HEIC／PDF／Office are left unchanged (server may convert HEIC later).
 */

export const IMAGE_MAX_EDGE_PX = 1600;
export const IMAGE_JPEG_QUALITY = 0.78;
export const IMAGE_WEBP_QUALITY = 0.78;
/** Skip work for already-small files. */
export const IMAGE_OPTIMIZE_MIN_BYTES = 250_000;

const OPTIMIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type OptimizeResult = {
  file: File;
  optimized: boolean;
  originalBytes: number;
  outputBytes: number;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('image_load_timeout'));
    }, 8000);
    img.onload = () =>
      done(() => {
        URL.revokeObjectURL(url);
        resolve(img);
      });
    img.onerror = () =>
      done(() => {
        URL.revokeObjectURL(url);
        reject(new Error('image_load_failed'));
      });
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

/**
 * Downscale + re-encode when beneficial. Never enlarges; on failure returns original.
 */
export async function optimizeImageForUpload(file: File): Promise<OptimizeResult> {
  const originalBytes = file.size;
  if (typeof window === 'undefined' || !OPTIMIZABLE.has(file.type)) {
    return { file, optimized: false, originalBytes, outputBytes: originalBytes };
  }
  if (file.size < IMAGE_OPTIMIZE_MIN_BYTES) {
    return { file, optimized: false, originalBytes, outputBytes: originalBytes };
  }

  try {
    const img = await loadImage(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) {
      return { file, optimized: false, originalBytes, outputBytes: originalBytes };
    }

    const longEdge = Math.max(w, h);
    const scale = longEdge > IMAGE_MAX_EDGE_PX ? IMAGE_MAX_EDGE_PX / longEdge : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    // Already within edge and not huge — still re-encode if very large PNG/JPEG.
    const needsResize = scale < 1;
    const needsReencode = file.size > 1.5 * 1024 * 1024;
    if (!needsResize && !needsReencode) {
      return { file, optimized: false, originalBytes, outputBytes: originalBytes };
    }

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { file, optimized: false, originalBytes, outputBytes: originalBytes };
    }
    ctx.drawImage(img, 0, 0, tw, th);

    const outType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const quality = outType === 'image/webp' ? IMAGE_WEBP_QUALITY : IMAGE_JPEG_QUALITY;
    const blob = await canvasToBlob(canvas, outType, quality);
    if (!blob || blob.size >= file.size * 0.98) {
      // Not smaller enough — keep original.
      return { file, optimized: false, originalBytes, outputBytes: originalBytes };
    }

    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    const ext = outType === 'image/webp' ? 'webp' : 'jpg';
    const next = new File([blob], `${base}.${ext}`, {
      type: outType,
      lastModified: Date.now(),
    });
    return {
      file: next,
      optimized: true,
      originalBytes,
      outputBytes: next.size,
    };
  } catch {
    return { file, optimized: false, originalBytes, outputBytes: originalBytes };
  }
}

export async function optimizeFilesForUpload(files: File[]): Promise<{
  files: File[];
  optimizedCount: number;
}> {
  const out: File[] = [];
  let optimizedCount = 0;
  for (const f of files) {
    const r = await optimizeImageForUpload(f);
    out.push(r.file);
    if (r.optimized) optimizedCount += 1;
  }
  return { files: out, optimizedCount };
}
