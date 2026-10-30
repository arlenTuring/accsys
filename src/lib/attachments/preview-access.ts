import { and, eq } from 'drizzle-orm';
import { canReadForm, isUuid, type Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import {
  aiApplicationDrafts,
  aiDraftSnapshotAttachments,
  approvedDocumentSnapshots,
  attachments,
  attachmentDerivatives,
} from '@/lib/db/schema';
import { isServable } from '@/lib/attachments/service';
import { readNoFollow } from '@/lib/attachments/storage';
import { sniffAllowedType } from '@/lib/attachments/validate';
import { canPreviewInBrowser, needsPreviewDerivative } from '@/lib/attachments/policy';

export type PreviewPayload =
  | {
      ok: true;
      kind: 'original' | 'derivative';
      bytes: Buffer;
      fileName: string;
      mimeType: string;
      attachmentId: string;
      sourceMime: string;
      note?: string;
    }
  | { ok: false; status: 404 | 409; reason?: string };

/** Target-document authorization: can read the form the attachment is on. */
export async function canAccessAttachment(actor: Actor | null, attachmentId: string): Promise<boolean> {
  if (!actor || !isUuid(attachmentId)) return false;
  const [row] = await getDb().select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!row) return false;
  return canReadForm(actor, row.formType, row.formId);
}

/**
 * Approved PDF snapshot access:
 * - source form readers
 * - draft owners who linked the snapshot
 * - readers of a submitted form that owns a copied attachment is handled via attachments table
 */
export async function canAccessApprovedSnapshot(actor: Actor | null, snapshotId: string): Promise<boolean> {
  if (!actor || !isUuid(snapshotId)) return false;
  const db = getDb();
  const [snap] = await db
    .select()
    .from(approvedDocumentSnapshots)
    .where(eq(approvedDocumentSnapshots.id, snapshotId))
    .limit(1);
  if (!snap) return false;

  if (await canReadForm(actor, snap.sourceFormType, snap.sourceFormId)) return true;

  const links = await db
    .select({
      draftId: aiDraftSnapshotAttachments.draftId,
      ownerId: aiApplicationDrafts.ownerEmployeeId,
      submissionId: aiApplicationDrafts.submissionId,
    })
    .from(aiDraftSnapshotAttachments)
    .innerJoin(aiApplicationDrafts, eq(aiApplicationDrafts.id, aiDraftSnapshotAttachments.draftId))
    .where(eq(aiDraftSnapshotAttachments.snapshotId, snapshotId));

  for (const link of links) {
    if (link.ownerId === actor.id) return true;
    // Designer submissions use formType `custom` with submission id as formId.
    if (link.submissionId && (await canReadForm(actor, 'custom', link.submissionId))) return true;
  }
  return false;
}

/**
 * Controlled preview: serve browser-safe bytes (JPEG/PNG/WebP/PDF) under
 * target-document auth. HEIC/Office use derivatives when ready; never inline
 * active content. Download path stays separate (attachment disposition).
 */
export async function readPreviewFor(
  actor: Actor | null,
  attachmentId: unknown
): Promise<PreviewPayload> {
  if (!actor || !isUuid(attachmentId)) return { ok: false, status: 404 };
  const db = getDb();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!row || !(await canReadForm(actor, row.formType, row.formId))) return { ok: false, status: 404 };
  if (!isServable(row.scanStatus)) return { ok: false, status: 409, reason: 'scan_blocked' };

  if (canPreviewInBrowser(row.mimeType)) {
    try {
      const bytes = await readNoFollow(row.storagePath);
      if (sniffAllowedType(bytes) !== row.mimeType) return { ok: false, status: 409, reason: 'type_mismatch' };
      return {
        ok: true,
        kind: 'original',
        bytes,
        fileName: row.fileName,
        mimeType: row.mimeType,
        attachmentId: row.id,
        sourceMime: row.mimeType,
      };
    } catch {
      return { ok: false, status: 404 };
    }
  }

  if (needsPreviewDerivative(row.mimeType)) {
    const [der] = await db
      .select()
      .from(attachmentDerivatives)
      .where(
        and(
          eq(attachmentDerivatives.attachmentId, row.id),
          eq(attachmentDerivatives.status, 'ready')
        )
      )
      .limit(1);
    if (!der) {
      return {
        ok: false,
        status: 409,
        reason: 'derivative_pending',
      };
    }
    try {
      const bytes = await readNoFollow(der.storagePath);
      return {
        ok: true,
        kind: 'derivative',
        bytes,
        fileName: row.fileName.replace(/\.[^.]+$/, '') + (der.mimeType === 'application/pdf' ? '.pdf' : '.jpg'),
        mimeType: der.mimeType,
        attachmentId: row.id,
        sourceMime: row.mimeType,
        note: '預覽為轉換版本，原始檔另可下載',
      };
    } catch {
      return { ok: false, status: 409, reason: 'derivative_missing' };
    }
  }

  return { ok: false, status: 409, reason: 'unsupported_preview' };
}
