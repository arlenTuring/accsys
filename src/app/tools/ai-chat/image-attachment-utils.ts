/** Shared helpers for AI chat image staging (pure; no React). */

import { MAX_CHAT_ATTACHMENTS, MAX_FILE_SIZE_BYTES } from '@/lib/attachments/policy';
import { invoiceStatusNeedsConfirm } from '@/lib/attachments/invoice-reminder';

/**
 * selected → uploading (original file, real type, security scan; no AI)
 * → scanned (waits for 確認並檢查) → checking (AI) → ready / needs_confirm
 * → attached to the draft chosen at 確認並檢查 (the strip entry then goes away).
 */
export type ClientImageStatus =
  | 'processing'
  | 'selected'
  | 'uploading'
  | 'scanning'
  | 'scanned'
  | 'checking'
  | 'ready'
  | 'attaching'
  | 'needs_confirm'
  | 'confirmed'
  | 'attach_failed'
  | 'failed'
  /** Failed the security scan: quarantined, no retry, no 仍要夾帶. */
  | 'blocked';

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
  /** Upload progress 0–100 while uploading. */
  progress?: number;
  /** Bumped after each saved photo edit (0 / undefined = the original). */
  edited?: number;
  /** Draft chosen when the person pressed 確認並檢查; attaching never follows a later tab switch. */
  target?: { draftId: string; title: string };
  /** Business invoice reminder (not a security block). */
  invoice?: ClientInvoiceReminder | null;
};

export const AI_CHAT_IMAGE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif,.pdf';
/** Client ceiling — must stay ≤ server `AI_IMAGE_MAX_BYTES` in staged-images. */
export const AI_CHAT_IMAGE_MAX_BYTES = MAX_FILE_SIZE_BYTES;
export const AI_CHAT_IMAGE_MAX_COUNT = MAX_CHAT_ATTACHMENTS;

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

export function statusLabel(status: ClientImageStatus): string {
  switch (status) {
    case 'processing':
    case 'selected':
      return '準備上傳';
    case 'uploading':
    case 'scanning':
      return '上傳與安全檢查中';
    case 'scanned':
      return '等待確認（尚未送 AI）';
    case 'checking':
      return 'AI 檢查中';
    case 'ready':
      return '檢查完成';
    case 'attaching':
      return '加入草稿中';
    case 'needs_confirm':
      return '需確認提醒';
    case 'confirmed':
      return '已確認仍要夾帶';
    case 'attach_failed':
      return '尚未加入草稿';
    case 'failed':
      return '失敗';
    case 'blocked':
      return '未通過安全掃描，已隔離';
  }
}

/** Statuses that may be sent to the model as vision context (the person pressed 傳送訊息). */
export function canSendToModel(status: ClientImageStatus): boolean {
  return ['scanned', 'ready', 'needs_confirm', 'confirmed', 'attach_failed'].includes(status);
}

/** Draft attach requires a finished check (no business issue) or explicit confirmation. */
export function canAttachToDraft(status: ClientImageStatus): boolean {
  return status === 'ready' || status === 'confirmed' || status === 'attach_failed';
}

/** Map AI invoice check into client status after security scan passed. */
export function statusAfterInvoiceCheck(invoice: ClientInvoiceReminder | null | undefined): ClientImageStatus {
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
