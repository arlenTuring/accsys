'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import {
  deleteQuestionAction,
  publishSurveyAction,
  removeQuestionMediaAction,
  saveSurveyDraftMetaAction,
  uploadQuestionMediaAction,
  upsertQuestionAction,
} from '@/lib/surveys/actions';
import { SURVEY_MEDIA_ACCEPT } from '@/lib/surveys/media-validate';
import { nextStableKey, type QuestionType } from '@/lib/surveys/types';
import { formatBytesLabel } from '@/lib/attachments/policy';

export type SurveyEditorMedia = {
  id: string;
  questionId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: string;
  kind: 'image' | 'video';
};

export type SurveyEditorQuestion = {
  id: string;
  stableKey: string;
  prompt: string;
  help: string;
  questionType: QuestionType;
  required: boolean;
  sortOrder: number;
  options: Array<{ id: string; label: string }>;
};

const TYPE_LABEL: Record<QuestionType, string> = {
  short_text: '短文',
  long_text: '長文',
  single_choice: '單選',
  multi_choice: '多選',
  number: '數字',
  date: '日期',
  rating: '評分（1–5）',
};

function mediaUrl(surveyId: string, mediaId: string) {
  return `/api/surveys/${surveyId}/media/${mediaId}`;
}

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function QuestionMediaBlock(props: {
  surveyId: string;
  questionId: string;
  media: SurveyEditorMedia[];
  pending: boolean;
  onError: (msg: string | null) => void;
  start: (fn: () => Promise<void>) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3 rounded-lg border border-td-border bg-td-blue-light/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-td-blue-dark">題目媒體</p>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={props.pending}
          onClick={() => inputRef.current?.click()}
        >
          加入照片／影片
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={SURVEY_MEDIA_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            props.start(async () => {
              props.onError(null);
              const fd = new FormData();
              fd.set('file', file);
              const res = await uploadQuestionMediaAction(props.surveyId, props.questionId, fd);
              if (!res.ok) props.onError(res.error);
              else router.refresh();
            });
          }}
        />
      </div>
      {props.media.length === 0 ? (
        <p className="text-sm text-td-muted">尚未加入</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {props.media.map((m) => {
            const ready = m.scanStatus === 'clean' || m.scanStatus === 'unscanned';
            const src = mediaUrl(props.surveyId, m.id);
            return (
              <li key={m.id} className="space-y-2 rounded-lg border border-td-border bg-white p-3">
                {ready && m.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={m.fileName} className="max-h-56 w-full rounded object-contain" />
                ) : ready && m.kind === 'video' ? (
                  <video src={src} controls preload="metadata" className="max-h-56 w-full rounded bg-black" />
                ) : (
                  <p className="text-sm text-amber-800">
                    {m.fileName}（{m.scanStatus}）
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-td-muted">
                  <span>
                    {m.fileName} · {formatBytesLabel(m.fileSizeBytes)}
                  </span>
                  <button
                    type="button"
                    className="text-amber-900 underline"
                    disabled={props.pending}
                    onClick={() =>
                      props.start(async () => {
                        props.onError(null);
                        const res = await removeQuestionMediaAction(props.surveyId, m.id);
                        if (!res.ok) props.onError(res.error);
                        else router.refresh();
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function QuestionCard(props: {
  surveyId: string;
  question: SurveyEditorQuestion;
  media: SurveyEditorMedia[];
  index: number;
  selected: boolean;
  onSelect: () => void;
  pending: boolean;
  onError: (msg: string | null) => void;
  start: (fn: () => Promise<void>) => void;
}) {
  const router = useRouter();
  const q = props.question;
  const [prompt, setPrompt] = useState(q.prompt);
  const [help, setHelp] = useState(q.help);
  const [questionType, setQuestionType] = useState<QuestionType>(q.questionType);
  const [required, setRequired] = useState(q.required);
  const [optionsText, setOptionsText] = useState(q.options.map((o) => o.label).join('\n'));

  const needsOptions = questionType === 'single_choice' || questionType === 'multi_choice';

  return (
    <article
      className={`card space-y-4 !p-6 transition ${
        props.selected ? 'ring-2 ring-td-blue border-td-blue/40' : 'hover:border-td-blue/30'
      }`}
      onClick={props.onSelect}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-td-muted">
          第 {props.index + 1} 題 · {TYPE_LABEL[questionType]}
        </p>
        <button
          type="button"
          className="text-sm text-amber-900 underline"
          disabled={props.pending}
          onClick={(e) => {
            e.stopPropagation();
            if (!confirm('確定刪除此題？')) return;
            props.start(async () => {
              props.onError(null);
              const res = await deleteQuestionAction(props.surveyId, q.id);
              if (!res.ok) props.onError(res.error);
              else router.refresh();
            });
          }}
        >
          刪除
        </button>
      </div>

      <input
        className="w-full rounded-md border border-td-border px-4 py-3 text-lg font-medium text-td-blue-dark"
        placeholder="題目"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />

      <input
        className="w-full rounded-md border border-td-border px-4 py-2.5 text-base"
        placeholder="補充說明（選填）"
        value={help}
        onChange={(e) => setHelp(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />

      <div className="flex flex-wrap items-center gap-4 text-base" onClick={(e) => e.stopPropagation()}>
        <select
          className="rounded-md border border-td-border px-3 py-2"
          value={questionType}
          onChange={(e) => setQuestionType(e.target.value as QuestionType)}
        >
          {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          必填
        </label>
      </div>

      {needsOptions && (
        <textarea
          className="min-h-[7rem] w-full rounded-md border border-td-border px-4 py-3 text-base"
          placeholder="選項（每行一個）"
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <div onClick={(e) => e.stopPropagation()}>
        <QuestionMediaBlock
          surveyId={props.surveyId}
          questionId={q.id}
          media={props.media}
          pending={props.pending}
          onError={props.onError}
          start={props.start}
        />
      </div>

      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={props.pending}
          onClick={() =>
            props.start(async () => {
              props.onError(null);
              const options = needsOptions
                ? optionsText
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((label, i) => ({ id: `opt_${i + 1}`, label }))
                : [];
              if (needsOptions && options.length < 2) {
                props.onError('單選／多選至少需要兩個選項');
                return;
              }
              const res = await upsertQuestionAction(props.surveyId, {
                stableKey: q.stableKey,
                prompt,
                help,
                questionType,
                required,
                sortOrder: q.sortOrder,
                options,
              });
              if (!res.ok) props.onError(res.error);
              else router.refresh();
            })
          }
        >
          儲存此題
        </button>
      </div>
    </article>
  );
}

function SurveyPreview(props: {
  title: string;
  description: string;
  surveyId: string;
  questions: SurveyEditorQuestion[];
  mediaByQuestion: Map<string, SurveyEditorMedia[]>;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-td-muted">預覽</p>
        <h2 className="text-2xl font-semibold text-td-blue-dark">{props.title}</h2>
        {props.description ? (
          <p className="whitespace-pre-wrap text-base text-td-muted">{props.description}</p>
        ) : null}
      </header>
      {props.questions.map((q, index) => {
        const media = props.mediaByQuestion.get(q.id) ?? [];
        return (
          <section key={q.id} className="card space-y-3 !p-6">
            <h3 className="text-base font-semibold text-td-blue-dark">
              {index + 1}. {q.prompt}
              {q.required ? ' *' : ''}
            </h3>
            {q.help ? <p className="text-sm text-td-muted">{q.help}</p> : null}
            {media.length > 0 && (
              <ul className="grid gap-3 sm:grid-cols-2">
                {media.map((m) => {
                  const ready = m.scanStatus === 'clean' || m.scanStatus === 'unscanned';
                  const src = mediaUrl(props.surveyId, m.id);
                  if (!ready) return null;
                  return (
                    <li key={m.id} className="overflow-hidden rounded border border-td-border">
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
            )}
            {q.questionType === 'long_text' ? (
              <textarea className="min-h-[5rem] w-full rounded border px-3 py-2 text-sm" disabled placeholder="填寫區" />
            ) : q.questionType === 'single_choice' ? (
              <div className="space-y-2 text-sm">
                {q.options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-td-muted">
                    <input type="radio" disabled name={`preview-${q.stableKey}`} />
                    {o.label}
                  </label>
                ))}
              </div>
            ) : q.questionType === 'multi_choice' ? (
              <div className="space-y-2 text-sm">
                {q.options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-td-muted">
                    <input type="checkbox" disabled />
                    {o.label}
                  </label>
                ))}
              </div>
            ) : q.questionType === 'date' ? (
              <input type="date" className="w-full rounded border px-3 py-2 text-sm" disabled />
            ) : q.questionType === 'number' || q.questionType === 'rating' ? (
              <input type="number" className="w-full rounded border px-3 py-2 text-sm" disabled placeholder={q.questionType === 'rating' ? '1–5' : ''} />
            ) : (
              <input className="w-full rounded border px-3 py-2 text-sm" disabled placeholder="填寫區" />
            )}
          </section>
        );
      })}
    </div>
  );
}

function PublishPanel(props: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onError: (msg: string | null) => void;
  start: (fn: () => Promise<void>) => void;
  surveyId: string;
  version: number;
  initialOpensAt: string | null;
  initialClosesAt: string | null;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'now' | 'schedule' | 'draft'>('now');
  const [opensAt, setOpensAt] = useState(toLocalInputValue(props.initialOpensAt));
  const [closesAt, setClosesAt] = useState(toLocalInputValue(props.initialClosesAt));

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal>
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-td-blue-dark">發布設定</h2>
          <button type="button" className="text-sm text-td-muted underline" onClick={props.onClose} disabled={props.pending}>
            關閉
          </button>
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="publish-mode" checked={mode === 'now'} onChange={() => setMode('now')} />
            立刻發布
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="publish-mode" checked={mode === 'schedule'} onChange={() => setMode('schedule')} />
            預約發布
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="publish-mode" checked={mode === 'draft'} onChange={() => setMode('draft')} />
            儲存草稿
          </label>
        </div>

        {mode === 'schedule' && (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">開放時間</span>
            <input
              type="datetime-local"
              className="w-full rounded border px-3 py-2"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              required
            />
          </label>
        )}

        {(mode === 'now' || mode === 'schedule') && (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">截止時間（選填）</span>
            <input
              type="datetime-local"
              className="w-full rounded border px-3 py-2"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
            />
          </label>
        )}

        <button
          type="button"
          className="btn-primary w-full text-sm"
          disabled={props.pending || (mode !== 'draft' && !props.canPublish)}
          onClick={() =>
            props.start(async () => {
              props.onError(null);
              if (mode === 'draft') {
                const res = await saveSurveyDraftMetaAction(props.surveyId, props.version, {
                  opensAt: opensAt ? new Date(opensAt).toISOString() : null,
                  closesAt: closesAt ? new Date(closesAt).toISOString() : null,
                });
                if (!res.ok) props.onError(String(res.error));
                else {
                  props.onClose();
                  router.refresh();
                }
                return;
              }
              if (!props.canPublish) {
                props.onError('請先新增至少一題');
                return;
              }
              if (mode === 'schedule' && !opensAt) {
                props.onError('請設定預約開放時間');
                return;
              }
              const res = await publishSurveyAction(props.surveyId, props.version, {
                opensAt: mode === 'schedule' ? new Date(opensAt).toISOString() : null,
                closesAt: closesAt ? new Date(closesAt).toISOString() : null,
              });
              if (!res.ok) props.onError(String(res.error));
              else {
                props.onClose();
                router.push('/admin/surveys');
                router.refresh();
              }
            })
          }
        >
          {mode === 'draft' ? '儲存草稿' : mode === 'schedule' ? '確認預約' : '立刻發布'}
        </button>
      </div>
    </div>
  );
}

export function SurveyEditor(props: {
  surveyId: string;
  version: number;
  status: string;
  title: string;
  description: string;
  opensAt: string | null;
  closesAt: string | null;
  questions: SurveyEditorQuestion[];
  media: SurveyEditorMedia[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(props.questions[0]?.id ?? null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [publishOpen, setPublishOpen] = useState(false);

  const mediaByQuestion = useMemo(() => {
    const map = new Map<string, SurveyEditorMedia[]>();
    for (const m of props.media) {
      const list = map.get(m.questionId) ?? [];
      list.push(m);
      map.set(m.questionId, list);
    }
    return map;
  }, [props.media]);

  return (
    <div className="space-y-5">
      {mode === 'preview' ? (
        <SurveyPreview
          title={props.title}
          description={props.description}
          surveyId={props.surveyId}
          questions={props.questions}
          mediaByQuestion={mediaByQuestion}
        />
      ) : (
        <>
          <h2 className="text-base font-semibold text-td-blue-dark">題目</h2>
          {props.questions.length === 0 && <p className="card p-5 text-base text-td-muted">尚無題目</p>}

          {props.questions.map((q, index) => (
            <QuestionCard
              key={q.id}
              surveyId={props.surveyId}
              question={q}
              media={mediaByQuestion.get(q.id) ?? []}
              index={index}
              selected={selectedId === q.id}
              onSelect={() => setSelectedId(q.id)}
              pending={pending}
              onError={setError}
              start={start}
            />
          ))}

          <button
            type="button"
            className="btn-secondary w-full py-3 text-base"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const stableKey = nextStableKey(props.questions.map((q) => q.stableKey));
                const res = await upsertQuestionAction(props.surveyId, {
                  stableKey,
                  prompt: '未命名題目',
                  help: '',
                  questionType: 'short_text',
                  required: true,
                  sortOrder: props.questions.length,
                  options: [],
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                if (res.question?.id) setSelectedId(res.question.id);
                router.refresh();
              })
            }
          >
            ＋ 新增題目
          </button>
        </>
      )}

      {error && <p className="text-sm text-amber-800">{error}</p>}

      <div className="sticky bottom-3 z-10 flex flex-wrap gap-2 rounded-xl border border-td-border bg-white/95 p-3 shadow-card backdrop-blur">
        {mode === 'preview' ? (
          <button type="button" className="btn-secondary flex-1 text-sm" onClick={() => setMode('edit')}>
            返回編輯
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary flex-1 text-sm"
            disabled={props.questions.length === 0}
            onClick={() => setMode('preview')}
          >
            預覽
          </button>
        )}
        <button
          type="button"
          className="btn-primary flex-1 text-sm"
          disabled={pending}
          onClick={() => setPublishOpen(true)}
        >
          發布設定
        </button>
      </div>

      <PublishPanel
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        pending={pending}
        onError={setError}
        start={start}
        surveyId={props.surveyId}
        version={props.version}
        initialOpensAt={props.opensAt}
        initialClosesAt={props.closesAt}
        canPublish={props.questions.length > 0}
      />
    </div>
  );
}
