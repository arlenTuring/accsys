'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveSurveyDraftAction, submitSurveyAction } from '@/lib/surveys/actions';

type Media = {
  id: string;
  fileName: string;
  mimeType: string;
  kind: 'image' | 'video';
};

type Q = {
  stableKey: string;
  prompt: string;
  help: string;
  questionType: string;
  required: boolean;
  options: Array<{ id: string; label: string }>;
  media: Media[];
};

function QuestionMediaView(props: { surveyId: string; media: Media[] }) {
  if (props.media.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {props.media.map((m) => {
        const src = `/api/surveys/${props.surveyId}/media/${m.id}`;
        return (
          <li key={m.id} className="overflow-hidden rounded border border-td-border bg-td-blue-light/10">
            {m.kind === 'video' ? (
              <video src={src} controls playsInline preload="metadata" className="max-h-72 w-full bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={m.fileName} className="max-h-72 w-full object-contain" />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SurveyAnswerForm(props: {
  surveyId: string;
  questions: Q[];
  initialAnswers: Record<string, unknown>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<Record<string, unknown>>(props.initialAnswers);
  const [message, setMessage] = useState<string | null>(null);

  function setValue(key: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const res = await submitSurveyAction(props.surveyId, answers);
          if (!res.ok) {
            setMessage(res.error);
            return;
          }
          setMessage('已提交');
          router.refresh();
        });
      }}
    >
      {props.questions.map((q, index) => (
        <fieldset key={q.stableKey} className="card space-y-3 !p-4">
          <legend className="px-1 text-sm font-semibold text-td-blue-dark">
            {index + 1}. {q.prompt}
            {q.required ? ' *' : ''}
          </legend>
          {q.help && <p className="text-xs text-td-muted">{q.help}</p>}
          <QuestionMediaView surveyId={props.surveyId} media={q.media} />
          {q.questionType === 'long_text' ? (
            <textarea
              className="min-h-[5rem] w-full rounded border px-3 py-2 text-sm"
              value={String(answers[q.stableKey] ?? '')}
              onChange={(e) => setValue(q.stableKey, e.target.value)}
              required={q.required}
            />
          ) : q.questionType === 'single_choice' ? (
            <div className="space-y-1 text-sm">
              {q.options.map((o) => (
                <label key={o.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={q.stableKey}
                    checked={String(answers[q.stableKey] ?? '') === o.id}
                    onChange={() => setValue(q.stableKey, o.id)}
                    required={q.required}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          ) : q.questionType === 'multi_choice' ? (
            <div className="space-y-1 text-sm">
              {q.options.map((o) => {
                const selected = Array.isArray(answers[q.stableKey])
                  ? (answers[q.stableKey] as string[])
                  : [];
                return (
                  <label key={o.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(o.id)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selected, o.id]
                          : selected.filter((x) => x !== o.id);
                        setValue(q.stableKey, next);
                      }}
                    />
                    {o.label}
                  </label>
                );
              })}
            </div>
          ) : q.questionType === 'number' || q.questionType === 'rating' ? (
            <input
              type="number"
              className="w-full rounded border px-3 py-2 text-sm"
              value={answers[q.stableKey] == null ? '' : String(answers[q.stableKey])}
              onChange={(e) => setValue(q.stableKey, e.target.value === '' ? '' : Number(e.target.value))}
              required={q.required}
              min={q.questionType === 'rating' ? 1 : undefined}
              max={q.questionType === 'rating' ? 5 : undefined}
            />
          ) : q.questionType === 'date' ? (
            <input
              type="date"
              className="w-full rounded border px-3 py-2 text-sm"
              value={String(answers[q.stableKey] ?? '')}
              onChange={(e) => setValue(q.stableKey, e.target.value)}
              required={q.required}
            />
          ) : (
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={String(answers[q.stableKey] ?? '')}
              onChange={(e) => setValue(q.stableKey, e.target.value)}
              required={q.required}
            />
          )}
        </fieldset>
      ))}

      {message && <p className="text-sm text-amber-800">{message}</p>}
      <div className="sticky bottom-0 flex flex-wrap gap-2 bg-[var(--page-bg,white)] py-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveSurveyDraftAction(props.surveyId, answers);
              setMessage(res.ok ? '已暫存' : res.error);
            })
          }
        >
          暫存
        </button>
        <button type="submit" className="btn-primary text-sm" disabled={pending}>
          正式提交
        </button>
      </div>
    </form>
  );
}
