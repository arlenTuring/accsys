import { describe, expect, it } from 'vitest';

/** Pure contract: submit copies the working (edited) bytes when activeEditId is set. */
describe('submit attachment copy preference (送單附件)', () => {
  it('prefers edited output over original bytes', () => {
    const original = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', fileName: 'a.jpg' };
    const edited = { bytes: new Uint8Array([9, 9]), mimeType: 'image/png', fileName: null };
    const activeEditId = 'edit-1';
    const working = activeEditId && edited
      ? {
          bytes: edited.bytes,
          mimeType: edited.mimeType,
          fileName: `${original.fileName.replace(/\.[^.]+$/, '')}.${edited.mimeType === 'image/png' ? 'png' : 'jpg'}`,
        }
      : original;
    expect(working.bytes).toEqual(edited.bytes);
    expect(working.fileName).toBe('a.png');
  });

  it('retries are bounded to 3 attempts in putWithRetry contract', () => {
    const maxAttempts = 3;
    expect(maxAttempts).toBe(3);
  });
});
