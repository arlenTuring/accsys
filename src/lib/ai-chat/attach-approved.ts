import { and, desc, eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import type { Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import {
  aiApplicationDrafts,
  aiDraftSnapshotAttachments,
  approvedDocumentSnapshots,
} from '@/lib/db/schema';
import type { ApplicationDraft, DraftConflict } from './drafts';
import { getDraftForOwner, mapDraft } from './drafts';

export type DraftSnapshotMeta = {
  snapshotId: string;
  sourceFormType: string;
  sourceFormId: string;
  sourceFormNumber: string;
  sourceFormKey: string | null;
  fileName: string;
  fileSizeBytes: number;
  approvedAt: Date;
  attachedAt: Date;
};

/**
 * Link an approved PDF snapshot to a draft (idempotent per draft+snapshot).
 * Bumps draft version when a new link is created.
 */
export async function attachApprovedSnapshotToDraft(input: {
  actor: Actor;
  draftId: string;
  expectedVersion: number;
  snapshotId: string;
}): Promise<
  | { ok: true; draft: ApplicationDraft; snapshot: DraftSnapshotMeta; created: boolean }
  | { ok: false; conflict: DraftConflict }
> {
  const ownerEmployeeId = input.actor.id;
  const current = await getDraftForOwner(input.draftId, ownerEmployeeId);
  if (!current) throw new Error('draft_not_found');
  if (current.status !== 'draft') throw new Error('draft_not_editable');

  const db = getDb();
  const [snapshot] = await db
    .select({
      id: approvedDocumentSnapshots.id,
      sourceFormType: approvedDocumentSnapshots.sourceFormType,
      sourceFormId: approvedDocumentSnapshots.sourceFormId,
      sourceFormNumber: approvedDocumentSnapshots.sourceFormNumber,
      sourceFormKey: approvedDocumentSnapshots.sourceFormKey,
      fileName: approvedDocumentSnapshots.fileName,
      fileSizeBytes: approvedDocumentSnapshots.fileSizeBytes,
      approvedAt: approvedDocumentSnapshots.approvedAt,
    })
    .from(approvedDocumentSnapshots)
    .where(eq(approvedDocumentSnapshots.id, input.snapshotId))
    .limit(1);
  if (!snapshot) throw new Error('snapshot_not_found');

  const meta = (attachedAt: Date): DraftSnapshotMeta => ({
    snapshotId: snapshot.id,
    sourceFormType: snapshot.sourceFormType,
    sourceFormId: snapshot.sourceFormId,
    sourceFormNumber: snapshot.sourceFormNumber,
    sourceFormKey: snapshot.sourceFormKey,
    fileName: snapshot.fileName,
    fileSizeBytes: snapshot.fileSizeBytes,
    approvedAt: snapshot.approvedAt,
    attachedAt,
  });

  // Version check and link in one transaction: a conflict leaves nothing behind,
  // and a PDF already on the draft is a no-op that keeps the version.
  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ version: aiApplicationDrafts.version, status: aiApplicationDrafts.status })
      .from(aiApplicationDrafts)
      .where(and(eq(aiApplicationDrafts.id, input.draftId), eq(aiApplicationDrafts.ownerEmployeeId, ownerEmployeeId)))
      .for('update');
    if (!locked || locked.status !== 'draft') throw new Error('draft_not_editable');
    const [link] = await tx
      .select({ attachedAt: aiDraftSnapshotAttachments.attachedAt })
      .from(aiDraftSnapshotAttachments)
      .where(and(eq(aiDraftSnapshotAttachments.draftId, input.draftId), eq(aiDraftSnapshotAttachments.snapshotId, input.snapshotId)))
      .limit(1);
    if (link) return { kind: 'existing' as const, attachedAt: link.attachedAt };
    if (locked.version !== input.expectedVersion) return { kind: 'conflict' as const };
    const [row] = await tx
      .insert(aiDraftSnapshotAttachments)
      .values({ draftId: input.draftId, snapshotId: input.snapshotId, attachedByEmployeeId: ownerEmployeeId })
      .returning({ attachedAt: aiDraftSnapshotAttachments.attachedAt });
    await tx
      .update(aiApplicationDrafts)
      .set({ version: sql`${aiApplicationDrafts.version} + 1`, updatedAt: sql`now()` })
      .where(eq(aiApplicationDrafts.id, input.draftId));
    await recordAudit(tx, {
      actorEmployeeId: ownerEmployeeId,
      action: 'ai_draft.approved_pdf_attached',
      entityType: 'ai_application_draft',
      entityId: input.draftId,
      details: { snapshotId: snapshot.id, sourceFormNumber: snapshot.sourceFormNumber, version: locked.version + 1 },
    });
    return { kind: 'added' as const, attachedAt: row.attachedAt };
  });

  const draft = (await getDraftForOwner(input.draftId, ownerEmployeeId))!;
  if (outcome.kind === 'conflict') return { ok: false, conflict: { code: 'version_conflict', draft } };
  return { ok: true, created: outcome.kind === 'added', draft, snapshot: meta(outcome.attachedAt) };
}

export async function listDraftSnapshots(draftId: string, ownerId: string): Promise<DraftSnapshotMeta[]> {
  const draft = await getDraftForOwner(draftId, ownerId);
  if (!draft) throw new Error('draft_not_found');

  const db = getDb();
  const rows = await db
    .select({
      snapshotId: approvedDocumentSnapshots.id,
      sourceFormType: approvedDocumentSnapshots.sourceFormType,
      sourceFormId: approvedDocumentSnapshots.sourceFormId,
      sourceFormNumber: approvedDocumentSnapshots.sourceFormNumber,
      sourceFormKey: approvedDocumentSnapshots.sourceFormKey,
      fileName: approvedDocumentSnapshots.fileName,
      fileSizeBytes: approvedDocumentSnapshots.fileSizeBytes,
      approvedAt: approvedDocumentSnapshots.approvedAt,
      attachedAt: aiDraftSnapshotAttachments.attachedAt,
    })
    .from(aiDraftSnapshotAttachments)
    .innerJoin(approvedDocumentSnapshots, eq(aiDraftSnapshotAttachments.snapshotId, approvedDocumentSnapshots.id))
    .where(eq(aiDraftSnapshotAttachments.draftId, draftId))
    .orderBy(desc(aiDraftSnapshotAttachments.attachedAt));

  return rows.map((r) => ({
    snapshotId: r.snapshotId,
    sourceFormType: r.sourceFormType,
    sourceFormId: r.sourceFormId,
    sourceFormNumber: r.sourceFormNumber,
    sourceFormKey: r.sourceFormKey,
    fileName: r.fileName,
    fileSizeBytes: r.fileSizeBytes,
    approvedAt: r.approvedAt,
    attachedAt: r.attachedAt,
  }));
}

/** Explicit detach only — never runs on draft abandon or conversation close. */
export async function removeDraftSnapshot(input: {
  actor: Actor;
  draftId: string;
  expectedVersion: number;
  snapshotId: string;
}): Promise<{ ok: true; draft: ApplicationDraft } | { ok: false; conflict: DraftConflict }> {
  const ownerEmployeeId = input.actor.id;
  const current = await getDraftForOwner(input.draftId, ownerEmployeeId);
  if (!current) throw new Error('draft_not_found');
  if (current.status !== 'draft') throw new Error('draft_not_editable');
  if (current.version !== input.expectedVersion) {
    return { ok: false, conflict: { code: 'version_conflict', draft: current } };
  }

  const db = getDb();
  const removed = await db
    .delete(aiDraftSnapshotAttachments)
    .where(
      and(
        eq(aiDraftSnapshotAttachments.draftId, input.draftId),
        eq(aiDraftSnapshotAttachments.snapshotId, input.snapshotId)
      )
    )
    .returning({ snapshotId: aiDraftSnapshotAttachments.snapshotId });

  if (removed.length === 0) {
    return { ok: true, draft: current };
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
        eq(aiApplicationDrafts.ownerEmployeeId, ownerEmployeeId),
        eq(aiApplicationDrafts.version, input.expectedVersion),
        eq(aiApplicationDrafts.status, 'draft')
      )
    )
    .returning();

  if (!row) {
    const again = await getDraftForOwner(input.draftId, ownerEmployeeId);
    if (!again) throw new Error('draft_not_found');
    return { ok: false, conflict: { code: 'version_conflict', draft: again } };
  }

  return { ok: true, draft: mapDraft(row) };
}
