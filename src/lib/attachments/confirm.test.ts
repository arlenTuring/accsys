import { describe, expect, it } from 'vitest';
import { isServable } from './service';

describe('confirm vs scan isolation', () => {
  it('servable statuses allow business confirm path', () => {
    expect(isServable('clean')).toBe(true);
    expect(isServable('infected')).toBe(false);
    expect(isServable('pending')).toBe(false);
    expect(isServable('scan_failed')).toBe(false);
  });
});
