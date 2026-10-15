'use client';

import { useMemo, useState } from 'react';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { parseFormSchema, sourceFieldOf, type FormSchema } from '@/lib/custom-forms/schema';
import { previewSourceOptions } from '@/lib/form-builder/preview-sources';
import type { BuilderSourceForm } from '@/lib/form-builder/queries';
import { CustomForm } from '@/app/f/custom-form';

export function PreviewPanel({
  formKey,
  name,
  description,
  schema,
  options,
  sourceForms,
  today,
}: {
  formKey: string;
  name: string;
  description: string;
  schema: FormSchema;
  options: PickerOptions;
  sourceForms: BuilderSourceForm[];
  today: string;
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const parsed = useMemo(() => parseFormSchema(schema), [schema]);
  const previewOptions = useMemo(
    () => (parsed.ok ? { ...options, sources: previewSourceOptions(parsed.schema, sourceForms, options) } : options),
    [parsed, options, sourceForms]
  );
  const hasSource = parsed.ok && !!sourceFieldOf(parsed.schema);

  if (!parsed.ok) {
    return (
      <div className="card space-y-2">
        <p className="font-semibold text-td-blue-dark">欄位設定還有問題，修正後才能預覽：</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {parsed.errors.slice(0, 10).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-td-muted">預覽寬度</span>
        {(['desktop', 'mobile'] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={device === d}
            onClick={() => setDevice(d)}
            className={`rounded border px-2.5 py-1 text-xs font-semibold ${device === d ? 'border-td-blue bg-td-blue-light text-td-blue' : 'border-td-border bg-white text-td-muted'}`}
          >
            {d === 'desktop' ? '桌機' : '手機'}
          </button>
        ))}
        <span className="ml-auto text-xs text-td-muted">這是申請人看到的填寫頁，可以試填看看；不會送出、建立資料或上傳檔案。</span>
      </div>
      {hasSource && (
        <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          關聯單據在預覽中改用範例單據（依來源表單的明細欄位產生，不讀取真實單據），可試看帶入與移除明細。
        </p>
      )}
      <div className={device === 'mobile' ? 'mx-auto max-w-[390px]' : ''}>
        <CustomForm
          key={JSON.stringify(parsed.schema)}
          formKey={formKey}
          name={name}
          description={description}
          schema={parsed.schema}
          options={previewOptions}
          today={today}
          mode={{ kind: 'preview' }}
        />
      </div>
    </div>
  );
}
