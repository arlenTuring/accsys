import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { actorHas } from '@/lib/authz/access';
import { getDb } from '@/lib/db';
import {
  companySurveyQuestions,
  companySurveyResponses,
  companySurveys,
} from '@/lib/db/schema';

import { type QuestionType, type SurveyQuestionInput, nextStableKey } from '@/lib/surveys/types';

export type SurveyActor = { id: string; role: string } | null;
export type { QuestionType, SurveyQuestionInput };
export { nextStableKey };

export async function canManageSurveys(actor: SurveyActor): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return actorHas(actor, 'company.surveys');
}

export async function canViewSurveyResults(actor: SurveyActor): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return (await actorHas(actor, 'company.surveys_results')) || (await canManageSurveys(actor));
}

function inAudience(
  row: {
    audienceType: string;
    audienceDepartmentIds: string[] | null;
    audienceEmployeeIds: string[] | null;
  },
  employeeId: string,
  departmentId: string | null
): boolean {
  if (row.audienceType === 'company') return true;
  if (row.audienceType === 'department') {
    return !!departmentId && (row.audienceDepartmentIds ?? []).includes(departmentId);
  }
  return (row.audienceEmployeeIds ?? []).includes(employeeId);
}

export async function createSurvey(
  actor: SurveyActor,
  input: {
    title: string;
    description?: string;
    audienceType?: 'company' | 'department' | 'employees';
    audienceDepartmentIds?: string[];
    audienceEmployeeIds?: string[];
    opensAt?: string | null;
    closesAt?: string | null;
  }
) {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false as const, error: '標題不可空白' };
  const db = getDb();
  const [row] = await db
    .insert(companySurveys)
    .values({
      title,
      description: (input.description ?? '').slice(0, 5000),
      audienceType: input.audienceType ?? 'company',
      audienceDepartmentIds: input.audienceDepartmentIds ?? [],
      audienceEmployeeIds: input.audienceEmployeeIds ?? [],
      opensAt: input.opensAt ? new Date(input.opensAt) : null,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
      createdByEmployeeId: actor.id,
      updatedByEmployeeId: actor.id,
    })
    .returning();
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'survey.create',
    entityType: 'company_survey',
    entityId: row.id,
    details: { title },
  });
  return { ok: true as const, survey: row };
}

export async function upsertQuestion(actor: SurveyActor, surveyId: string, q: SurveyQuestionInput) {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: 'not_found' };
  if (survey.status !== 'draft' && survey.status !== 'scheduled') {
    return { ok: false as const, error: '已有回覆／已發布後不可直接改題意；請關閉後新建問卷' };
  }
  const stableKey = q.stableKey.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(stableKey)) return { ok: false as const, error: 'stable_key 格式錯誤' };
  const prompt = q.prompt.trim().slice(0, 500);
  if (!prompt) return { ok: false as const, error: '題目不可空白' };

  const [row] = await db
    .insert(companySurveyQuestions)
    .values({
      surveyId,
      stableKey,
      prompt,
      help: (q.help ?? '').slice(0, 1000),
      questionType: q.questionType,
      required: !!q.required,
      sortOrder: q.sortOrder ?? 0,
      options: q.options ?? [],
    })
    .onConflictDoUpdate({
      target: [companySurveyQuestions.surveyId, companySurveyQuestions.stableKey],
      set: {
        prompt,
        help: (q.help ?? '').slice(0, 1000),
        questionType: q.questionType,
        required: !!q.required,
        sortOrder: q.sortOrder ?? 0,
        options: q.options ?? [],
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return { ok: true as const, question: row };
}

export async function listQuestions(surveyId: string) {
  const db = getDb();
  return db
    .select()
    .from(companySurveyQuestions)
    .where(eq(companySurveyQuestions.surveyId, surveyId))
    .orderBy(asc(companySurveyQuestions.sortOrder), asc(companySurveyQuestions.createdAt));
}

export async function deleteQuestion(actor: SurveyActor, surveyId: string, questionId: string) {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: 'not_found' };
  if (survey.status !== 'draft' && survey.status !== 'scheduled') {
    return { ok: false as const, error: '已發布後不可刪題' };
  }
  const deleted = await db
    .delete(companySurveyQuestions)
    .where(and(eq(companySurveyQuestions.id, questionId), eq(companySurveyQuestions.surveyId, surveyId)))
    .returning({ id: companySurveyQuestions.id });
  if (deleted.length === 0) return { ok: false as const, error: 'not_found' };
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'survey.question_delete',
    entityType: 'company_survey',
    entityId: surveyId,
    details: { questionId },
  });
  return { ok: true as const };
}

export async function publishSurvey(
  actor: SurveyActor,
  surveyId: string,
  expectedVersion: number,
  options?: {
    /** ISO datetime; omit or past/now → open immediately. Future → scheduled. */
    opensAt?: string | null;
    closesAt?: string | null;
  }
) {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: 'not_found' };
  if (survey.version !== expectedVersion) return { ok: false as const, error: 'version_conflict', version: survey.version };
  if (survey.status !== 'draft' && survey.status !== 'scheduled') {
    return { ok: false as const, error: '僅草稿或預約中的問卷可發布' };
  }
  const questions = await listQuestions(surveyId);
  if (questions.length === 0) return { ok: false as const, error: '請先新增至少一題' };

  const now = Date.now();
  let opensAt: Date;
  if (options?.opensAt) {
    const parsed = new Date(options.opensAt);
    if (Number.isNaN(parsed.getTime())) return { ok: false as const, error: '預約時間格式錯誤' };
    opensAt = parsed;
  } else {
    opensAt = new Date();
  }
  let closesAt: Date | null = null;
  if (options?.closesAt) {
    const parsed = new Date(options.closesAt);
    if (Number.isNaN(parsed.getTime())) return { ok: false as const, error: '截止時間格式錯誤' };
    closesAt = parsed;
    if (closesAt.getTime() <= opensAt.getTime()) {
      return { ok: false as const, error: '截止時間必須晚於開放時間' };
    }
  } else if (options && 'closesAt' in options && options.closesAt === null) {
    closesAt = null;
  } else {
    closesAt = survey.closesAt;
  }

  const status = opensAt.getTime() > now ? 'scheduled' : 'open';
  const { listSurveyMedia } = await import('@/lib/surveys/media');
  const allMedia = await listSurveyMedia(surveyId);
  const mediaByQuestion = new Map<string, typeof allMedia>();
  for (const m of allMedia) {
    if (m.scanStatus !== 'clean' && m.scanStatus !== 'unscanned') continue;
    const list = mediaByQuestion.get(m.questionId) ?? [];
    list.push(m);
    mediaByQuestion.set(m.questionId, list);
  }

  const snapshot = questions.map((q) => ({
    id: q.id,
    stableKey: q.stableKey,
    prompt: q.prompt,
    help: q.help,
    questionType: q.questionType,
    required: q.required,
    sortOrder: q.sortOrder,
    options: q.options,
    validation: q.validation,
    media: (mediaByQuestion.get(q.id) ?? []).map((m) => ({
      id: m.id,
      fileName: m.fileName,
      mimeType: m.mimeType,
      kind: m.kind,
    })),
  }));

  const [row] = await db
    .update(companySurveys)
    .set({
      status,
      opensAt,
      closesAt,
      publishedAt: sql`now()`,
      publishedQuestionSnapshot: snapshot,
      version: survey.version + 1,
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
    })
    .where(eq(companySurveys.id, surveyId))
    .returning();

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'survey.publish',
    entityType: 'company_survey',
    entityId: surveyId,
    details: { status, opensAt: opensAt.toISOString(), closesAt: closesAt?.toISOString() ?? null, questionCount: questions.length, version: row.version },
  });
  return { ok: true as const, survey: row };
}

export async function updateSurveyBasics(
  actor: SurveyActor,
  surveyId: string,
  input: { title: string; description?: string }
) {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false as const, error: '標題不可空白' };
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: 'not_found' };
  if (survey.status !== 'draft' && survey.status !== 'scheduled') {
    return { ok: false as const, error: '已發布後不可改標題說明；請關閉後新建' };
  }
  const [row] = await db
    .update(companySurveys)
    .set({
      title,
      description: (input.description ?? '').slice(0, 5000),
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
    })
    .where(eq(companySurveys.id, surveyId))
    .returning();
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'survey.update_basics',
    entityType: 'company_survey',
    entityId: surveyId,
    details: { title },
  });
  return { ok: true as const, survey: row };
}

/** Keep draft (or pull scheduled back to draft) and optionally update open/close times. */
export async function saveSurveyDraftMeta(
  actor: SurveyActor,
  surveyId: string,
  expectedVersion: number,
  input?: { opensAt?: string | null; closesAt?: string | null }
) {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: 'not_found' };
  if (survey.version !== expectedVersion) return { ok: false as const, error: 'version_conflict', version: survey.version };
  if (survey.status !== 'draft' && survey.status !== 'scheduled') {
    return { ok: false as const, error: '僅草稿或預約中的問卷可儲存為草稿' };
  }
  const opensAt =
    input && 'opensAt' in input
      ? input.opensAt
        ? new Date(input.opensAt)
        : null
      : survey.opensAt;
  const closesAt =
    input && 'closesAt' in input
      ? input.closesAt
        ? new Date(input.closesAt)
        : null
      : survey.closesAt;
  if (opensAt && Number.isNaN(opensAt.getTime())) return { ok: false as const, error: '預約時間格式錯誤' };
  if (closesAt && Number.isNaN(closesAt.getTime())) return { ok: false as const, error: '截止時間格式錯誤' };

  const [row] = await db
    .update(companySurveys)
    .set({
      status: 'draft',
      opensAt,
      closesAt,
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
      version: survey.version + 1,
    })
    .where(eq(companySurveys.id, surveyId))
    .returning();

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'survey.save_draft',
    entityType: 'company_survey',
    entityId: surveyId,
    details: { version: row.version },
  });
  return { ok: true as const, survey: row };
}

export async function closeSurvey(actor: SurveyActor, surveyId: string, expectedVersion: number) {
  if (!(await canManageSurveys(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: 'not_found' };
  if (survey.version !== expectedVersion) return { ok: false as const, error: 'version_conflict', version: survey.version };
  const [row] = await db
    .update(companySurveys)
    .set({
      status: 'closed',
      closedAt: sql`now()`,
      version: survey.version + 1,
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
    })
    .where(eq(companySurveys.id, surveyId))
    .returning();
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'survey.close',
    entityType: 'company_survey',
    entityId: surveyId,
    details: { version: row.version },
  });
  return { ok: true as const, survey: row };
}

export async function listSurveysForViewer(input: {
  employeeId: string;
  departmentId: string | null;
  manage: boolean;
}) {
  const db = getDb();
  const rows = await db
    .select()
    .from(companySurveys)
    .where(input.manage ? undefined : inArray(companySurveys.status, ['open', 'scheduled', 'closed']))
    .orderBy(asc(companySurveys.title))
    .limit(200);

  const now = Date.now();
  return rows.filter((s) => {
    if (input.manage) return true;
    if (!inAudience(s, input.employeeId, input.departmentId)) return false;
    if (s.status === 'draft' || s.status === 'archived') return false;
    if (s.status === 'scheduled' && s.opensAt && s.opensAt.getTime() > now) return false;
    return true;
  });
}

export async function getSurveyForAnswer(input: {
  surveyId: string;
  employeeId: string;
  departmentId: string | null;
}) {
  const db = getDb();
  await activateDueSurveys();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, input.surveyId)).limit(1);
  if (!survey) return null;
  if (!inAudience(survey, input.employeeId, input.departmentId)) return null;
  if (survey.status !== 'open' && survey.status !== 'closed') return null;
  const questions =
    survey.publishedQuestionSnapshot && Array.isArray(survey.publishedQuestionSnapshot)
      ? (survey.publishedQuestionSnapshot as Awaited<ReturnType<typeof listQuestions>>)
      : await listQuestions(survey.id);
  const [response] = await db
    .select()
    .from(companySurveyResponses)
    .where(
      and(
        eq(companySurveyResponses.surveyId, survey.id),
        eq(companySurveyResponses.employeeId, input.employeeId)
      )
    )
    .limit(1);
  return { survey, questions, response: response ?? null };
}

function validateAnswers(
  questions: Array<{
    stableKey: string;
    required: boolean;
    questionType: string;
    options: Array<{ id: string; label: string }> | null;
  }>,
  answers: Record<string, unknown>
): string | null {
  for (const q of questions) {
    const v = answers[q.stableKey];
    if (q.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) {
      return `請填寫：${q.stableKey}`;
    }
    if (v === undefined || v === null || v === '') continue;
    if (q.questionType === 'multi_choice' && !Array.isArray(v)) return `${q.stableKey} 需為多選陣列`;
    if (q.questionType === 'number' && typeof v !== 'number' && Number.isNaN(Number(v))) {
      return `${q.stableKey} 需為數字`;
    }
  }
  return null;
}

export async function saveResponseDraft(input: {
  surveyId: string;
  employeeId: string;
  departmentId: string | null;
  answers: Record<string, unknown>;
}) {
  const packed = await getSurveyForAnswer(input);
  if (!packed) return { ok: false as const, error: '找不到問卷或無權填寫' };
  if (packed.survey.status !== 'open') return { ok: false as const, error: '問卷未開放' };
  if (packed.response?.status === 'submitted') return { ok: false as const, error: '已提交，不可再改' };
  if (packed.survey.closesAt && packed.survey.closesAt.getTime() < Date.now()) {
    return { ok: false as const, error: '已截止' };
  }

  const db = getDb();
  const [row] = await db
    .insert(companySurveyResponses)
    .values({
      surveyId: input.surveyId,
      employeeId: input.employeeId,
      status: 'draft',
      answers: input.answers,
      surveyVersion: packed.survey.version,
    })
    .onConflictDoUpdate({
      target: [companySurveyResponses.surveyId, companySurveyResponses.employeeId],
      set: {
        answers: input.answers,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return { ok: true as const, response: row };
}

export async function submitResponse(input: {
  surveyId: string;
  employeeId: string;
  departmentId: string | null;
  answers: Record<string, unknown>;
}) {
  const packed = await getSurveyForAnswer(input);
  if (!packed) return { ok: false as const, error: '找不到問卷或無權填寫' };
  if (packed.survey.status !== 'open') return { ok: false as const, error: '問卷未開放' };
  if (packed.response?.status === 'submitted') return { ok: false as const, error: '已提交' };
  if (packed.survey.closesAt && packed.survey.closesAt.getTime() < Date.now()) {
    return { ok: false as const, error: '已截止' };
  }
  const err = validateAnswers(packed.questions, input.answers);
  if (err) return { ok: false as const, error: err };

  const db = getDb();
  const [row] = await db
    .insert(companySurveyResponses)
    .values({
      surveyId: input.surveyId,
      employeeId: input.employeeId,
      status: 'submitted',
      answers: input.answers,
      surveyVersion: packed.survey.version,
      submittedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [companySurveyResponses.surveyId, companySurveyResponses.employeeId],
      set: {
        status: 'submitted',
        answers: input.answers,
        submittedAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  await recordAudit(db, {
    actorEmployeeId: input.employeeId,
    action: 'survey.submit',
    entityType: 'company_survey',
    entityId: input.surveyId,
    details: { responseId: row.id },
  });
  return { ok: true as const, response: row };
}

export async function surveyStats(actor: SurveyActor, surveyId: string) {
  if (!(await canViewSurveyResults(actor))) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: 'not_found' };
  const responses = await db
    .select()
    .from(companySurveyResponses)
    .where(and(eq(companySurveyResponses.surveyId, surveyId), eq(companySurveyResponses.status, 'submitted')));
  const questions =
    survey.publishedQuestionSnapshot && Array.isArray(survey.publishedQuestionSnapshot)
      ? (survey.publishedQuestionSnapshot as Awaited<ReturnType<typeof listQuestions>>)
      : await listQuestions(surveyId);

  const byQuestion: Record<string, { type: string; prompt: string; counts: Record<string, number>; numeric: number[] }> =
    {};
  for (const q of questions) {
    byQuestion[q.stableKey] = { type: q.questionType, prompt: q.prompt, counts: {}, numeric: [] };
  }
  for (const r of responses) {
    for (const [key, val] of Object.entries(r.answers ?? {})) {
      const bucket = byQuestion[key];
      if (!bucket) continue;
      if (Array.isArray(val)) {
        for (const item of val) {
          const k = String(item);
          bucket.counts[k] = (bucket.counts[k] ?? 0) + 1;
        }
      } else if (typeof val === 'number' || (typeof val === 'string' && val !== '' && !Number.isNaN(Number(val)))) {
        bucket.numeric.push(Number(val));
        const k = String(val);
        bucket.counts[k] = (bucket.counts[k] ?? 0) + 1;
      } else {
        const k = String(val).slice(0, 200);
        bucket.counts[k] = (bucket.counts[k] ?? 0) + 1;
      }
    }
  }

  return {
    ok: true as const,
    submittedCount: responses.length,
    questions: byQuestion,
  };
}

/** CSV export with formula-injection mitigation. */
export function answersToCsv(
  questions: Array<{ stableKey: string; prompt: string }>,
  responses: Array<{ employeeId: string; answers: Record<string, unknown>; submittedAt: Date | null }>
): string {
  const escape = (v: string) => {
    let s = v.replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s}"`;
  };
  const header = ['employee_id', 'submitted_at', ...questions.map((q) => q.stableKey)].map(escape).join(',');
  const lines = responses.map((r) =>
    [
      r.employeeId,
      r.submittedAt?.toISOString() ?? '',
      ...questions.map((q) => {
        const v = r.answers[q.stableKey];
        if (Array.isArray(v)) return v.join('|');
        return v == null ? '' : String(v);
      }),
    ]
      .map((c) => escape(String(c)))
      .join(',')
  );
  return [header, ...lines].join('\n');
}

export async function listPendingSurveysForEmployee(input: {
  employeeId: string;
  departmentId: string | null;
  limit?: number;
}) {
  await activateDueSurveys();
  const surveys = await listSurveysForViewer({ ...input, manage: false });
  const open = surveys.filter((s) => s.status === 'open');
  const db = getDb();
  const responses = await db
    .select()
    .from(companySurveyResponses)
    .where(eq(companySurveyResponses.employeeId, input.employeeId));
  const bySurvey = new Map(responses.map((r) => [r.surveyId, r]));
  return open
    .filter((s) => bySurvey.get(s.id)?.status !== 'submitted')
    .filter((s) => !s.closesAt || s.closesAt.getTime() >= Date.now())
    .slice(0, input.limit ?? 10)
    .map((s) => ({
      id: s.id,
      title: s.title,
      closesAt: s.closesAt?.toISOString() ?? null,
      href: `/surveys/${s.id}`,
      draft: bySurvey.get(s.id)?.status === 'draft',
    }));
}

export async function activateDueSurveys() {
  const db = getDb();
  await db
    .update(companySurveys)
    .set({ status: 'open', updatedAt: sql`now()` })
    .where(and(eq(companySurveys.status, 'scheduled'), sql`${companySurveys.opensAt} <= now()`));
  await db
    .update(companySurveys)
    .set({ status: 'closed', closedAt: sql`coalesce(${companySurveys.closedAt}, now())`, updatedAt: sql`now()` })
    .where(
      and(
        eq(companySurveys.status, 'open'),
        sql`${companySurveys.closesAt} is not null and ${companySurveys.closesAt} < now()`
      )
    );
}
