import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { aiApplicationDrafts, aiDraftFileAttachments } from '@/lib/db/schema';
import { writeNew, readNoFollow } from '@/lib/attachments/storage';
import { getReadyStagedImagesForOwner } from '@/lib/ai-chat/staged-images';
import type { ApplicationDraft, DraftConflict } from '@/lib/ai-chat/drafts';
import { getDraftForOwner, mapDraft } from '@/lib/ai-chat/drafts';

export type DraftFileMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sourceStagedId: string | null;
  attachedAt: Date;
};

/**
 * Copy ready chat-staged files onto a draft (durable copy; staged purge won't remove them).
 */
export async function attachStagedFilesToDraft(input: {
  actor: Actor;
  conversationId: string;
  draftId: string;
  expectedVersion: number;
  stagedIds: string[];
}): Promise<
  | { ok: true; draft: ApplicationDraft; attached: DraftFileMeta[]; skipped: string[] }
  | { ok: false; conflict: DraftConflict }
  | { ok: false; error: string }
> {
  const draft = await getDraftForOwner(input.draftId, input.actor.id);
  if (!draft) return { ok: false, error: 'draft_not_found' };
  if (draft.conversationId !== input.conversationId) return { ok: false, error: 'draft_forbidden' };
  if (draft.status !== 'draft') return { ok: false, error: 'draft_not_editable' };
  if (draft.version !== input.expectedVersion) {
    return { ok: false, conflict: { code: 'version_conflict', draft } };
  }

  const ids = [...new Set(input.stagedIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 20);
  if (ids.length === 0) return { ok: false, error: 'staged_ids_required' };

  const ready = await getReadyStagedImagesForOwner(input.actor.id, input.conversationId, ids);
  const readyById = new Map(ready.map((r) => [r.id, r]));
  const skipped = ids.filter((id) => !readyById.has(id));

  const db = getDb();
  const attached: DraftFileMeta[] = [];

  for (const staged of ready) {
    // Idempotent: same source staged id on same draft → skip duplicate copy.
    const [existing] = await db
      .select()
      .from(aiDraftFileAttachments)
      .where(
        and(
          eq(aiDraftFileAttachments.draftId, input.draftId),
          eq(aiDraftFileAttachments.sourceStagedId, staged.id)
        )
      )
      .limit(1);
    if (existing) {
      attached.push({
        id: existing.id,
        fileName: existing.fileName,
        mimeType: existing.mimeType,
        fileSizeBytes: existing.fileSizeBytes,
        sourceStagedId: existing.sourceStagedId,
        attachedAt: existing.attachedAt,
      });
      continue;
    }

    const id = randomUUID();
    const storagePath = `ai-draft-files/${input.draftId}/${id}`;
    const sha256 = createHash('sha256').update(staged.bytes).digest('hex');
    await writeNew(storagePath, staged.bytes);
    await db.insert(aiDraftFileAttachments).values({
      id,
      draftId: input.draftId,
      fileName: staged.fileName,
      mimeType: staged.mimeType,
      fileSizeBytes: staged.fileSizeBytes,
      storagePath,
      sha256,
      sourceStagedId: staged.id,
      attachedByEmployeeId: input.actor.id,
    });
    attached.push({
      id,
      fileName: staged.fileName,
      mimeType: staged.mimeType,
      fileSizeBytes: staged.fileSizeBytes,
      sourceStagedId: staged.id,
      attachedAt: new Date(),
    });
  }

  if (attached.length === 0 && skipped.length > 0) {
    return { ok: false, error: 'staged_not_ready' };
  }

  const [row] = await db
    .update(aiApplicationDrafts)
    .set({
      version: sql`${aiApplicationDrafts.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(aiApplicationDrafts.id, input.draftId),
        eq(aiApplicationDrafts.ownerEmployeeId, input.actor.id),
        eq(aiApplicationDrafts.version, input.expectedVersion),
        eq(aiApplicationDrafts.status, 'draft')
      )
    )
    .returning();
  if (!row) {
    const again = await getDraftForOwner(input.draftId, input.actor.id);
    if (!again) return { ok: false, error: 'draft_not_found' };
    return { ok: false, conflict: { code: 'version_conflict', draft: again } };
  }

  return { ok: true, draft: mapDraft(row), attached, skipped };
}

export async function listDraftFiles(draftId: string, ownerId: string): Promise<DraftFileMeta[]> {
  const draft = await getDraftForOwner(draftId, ownerId);
  if (!draft) throw new Error('draft_not_found');
  const rows = await getDb()
    .select()
    .from(aiDraftFileAttachments)
    .where(eq(aiDraftFileAttachments.draftId, draftId))
    .orderBy(desc(aiDraftFileAttachments.attachedAt));
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    sourceStagedId: r.sourceStagedId,
    attachedAt: r.attachedAt,
  }));
}

export async function readDraftFileBytes(
  draftId: string,
  fileId: string
): Promise<{ fileName: string; mimeType: string; bytes: Buffer } | null> {
  const [row] = await getDb()
    .select()
    .from(aiDraftFileAttachments)
    .where(and(eq(aiDraftFileAttachments.id, fileId), eq(aiDraftFileAttachments.draftId, draftId)))
    .limit(1);
  if (!row) return null;
  try {
    const bytes = await readNoFollow(row.storagePath);
    return { fileName: row.fileName, mimeType: row.mimeType, bytes };
  } catch {
    return null;
  }
}
