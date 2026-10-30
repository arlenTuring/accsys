import {
  MAX_FILE_SIZE_BYTES,
  type StoredMime,
  formatBytesLabel,
} from '@/lib/attachments/policy';

export type ValidationResult = { ok: true } | { ok: false; error: string };

export { MAX_FILE_SIZE_BYTES, MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/policy';

export type AllowedMime = StoredMime;

const EXTENSION: Partial<Record<AllowedMime, string>> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/** Size check before reading the body. */
export function validateAttachmentFile(input: { sizeBytes: number }): ValidationResult {
  if (input.sizeBytes <= 0) return { ok: false, error: '檔案內容為空' };
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `檔案大小不可超過 ${formatBytesLabel(MAX_FILE_SIZE_BYTES)}` };
  }
  return { ok: true };
}

function starts(bytes: Uint8Array, sig: number[], at = 0): boolean {
  return sig.every((b, i) => bytes[at + i] === b);
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && start + i < bytes.length; i++) s += String.fromCharCode(bytes[start + i]!);
  return s;
}

/** HEIC/HEIF: ISO BMFF with ftyp brand heic/heif/mif1/msf1. */
function sniffHeic(bytes: Uint8Array): 'image/heic' | 'image/heif' | null {
  if (bytes.length < 12) return null;
  if (readAscii(bytes, 4, 4) !== 'ftyp') return null;
  const brand = readAscii(bytes, 8, 4).toLowerCase();
  if (brand === 'heic' || brand === 'heix' || brand === 'heim' || brand === 'heis') return 'image/heic';
  if (brand === 'heif' || brand === 'hevc' || brand === 'mif1' || brand === 'msf1') return 'image/heif';
  // Compatible brands after major brand
  const boxSize = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const end = Math.min(bytes.length, Math.max(16, boxSize));
  const compat = readAscii(bytes, 16, Math.max(0, end - 16)).toLowerCase();
  if (/heic|heix|heif|mif1|msf1/.test(compat)) {
    return /heic|heix/.test(compat) ? 'image/heic' : 'image/heif';
  }
  return null;
}

function sniffOfficeOpenXml(bytes: Uint8Array): AllowedMime | null {
  // ZIP local file header
  if (!starts(bytes, [0x50, 0x4b, 0x03, 0x04])) return null;
  // Look for [Content_Types].xml near the start (typical OOXML layout).
  const head = readAscii(bytes, 0, Math.min(bytes.length, 8192));
  if (!head.includes('[Content_Types].xml')) return null;
  if (head.includes('word/')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (head.includes('xl/')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (head.includes('ppt/')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  return null;
}

/**
 * Determines the type from the file's own bytes; the browser-supplied MIME type
 * and extension are ignored for security decisions.
 */
export function sniffAllowedType(bytes: Uint8Array): AllowedMime | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    starts(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  const heic = sniffHeic(bytes);
  if (heic) return heic;
  const office = sniffOfficeOpenXml(bytes);
  if (office) return office;
  return null;
}

/** Display name only (never used in a path). */
export function sanitizeFileName(raw: string, mime: AllowedMime): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  let name = base
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  if (!name) name = 'attachment';
  const ext = EXTENSION[mime];
  if (!ext) return name;
  if (!name.toLowerCase().endsWith(ext) && !(mime === 'image/jpeg' && /\.jpe?g$/i.test(name))) {
    if (mime === 'image/heif' && /\.heic$/i.test(name)) return name;
    name += ext;
  }
  return name;
}

/** Force download Content-Disposition. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Inline disposition for controlled preview of safe static types only. */
export function contentDispositionInline(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
