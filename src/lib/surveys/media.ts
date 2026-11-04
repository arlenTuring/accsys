import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { scanBytes, scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { promote, quarantineKey, readNoFollow, removeKey, writeNew } from '@/lib/attachments/storage';
import { getDb } from '@/lib/db';
import { companySurveyQuestionMedia, companySurveyQuestions, companySurveys } from '@/lib/db/schema';
import {
  MAX_MEDIA_PER_QUESTION,
  sanitizeSurveyMediaFileName,
  sniffSurveyMediaType,
  surveyMediaKind,
  validateSurveyMediaSize,
  type SurveyMediaMime,
} from '@/lib/surveys/media-validate';
import { canManageSurveys, type SurveyActor } from '@/lib/surveys/service';

function isServableScan(scanStatus: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (scanStatus === 'clean') return true;
  return scanStatus === 'unscanned' && env.NODE_ENV !== 'production' && env.ATTACHMENT_SCAN?.trim() !== 'clamav';
}

export type SurveyMediaItem = {
  id: string;
  questionId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: string;
  sortOrder: number;
  kind: 'image' | 'video';
};

export async function listSurveyMedia(surveyId: string): Promise<SurveyMediaItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(companySurveyQuestionMedia)
    .where(eq(companySurveyQuestionMedia.surveyId, surveyId))
    .orderBy(asc(companySurveyQuestionMedia.sortOrder), asc(companySurveyQuestionMedia.createdAt));
  return rows.map((r) => ({
    id: r.id,
    questionId: r.questionId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    scanStatus: r.scanStatus,
    sortOrder: r.sortOrder,
    kind: surveyMediaKind(r.mimeType),
  }));
}

export async function listQuestionMedia(questionId: string): Promise<SurveyMediaItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(companySurveyQuestionMedia)
    .where(eq(companySurveyQuestionMedia.questionId, questionId))
    .orderBy(asc(companySurveyQuestionMedia.sortOrder), asc(companySurveyQuestionMedia.createdAt));
  return rows.map((r) => ({
    id: r.id,
    questionId: r.questionId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    scanStatus: r.scanStatus,
    sortOrder: r.sortOrder,
    kind: surveyMediaKind(r.mimeType),
  }));
}

export async function uploadQuestionMedia(
  actor: SurveyActor,
  surveyId: string,
  questionId: string,
  file: unknown
): Promise<{ ok: true; mediaId: string; scanStatus: string } | { ok: false; error: string }> {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false, error: 'forbidden' };
  if (!/^[0-9a-f-]{36}$/i.test(surveyId) || !/^[0-9a-f-]{36}$/i.test(questionId)) {
    return { ok: false, error: 'not_found' };
  }
  if (!(file instanceof File)) return { ok: false, error: '請選擇檔案' };

  const size = validateSurveyMediaSize(file.size);
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

  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false, error: 'not_found' };
  if (survey.status !== 'draft' && survey.status !== 'scheduled') {
    return { ok: false, error: '已發布後不可再改題目媒體' };
  }
  const [question] = await db
    .select()
    .from(companySurveyQuestions)
    .where(and(eq(companySurveyQuestions.id, questionId), eq(companySurveyQuestions.surveyId, surveyId)))
    .limit(1);
  if (!question) return { ok: false, error: '找不到題目，請先儲存題目' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length === 0) return { ok: false, error: '檔案內容不完整' };
  const mime = sniffSurveyMediaType(bytes);
  if (!mime) {
    return { ok: false, error: '僅接受 JPEG／PNG／WebP 圖片，或 MP4／WebM 影片（以檔案內容判斷）' };
  }

  const id = randomUUID();
  const finalKey = `survey/${surveyId}/${questionId}/${randomUUID()}`;
  const fileName = sanitizeSurveyMediaFileName(file.name, mime);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`survey-question-media:${questionId}`}, 0))`
    );
    const countResult = await tx.execute(sql`
      select count(*)::int as n from company_survey_question_media
      where question_id = ${questionId}::uuid
    `);
    const countRows = Array.isArray(countResult)
      ? countResult
      : ((countResult as { rows?: Array<{ n: number }> }).rows ?? []);
    const n = Number((countRows[0] as { n?: number } | undefined)?.n ?? 0);
    if (n >= MAX_MEDIA_PER_QUESTION) return { full: MAX_MEDIA_PER_QUESTION as number };
    await tx.insert(companySurveyQuestionMedia).values({
      id,
      surveyId,
      questionId,
      uploadedByEmployeeId: actor.id,
      storagePath: finalKey,
      fileName,
      mimeType: mime,
      fileSizeBytes: bytes.length,
      scanStatus: 'pending',
      sha256,
      sortOrder: n,
    });
    await recordAudit(tx, {
      actorEmployeeId: actor.id,
      action: 'survey.question_media_uploaded',
      entityType: 'company_survey',
      entityId: surveyId,
      details: { mediaId: id, questionId, mime, size: bytes.length, sha256 },
    });
    return 'stored' as const;
  });

  if (typeof outcome === 'object') {
    return { ok: false, error: `每題最多 ${outcome.full} 個媒體檔` };
  }

  await writeNew(quarantineKey(id), bytes);
  const verdict = await scanBytes(bytes, scanner);
  if (verdict === 'clean' || verdict === 'unscanned') await promote(quarantineKey(id), finalKey);
  if (verdict === 'infected') await removeKey(quarantineKey(id));
  await db
    .update(companySurveyQuestionMedia)
    .set({
      scanStatus: verdict,
      scannedAt: verdict === 'unscanned' ? null : sql`now()`,
    })
    .where(eq(companySurveyQuestionMedia.id, id));

  if (verdict === 'infected') {
    await db.delete(companySurveyQuestionMedia).where(eq(companySurveyQuestionMedia.id, id));
    return { ok: false, error: '檔案未通過安全掃描，已拒絕' };
  }
  if (verdict === 'scan_failed') {
    return { ok: false, error: '檔案安全掃描失敗，已暫存待重新掃描，目前無法播放' };
  }

  return { ok: true, mediaId: id, scanStatus: verdict };
}

export async function removeQuestionMedia(
  actor: SurveyActor,
  surveyId: string,
  mediaId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false, error: 'forbidden' };
  if (!/^[0-9a-f-]{36}$/i.test(surveyId) || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
    return { ok: false, error: 'not_found' };
  }
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false, error: 'not_found' };
  if (survey.status !== 'draft' && survey.status !== 'scheduled') {
    return { ok: false, error: '已發布後不可再改題目媒體' };
  }
  const [row] = await db
    .select()
    .from(companySurveyQuestionMedia)
    .where(and(eq(companySurveyQuestionMedia.id, mediaId), eq(companySurveyQuestionMedia.surveyId, surveyId)))
    .limit(1);
  if (!row) return { ok: false, error: 'not_found' };

  await db.delete(companySurveyQuestionMedia).where(eq(companySurveyQuestionMedia.id, mediaId));
  try {
    await removeKey(row.storagePath);
  } catch {
    /* best-effort */
  }
  try {
    await removeKey(quarantineKey(mediaId));
  } catch {
    /* best-effort */
  }
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'survey.question_media_removed',
    entityType: 'company_survey',
    entityId: surveyId,
    details: { mediaId, fileName: row.fileName, questionId: row.questionId },
  });
  return { ok: true };
}

export async function readSurveyMediaFor(input: {
  actor: { id: string; role: string; departmentId?: string | null } | null;
  surveyId: string;
  mediaId: string;
}): Promise<
  | { ok: true; bytes: Buffer; fileName: string; mimeType: SurveyMediaMime }
  | { ok: false; status: 404 | 409 | 403 }
> {
  const { actor, surveyId, mediaId } = input;
  if (!actor || !/^[0-9a-f-]{36}$/i.test(surveyId) || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
    return { ok: false, status: 404 };
  }

  const manage = await canManageSurveys(actor);
  const db = getDb();
  const [row] = await db
    .select()
    .from(companySurveyQuestionMedia)
    .where(and(eq(companySurveyQuestionMedia.id, mediaId), eq(companySurveyQuestionMedia.surveyId, surveyId)))
    .limit(1);
  if (!row) return { ok: false, status: 404 };

  if (!manage) {
    const { getSurveyForAnswer } = await import('@/lib/surveys/service');
    const packed = await getSurveyForAnswer({
      surveyId,
      employeeId: actor.id,
      departmentId: actor.departmentId ?? null,
    });
    if (!packed) return { ok: false, status: 403 };
  } else {
    const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
    if (!survey) return { ok: false, status: 404 };
  }

  if (!isServableScan(row.scanStatus)) return { ok: false, status: 409 };
  try {
    const bytes = await readNoFollow(row.storagePath);
    const sniffed = sniffSurveyMediaType(bytes);
    if (sniffed !== row.mimeType) return { ok: false, status: 409 };
    return { ok: true, bytes, fileName: row.fileName, mimeType: sniffed };
  } catch {
    return { ok: false, status: 404 };
  }
}
