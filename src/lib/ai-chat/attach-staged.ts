import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import type { Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { aiApplicationDrafts, aiChatStagedAttachments, aiDraftFileAttachments } from '@/lib/db/schema';
import { writeNew, readNoFollow } from '@/lib/attachments/storage';
import { getReadyStagedImagesForOwner } from '@/lib/ai-chat/staged-images';
import type { ApplicationDraft, DraftConflict } from '@/lib/ai-chat/drafts';
import { getDraftForOwner, isDraftInConversation } from '@/lib/ai-chat/drafts';

export type DraftFileMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sourceStagedId: string | null;
  attachedAt: Date;
  activeEditId?: string | null;
  /** AI check of the current picture: 'none' after an edit until it is run again. */
  checkState?: 'none' | 'running' | 'done';
  checkSummary?: string | null;
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
  if (!(await isDraftInConversation(draft.id, input.conversationId, input.actor.id))) return { ok: false, error: 'draft_forbidden' };
  if (draft.status !== 'draft') return { ok: false, error: 'draft_not_editable' };
  if (draft.version !== input.expectedVersion) {
    return { ok: false, conflict: { code: 'version_conflict', draft } };
  }

  const ids = [...new Set(input.stagedIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 20);
  if (ids.length === 0) return { ok: false, error: 'staged_ids_required' };

  const ready = await getReadyStagedImagesForOwner(input.actor.id, input.conversationId, ids);
  const readyById = new Map(ready.map((r) => [r.id, r]));
  const skipped = ids.filter((id) => !readyById.has(id));

  if (process.env.NODE_ENV !== 'production' && process.env.AI_FAULT_INJECT === 'attach_link') {
    return { ok: false, error: 'attach_failed' };
  }

  // One transaction around the version check and the links: either every file is
  // linked and the version moves once, or nothing changed. A file already on this
  // draft stays as it is, so a retry or double click adds nothing and keeps the version.
  const outcome = await getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select({ version: aiApplicationDrafts.version, status: aiApplicationDrafts.status })
      .from(aiApplicationDrafts)
      .where(and(eq(aiApplicationDrafts.id, input.draftId), eq(aiApplicationDrafts.ownerEmployeeId, input.actor.id)))
      .for('update');
    if (!locked || locked.status !== 'draft') return { kind: 'gone' as const };

    const attached: DraftFileMeta[] = [];
    const fresh: DraftFileMeta[] = [];
    for (const staged of ready) {
      const [existing] = await tx
        .select()
        .from(aiDraftFileAttachments)
        .where(and(eq(aiDraftFileAttachments.draftId, input.draftId), eq(aiDraftFileAttachments.sourceStagedId, staged.id)))
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
      fresh.push({
        id: randomUUID(),
        fileName: staged.fileName,
        mimeType: staged.mimeType,
        fileSizeBytes: staged.fileSizeBytes,
        sourceStagedId: staged.id,
        attachedAt: new Date(),
      });
    }

    if (fresh.length === 0) {
      if (attached.length === 0 && skipped.length > 0) return { kind: 'not_ready' as const };
      return { kind: 'done' as const, version: locked.version, attached, added: 0 };
    }
    if (locked.version !== input.expectedVersion) return { kind: 'conflict' as const };

    for (const meta of fresh) {
      const staged = ready.find((r) => r.id === meta.sourceStagedId)!;
      const storagePath = `ai-draft-files/${input.draftId}/${meta.id}`;
      await writeNew(storagePath, staged.bytes);
      await tx.insert(aiDraftFileAttachments).values({
        id: meta.id,
        draftId: input.draftId,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        fileSizeBytes: meta.fileSizeBytes,
        storagePath,
        sha256: createHash('sha256').update(staged.bytes).digest('hex'),
        sourceStagedId: staged.id,
        activeEditId: staged.activeEditId,
        attachedByEmployeeId: input.actor.id,
      });
      attached.push(meta);
    }
    await tx
      .update(aiApplicationDrafts)
      .set({ version: sql`${aiApplicationDrafts.version} + 1`, updatedAt: sql`now()` })
      .where(eq(aiApplicationDrafts.id, input.draftId));
    await recordAudit(tx, {
      actorEmployeeId: input.actor.id,
      action: 'ai_draft.files_attached',
      entityType: 'ai_application_draft',
      entityId: input.draftId,
      details: { version: locked.version + 1, files: fresh.map((f) => ({ id: f.id, source: f.sourceStagedId })) },
    });
    return { kind: 'done' as const, version: locked.version + 1, attached, added: fresh.length };
  });

  if (outcome.kind === 'not_ready') return { ok: false, error: 'staged_not_ready' };
  if (outcome.kind === 'gone') return { ok: false, error: 'draft_not_editable' };
  const current = await getDraftForOwner(input.draftId, input.actor.id);
  if (!current) return { ok: false, error: 'draft_not_found' };
  if (outcome.kind === 'conflict') return { ok: false, conflict: { code: 'version_conflict', draft: current } };
  return { ok: true, draft: current, attached: outcome.attached, skipped };
}

export async function listDraftFiles(draftId: string, ownerId: string): Promise<DraftFileMeta[]> {
  const draft = await getDraftForOwner(draftId, ownerId);
  if (!draft) throw new Error('draft_not_found');
  const rows = await getDb()
    .select({
      file: aiDraftFileAttachments,
      analysisStatus: aiChatStagedAttachments.analysisStatus,
      analysisResult: aiChatStagedAttachments.analysisResult,
    })
    .from(aiDraftFileAttachments)
    .leftJoin(aiChatStagedAttachments, eq(aiChatStagedAttachments.id, aiDraftFileAttachments.sourceStagedId))
    .where(eq(aiDraftFileAttachments.draftId, draftId))
    .orderBy(desc(aiDraftFileAttachments.attachedAt));
  return rows.map(({ file: r, analysisStatus, analysisResult }) => ({
    id: r.id,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    sourceStagedId: r.sourceStagedId,
    attachedAt: r.attachedAt,
    activeEditId: r.activeEditId,
    checkState: analysisStatus === 'running' ? 'running' : analysisStatus ? 'done' : 'none',
    checkSummary: typeof analysisResult?.summary === 'string' ? analysisResult.summary : null,
  }));
}

/** The original as uploaded. `readDraftFileView` gives the current edit instead. */
export async function readDraftFileBytes(
  draftId: string,
  fileId: string
): Promise<{ fileName: string; mimeType: string; bytes: Buffer; activeEditId: string | null } | null> {
  const [row] = await getDb()
    .select()
    .from(aiDraftFileAttachments)
    .where(and(eq(aiDraftFileAttachments.id, fileId), eq(aiDraftFileAttachments.draftId, draftId)))
    .limit(1);
  if (!row) return null;
  try {
    const bytes = await readNoFollow(row.storagePath);
    return { fileName: row.fileName, mimeType: row.mimeType, bytes, activeEditId: row.activeEditId };
  } catch {
    return null;
  }
}

/**
 * Detach draft file link(s). Deletes only this draft's copy under `ai-draft-files/…`.
 * Does not purge staged chat originals or files attached to other drafts/forms.
 */
export async function removeDraftFiles(input: {
  actor: Actor;
  conversationId: string;
  draftId: string;
  expectedVersion: number;
  /** Specific file IDs; empty + removeAll removes every link on this draft. */
  fileIds?: string[];
  removeAll?: boolean;
}): Promise<
  | { ok: true; draft: ApplicationDraft; removed: DraftFileMeta[]; removedCount: number }
  | { ok: false; conflict: DraftConflict }
  | { ok: false; error: string; message: string }
> {
  const draft = await getDraftForOwner(input.draftId, input.actor.id);
  if (!draft) return { ok: false, error: 'draft_not_found', message: '找不到草稿。' };
  if (!(await isDraftInConversation(draft.id, input.conversationId, input.actor.id))) {
    return { ok: false, error: 'draft_forbidden', message: '此草稿未連結到目前對話，或無權操作。' };
  }
  if (draft.status !== 'draft') {
    return {
      ok: false,
      error: 'draft_not_editable',
      message: '已送出或已放棄的草稿不可改附件；請走撤回／補件流程。',
    };
  }
  if (draft.version !== input.expectedVersion) {
    return { ok: false, conflict: { code: 'version_conflict', draft } };
  }

  const removeAll = !!input.removeAll;
  const fileIds = [...new Set((input.fileIds ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!removeAll && fileIds.length === 0) {
    return { ok: false, error: 'file_ids_required', message: '請指定要移除的附件 ID，或明確要求移除全部。' };
  }

  const { removeKey } = await import('@/lib/attachments/storage');

  const outcome = await getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select({ version: aiApplicationDrafts.version, status: aiApplicationDrafts.status })
      .from(aiApplicationDrafts)
      .where(and(eq(aiApplicationDrafts.id, input.draftId), eq(aiApplicationDrafts.ownerEmployeeId, input.actor.id)))
      .for('update');
    if (!locked || locked.status !== 'draft') return { kind: 'gone' as const };
    if (locked.version !== input.expectedVersion) return { kind: 'conflict' as const };

    const rows = removeAll
      ? await tx.select().from(aiDraftFileAttachments).where(eq(aiDraftFileAttachments.draftId, input.draftId))
      : await tx
          .select()
          .from(aiDraftFileAttachments)
          .where(and(eq(aiDraftFileAttachments.draftId, input.draftId), inArray(aiDraftFileAttachments.id, fileIds)));

    if (rows.length === 0) {
      return { kind: 'done' as const, version: locked.version, removed: [] as DraftFileMeta[], bumped: false };
    }

    for (const row of rows) {
      await tx.delete(aiDraftFileAttachments).where(eq(aiDraftFileAttachments.id, row.id));
      try {
        await removeKey(row.storagePath);
      } catch {
        /* link row is gone; orphaned blob is best-effort */
      }
    }

    await tx
      .update(aiApplicationDrafts)
      .set({ version: sql`${aiApplicationDrafts.version} + 1`, updatedAt: sql`now()` })
      .where(eq(aiApplicationDrafts.id, input.draftId));
    await recordAudit(tx, {
      actorEmployeeId: input.actor.id,
      action: removeAll ? 'ai_draft.files_removed_all' : 'ai_draft.files_removed',
      entityType: 'ai_application_draft',
      entityId: input.draftId,
      details: {
        version: locked.version + 1,
        removedIds: rows.map((r) => r.id),
        removedCount: rows.length,
      },
    });

    return {
      kind: 'done' as const,
      version: locked.version + 1,
      removed: rows.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        mimeType: r.mimeType,
        fileSizeBytes: r.fileSizeBytes,
        sourceStagedId: r.sourceStagedId,
        attachedAt: r.attachedAt,
      })),
      bumped: true,
    };
  });

  const current = await getDraftForOwner(input.draftId, input.actor.id);
  if (!current) return { ok: false, error: 'draft_not_found', message: '找不到草稿。' };
  if (outcome.kind === 'gone') {
    return { ok: false, error: 'draft_not_editable', message: '草稿已不可修改。' };
  }
  if (outcome.kind === 'conflict') return { ok: false, conflict: { code: 'version_conflict', draft: current } };
  return { ok: true, draft: current, removed: outcome.removed, removedCount: outcome.removed.length };
}
