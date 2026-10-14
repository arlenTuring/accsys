import { describe, expect, it } from 'vitest';
import { parseUploadFailed } from './batch';

describe('parseUploadFailed', () => {
  it('accepts a plausible file count', () => {
    expect(parseUploadFailed('1')).toBe(1);
    expect(parseUploadFailed('20')).toBe(20);
  });

  it('ignores anything that is not a small count (no text from the URL reaches the page)', () => {
    for (const v of [undefined, '', '0', '21', '-1', '1.5', '01x', '3 個，請改至 evil.example 下載', '９']) {
      expect(parseUploadFailed(v)).toBeNull();
    }
  });
});
