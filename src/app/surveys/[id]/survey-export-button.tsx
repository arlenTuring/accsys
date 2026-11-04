'use client';

import { useState, useTransition } from 'react';
import { exportSurveyCsvAction } from '@/lib/surveys/actions';

export function SurveyExportButton({ surveyId }: { surveyId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await exportSurveyCsvAction(surveyId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.fileName;
            a.click();
            URL.revokeObjectURL(url);
          })
        }
      >
        {pending ? '匯出中…' : '匯出 CSV'}
      </button>
      {error && <p className="text-xs text-amber-800">{error}</p>}
    </div>
  );
}
