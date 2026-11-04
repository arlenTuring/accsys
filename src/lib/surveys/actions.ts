'use server';

import { revalidatePath } from 'next/cache';
import { notifyAiKnowledgeUpdated } from '@/lib/ai-chat/knowledge-sync';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as service from '@/lib/surveys/service';

function revalidateSurveyPaths(surveyId?: string, reason = 'survey_updated') {
  notifyAiKnowledgeUpdated('surveys', reason);
  revalidatePath('/surveys');
  revalidatePath('/admin/surveys');
  if (surveyId) {
    revalidatePath(`/surveys/${surveyId}`);
    revalidatePath(`/admin/surveys/${surveyId}/edit`);
  }
}

export async function createSurveyAction(input: {
  title: string;
  description?: string;
  audienceType?: 'company' | 'department' | 'employees';
}) {
  const actor = await getCurrentEmployee();
  const result = await service.createSurvey(actor, input);
  if (result.ok) revalidateSurveyPaths(result.survey.id);
  return result;
}

export async function updateSurveyBasicsAction(
  surveyId: string,
  input: { title: string; description?: string }
) {
  const actor = await getCurrentEmployee();
  const result = await service.updateSurveyBasics(actor, surveyId, input);
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function upsertQuestionAction(surveyId: string, q: service.SurveyQuestionInput) {
  const actor = await getCurrentEmployee();
  const result = await service.upsertQuestion(actor, surveyId, q);
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function deleteQuestionAction(surveyId: string, questionId: string) {
  const actor = await getCurrentEmployee();
  const result = await service.deleteQuestion(actor, surveyId, questionId);
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function uploadQuestionMediaAction(surveyId: string, questionId: string, formData: FormData) {
  const actor = await getCurrentEmployee();
  const { uploadQuestionMedia } = await import('@/lib/surveys/media');
  const result = await uploadQuestionMedia(actor, surveyId, questionId, formData.get('file'));
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function removeQuestionMediaAction(surveyId: string, mediaId: string) {
  const actor = await getCurrentEmployee();
  const { removeQuestionMedia } = await import('@/lib/surveys/media');
  const result = await removeQuestionMedia(actor, surveyId, mediaId);
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function publishSurveyAction(
  surveyId: string,
  expectedVersion: number,
  options?: { opensAt?: string | null; closesAt?: string | null }
) {
  const actor = await getCurrentEmployee();
  const result = await service.publishSurvey(actor, surveyId, expectedVersion, options);
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function saveSurveyDraftMetaAction(
  surveyId: string,
  expectedVersion: number,
  input?: { opensAt?: string | null; closesAt?: string | null }
) {
  const actor = await getCurrentEmployee();
  const result = await service.saveSurveyDraftMeta(actor, surveyId, expectedVersion, input);
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function closeSurveyAction(surveyId: string, expectedVersion: number) {
  const actor = await getCurrentEmployee();
  const result = await service.closeSurvey(actor, surveyId, expectedVersion);
  if (result.ok) revalidateSurveyPaths(surveyId);
  return result;
}

export async function saveSurveyDraftAction(surveyId: string, answers: Record<string, unknown>) {
  const actor = await getCurrentEmployee();
  if (!actor) return { ok: false as const, error: '請先登入' };
  const result = await service.saveResponseDraft({
    surveyId,
    employeeId: actor.id,
    departmentId: actor.departmentId,
    answers,
  });
  if (result.ok) revalidatePath(`/surveys/${surveyId}`);
  return result;
}

export async function submitSurveyAction(surveyId: string, answers: Record<string, unknown>) {
  const actor = await getCurrentEmployee();
  if (!actor) return { ok: false as const, error: '請先登入' };
  const result = await service.submitResponse({
    surveyId,
    employeeId: actor.id,
    departmentId: actor.departmentId,
    answers,
  });
  if (result.ok) revalidatePath(`/surveys/${surveyId}`);
  return result;
}

export async function exportSurveyCsvAction(surveyId: string) {
  const actor = await getCurrentEmployee();
  if (!actor) return { ok: false as const, error: '請先登入' };
  if (!(await service.canViewSurveyResults(actor))) {
    return { ok: false as const, error: '沒有問卷結果權限' };
  }
  const { getDb } = await import('@/lib/db');
  const { companySurveyQuestions, companySurveyResponses, companySurveys } = await import('@/lib/db/schema');
  const { and, asc, eq } = await import('drizzle-orm');
  const db = getDb();
  const [survey] = await db.select().from(companySurveys).where(eq(companySurveys.id, surveyId)).limit(1);
  if (!survey) return { ok: false as const, error: '找不到問卷' };
  const questions =
    survey.publishedQuestionSnapshot && Array.isArray(survey.publishedQuestionSnapshot)
      ? (survey.publishedQuestionSnapshot as Array<{ stableKey: string; prompt: string }>)
      : await db
          .select({ stableKey: companySurveyQuestions.stableKey, prompt: companySurveyQuestions.prompt })
          .from(companySurveyQuestions)
          .where(eq(companySurveyQuestions.surveyId, surveyId))
          .orderBy(asc(companySurveyQuestions.sortOrder));
  const responses = await db
    .select({
      employeeId: companySurveyResponses.employeeId,
      answers: companySurveyResponses.answers,
      submittedAt: companySurveyResponses.submittedAt,
    })
    .from(companySurveyResponses)
    .where(and(eq(companySurveyResponses.surveyId, surveyId), eq(companySurveyResponses.status, 'submitted')));
  const csv = service.answersToCsv(questions, responses);
  return { ok: true as const, fileName: `survey-${surveyId.slice(0, 8)}.csv`, csv };
}
