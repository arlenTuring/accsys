import { describe, expect, it } from 'vitest';
import { contentDisposition, sanitizeFileName, sniffAllowedType, validateAttachmentFile } from './validate';

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe('validateAttachmentFile', () => {
  it('accepts sizes from 1 byte to 10 MB', () => {
    expect(validateAttachmentFile({ sizeBytes: 1 }).ok).toBe(true);
    expect(validateAttachmentFile({ sizeBytes: 10 * 1024 * 1024 }).ok).toBe(true);
  });

  it('rejects empty and oversized files', () => {
    expect(validateAttachmentFile({ sizeBytes: 0 }).ok).toBe(false);
    expect(validateAttachmentFile({ sizeBytes: 10 * 1024 * 1024 + 1 }).ok).toBe(false);
  });
});

describe('sniffAllowedType', () => {
  it('recognizes PDF, PNG and JPEG by their bytes', () => {
    expect(sniffAllowedType(text('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(sniffAllowedType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(sniffAllowedType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it.each([
    ['HTML', '<!doctype html><script>alert(1)</script>'],
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ['script with PDF-like text later', 'hello %PDF-1.7'],
    ['ZIP / Office', 'PK\u0003\u0004'],
  ])('rejects %s regardless of the declared type', (_label, content) => {
    expect(sniffAllowedType(text(content))).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it('drops directories, traversal and control characters', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf', 'application/pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\Users\\x\\報價單.pdf', 'application/pdf')).toBe('報價單.pdf');
    expect(sanitizeFileName('a\u202egnp.exe', 'image/png')).toBe('agnp.exe.png');
    expect(sanitizeFileName('...', 'image/jpeg')).toBe('attachment.jpg');
  });

  it('forces the extension of the detected type', () => {
    expect(sanitizeFileName('invoice.html', 'application/pdf')).toBe('invoice.html.pdf');
    expect(sanitizeFileName('photo.JPEG', 'image/jpeg')).toBe('photo.JPEG');
  });
});

describe('contentDisposition', () => {
  it('always downloads and escapes quotes, CR/LF and non-ASCII', () => {
    const value = contentDisposition('報價"單\r\n.pdf');
    expect(value.startsWith('attachment; ')).toBe(true);
    expect(value).not.toMatch(/[\r\n]/);
    expect(value).toContain("filename*=UTF-8''");
  });
});
