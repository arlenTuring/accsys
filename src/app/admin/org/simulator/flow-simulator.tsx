'use client';

import { useState, useTransition } from 'react';
import { simulateFormAction } from '@/lib/admin/org/actions';
import type { SimulatorData } from '@/lib/admin/org/queries';
import type { SimInput } from '@/lib/admin/org/sim-inputs';
import type { Simulation } from '@/lib/approval/flow/simulate';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { Section, smallInput } from '../org-ui';

const STEP_STATUS = {
  pending: { label: '需簽核', cls: 'badge-pending' },
  auto_approved: { label: '系統代簽', cls: 'badge-approved' },
  skipped: { label: '略過', cls: 'badge-withdrawn' },
} as const;

export function FlowSimulator({ data }: { data: SimulatorData }) {
  const [key, setKey] = useState(data.forms[0]?.key ?? '');
  const [applicantId, setApplicantId] = useState('');
  const [date, setDate] = useState(data.today);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Simulation | { error: string } | null>(null);
  const [pending, start] = useTransition();
  const form = data.forms.find((f) => f.key === key);

  const simulate = () => {
    setResult(null);
    start(async () => {
      try {
        const r = await simulateFormAction({ key, applicantId, date, fields });
        setResult(r.ok ? r.simulation : { error: r.error });
      } catch {
        setResult({ error: '連線失敗，請稍後再試' });
      }
    });
  };

  if (data.forms.length === 0) {
    return (
      <Section title="流程模擬">
        <p className="text-sm text-td-muted">目前沒有已發布的設計器表單。</p>
      </Section>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="流程模擬" description="試算簽核人，不寫入資料。">
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs font-semibold text-td-blue-dark">表單</span>
            <select
              className={smallInput}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setFields({});
                setResult(null);
              }}
            >
              {data.forms.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-td-blue-dark">申請人</span>
            <select className={smallInput} value={applicantId} onChange={(e) => setApplicantId(e.target.value)}>
              <option value="">選擇員工…</option>
              {data.options.employees.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-td-blue-dark">送出日期（影響代理人）</span>
            <input className={smallInput} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {form && form.inputs.length > 0 && (
            <fieldset className="space-y-3 rounded border border-dashed border-td-border p-3">
              <legend className="px-1 text-xs font-semibold text-td-muted">流程會參考的欄位</legend>
              {form.inputs.map((input) => (
                <SimField key={input.id} input={input} options={data.options} value={fields[input.id]} onChange={(v) => setFields((f) => ({ ...f, [input.id]: v }))} />
              ))}
            </fieldset>
          )}
          <button type="button" className="btn-primary !py-1.5" disabled={pending || !key || !applicantId} onClick={simulate}>
            {pending ? '試算中…' : '試算簽核流程'}
          </button>
        </div>
      </Section>

      <Section title="結果">
        {!result && <p className="text-sm text-td-muted">選擇表單與申請人後按「試算簽核流程」。</p>}
        <SimulationResultView result={result} />
      </Section>
    </div>
  );
}

export function SimulationResultView({ result }: { result: Simulation | { error: string } | null }) {
  if (!result) return null;
  if ('error' in result) {
    return (
      <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {result.error}
        {'blockLabel' in result && result.blockLabel && <span className="block text-xs">關卡：{result.blockLabel}</span>}
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {result.path.length > 0 && (
        <ul className="space-y-1 text-xs text-td-muted">
          {result.path.map((p, i) => (
            <li key={i}>條件：{p}</li>
          ))}
        </ul>
      )}
      {result.autoApproved && <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">沒有需要簽核的關卡，送出後會直接核准。</p>}
      <ol className="space-y-2">
        {result.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 rounded border border-td-border px-3 py-2">
            <span className="mt-0.5 w-5 text-xs text-td-muted">{i + 1}</span>
            <span className="flex-1">
              <span className="font-semibold text-td-blue-dark">{s.label}</span>
              <span className="ml-2">{s.approverName ?? '—'}</span>
              {s.delegatedFromName && <span className="ml-1 text-xs text-td-muted">（代理 {s.delegatedFromName}）</span>}
              {s.note && <span className="block text-xs text-td-muted">{s.note}</span>}
            </span>
            <span className={STEP_STATUS[s.status].cls}>{STEP_STATUS[s.status].label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SimField({
  input,
  options,
  value,
  onChange,
}: {
  input: SimInput;
  options: PickerOptions;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = <span className="text-xs font-semibold text-td-blue-dark">{input.label}</span>;
  const str = typeof value === 'string' ? value : '';
  switch (input.kind) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      );
    case 'checkboxes': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset>
          <legend>{label}</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {input.options.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5">
                <input type="checkbox" checked={list.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case 'select':
      return (
        <label className="block">
          {label}
          <select className={smallInput} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">（未選）</option>
            {input.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'employee':
    case 'department':
    case 'budget_code':
    case 'project': {
      const list = { employee: options.employees, department: options.departments, budget_code: options.budgetCodes, project: options.projects }[input.kind];
      return (
        <label className="block">
          {label}
          <select className={smallInput} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">（未選）</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    default:
      return (
        <label className="block">
          {label}
          <input
            className={smallInput}
            type={input.kind === 'number' ? 'number' : input.kind === 'date' ? 'date' : 'text'}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}
