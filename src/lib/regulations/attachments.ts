import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { scanBytes, scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { promote, quarantineKey, readNoFollow, removeKey, writeNew } from '@/lib/attachments/storage';
import {
  MAX_ATTACHMENTS_PER_FORM,
  sanitizeFileName,
  sniffAllowedType,
  validateAttachmentFile,
} from '@/lib/attachments/validate';
import { getDb } from '@/lib/db';
import { canManageRegulations, ensureRegulationsReady, type RegulationActor } from '@/lib/regulations/service';

const MAX_REGULATION_FILES = Math.min(10, MAX_ATTACHMENTS_PER_FORM);

function isServableScan(scanStatus: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (scanStatus === 'clean') return true;
  return scanStatus === 'unscanned' && env.NODE_ENV !== 'production' && env.ATTACHMENT_SCAN?.trim() !== 'clamav';
}

export type RegulationFileRow = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: string;
  createdAt: Date;
};

type FileDbRow = {
  id: string;
  regulation_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: string | number;
  scan_status: string;
};

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export async function listRegulationAttachments(regulationId: string): Promise<RegulationFileRow[]> {
  await ensureRegulationsReady();
  if (!/^[0-9a-f-]{36}$/i.test(regulationId)) return [];
  const result = await getDb().execute(sql`
    select id, file_name, mime_type, file_size_bytes, scan_status, created_at
    from company_regulation_attachments
    where regulation_id = ${regulationId}::uuid
    order by created_at asc
  `);
  return asRows<{
    id: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: string | number;
    scan_status: string;
    created_at: Date | string;
  }>(result).map((r) => ({
    id: r.id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    fileSizeBytes: Number(r.file_size_bytes),
    scanStatus: r.scan_status,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
  }));
}

export async function uploadRegulationAttachment(
  actor: RegulationActor,
  regulationId: string,
  file: unknown
): Promise<{ ok: true; attachmentId: string; scanStatus: string } | { ok: false; error: string }> {
  await ensureRegulationsReady();
  if (!(await canManageRegulations(actor)) || !actor) return { ok: false, error: 'forbidden' };
  if (!/^[0-9a-f-]{36}$/i.test(regulationId)) return { ok: false, error: 'not_found' };
  if (!(file instanceof File)) return { ok: false, error: '請選擇檔案' };

  const size = validateAttachmentFile({ sizeBytes: file.size });
  if (!size.ok) return size;

  let scanner;
  try {
    scanner = scannerConfig();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '附件掃毒尚未設定' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) return { ok: false, error: '檔案大小不一致' };

  const mime = sniffAllowedType(bytes);
  if (!mime) {
    return {
      ok: false,
      error: '僅接受 PDF、JPEG、PNG、WebP、HEIC／HEIF、DOCX／XLSX／PPTX（以檔案內容判斷）',
    };
  }

  const existingCount = await listRegulationAttachments(regulationId);
  if (existingCount.length >= MAX_REGULATION_FILES) {
    return { ok: false, error: `每筆規章最多可附加 ${MAX_REGULATION_FILES} 個檔案` };
  }

  const attachmentId = randomUUID();
  const safeName = sanitizeFileName(file.name, mime);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const qKey = quarantineKey(attachmentId);
  const finalKey = ['company_regulations', regulationId, `${attachmentId}`].join('/');

  await writeNew(qKey, bytes);

  let scanStatus: 'clean' | 'infected' | 'scan_failed' | 'unscanned' = 'unscanned';
  try {
    const verdict = await scanBytes(bytes, scanner);
    if (verdict === 'infected') {
      await removeKey(qKey);
      return { ok: false, error: '檔案未通過安全掃描' };
    }
    scanStatus = verdict;
  } catch (err) {
    await removeKey(qKey);
    if (err instanceof ScannerUnavailable) {
      return { ok: false, error: '附件掃毒服務暫時無法使用' };
    }
    return { ok: false, error: '檔案掃描失敗' };
  }

  await promote(qKey, finalKey);

  await getDb().execute(sql`
    insert into company_regulation_attachments (
      id, regulation_id, uploaded_by_employee_id, storage_path, file_name, mime_type, file_size_bytes, sha256, scan_status, scanned_at
    ) values (
      ${attachmentId}::uuid, ${regulationId}::uuid, ${actor.id}::uuid, ${finalKey}, ${safeName}, ${mime}, ${bytes.byteLength}, ${sha256}, ${scanStatus}, now()
    )
  `);

  await recordAudit(getDb(), {
    actorEmployeeId: actor.id,
    action: 'company_regulation.attachment_upload',
    entityType: 'company_regulation',
    entityId: regulationId,
    details: { attachmentId, fileName: safeName, size: bytes.byteLength },
  });

  return { ok: true, attachmentId, scanStatus };
}

export async function deleteRegulationAttachment(
  actor: RegulationActor,
  regulationId: string,
  attachmentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureRegulationsReady();
  if (!(await canManageRegulations(actor)) || !actor) return { ok: false, error: 'forbidden' };
  if (!/^[0-9a-f-]{36}$/i.test(regulationId) || !/^[0-9a-f-]{36}$/i.test(attachmentId)) {
    return { ok: false, error: 'not_found' };
  }
  const result = await getDb().execute(sql`
    select id, regulation_id, storage_path, file_name, mime_type, file_size_bytes, scan_status
    from company_regulation_attachments
    where id = ${attachmentId}::uuid and regulation_id = ${regulationId}::uuid
    limit 1
  `);
  const row = asRows<FileDbRow>(result)[0];
  if (!row) return { ok: false, error: 'not_found' };

  await getDb().execute(sql`
    delete from company_regulation_attachments
    where id = ${attachmentId}::uuid and regulation_id = ${regulationId}::uuid
  `);
  await removeKey(row.storage_path).catch(() => {});

  await recordAudit(getDb(), {
    actorEmployeeId: actor.id,
    action: 'company_regulation.attachment_delete',
    entityType: 'company_regulation',
    entityId: regulationId,
    details: { attachmentId, fileName: row.file_name },
  });

  return { ok: true };
}

export async function readRegulationAttachmentFor(
  actor: { id: string; role: string } | null,
  regulationId: string,
  attachmentId: string
): Promise<
  | { ok: true; bytes: Buffer; fileName: string; mimeType: string }
  | { ok: false; status: number; error: string }
> {
  await ensureRegulationsReady();
  if (!actor) return { ok: false, status: 401, error: 'unauthorized' };
  if (!/^[0-9a-f-]{36}$/i.test(regulationId) || !/^[0-9a-f-]{36}$/i.test(attachmentId)) {
    return { ok: false, status: 404, error: 'not_found' };
  }
  const result = await getDb().execute(sql`
    select id, regulation_id, storage_path, file_name, mime_type, file_size_bytes, scan_status
    from company_regulation_attachments
    where id = ${attachmentId}::uuid and regulation_id = ${regulationId}::uuid
    limit 1
  `);
  const row = asRows<FileDbRow>(result)[0];
  if (!row) return { ok: false, status: 404, error: 'not_found' };
  if (!isServableScan(row.scan_status)) {
    return { ok: false, status: 403, error: 'scan_not_clean' };
  }
  try {
    const bytes = await readNoFollow(row.storage_path);
    return {
      ok: true,
      bytes,
      fileName: row.file_name,
      mimeType: row.mime_type,
    };
  } catch {
    return { ok: false, status: 404, error: 'file_missing' };
  }
}
