'use client';

import { useState, useTransition } from 'react';
import type { FlowDef } from '@/lib/approval/flow/types';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { parseFormSchema, type FormSchema } from '@/lib/custom-forms/schema';
import { CustomForm } from '@/app/f/custom-form';
import { SimulationResultView } from '../../org/simulator/flow-simulator';
import { ApplicantPicker, runSimulation, type SimResult } from './sim-panel';

export function PreviewPanel({
  formKey,
  name,
  description,
  schema,
  flow,
  flowValid,
  options,
  today,
  defaultApplicantId,
}: {
  formKey: string;
  name: string;
  description: string;
  schema: FormSchema;
  flow: FlowDef;
  flowValid: boolean;
  options: PickerOptions;
  today: string;
  defaultApplicantId: string;
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [applicantId, setApplicantId] = useState(defaultApplicantId);
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<SimResult | 'valid' | null>(null);
  const [pending, start] = useTransition();
  const parsed = parseFormSchema(schema);

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
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
          <span className="ml-auto text-xs text-td-muted">這是申請人看到的填寫頁；試送出只做檢查，不會建立資料或上傳檔案。</span>
        </div>
        <div className={device === 'mobile' ? 'mx-auto max-w-[390px]' : ''}>
          <CustomForm
            key={JSON.stringify(parsed.schema)}
            formKey={formKey}
            name={name}
            description={description}
            schema={parsed.schema}
            options={options}
            today={today}
            mode={{
              kind: 'preview',
              onValid: (value) => {
                if (!flowValid || !applicantId) {
                  setResult('valid');
                  return;
                }
                start(async () => setResult(await runSimulation({ formKey, schema: parsed.schema, flow, applicantId, date, fields: value.flowFields })));
              },
            }}
          />
        </div>
      </div>
      <aside className="card h-fit space-y-3 !p-3">
        <p className="text-sm font-semibold text-td-blue-dark">試送出後的簽核流程</p>
        <ApplicantPicker options={options} applicantId={applicantId} setApplicantId={setApplicantId} date={date} setDate={setDate} />
        {pending && <p className="text-sm text-td-muted">試算中…</p>}
        {!pending && result === null && <p className="text-sm text-td-muted">填好表單後按「試送出」，這裡會顯示欄位檢查結果與會由誰簽核。</p>}
        {!pending && result === 'valid' && (
          <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            欄位檢查通過。{flowValid ? '選擇模擬申請人可以同時試算簽核流程。' : '簽核流程還有問題，修正後才能試算。'}
          </p>
        )}
        {!pending && result !== null && result !== 'valid' && (
          <>
            <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">欄位檢查通過。</p>
            <SimulationResultView result={result} />
          </>
        )}
      </aside>
    </div>
  );
}
