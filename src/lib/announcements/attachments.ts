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
import type { AnnouncementActor } from '@/lib/announcements/service';

const MAX_ANNOUNCEMENT_FILES = Math.min(10, MAX_ATTACHMENTS_PER_FORM);

function isServableScan(scanStatus: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (scanStatus === 'clean') return true;
  return scanStatus === 'unscanned' && env.NODE_ENV !== 'production' && env.ATTACHMENT_SCAN?.trim() !== 'clamav';
}

export type AnnouncementFileRow = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: string;
  createdAt: Date;
};

type FileDbRow = {
  id: string;
  announcement_id: string;
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

/** Raw SQL avoids Next API-route circular init where drizzle table exports can be undefined. */
async function loadFileRow(announcementId: string, attachmentId: string): Promise<FileDbRow | null> {
  const result = await getDb().execute(sql`
    select id, announcement_id, storage_path, file_name, mime_type, file_size_bytes, scan_status
    from company_announcement_attachments
    where id = ${attachmentId}::uuid and announcement_id = ${announcementId}::uuid
    limit 1
  `);
  return asRows<FileDbRow>(result)[0] ?? null;
}

export async function listAnnouncementAttachments(announcementId: string): Promise<AnnouncementFileRow[]> {
  const result = await getDb().execute(sql`
    select id, file_name, mime_type, file_size_bytes, scan_status, created_at
    from company_announcement_attachments
    where announcement_id = ${announcementId}::uuid
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

export async function uploadAnnouncementAttachment(
  actor: AnnouncementActor,
  announcementId: string,
  file: unknown
): Promise<{ ok: true; attachmentId: string; scanStatus: string } | { ok: false; error: string }> {
  const { canManageAnnouncements } = await import('@/lib/announcements/service');
  if (!(await canManageAnnouncements(actor)) || !actor) return { ok: false, error: 'forbidden' };
  if (!/^[0-9a-f-]{36}$/i.test(announcementId)) return { ok: false, error: 'not_found' };
  if (!(file instanceof File)) return { ok: false, error: '請選擇檔案' };

  const size = validateAttachmentFile({ sizeBytes: file.size });
  if (!size.ok) return size;

  let scanner;
  try {
    scanner = scannerConfig();
  } catch (err) {
    if (err instanceof ScannerUnavailable) {
      return { ok: false, error: '附件掃描服務未設定，暫時無法上傳，請聯絡系統管理員' };
    }
    throw err;
  }

  const exists = asRows<{ id: string }>(
    await getDb().execute(sql`select id from company_announcements where id = ${announcementId}::uuid limit 1`)
  );
  if (!exists[0]) return { ok: false, error: 'not_found' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length === 0) return { ok: false, error: '檔案內容不完整' };
  const mime = sniffAllowedType(bytes);
  if (!mime) {
    return {
      ok: false,
      error: '僅接受 PDF、JPEG、PNG、WebP、HEIC／HEIF、DOCX／XLSX／PPTX（以檔案內容判斷）',
    };
  }

  const id = randomUUID();
  const finalKey = `announcement/${announcementId}/${randomUUID()}`;
  const fileName = sanitizeFileName(file.name, mime);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const outcome = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`announcement-attachments:${announcementId}`}, 0))`
    );
    const n = Number(
      asRows<{ n: number }>(
        await tx.execute(sql`
          select count(*)::int as n from company_announcement_attachments
          where announcement_id = ${announcementId}::uuid
        `)
      )[0]?.n ?? 0
    );
    if (n >= MAX_ANNOUNCEMENT_FILES) return { full: MAX_ANNOUNCEMENT_FILES as number };
    await tx.execute(sql`
      insert into company_announcement_attachments
        (id, announcement_id, uploaded_by_employee_id, storage_path, file_name, mime_type, file_size_bytes, scan_status, sha256)
      values
        (${id}::uuid, ${announcementId}::uuid, ${actor.id}::uuid, ${finalKey}, ${fileName}, ${mime}, ${bytes.length}, 'pending', ${sha256})
    `);
    await recordAudit(tx, {
      actorEmployeeId: actor.id,
      action: 'announcement.attachment_uploaded',
      entityType: 'company_announcement',
      entityId: announcementId,
      details: { attachmentId: id, mime, size: bytes.length, sha256 },
    });
    return 'stored' as const;
  });

  if (typeof outcome === 'object') {
    return { ok: false, error: `每則公告最多 ${outcome.full} 個附件` };
  }

  await writeNew(quarantineKey(id), bytes);
  const verdict = await scanBytes(bytes, scanner);
  if (verdict === 'clean' || verdict === 'unscanned') await promote(quarantineKey(id), finalKey);
  if (verdict === 'infected') await removeKey(quarantineKey(id));
  await getDb().execute(sql`
    update company_announcement_attachments
    set scan_status = ${verdict},
        scanned_at = case when ${verdict} = 'unscanned' then null else now() end
    where id = ${id}::uuid
  `);

  if (verdict === 'infected') {
    await getDb().execute(sql`delete from company_announcement_attachments where id = ${id}::uuid`);
    return { ok: false, error: '檔案未通過安全掃描，已拒絕' };
  }
  if (verdict === 'scan_failed') {
    return { ok: false, error: '檔案安全掃描失敗，已暫存待重新掃描，目前無法下載' };
  }

  return { ok: true, attachmentId: id, scanStatus: verdict };
}

export async function removeAnnouncementAttachment(
  actor: AnnouncementActor,
  announcementId: string,
  attachmentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { canManageAnnouncements } = await import('@/lib/announcements/service');
  if (!(await canManageAnnouncements(actor)) || !actor) return { ok: false, error: 'forbidden' };
  if (!/^[0-9a-f-]{36}$/i.test(announcementId) || !/^[0-9a-f-]{36}$/i.test(attachmentId)) {
    return { ok: false, error: 'not_found' };
  }
  const row = await loadFileRow(announcementId, attachmentId);
  if (!row) return { ok: false, error: 'not_found' };

  await getDb().execute(sql`
    delete from company_announcement_attachments
    where id = ${attachmentId}::uuid and announcement_id = ${announcementId}::uuid
  `);
  try {
    await removeKey(row.storage_path);
  } catch {
    /* best-effort */
  }
  try {
    await removeKey(quarantineKey(attachmentId));
  } catch {
    /* best-effort */
  }

  await recordAudit(getDb(), {
    actorEmployeeId: actor.id,
    action: 'announcement.attachment_removed',
    entityType: 'company_announcement',
    entityId: announcementId,
    details: { attachmentId, fileName: row.file_name },
  });
  return { ok: true };
}

export async function readAnnouncementAttachmentFor(input: {
  actor: { id: string; role: string; departmentId?: string | null } | null;
  announcementId: string;
  attachmentId: string;
}): Promise<
  | { ok: true; bytes: Buffer; fileName: string; mimeType: string }
  | { ok: false; status: 404 | 409 }
> {
  const { actor, announcementId, attachmentId } = input;
  if (!actor || !/^[0-9a-f-]{36}$/i.test(announcementId) || !/^[0-9a-f-]{36}$/i.test(attachmentId)) {
    return { ok: false, status: 404 };
  }
  const { canManageAnnouncements, getAnnouncementForViewer } = await import('@/lib/announcements/service');
  const manage = await canManageAnnouncements(actor);
  const ann = await getAnnouncementForViewer({
    id: announcementId,
    employeeId: actor.id,
    departmentId: actor.departmentId ?? null,
    manage,
  });
  if (!ann) return { ok: false, status: 404 };

  const row = await loadFileRow(announcementId, attachmentId);
  if (!row) return { ok: false, status: 404 };
  if (!isServableScan(row.scan_status)) return { ok: false, status: 409 };
  try {
    const bytes = await readNoFollow(row.storage_path);
    if (sniffAllowedType(bytes) !== row.mime_type) return { ok: false, status: 409 };
    return { ok: true, bytes, fileName: row.file_name, mimeType: row.mime_type };
  } catch {
    return { ok: false, status: 404 };
  }
}
