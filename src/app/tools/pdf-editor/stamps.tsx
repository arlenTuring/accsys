'use client';

import type { StampKind } from './types';

/** Inline SVG glyph for on-screen stamps */
export function StampGlyph({
  kind,
  color,
  className = '',
}: {
  kind: StampKind;
  color: string;
  className?: string;
}) {
  const stroke = color;
  const common = {
    fill: 'none' as const,
    stroke,
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <svg viewBox="0 0 24 24" className={`h-full w-full ${className}`} aria-hidden>
      {kind === 'check' && (
        <path {...common} d="M4 12.5 L9.5 18 L20 5.5" strokeWidth={2.8} />
      )}
      {kind === 'cross' && (
        <>
          <path {...common} d="M6 6 L18 18" strokeWidth={2.8} />
          <path {...common} d="M18 6 L6 18" strokeWidth={2.8} />
        </>
      )}
      {kind === 'square' && (
        <rect x="4" y="4" width="16" height="16" rx="0.5" {...common} strokeWidth={2.4} />
      )}
      {kind === 'square_fill' && (
        <rect x="4" y="4" width="16" height="16" fill={color} stroke={color} />
      )}
      {kind === 'circle' && <circle cx="12" cy="12" r="8" {...common} strokeWidth={2.4} />}
      {kind === 'circle_fill' && <circle cx="12" cy="12" r="8" fill={color} stroke={color} />}
      {kind === 'checkbox' && (
        <rect x="4" y="4" width="16" height="16" rx="1" {...common} strokeWidth={2.2} />
      )}
      {kind === 'line' && (
        <path {...common} d="M2 18 H22" strokeWidth={2.4} />
      )}
      {kind === 'arrow' && (
        <>
          <path {...common} d="M3 12 H19" strokeWidth={2.4} />
          <path {...common} d="M14 6 L20 12 L14 18" strokeWidth={2.4} />
        </>
      )}
    </svg>
  );
}

/** Draw stamp onto a canvas for PDF export (vector-ish via path). */
export function drawStampOnCanvas(
  ctx: CanvasRenderingContext2D,
  kind: StampKind,
  color: string,
  width: number,
  height: number
) {
  const s = Math.min(width, height);
  const ox = (width - s) / 2;
  const oy = (height - s) / 2;
  const scale = s / 24;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.4;

  const strokePath = (d: string) => {
    const p = new Path2D(d);
    ctx.stroke(p);
  };

  switch (kind) {
    case 'check':
      ctx.lineWidth = 2.8;
      strokePath('M4 12.5 L9.5 18 L20 5.5');
      break;
    case 'cross':
      ctx.lineWidth = 2.8;
      strokePath('M6 6 L18 18');
      strokePath('M18 6 L6 18');
      break;
    case 'square':
      ctx.strokeRect(4, 4, 16, 16);
      break;
    case 'square_fill':
      ctx.fillRect(4, 4, 16, 16);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(12, 12, 8, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'circle_fill':
      ctx.beginPath();
      ctx.arc(12, 12, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'checkbox':
      ctx.strokeRect(4, 4, 16, 16);
      break;
    case 'line':
      // Use full width of the annotation box for underline stamps
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, height * 0.12);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2, height * 0.75);
      ctx.lineTo(width - 2, height * 0.75);
      ctx.stroke();
      break;
    case 'arrow':
      strokePath('M3 12 H19');
      strokePath('M14 6 L20 12 L14 18');
      break;
  }
  ctx.restore();
}

export async function renderStampPng(
  kind: StampKind,
  color: string,
  widthPx: number,
  heightPx: number
): Promise<Uint8Array> {
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(widthPx * dpr));
  canvas.height = Math.max(2, Math.round(heightPx * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立圖章畫布');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, widthPx, heightPx);
  drawStampOnCanvas(ctx, kind, color, widthPx, heightPx);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖章 PNG 失敗'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}
