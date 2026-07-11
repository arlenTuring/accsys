import { describe, expect, it } from 'vitest';
import { validateAttachmentFile } from './validate';

describe('validateAttachmentFile', () => {
  it('accepts a PDF within the size limit', () => {
    expect(validateAttachmentFile({ mimeType: 'application/pdf', sizeBytes: 1024 })).toEqual({
      ok: true,
    });
  });

  it('accepts PNG and JPEG', () => {
    expect(validateAttachmentFile({ mimeType: 'image/png', sizeBytes: 1024 })).toEqual({ ok: true });
    expect(validateAttachmentFile({ mimeType: 'image/jpeg', sizeBytes: 1024 })).toEqual({ ok: true });
  });

  it('rejects an unsupported mime type', () => {
    expect(
      validateAttachmentFile({ mimeType: 'application/x-msdownload', sizeBytes: 1024 })
    ).toEqual({ ok: false, error: '僅接受 PDF、PNG、JPEG 檔案' });
  });

  it('rejects a zero-byte file', () => {
    expect(validateAttachmentFile({ mimeType: 'application/pdf', sizeBytes: 0 })).toEqual({
      ok: false,
      error: '檔案內容為空',
    });
  });

  it('rejects a file over 10 MB', () => {
    expect(
      validateAttachmentFile({ mimeType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 + 1 })
    ).toEqual({ ok: false, error: '檔案大小不可超過 10 MB' });
  });
});
