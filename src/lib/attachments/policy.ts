/**
 * Unified attachment policy for form uploads, AI chat staging, and draft attach.
 * Limits are finite resource guards — never Infinity.
 */

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Per-file ceiling (default 50 MiB). */
export const MAX_FILE_SIZE_BYTES = envInt('ATTACHMENT_MAX_BYTES', 50 * 1024 * 1024, 1_000_000, 200 * 1024 * 1024);

/** Per-form / per-message attachment count ceiling (default 50). */
export const MAX_ATTACHMENTS_PER_FORM = envInt('ATTACHMENT_MAX_COUNT', 50, 1, 200);

/** Files one chat message may carry (never above the per-form ceiling). */
export const MAX_CHAT_ATTACHMENTS = Math.min(envInt('ATTACHMENT_CHAT_MAX_COUNT', 10, 1, 50), MAX_ATTACHMENTS_PER_FORM);

/** One AI check of one file may take this long; afterwards it is reported as not completed. */
export const ANALYSIS_TIMEOUT_MS = envInt('ATTACHMENT_ANALYSIS_TIMEOUT_MS', 90_000, 5_000, 300_000);

/** Largest payload sent inline to the model; bigger PDFs are analysed from their first pages. */
export const ANALYSIS_MAX_INLINE_BYTES = envInt('ATTACHMENT_ANALYSIS_MAX_BYTES', 18 * 1024 * 1024, 1_000_000, 20 * 1024 * 1024);

/** Multipart chunk size for resumable uploads (default 2 MiB). */
export const UPLOAD_CHUNK_BYTES = envInt('ATTACHMENT_CHUNK_BYTES', 2 * 1024 * 1024, 256 * 1024, 8 * 1024 * 1024);

/** Concurrent upload workers in the browser (advisory). */
export const UPLOAD_CONCURRENCY = envInt('ATTACHMENT_UPLOAD_CONCURRENCY', 2, 1, 4);

/** Max pages analysed / rendered per PDF request. */
export const PDF_PAGE_BATCH = envInt('ATTACHMENT_PDF_PAGE_BATCH', 5, 1, 20);

export const PREVIEWABLE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const ANALYZABLE_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export type StoredMime =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function canPreviewInBrowser(mime: string): boolean {
  return mime === 'application/pdf' || mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp';
}

export function needsPreviewDerivative(mime: string): boolean {
  return mime === 'image/heic' || mime === 'image/heif' || mime.startsWith('application/vnd.openxmlformats');
}

export function formatBytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Field title for attachment pickers — never hardcode legacy 2MB copy. */
export function attachmentFieldLabel(prefix = '附件'): string {
  return `${prefix}（單檔上限 ${formatBytesLabel(MAX_FILE_SIZE_BYTES)}，可上傳多個）`;
}

/** Rewrite stale schema / hardcoded labels that still say 2MB. */
export function normalizeAttachmentFieldLabel(label: string): string {
  if (!label) return attachmentFieldLabel();
  if (/2\s*MB|2MB|3\s*MB|3MB/i.test(label)) {
    const prefix = label.replace(/[（(].*$/, '').trim() || '附件';
    return attachmentFieldLabel(prefix);
  }
  return label;
}
