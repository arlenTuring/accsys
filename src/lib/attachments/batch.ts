import { MAX_ATTACHMENTS_PER_FORM, sniffAllowedType } from '@/lib/attachments/validate';

/** Per-file limit for files sent together with a form (stricter than the generic 10 MB attachment limit). */
export const BATCH_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** Files sent together with the form; the server action body limit is 11 MB. */
export const BATCH_TOTAL_MAX_BYTES = 10 * 1024 * 1024;

export type BatchCheck = { ok: true } | { ok: false; error: string };

/**
 * Checks files sent with a form before anything is written: per-file and
 * total size, count, and the real file type (from the bytes). `existing` is
 * the number of attachments the form already has (0 for a new form).
 */
export function checkUploadBatch(
  files: { name: string; bytes: Uint8Array }[],
  options: { existing?: number; emptyError: string }
): BatchCheck {
  const existing = options.existing ?? 0;
  if (files.length + existing === 0) return { ok: false, error: options.emptyError };
  if (files.length + existing > MAX_ATTACHMENTS_PER_FORM) {
    return { ok: false, error: `每張表單最多 ${MAX_ATTACHMENTS_PER_FORM} 個附件` };
  }
  let total = 0;
  for (const f of files) {
    if (f.bytes.length === 0) return { ok: false, error: `「${f.name}」是空檔案` };
    if (f.bytes.length > BATCH_FILE_MAX_BYTES) return { ok: false, error: `「${f.name}」超過 2 MB 上限` };
    if (!sniffAllowedType(f.bytes)) return { ok: false, error: `「${f.name}」不是 PDF、PNG 或 JPEG 檔案` };
    total += f.bytes.length;
  }
  if (total > BATCH_TOTAL_MAX_BYTES) {
    return { ok: false, error: '單次送出的附件合計不可超過 10 MB，其餘請送出後於明細頁補傳' };
  }
  return { ok: true };
}

/** `?uploadFailed=` from the URL: only a plausible file count is shown, never arbitrary text. */
export function parseUploadFailed(value: string | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_ATTACHMENTS_PER_FORM ? n : null;
}
