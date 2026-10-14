'use client';

import { Field, FieldRow, inputCls, readOnlyCls } from '@/app/components/form-fields';
import { NORMAL_LEAD_DAYS, SEAL_URGENCIES, type SealOption } from '@/lib/seal-requests/constants';
import type { SealPartyOptions } from '@/lib/seal-requests/queries';
import type { SubmitResult } from '@/lib/seal-requests/submission';
import { addDays } from '@/lib/seal-requests/validate';

// Pieces shared by the seal request forms.

export type SealFormMode =
  | { kind: 'create' }
  | { kind: 'update' | 'resubmit'; sealRequestId: string; version: number; existingAttachmentCount: number };

/** 申請人 / 部門 / 文件用印時效性 / 期望用印完成日 / 備註. */
export type SealCommonValues = {
  applicantEmployeeId: string;
  departmentId: string;
  urgency: string;
  expectedCompletionDate: string;
  remark: string;
};

export type LendSealValues = { lendSeal: string; lendSealNote: string };

const fmtDate = (iso: string) => iso.replaceAll('-', '/');

export const checkboxCls = 'h-4 w-4 shrink-0 rounded border-td-border text-td-blue focus:ring-td-blue/30';

export function CheckOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-sm text-td-blue-dark">
      <input type="checkbox" checked={checked} onChange={onChange} className={`${checkboxCls} mt-0.5`} />
      <span>{label}</span>
    </label>
  );
}

export function initialCommon(initial: Partial<SealCommonValues> | undefined, me: { id: string; departmentId: string }) {
  return {
    applicantEmployeeId: initial?.applicantEmployeeId ?? me.id,
    departmentId: initial?.departmentId ?? me.departmentId,
    urgency: initial?.urgency ?? 'normal',
    expectedCompletionDate: initial?.expectedCompletionDate ?? '',
    remark: initial?.remark ?? '',
  };
}

export type SealPartyValues = { applicantEmployeeId: string; departmentId: string };

/** 申請人 / 部門 / 申請日期; the department always follows the applicant. */
export function SealPartyRow({
  value,
  onChange,
  parties,
  applicationDate,
}: {
  value: SealPartyValues;
  onChange: (next: SealPartyValues) => void;
  parties: SealPartyOptions;
  applicationDate: string;
}) {
  const pickApplicant = (id: string) => {
    const person = parties.employees.find((e) => e.id === id);
    onChange({ applicantEmployeeId: id, departmentId: person?.departmentId ?? value.departmentId });
  };
  // The server uses the applicant's current department, which may differ from the one saved on an older form.
  const departmentId = parties.employees.find((e) => e.id === value.applicantEmployeeId)?.departmentId ?? value.departmentId;
  const departmentName = parties.departments.find((d) => d.id === departmentId)?.name ?? '';
  return (
    <FieldRow cols={3}>
      <Field label="申請人" required hint="如是以經辦身分協助申請，請記得調整申請人">
        <select value={value.applicantEmployeeId} onChange={(e) => pickApplicant(e.target.value)} className={`${inputCls} !bg-white`}>
          {parties.employees.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.departmentName}）
            </option>
          ))}
        </select>
      </Field>
      <Field label="部門" required hint="依申請人所屬部門自動帶入">
        <input value={departmentName} readOnly aria-label="部門" className={readOnlyCls} />
      </Field>
      <Field label="申請日期" required>
        <input value={fmtDate(applicationDate)} readOnly className={readOnlyCls} />
      </Field>
    </FieldRow>
  );
}

export function SealCommonFields({
  value,
  onChange,
  parties,
  applicationDate,
  today,
}: {
  value: SealCommonValues;
  onChange: (next: SealCommonValues) => void;
  parties: SealPartyOptions;
  applicationDate: string;
  today: string;
}) {
  const set = (patch: Partial<SealCommonValues>) => onChange({ ...value, ...patch });
  const minExpected = value.urgency === 'normal' ? addDays(today, NORMAL_LEAD_DAYS) : today;

  return (
    <>
      <SealPartyRow value={value} onChange={set} parties={parties} applicationDate={applicationDate} />

      <FieldRow cols={2}>
        <Field label="文件用印時效性" required>
          <select value={value.urgency} onChange={(e) => set({ urgency: e.target.value })} className={`${inputCls} !bg-white`}>
            {SEAL_URGENCIES.map((u) => (
              <option key={u.code} value={u.code}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="期望用印完成日" required>
          <input
            type="date"
            value={value.expectedCompletionDate}
            min={minExpected}
            onChange={(e) => set({ expectedCompletionDate: e.target.value })}
            className={inputCls}
          />
        </Field>
      </FieldRow>

      <div className="border-t border-dashed border-td-border">
        <Field label="備註" required hint="一般件請填寫「無」；勾選急件請註明「完成時間與急件原因」。">
          <textarea
            value={value.remark}
            onChange={(e) => set({ remark: e.target.value })}
            placeholder="請輸入文字"
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </Field>
      </div>
    </>
  );
}

export function SealCheckboxes({
  options,
  value,
  onChange,
}: {
  options: readonly SealOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label="印鑑名稱" required>
      {options.map((s) => (
        <CheckOption
          key={s.code}
          label={s.label}
          checked={value.includes(s.code)}
          onChange={() => onChange(value.includes(s.code) ? value.filter((c) => c !== s.code) : [...value, s.code])}
        />
      ))}
    </Field>
  );
}

export function LendSealFields({ value, onChange }: { value: LendSealValues; onChange: (next: LendSealValues) => void }) {
  return (
    <FieldRow cols={2}>
      <Field label="出借印鑑" required>
        <select
          value={value.lendSeal}
          onChange={(e) => onChange({ ...value, lendSeal: e.target.value })}
          className={`${inputCls} !bg-white`}
        >
          <option value="no">否</option>
          <option value="yes">是</option>
        </select>
      </Field>
      <Field label="出借印鑑說明" required hint={'如沒有要出借印鑑，請填入"無"'}>
        <input
          value={value.lendSealNote}
          onChange={(e) => onChange({ ...value, lendSealNote: e.target.value })}
          placeholder="請輸入文字"
          className={inputCls}
        />
      </Field>
    </FieldRow>
  );
}

export function SealReminderBlock({ text }: { text: string }) {
  return (
    <div className="px-5 py-5">
      <p className="text-sm font-semibold text-td-blue-dark">提醒</p>
      <p className="mt-2 text-sm leading-6 text-td-blue-dark">{text}</p>
    </div>
  );
}

export function SealSubmitBar({
  mode,
  error,
  submitting,
  onSubmit,
}: {
  mode: SealFormMode;
  error: string | null;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const label = mode.kind === 'create' ? '確認送出' : mode.kind === 'update' ? '儲存修改並重新送簽' : '重新送出';
  return (
    <div className="flex flex-col items-center gap-3 border-t border-dashed border-td-border px-5 py-8">
      {error && <p className="w-full max-w-xl rounded bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="btn-primary min-w-[160px] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? '送出中…' : label}
      </button>
    </div>
  );
}

/** Sends the JSON payload and the new files in one request (create, edit or resubmit). */
export function sendSealForm<T extends object>({
  mode,
  input,
  files,
  idempotencyKey,
  submit,
  revise,
}: {
  mode: SealFormMode;
  input: T;
  files: File[];
  idempotencyKey: string;
  submit: (formData: FormData) => Promise<SubmitResult>;
  revise: (id: string, kind: 'update' | 'resubmit', formData: FormData) => Promise<SubmitResult>;
}): Promise<SubmitResult> {
  const formData = new FormData();
  formData.set(
    'payload',
    JSON.stringify(mode.kind === 'create' ? { ...input, idempotencyKey } : { ...input, expectedVersion: mode.version })
  );
  for (const f of files) formData.append('files', f);
  return mode.kind === 'create' ? submit(formData) : revise(mode.sealRequestId, mode.kind, formData);
}
