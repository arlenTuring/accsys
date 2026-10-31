import { describe, expect, it } from 'vitest';
import {
  EMPTY_EDIT,
  fromOutput,
  isEmptyEdit,
  outputSize,
  pushState,
  redo,
  rotateRight,
  rotatedCrop,
  startHistory,
  toOutput,
  toRotated,
  undo,
  type Point,
  type Rotation,
} from './photo-geometry';

const near = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('rotation', () => {
  it('four right turns return to the original orientation', () => {
    let r: Rotation = 0;
    const seen: Rotation[] = [];
    for (let i = 0; i < 4; i++) {
      r = rotateRight(r);
      seen.push(r);
    }
    expect(seen).toEqual([90, 180, 270, 0]);
  });

  it('rotates clockwise: the top-left corner moves to the top-right', () => {
    near(toRotated({ x: 0, y: 0 }, 90), { x: 1, y: 0 });
    near(toRotated({ x: 1, y: 0 }, 90), { x: 1, y: 1 });
  });
});

describe('output coordinates', () => {
  const p = { x: 0.3, y: 0.7 };
  it.each([0, 90, 180, 270] as Rotation[])('round-trips at %d°, with and without crop', (rotation) => {
    near(fromOutput(toOutput(p, { rotation, crop: null }), { rotation, crop: null }), p);
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    near(fromOutput(toOutput(p, { rotation, crop }), { rotation, crop }), p);
  });

  it('an annotation stays on the same spot of the photo when the picture is rotated', () => {
    const on0 = toOutput(p, { rotation: 0, crop: null });
    const on90 = toOutput(p, { rotation: 90, crop: null });
    near(on90, { x: 1 - on0.y, y: on0.x });
  });

  it('the crop rectangle follows the rotation', () => {
    const r = rotatedCrop({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 90);
    expect(r.x).toBeCloseTo(0.4);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.4);
    expect(r.h).toBeCloseTo(0.3);
  });
});

describe('outputSize', () => {
  it('swaps width and height at 90° and applies the crop', () => {
    expect(outputSize(400, 200, { rotation: 90, crop: null })).toMatchObject({ width: 200, height: 400 });
    expect(outputSize(400, 200, { rotation: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toMatchObject({ width: 200, height: 100 });
  });

  it('caps the long edge', () => {
    expect(outputSize(8000, 4000, { rotation: 0, crop: null }, 4000)).toMatchObject({ width: 4000, height: 2000 });
  });
});

describe('history', () => {
  it('undo and redo walk through states; a new change clears redo', () => {
    const a = { ...EMPTY_EDIT, rotation: 90 as Rotation };
    const b = { ...EMPTY_EDIT, rotation: 180 as Rotation };
    let h = pushState(pushState(startHistory(EMPTY_EDIT), a), b);
    h = undo(h);
    expect(h.present).toBe(a);
    h = redo(h);
    expect(h.present).toBe(b);
    h = undo(h);
    h = pushState(h, EMPTY_EDIT);
    expect(h.future).toEqual([]);
    expect(isEmptyEdit(h.present)).toBe(true);
  });
});
