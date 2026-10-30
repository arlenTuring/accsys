/** Shared helpers for AI chat image staging (pure; no React). */

import { MAX_ATTACHMENTS_PER_FORM, MAX_FILE_SIZE_BYTES } from '@/lib/attachments/policy';
import { invoiceStatusNeedsConfirm } from '@/lib/attachments/invoice-reminder';

export type ClientImageStatus =
  | 'processing'
  | 'selected'
  | 'uploading'
  | 'scanning'
  | 'ready'
  | 'needs_confirm'
  | 'confirmed'
  | 'failed';

export type ClientInvoiceReminder = {
  status: string;
  summary: string;
  buyerTaxId?: string | null;
  sellerTaxId?: string | null;
};

export type ClientImageAttachment = {
  clientAttachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
  status: ClientImageStatus;
  stagedId?: string;
  error?: string;
  /** Local File retained for retry until ready. */
  file?: File;
  /** Business invoice reminder (not a security block). */
  invoice?: ClientInvoiceReminder | null;
};

export const AI_CHAT_IMAGE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif,.pdf';
/** Client ceiling — must stay ≤ server `AI_IMAGE_MAX_BYTES` in staged-images. */
export const AI_CHAT_IMAGE_MAX_BYTES = MAX_FILE_SIZE_BYTES;
export const AI_CHAT_IMAGE_MAX_COUNT = Math.min(10, MAX_ATTACHMENTS_PER_FORM);

export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload + scan are one server request — do not invent a separate scan progress.
 */
export function statusLabel(status: ClientImageStatus): string {
  switch (status) {
    case 'processing':
      return '壓縮處理中';
    case 'selected':
      return '等待上傳';
    case 'uploading':
    case 'scanning':
      return '上傳與檢查中';
    case 'ready':
      return '可使用';
    case 'needs_confirm':
      return '需確認後才可夾帶';
    case 'confirmed':
      return '已確認仍要夾帶';
    case 'failed':
      return '失敗';
  }
}

/** Statuses that may be sent to the model as vision context. */
export function canSendToModel(status: ClientImageStatus): boolean {
  return status === 'ready' || status === 'needs_confirm' || status === 'confirmed';
}

/** Draft attach requires ready (no business issue) or explicit confirmed. */
export function canAttachToDraft(status: ClientImageStatus): boolean {
  return status === 'ready' || status === 'confirmed';
}

/** Map AI invoice check into client status after security scan passed. */
export function statusAfterInvoiceCheck(
  scanReady: boolean,
  invoice: ClientInvoiceReminder | null | undefined
): ClientImageStatus {
  if (!scanReady) return 'failed';
  if (invoice && invoiceStatusNeedsConfirm(invoice.status)) return 'needs_confirm';
  return 'ready';
}

export function invoiceReminderFromCheck(raw: {
  overallStatus?: string;
  summary?: string;
  pages?: Array<{ buyerTaxId?: string | null; sellerTaxId?: string | null }>;
} | null | undefined): ClientInvoiceReminder | null {
  if (!raw?.overallStatus) return null;
  const page0 = raw.pages?.[0];
  return {
    status: raw.overallStatus,
    summary: raw.summary ?? raw.overallStatus,
    buyerTaxId: page0?.buyerTaxId ?? null,
    sellerTaxId: page0?.sellerTaxId ?? null,
  };
}

/** Pure planning: which candidates fit under the remaining slot budget. */
export function planAcceptedAttachments(
  currentCount: number,
  candidates: ClientImageAttachment[],
  maxCount: number = AI_CHAT_IMAGE_MAX_COUNT
): { accepted: ClientImageAttachment[]; overLimit: number } {
  const room = Math.max(0, maxCount - currentCount);
  const accepted = candidates.slice(0, room);
  return { accepted, overLimit: Math.max(0, candidates.length - accepted.length) };
}

/** Resolve MIME when the OS leaves `file.type` empty (common for camera rolls). */
export function resolveImageMime(file: File): string {
  if (file.type && ALLOWED_IMAGE_MIMES.has(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.heic$/i.test(name)) return 'image/heic';
  if (/\.heif$/i.test(name)) return 'image/heif';
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (file.type === 'image/jpg') return 'image/jpeg';
  return file.type;
}

export function buildImageCandidates(
  files: File[],
  newId: () => string = () => crypto.randomUUID()
): { candidates: ClientImageAttachment[]; invalid: number } {
  const candidates: ClientImageAttachment[] = [];
  let invalid = 0;
  for (const file of files) {
    const mimeType = resolveImageMime(file);
    if (!ALLOWED_IMAGE_MIMES.has(mimeType) || file.size > AI_CHAT_IMAGE_MAX_BYTES || file.size <= 0) {
      invalid += 1;
      continue;
    }
    const normalized =
      mimeType !== file.type
        ? new File([file], file.name || 'image', { type: mimeType, lastModified: file.lastModified })
        : file;
    candidates.push({
      clientAttachmentId: newId(),
      fileName: normalized.name || 'image',
      mimeType,
      sizeBytes: normalized.size,
      previewUrl: URL.createObjectURL(normalized),
      status: 'selected',
      file: normalized,
    });
  }
  return { candidates, invalid };
}
