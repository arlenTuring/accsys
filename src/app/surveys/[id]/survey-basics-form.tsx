'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { updateSurveyBasicsAction } from '@/lib/surveys/actions';

export function SurveyBasicsForm(props: {
  surveyId: string;
  title: string;
  description: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(props.title);
  const [description, setDescription] = useState(props.description);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(props.title);
    setDescription(props.description);
  }, [props.title, props.description]);

  return (
    <section className="card space-y-4 border-td-blue/30 !p-6">
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-td-blue-dark">標題</span>
        <input
          className="w-full rounded-md border border-td-border bg-white px-4 py-3 text-xl font-semibold text-td-blue-dark"
          placeholder="問卷標題"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
          required
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-td-blue-dark">說明</span>
        <textarea
          className="min-h-[5rem] w-full rounded-md border border-td-border bg-white px-4 py-3 text-base"
          placeholder="說明（選填）"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <p className="text-sm text-amber-800">{error}</p>}
        {saved && !error && <p className="text-sm text-td-muted">已儲存</p>}
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              setSaved(false);
              const res = await updateSurveyBasicsAction(props.surveyId, { title, description });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setSaved(true);
              router.refresh();
            })
          }
        >
          儲存標題與說明
        </button>
      </div>
    </section>
  );
}
