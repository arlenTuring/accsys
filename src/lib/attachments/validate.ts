export type ValidationResult = { ok: true } | { ok: false; error: string };

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function validateAttachmentFile(input: {
  mimeType: string;
  sizeBytes: number;
}): ValidationResult {
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    return { ok: false, error: '僅接受 PDF、PNG、JPEG 檔案' };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, error: '檔案內容為空' };
  }
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: '檔案大小不可超過 10 MB' };
  }
  return { ok: true };
}
