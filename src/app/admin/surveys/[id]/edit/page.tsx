import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SurveyBasicsForm } from '@/app/surveys/[id]/survey-basics-form';
import { SurveyEditor } from '@/app/surveys/[id]/survey-editor';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { companySurveys } from '@/lib/db/schema';
import { listSurveyMedia } from '@/lib/surveys/media';
import { canManageSurveys, listQuestions } from '@/lib/surveys/service';
import type { QuestionType } from '@/lib/surveys/types';
import { eq } from 'drizzle-orm';

export default async function AdminSurveyEditPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageSurveys(employee))) redirect('/surveys');

  const { id } = await params;
  const db = getDb();
  const [raw] = await db.select().from(companySurveys).where(eq(companySurveys.id, id)).limit(1);
  if (!raw) notFound();
  if (raw.status !== 'draft' && raw.status !== 'scheduled') {
    redirect(`/surveys/${id}`);
  }

  const [questions, media] = await Promise.all([listQuestions(id), listSurveyMedia(id)]);

  return (
    <main className="page-shell space-y-6">
      <p className="text-sm">
        <Link href="/admin/surveys" className="underline">
          ← 問卷管理
        </Link>
      </p>
      <section>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">編輯問卷</h1>
      </section>

      <div className="mx-auto w-full max-w-4xl space-y-5">
        <SurveyBasicsForm
          surveyId={id}
          title={raw.title}
          description={raw.description ?? ''}
        />

        <SurveyEditor
          surveyId={id}
          version={raw.version}
          status={raw.status}
          title={raw.title}
          description={raw.description ?? ''}
          opensAt={raw.opensAt?.toISOString() ?? null}
          closesAt={raw.closesAt?.toISOString() ?? null}
          questions={questions.map((q) => ({
            id: q.id,
            stableKey: q.stableKey,
            prompt: q.prompt,
            help: q.help ?? '',
            questionType: q.questionType as QuestionType,
            required: q.required,
            sortOrder: q.sortOrder,
            options: q.options ?? [],
          }))}
          media={media.map((m) => ({
            id: m.id,
            questionId: m.questionId,
            fileName: m.fileName,
            mimeType: m.mimeType,
            fileSizeBytes: m.fileSizeBytes,
            scanStatus: m.scanStatus,
            kind: m.kind,
          }))}
        />
      </div>
    </main>
  );
}
