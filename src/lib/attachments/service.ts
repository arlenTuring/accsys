import { createHash, randomUUID } from 'node:crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { canReadForm, isFormType, isUuid, type Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { scanBytes, scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { promote, quarantineKey, readNoFollow, removeKey, writeNew } from '@/lib/attachments/storage';
import {
  MAX_ATTACHMENTS_PER_FORM,
  sanitizeFileName,
  sniffAllowedType,
  validateAttachmentFile,
} from '@/lib/attachments/validate';

export type UploadResult =
  | { ok: true; attachmentId: string; scanStatus: string }
  | { ok: false; error: string };

/**
 * Upload pipeline (files and the database share no transaction, so each step
 * has an explicit state):
 *   1. authorize + validate size, count and real file type
 *   2. insert row as 'pending' (server-generated storage key)
 *   3. write bytes to quarantine, scan with the local scanner
 *   4. clean -> move to its final key; infected -> delete; failure -> stays in
 *      quarantine as 'scan_failed' for scripts/attachments-rescan.ts
 * Only 'clean' files are ever served ('unscanned' only in development).
 */
export async function uploadAttachmentFor(
  actor: Actor | null,
  formType: unknown,
  formId: unknown,
  file: unknown
): Promise<UploadResult> {
  if (!actor) return { ok: false, error: '找不到您的員工資料' };
  if (!isFormType(formType) || !isUuid(formId) || !(await canReadForm(actor, formType, formId))) {
    return { ok: false, error: '您沒有權限為此表單上傳附件' };
  }
  if (!(file instanceof File)) return { ok: false, error: '請選擇檔案' };
  const size = validateAttachmentFile({ sizeBytes: file.size });
  if (!size.ok) return size;

  let scanner;
  try {
    scanner = scannerConfig();
  } catch (err) {
    if (err instanceof ScannerUnavailable) {
      console.error('[attachments] upload refused:', err.message);
      return { ok: false, error: '附件掃描服務未設定，暫時無法上傳，請聯絡系統管理員' };
    }
    throw err;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length === 0) return { ok: false, error: '檔案內容不完整' };
  const mime = sniffAllowedType(bytes);
  if (!mime) return { ok: false, error: '僅接受 PDF、PNG、JPEG 檔案（以檔案內容判斷）' };

  const db = getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(attachments)
    .where(and(eq(attachments.formType, formType), eq(attachments.formId, formId)));
  if (n >= MAX_ATTACHMENTS_PER_FORM) return { ok: false, error: `每張表單最多 ${MAX_ATTACHMENTS_PER_FORM} 個附件` };

  const id = randomUUID();
  const finalKey = `${formType}/${formId}/${randomUUID()}`;
  const fileName = sanitizeFileName(file.name, mime);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  await db.transaction(async (tx) => {
    await tx.insert(attachments).values({
      id,
      formType,
      formId,
      uploadedByEmployeeId: actor.id,
      storagePath: finalKey,
      fileName,
      mimeType: mime,
      fileSizeBytes: bytes.length,
      scanStatus: 'pending',
      sha256,
    });
    await recordAudit(tx, {
      actorEmployeeId: actor.id,
      action: 'attachment.uploaded',
      entityType: formType,
      entityId: formId,
      details: { attachmentId: id, mime, size: bytes.length, sha256 },
    });
  });

  await writeNew(quarantineKey(id), bytes);
  const verdict = await scanBytes(bytes, scanner);
  const status = await settleScan(id, finalKey, verdict);
  if (status === 'infected') return { ok: false, error: '檔案未通過安全掃描，已拒絕' };
  if (status === 'scan_failed') return { ok: false, error: '檔案安全掃描失敗，已暫存待重新掃描，目前無法下載' };
  return { ok: true, attachmentId: id, scanStatus: status };
}

/** Applies a scanner verdict to a quarantined attachment. */
export async function settleScan(
  id: string,
  finalKey: string,
  verdict: 'clean' | 'infected' | 'scan_failed' | 'unscanned'
): Promise<string> {
  if (verdict === 'clean' || verdict === 'unscanned') await promote(quarantineKey(id), finalKey);
  if (verdict === 'infected') await removeKey(quarantineKey(id));
  await getDb()
    .update(attachments)
    .set({ scanStatus: verdict, scannedAt: verdict === 'unscanned' ? null : sql`now()` })
    .where(eq(attachments.id, id));
  return verdict;
}

export function isServable(scanStatus: string, env: Record<string, string | undefined> = process.env): boolean {
  if (scanStatus === 'clean') return true;
  // Development without a scanner only; production never serves unscanned files.
  return scanStatus === 'unscanned' && env.NODE_ENV !== 'production' && env.ATTACHMENT_SCAN?.trim() !== 'clamav';
}

export type DownloadResult =
  | { ok: true; bytes: Buffer; fileName: string; mimeType: string }
  | { ok: false; status: 404 | 409 };

/** Authorized read by attachment ID. Unauthorized and missing look identical (404). */
export async function readAttachmentFor(actor: Actor | null, attachmentId: unknown): Promise<DownloadResult> {
  if (!actor || !isUuid(attachmentId)) return { ok: false, status: 404 };
  const [row] = await getDb().select().from(attachments).where(eq(attachments.id, attachmentId));
  if (!row || !(await canReadForm(actor, row.formType, row.formId))) return { ok: false, status: 404 };
  if (!isServable(row.scanStatus)) return { ok: false, status: 409 };
  try {
    const bytes = await readNoFollow(row.storagePath);
    // Re-check the content type at serve time (covers files placed by older code).
    if (sniffAllowedType(bytes) !== row.mimeType) return { ok: false, status: 409 };
    return { ok: true, bytes, fileName: row.fileName, mimeType: row.mimeType };
  } catch (err) {
    console.error(`[attachments] cannot read ${row.id}:`, (err as Error).message);
    return { ok: false, status: 404 };
  }
}
