'use client';

import { useState, useTransition } from 'react';
import { simulationInputs } from '@/lib/admin/org/sim-inputs';
import type { Simulation } from '@/lib/approval/flow/simulate';
import type { FlowDef } from '@/lib/approval/flow/types';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import type { FormSchema } from '@/lib/custom-forms/schema';
import { simulateDraftAction } from '@/lib/form-builder/actions';
import { smallInput } from '../../org/org-ui';
import { SimField, SimulationResultView } from '../../org/simulator/flow-simulator';
import { Field } from '../builder-ui';

export type SimResult = Simulation | { error: string } | null;

export async function runSimulation(input: {
  formKey: string;
  schema: FormSchema;
  flow: FlowDef;
  applicantId: string;
  date: string;
  fields: Record<string, unknown>;
}): Promise<SimResult> {
  try {
    const r = await simulateDraftAction({ key: input.formKey, schema: input.schema, flow: input.flow, applicantId: input.applicantId, date: input.date, fields: input.fields });
    return r.ok ? r.simulation : { error: r.error };
  } catch {
    return { error: '連線失敗，請稍後再試' };
  }
}

export function ApplicantPicker({
  options,
  applicantId,
  setApplicantId,
  date,
  setDate,
}: {
  options: PickerOptions;
  applicantId: string;
  setApplicantId: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="模擬申請人">
        <select className={smallInput} value={applicantId} onChange={(e) => setApplicantId(e.target.value)}>
          <option value="">選擇員工…</option>
          {options.employees.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="送出日期（影響代理人）">
        <input className={smallInput} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </div>
  );
}

export function SimPanel({
  formKey,
  schema,
  flow,
  valid,
  options,
  today,
  defaultApplicantId,
}: {
  formKey: string;
  schema: FormSchema;
  flow: FlowDef;
  valid: boolean;
  options: PickerOptions;
  today: string;
  defaultApplicantId: string;
}) {
  const [applicantId, setApplicantId] = useState(defaultApplicantId);
  const [date, setDate] = useState(today);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<SimResult>(null);
  const [pending, start] = useTransition();
  const inputs = valid ? simulationInputs(schema, flow) : [];

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-td-muted">用目前畫面上的設定（不必先儲存）與實際組織資料試算，不會建立任何資料。</p>
      <ApplicantPicker options={options} applicantId={applicantId} setApplicantId={setApplicantId} date={date} setDate={setDate} />
      {inputs.length > 0 && (
        <fieldset className="space-y-2 rounded border border-dashed border-td-border p-2">
          <legend className="px-1 text-xs font-semibold text-td-muted">流程會參考的欄位</legend>
          {inputs.map((input) => (
            <SimField key={input.id} input={input} options={options} value={fields[input.id]} onChange={(v) => setFields((f) => ({ ...f, [input.id]: v }))} />
          ))}
        </fieldset>
      )}
      <button
        type="button"
        className="btn-primary !py-1.5"
        disabled={pending || !valid || !applicantId}
        onClick={() => start(async () => setResult(await runSimulation({ formKey, schema, flow, applicantId, date, fields })))}
      >
        {pending ? '試算中…' : '試算簽核流程'}
      </button>
      {!valid && <p className="text-xs text-amber-700">表單還有問題（見上方「待修正」），修正後才能試算。</p>}
      <SimulationResultView result={result} />
    </div>
  );
}
