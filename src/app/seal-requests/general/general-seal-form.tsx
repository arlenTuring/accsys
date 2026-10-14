'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FieldRow, inputCls } from '@/app/components/form-fields';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { reviseGeneralSealRequest, submitGeneralSealRequest } from '@/lib/general-seals/actions';
import { GENERAL_DOCUMENT_TYPES, GENERAL_SEAL_OPTIONS } from '@/lib/general-seals/constants';
import { parseGeneralSealInput, type GeneralSealInput } from '@/lib/general-seals/validate';
import type { SealPartyOptions } from '@/lib/seal-requests/queries';
import {
  LendSealFields,
  SealCheckboxes,
  SealCommonFields,
  SealSubmitBar,
  initialCommon,
  sendSealForm,
  type SealFormMode,
} from '../seal-form-parts';

const NO_FILES = '請上傳至少一個附件（要用印的文件）';

export function GeneralSealForm({
  currentEmployee,
  parties,
  applicationDate,
  today,
  mode,
  initial,
}: {
  currentEmployee: { id: string; departmentId: string };
  parties: SealPartyOptions;
  applicationDate: string;
  today: string;
  mode: SealFormMode;
  initial?: GeneralSealInput;
}) {
  const router = useRouter();
  const [common, setCommon] = useState(() => initialCommon(initial, currentEmployee));
  const [documentType, setDocumentType] = useState<string>(initial?.documentType ?? GENERAL_DOCUMENT_TYPES[0].code);
  const [documentDescription, setDocumentDescription] = useState(initial?.documentDescription ?? '');
  const [seals, setSeals] = useState<string[]>(initial?.seals ?? []);
  const [lending, setLending] = useState({ lendSeal: initial?.lendSeal ?? 'no', lendSealNote: initial?.lendSealNote ?? '' });
  const [files, setFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existingAttachments = mode.kind === 'create' ? 0 : mode.existingAttachmentCount;

  const onSubmit = async () => {
    setError(null);
    const input: GeneralSealInput = { ...common, documentType, documentDescription, seals, ...lending };
    const parsed = parseGeneralSealInput(input, today);
    if (!parsed.ok) return setError(parsed.error);
    if (files.length + existingAttachments === 0) return setError(NO_FILES);

    setSubmitting(true);
    const result = await sendSealForm({
      mode,
      input,
      files,
      idempotencyKey,
      submit: submitGeneralSealRequest,
      revise: reviseGeneralSealRequest,
    });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    const failed = result.attachmentErrors.length;
    router.push(`/seal-requests/general/${result.sealRequestId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  return (
    <div className="card !p-0">
      <h1 className="px-5 py-4 text-xl font-bold text-td-blue-dark">用印申請單(非合約類)</h1>

      <SealCommonFields value={common} onChange={setCommon} parties={parties} applicationDate={applicationDate} today={today} />

      <FieldRow cols={2}>
        <Field label="文件類別" required>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className={`${inputCls} !bg-white`}>
            {GENERAL_DOCUMENT_TYPES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="文件說明" required>
          <textarea
            value={documentDescription}
            onChange={(e) => setDocumentDescription(e.target.value)}
            placeholder="請輸入文字"
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <SealCheckboxes options={GENERAL_SEAL_OPTIONS} value={seals} onChange={setSeals} />
        <Field label="附件(一個檔案上限2MB，可上傳多個檔案)" required hint="請上傳要用印的文件">
          <PendingFilesField files={files} onChange={setFiles} existingCount={existingAttachments} />
        </Field>
      </FieldRow>

      <LendSealFields value={lending} onChange={setLending} />

      <div className="border-t border-dashed border-td-border px-5 py-5">
        <p className="text-sm font-semibold text-td-blue-dark">提醒</p>
        <p className="mt-2 text-sm leading-6 text-td-blue-dark">
          完成線上簽核流程後，請印出核准之用印申請單，連同原始附件提供給相關單位用印/簽名，謝謝。
        </p>
      </div>

      <SealSubmitBar mode={mode} error={error} submitting={submitting} onSubmit={onSubmit} />
    </div>
  );
}
