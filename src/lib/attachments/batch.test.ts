import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENTS_PER_FORM } from './policy';
import { parseUploadFailed } from './batch';

describe('parseUploadFailed', () => {
  it('accepts a plausible file count within policy', () => {
    expect(parseUploadFailed('1')).toBe(1);
    expect(parseUploadFailed('20')).toBe(20);
    expect(parseUploadFailed(String(MAX_ATTACHMENTS_PER_FORM))).toBe(MAX_ATTACHMENTS_PER_FORM);
  });

  it('ignores anything that is not a small count (no text from the URL reaches the page)', () => {
    for (const v of [
      undefined,
      '',
      '0',
      String(MAX_ATTACHMENTS_PER_FORM + 1),
      '201',
      '-1',
      '1.5',
      '01x',
      '3 個，請改至 evil.example 下載',
      '９',
    ]) {
      expect(parseUploadFailed(v)).toBeNull();
    }
  });
});
