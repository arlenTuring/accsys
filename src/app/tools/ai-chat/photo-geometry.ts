/**
 * Pure geometry of the photo editor. Crop and annotations are stored in
 * original-image coordinates (0–1), so they stay on the same spot of the photo
 * whatever the rotation; everything on screen is derived from that.
 */

export type Rotation = 0 | 90 | 180 | 270;
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Annotation =
  | { kind: 'rect'; a: Point; b: Point }
  | { kind: 'arrow'; a: Point; b: Point }
  | { kind: 'text'; at: Point; text: string }
  | { kind: 'free'; points: Point[] };

export type EditState = { rotation: Rotation; crop: Rect | null; annotations: Annotation[] };

export const EMPTY_EDIT: EditState = { rotation: 0, crop: null, annotations: [] };

export function isEmptyEdit(s: EditState): boolean {
  return s.rotation === 0 && !s.crop && s.annotations.length === 0;
}

export const rotateRight = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);

/** Original coordinates → rotated coordinates (clockwise rotation). */
export function toRotated(p: Point, r: Rotation): Point {
  switch (r) {
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
    default:
      return p;
  }
}

export function fromRotated(p: Point, r: Rotation): Point {
  return toRotated(p, ((360 - r) % 360) as Rotation);
}

/** The crop rectangle as seen after rotation. */
export function rotatedCrop(crop: Rect | null, r: Rotation): Rect {
  if (!crop) return { x: 0, y: 0, w: 1, h: 1 };
  const a = toRotated({ x: crop.x, y: crop.y }, r);
  const b = toRotated({ x: crop.x + crop.w, y: crop.y + crop.h }, r);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Original coordinates → output coordinates (0–1 of the visible, cropped picture). */
export function toOutput(p: Point, s: Pick<EditState, 'rotation' | 'crop'>): Point {
  const q = toRotated(p, s.rotation);
  const c = rotatedCrop(s.crop, s.rotation);
  return { x: (q.x - c.x) / c.w, y: (q.y - c.y) / c.h };
}

/** Output coordinates (a pointer on the canvas) → original coordinates. */
export function fromOutput(p: Point, s: Pick<EditState, 'rotation' | 'crop'>): Point {
  const c = rotatedCrop(s.crop, s.rotation);
  return fromRotated({ x: c.x + p.x * c.w, y: c.y + p.y * c.h }, s.rotation);
}

/** Pixel size of the output for a source image, capped on the long edge. */
export function outputSize(srcW: number, srcH: number, s: Pick<EditState, 'rotation' | 'crop'>, maxEdge = 4096) {
  const swapped = s.rotation === 90 || s.rotation === 270;
  const rw = swapped ? srcH : srcW;
  const rh = swapped ? srcW : srcH;
  const c = rotatedCrop(s.crop, s.rotation);
  const w = rw * c.w;
  const h = rh * c.h;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale, rw, rh, crop: c };
}

/** Undo/redo over immutable states. */
export type History = { past: EditState[]; present: EditState; future: EditState[] };

export const startHistory = (present: EditState): History => ({ past: [], present, future: [] });

export function pushState(h: History, next: EditState): History {
  return { past: [...h.past, h.present].slice(-100), present: next, future: [] };
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
}

export function redo(h: History): History {
  const next = h.future[0];
  return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) } : h;
}
