import { randomUUID, createHash } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { MAX_FILE_SIZE_BYTES } from '@/lib/attachments/policy';
import { scanBytes, scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { readNoFollow, writeNew } from '@/lib/attachments/storage';
import { sniffAllowedType } from '@/lib/attachments/validate';
import { getDb } from '@/lib/db';
import { aiApplicationDrafts, aiChatStagedAttachments, aiDraftFileAttachments, aiFileEditVersions } from '@/lib/db/schema';

/**
 * Non-destructive photo editing. The original stays where it is, byte for
 * byte. A saved edit is a new row with the operations and two renders made in
 * the browser: the output people see, and an analysis copy with crop and
 * rotation only. The AI check reads the analysis copy, so anything written on
 * the photo can never count as evidence from the document. Saving or restoring
 * clears the previous AI result: it described a different picture.
 */

export type EditKind = 'staged' | 'draft_file';

export type EditOperations = {
  rotation: 0 | 90 | 180 | 270;
  /** Crop in original-image coordinates (0–1); null = whole image. */
  crop: { x: number; y: number; w: number; h: number } | null;
  annotations: Record<string, unknown>[];
};

export function parseOperations(raw: unknown): EditOperations | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (![0, 90, 180, 270].includes(r.rotation as number)) return null;
  let crop: EditOperations['crop'] = null;
  if (r.crop !== null && r.crop !== undefined) {
    const c = r.crop as Record<string, unknown>;
    const vals = [c.x, c.y, c.w, c.h];
    if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) return null;
    if ((c.w as number) <= 0 || (c.h as number) <= 0) return null;
    crop = { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number };
  }
  if (!Array.isArray(r.annotations) || r.annotations.length > 200) return null;
  if (JSON.stringify(r.annotations).length > 200_000) return null;
  return { rotation: r.rotation as EditOperations['rotation'], crop, annotations: r.annotations as Record<string, unknown>[] };
}

type Source = {
  activeEditId: string | null;
  fileName: string;
  /** Staged row whose AI result depends on this picture. */
  stagedId: string | null;
  draftId: string | null;
};

async function loadSource(kind: EditKind, id: string, ownerEmployeeId: string): Promise<Source | null> {
  const db = getDb();
  if (kind === 'staged') {
    const [row] = await db
      .select({ activeEditId: aiChatStagedAttachments.activeEditId, fileName: aiChatStagedAttachments.fileName })
      .from(aiChatStagedAttachments)
      .where(
        and(
          eq(aiChatStagedAttachments.id, id),
          eq(aiChatStagedAttachments.ownerEmployeeId, ownerEmployeeId),
          eq(aiChatStagedAttachments.scanStatus, 'ready'),
          isNull(aiChatStagedAttachments.purgedAt)
        )
      )
      .limit(1);
    return row ? { activeEditId: row.activeEditId, fileName: row.fileName, stagedId: id, draftId: null } : null;
  }
  const [row] = await db
    .select({
      activeEditId: aiDraftFileAttachments.activeEditId,
      fileName: aiDraftFileAttachments.fileName,
      sourceStagedId: aiDraftFileAttachments.sourceStagedId,
      draftId: aiDraftFileAttachments.draftId,
      status: aiApplicationDrafts.status,
    })
    .from(aiDraftFileAttachments)
    .innerJoin(aiApplicationDrafts, eq(aiApplicationDrafts.id, aiDraftFileAttachments.draftId))
    .where(and(eq(aiDraftFileAttachments.id, id), eq(aiApplicationDrafts.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!row || row.status !== 'draft') return null;
  return { activeEditId: row.activeEditId, fileName: row.fileName, stagedId: row.sourceStagedId, draftId: row.draftId };
}

/** Point the source at an edit (or the original) and drop the AI result of the previous picture. */
async function activate(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  kind: EditKind,
  id: string,
  source: Source,
  editId: string | null
) {
  if (kind === 'draft_file') {
    await tx.update(aiDraftFileAttachments).set({ activeEditId: editId }).where(eq(aiDraftFileAttachments.id, id));
    if (source.draftId) {
      await tx
        .update(aiApplicationDrafts)
        .set({ version: sql`${aiApplicationDrafts.version} + 1`, updatedAt: sql`now()` })
        .where(eq(aiApplicationDrafts.id, source.draftId));
    }
  }
  if (source.stagedId) {
    await tx
      .update(aiChatStagedAttachments)
      .set({
        activeEditId: editId,
        analysisStatus: null,
        analysisResult: null,
        analysisCompletedAt: null,
        analysisStartedAt: null,
        analysisContentSha256: null,
        analysisCompanyVersion: null,
        analysisRulesVersion: null,
      })
      .where(eq(aiChatStagedAttachments.id, source.stagedId));
  }
}

export type SaveEditResult =
  | { ok: true; editId: string; version: number; analysisCleared: boolean }
  | { ok: false; code: 'not_found' | 'conflict' | 'invalid' | 'unsafe' | 'unavailable'; error: string };

export async function saveFileEdit(input: {
  ownerEmployeeId: string;
  kind: EditKind;
  sourceId: string;
  /** Active edit when the editor opened (null = original); someone else's save in between is a conflict. */
  expectedEditId: string | null;
  operations: EditOperations;
  output: Uint8Array;
  analysis: Uint8Array;
}): Promise<SaveEditResult> {
  const source = await loadSource(input.kind, input.sourceId, input.ownerEmployeeId);
  if (!source) return { ok: false, code: 'not_found', error: '找不到檔案，或這張草稿已送出。' };
  if (source.activeEditId !== input.expectedEditId) {
    return { ok: false, code: 'conflict', error: '這張圖片已有較新的編輯版本，請重新開啟後再編輯。' };
  }
  const mimeType = sniffAllowedType(input.output);
  const analysisMime = sniffAllowedType(input.analysis);
  const images = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!mimeType || !analysisMime || !images.has(mimeType) || !images.has(analysisMime)) {
    return { ok: false, code: 'invalid', error: '編輯結果格式不正確。' };
  }
  if (input.output.length > MAX_FILE_SIZE_BYTES || input.analysis.length > MAX_FILE_SIZE_BYTES) {
    return { ok: false, code: 'invalid', error: '編輯結果過大。' };
  }
  let scanner;
  try {
    scanner = scannerConfig();
  } catch (err) {
    if (err instanceof ScannerUnavailable) return { ok: false, code: 'unavailable', error: '附件掃描服務未設定，暫時無法儲存。' };
    throw err;
  }
  for (const bytes of [input.output, input.analysis]) {
    const verdict = await scanBytes(bytes, scanner);
    if (verdict === 'infected') return { ok: false, code: 'unsafe', error: '編輯結果未通過安全掃描。' };
    if (verdict === 'scan_failed') return { ok: false, code: 'unavailable', error: '安全掃描失敗，請重試。' };
  }

  const editId = randomUUID();
  const base = `ai-edits/${input.kind}/${input.sourceId}/${editId}`;
  await writeNew(`${base}.output`, input.output);
  await writeNew(`${base}.analysis`, input.analysis);

  const version = await getDb().transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${aiFileEditVersions.version}), 0) + 1` })
      .from(aiFileEditVersions)
      .where(and(eq(aiFileEditVersions.sourceKind, input.kind), eq(aiFileEditVersions.sourceId, input.sourceId)));
    await tx.insert(aiFileEditVersions).values({
      id: editId,
      ownerEmployeeId: input.ownerEmployeeId,
      sourceKind: input.kind,
      sourceId: input.sourceId,
      version: next,
      operations: input.operations as unknown as Record<string, unknown>,
      outputPath: `${base}.output`,
      outputSha256: createHash('sha256').update(input.output).digest('hex'),
      analysisPath: `${base}.analysis`,
      analysisSha256: createHash('sha256').update(input.analysis).digest('hex'),
      mimeType,
    });
    await activate(tx, input.kind, input.sourceId, source, editId);
    await recordAudit(tx, {
      actorEmployeeId: input.ownerEmployeeId,
      action: 'ai_file.edited',
      entityType: input.kind === 'staged' ? 'ai_staged_attachment' : 'ai_draft_file',
      entityId: input.sourceId,
      details: { version: next, rotation: input.operations.rotation, cropped: Boolean(input.operations.crop), annotations: input.operations.annotations.length },
    });
    return next;
  });
  return { ok: true, editId, version, analysisCleared: Boolean(source.stagedId) };
}

export async function restoreOriginal(input: { ownerEmployeeId: string; kind: EditKind; sourceId: string }): Promise<{ ok: boolean; error?: string }> {
  const source = await loadSource(input.kind, input.sourceId, input.ownerEmployeeId);
  if (!source) return { ok: false, error: '找不到檔案，或這張草稿已送出。' };
  if (!source.activeEditId) return { ok: true };
  await getDb().transaction(async (tx) => {
    await activate(tx, input.kind, input.sourceId, source, null);
    await recordAudit(tx, {
      actorEmployeeId: input.ownerEmployeeId,
      action: 'ai_file.restored',
      entityType: input.kind === 'staged' ? 'ai_staged_attachment' : 'ai_draft_file',
      entityId: input.sourceId,
      details: { fromEdit: source.activeEditId },
    });
  });
  return { ok: true };
}

export async function getEdit(editId: string, ownerEmployeeId: string) {
  const [row] = await getDb()
    .select()
    .from(aiFileEditVersions)
    .where(and(eq(aiFileEditVersions.id, editId), eq(aiFileEditVersions.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  return row ?? null;
}

export async function editState(kind: EditKind, sourceId: string, ownerEmployeeId: string) {
  const source = await loadSource(kind, sourceId, ownerEmployeeId);
  if (!source) return null;
  const active = source.activeEditId ? await getEdit(source.activeEditId, ownerEmployeeId) : null;
  const history = await getDb()
    .select({ id: aiFileEditVersions.id, version: aiFileEditVersions.version, createdAt: aiFileEditVersions.createdAt })
    .from(aiFileEditVersions)
    .where(and(eq(aiFileEditVersions.sourceKind, kind), eq(aiFileEditVersions.sourceId, sourceId)))
    .orderBy(desc(aiFileEditVersions.version))
    .limit(50);
  return {
    activeEditId: source.activeEditId,
    fileName: source.fileName,
    operations: (active?.operations as unknown as EditOperations | undefined) ?? null,
    version: active?.version ?? null,
    history: history.map((h) => ({ id: h.id, version: h.version, createdAt: h.createdAt.toISOString() })),
  };
}

/** The picture people see (annotations included) for an edit, or null when the id is not the owner's. */
export async function readEditOutput(editId: string, ownerEmployeeId: string) {
  const row = await getEdit(editId, ownerEmployeeId);
  if (!row) return null;
  return { bytes: await readNoFollow(row.outputPath), mimeType: row.mimeType };
}

/** The picture the AI reads: crop and rotation only. */
export async function readEditAnalysis(editId: string, ownerEmployeeId: string) {
  const row = await getEdit(editId, ownerEmployeeId);
  if (!row) return null;
  const bytes = await readNoFollow(row.analysisPath);
  return { bytes, sha256: row.analysisSha256, mimeType: sniffAllowedType(bytes) ?? row.mimeType };
}
