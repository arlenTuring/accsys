'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { closeSurveyAction } from '@/lib/surveys/actions';

export function SurveyCloseButton(props: { surveyId: string; version: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={pending}
        onClick={() => {
          if (!confirm('結束後將無法再填寫，確定？')) return;
          start(async () => {
            setError(null);
            const res = await closeSurveyAction(props.surveyId, props.version);
            if (!res.ok) setError(String(res.error));
            else {
              router.push('/admin/surveys');
              router.refresh();
            }
          });
        }}
      >
        結束問卷
      </button>
      {error && <p className="text-xs text-amber-800">{error}</p>}
    </div>
  );
}
