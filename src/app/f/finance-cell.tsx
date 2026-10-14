'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inputCls } from '@/app/components/form-fields';
import { setCustomFormFinanceCell } from '@/lib/custom-forms/actions';

/** 核准後由財會填寫 cell on the detail page (finance / admin, approved submissions only). */
export function FinanceCell({
  submissionId,
  table,
  row,
  column,
  value,
  maxLength,
}: {
  submissionId: string;
  table: string;
  row: number;
  column: string;
  value: string;
  maxLength: number;
}) {
  const router = useRouter();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = text.trim() !== value;
  return (
    <div className="flex min-w-[10rem] flex-col gap-1 print:hidden">
      <div className="flex gap-1">
        <input
          className={`${inputCls} !bg-white flex-1`}
          value={text}
          maxLength={maxLength}
          onChange={(e) => setText(e.target.value)}
          aria-label="財會填寫"
        />
        <button
          type="button"
          className="btn-secondary !px-3 !py-1.5 text-xs disabled:opacity-50"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await setCustomFormFinanceCell(submissionId, { table, row, column, value: text });
              if (!result.ok) setError(result.error);
              else router.refresh();
            })
          }
        >
          {pending ? '儲存中…' : '儲存'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
