export type ValidationResult = { ok: true } | { ok: false; error: string };

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_FORM = 20;
export type AllowedMime = 'application/pdf' | 'image/png' | 'image/jpeg';

const EXTENSION: Record<AllowedMime, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

/** Size check before reading the body. */
export function validateAttachmentFile(input: { sizeBytes: number }): ValidationResult {
  if (input.sizeBytes <= 0) return { ok: false, error: '檔案內容為空' };
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) return { ok: false, error: '檔案大小不可超過 10 MB' };
  return { ok: true };
}

/**
 * Determines the type from the file's own bytes; the browser-supplied MIME type
 * and extension are ignored. Anything that is not a PDF, PNG or JPEG (HTML,
 * SVG, scripts, archives, Office files...) is rejected.
 */
export function sniffAllowedType(bytes: Uint8Array): AllowedMime | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  return null;
}

/** Display name only (never used in a path): no directories, control characters or bidi overrides. */
export function sanitizeFileName(raw: string, mime: AllowedMime): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  let name = base
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  if (!name) name = 'attachment';
  const ext = EXTENSION[mime];
  if (!name.toLowerCase().endsWith(ext) && !(mime === 'image/jpeg' && /\.jpe?g$/i.test(name))) name += ext;
  return name;
}

/** Content-Disposition value that is safe for any file name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
