import { MAX_FILE_SIZE_BYTES, formatBytesLabel } from '@/lib/attachments/policy';

export type SurveyMediaMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm';

const EXTENSION: Record<SurveyMediaMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

export function validateSurveyMediaSize(sizeBytes: number): { ok: true } | { ok: false; error: string } {
  if (sizeBytes <= 0) return { ok: false, error: '檔案內容為空' };
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
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

function isHeicBrand(brand: string): boolean {
  return /^(heic|heix|heim|heis|heif|hevc|mif1|msf1)$/i.test(brand);
}

/** MP4 family (exclude HEIC/HEIF brands that also use ftyp). */
function sniffMp4(bytes: Uint8Array): 'video/mp4' | null {
  if (bytes.length < 12) return null;
  if (readAscii(bytes, 4, 4) !== 'ftyp') return null;
  const brand = readAscii(bytes, 8, 4);
  if (isHeicBrand(brand)) return null;
  const boxSize = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const end = Math.min(bytes.length, Math.max(16, boxSize));
  const compat = readAscii(bytes, 16, Math.max(0, end - 16));
  if (isHeicBrand(brand) || /heic|heix|heif|mif1|msf1/i.test(compat)) return null;
  return 'video/mp4';
}

/**
 * Survey question media only: JPEG / PNG / WebP images and MP4 / WebM video.
 * Type is taken from file bytes, not the browser-supplied MIME.
 */
export function sniffSurveyMediaType(bytes: Uint8Array): SurveyMediaMime | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    starts(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  return sniffMp4(bytes);
}

export function sanitizeSurveyMediaFileName(raw: string, mime: SurveyMediaMime): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  let name = base
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  if (!name) name = mime.startsWith('video/') ? 'video' : 'image';
  const ext = EXTENSION[mime];
  if (!name.toLowerCase().endsWith(ext) && !(mime === 'image/jpeg' && /\.jpe?g$/i.test(name))) {
    name += ext;
  }
  return name;
}

export function surveyMediaKind(mime: string): 'image' | 'video' {
  return mime.startsWith('video/') ? 'video' : 'image';
}

export const SURVEY_MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.webm';
export const MAX_MEDIA_PER_QUESTION = 5;
