import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { listSurveyMedia } from '@/lib/surveys/media';
import { surveyMediaKind } from '@/lib/surveys/media-validate';
import {
  canManageSurveys,
  canViewSurveyResults,
  getSurveyForAnswer,
  surveyStats,
} from '@/lib/surveys/service';
import { getDb } from '@/lib/db';
import { companySurveys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { SurveyAnswerForm } from './survey-answer-form';
import { SurveyExportButton } from './survey-export-button';

type SnapshotMedia = { id: string; fileName: string; mimeType: string; kind?: 'image' | 'video' };

function normalizeQuestionMedia(
  q: {
    id?: string;
    stableKey: string;
    prompt: string;
    help?: string | null;
    questionType: string;
    required: boolean;
    options?: Array<{ id: string; label: string }> | null;
    media?: SnapshotMedia[] | null;
  },
  mediaByQuestionId: Map<string, SnapshotMedia[]>
) {
  const fromSnapshot = Array.isArray(q.media) ? q.media : null;
  const fromDb = q.id ? mediaByQuestionId.get(q.id) : undefined;
  const media = (fromSnapshot ?? fromDb ?? []).map((m) => ({
    id: m.id,
    fileName: m.fileName,
    mimeType: m.mimeType,
    kind: (m.kind ?? surveyMediaKind(m.mimeType)) as 'image' | 'video',
  }));
  return {
    stableKey: q.stableKey,
    prompt: q.prompt,
    help: String(q.help ?? ''),
    questionType: q.questionType,
    required: q.required,
    options: q.options ?? [],
    media,
  };
}

export default async function SurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const { id } = await params;
  const manage = await canManageSurveys(employee);
  const db = getDb();
  const [raw] = await db.select().from(companySurveys).where(eq(companySurveys.id, id)).limit(1);
  if (!raw) notFound();

  // Editing only under 系統管理.
  if (raw.status === 'draft' || raw.status === 'scheduled') {
    if (manage) redirect(`/admin/surveys/${id}/edit`);
    notFound();
  }

  const packed = await getSurveyForAnswer({
    surveyId: id,
    employeeId: employee.id,
    departmentId: employee.departmentId,
  });
  if (!packed && !manage) notFound();

  const canStats = await canViewSurveyResults(employee);
  const stats = canStats ? await surveyStats(employee, id) : null;

  const liveMedia = packed ? await listSurveyMedia(id) : [];
  const mediaByQuestion = new Map<string, SnapshotMedia[]>();
  for (const m of liveMedia) {
    if (m.scanStatus !== 'clean' && m.scanStatus !== 'unscanned') continue;
    const list = mediaByQuestion.get(m.questionId) ?? [];
    list.push({ id: m.id, fileName: m.fileName, mimeType: m.mimeType, kind: m.kind });
    mediaByQuestion.set(m.questionId, list);
  }
  const answerQuestions =
    packed?.questions.map((q) =>
      normalizeQuestionMedia(
        q as {
          id?: string;
          stableKey: string;
          prompt: string;
          help?: string | null;
          questionType: string;
          required: boolean;
          options?: Array<{ id: string; label: string }> | null;
          media?: SnapshotMedia[] | null;
        },
        mediaByQuestion
      )
    ) ?? [];

  return (
    <main className="page-shell space-y-6">
      <p className="text-sm">
        <Link href="/surveys" className="underline">
          ← 問卷列表
        </Link>
      </p>
      <section>
        <h1 className="page-title">{(packed?.survey ?? raw).title}</h1>
        {(packed?.survey ?? raw).description ? (
          <p className="page-subtitle whitespace-pre-wrap">{(packed?.survey ?? raw).description}</p>
        ) : null}
      </section>

      {packed && packed.survey.status === 'open' && packed.response?.status !== 'submitted' && (
        <SurveyAnswerForm
          surveyId={id}
          questions={answerQuestions}
          initialAnswers={(packed.response?.answers as Record<string, unknown>) ?? {}}
        />
      )}

      {packed?.response?.status === 'submitted' && (
        <p className="card p-4 text-sm">你已提交此問卷，謝謝。</p>
      )}

      {packed?.survey.status === 'closed' && packed.response?.status !== 'submitted' && (
        <p className="card p-4 text-sm text-td-muted">問卷已關閉。</p>
      )}

      {stats?.ok && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">統計（已提交 {stats.submittedCount} 份）</h2>
            <SurveyExportButton surveyId={id} />
          </div>
          {Object.entries(stats.questions).map(([key, q]) => (
            <div key={key} className="text-sm">
              <p className="font-medium">
                {q.prompt} <span className="text-xs text-td-muted">({key})</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-td-muted">
                {Object.entries(q.counts)
                  .slice(0, 12)
                  .map(([label, n]) => (
                    <li key={label}>
                      {label || '（空）'}: {n}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
