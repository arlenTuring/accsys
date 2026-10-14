'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FieldRow, inputCls } from '@/app/components/form-fields';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { reviseContractSealRequest, submitContractSealRequest } from '@/lib/contract-seals/actions';
import {
  CONTRACT_DOCUMENT_TYPES,
  CONTRACT_SEAL_OPTIONS,
  LEGAL_REVIEW_DOCUMENT_TYPES,
  MOU_CHECKS,
  MOU_NOT_APPLICABLE_LABEL,
  NDA_CHECKS,
  NDA_MOU_NOTES_URL,
  NDA_NOT_APPLICABLE_LABEL,
  NOT_APPLICABLE,
  type ContractDocumentType,
} from '@/lib/contract-seals/constants';
import { parseContractSealInput, type ContractSealInput } from '@/lib/contract-seals/validate';
import type { SealPartyOptions } from '@/lib/seal-requests/queries';
import {
  CheckOption,
  LendSealFields,
  SealCheckboxes,
  SealCommonFields,
  SealReminderBlock,
  SealSubmitBar,
  checkboxCls,
  initialCommon,
  sendSealForm,
  type SealFormMode,
} from '../seal-form-parts';

const NO_FILES = '請上傳至少一個附件（用印文件；合約類另附法律顧問確認完成信件）';

function MultiHint({ max }: { max: number }) {
  return (
    <span className="mt-2 inline-flex items-center gap-2 text-xs">
      <span className="rounded bg-slate-400 px-2 py-0.5 font-semibold text-white">複選</span>
      <span className="text-td-apex-dark">請選擇1~{max}個選項</span>
    </span>
  );
}

/** NDA/MOU checklist: "非屬…" excludes the items and vice versa. */
function toggleCheck(list: string[], code: string): string[] {
  if (list.includes(code)) return list.filter((c) => c !== code);
  if (code === NOT_APPLICABLE) return [NOT_APPLICABLE];
  return [...list.filter((c) => c !== NOT_APPLICABLE), code];
}

/** Picking a document type pre-ticks "非屬…" on the checklist that does not apply. */
function checksFor(type: ContractDocumentType, kind: 'nda' | 'mou', current: string[]): string[] {
  if (type === kind) return current.filter((c) => c !== NOT_APPLICABLE);
  return [NOT_APPLICABLE];
}

export function ContractSealForm({
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
  initial?: ContractSealInput;
}) {
  const router = useRouter();
  const [common, setCommon] = useState(() => initialCommon(initial, currentEmployee));
  const [documentType, setDocumentType] = useState(initial?.documentType ?? '');
  const [seals, setSeals] = useState<string[]>(initial?.seals ?? []);
  const [periodStart, setPeriodStart] = useState(initial?.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(initial?.periodEnd ?? '');
  const [totalAmount, setTotalAmount] = useState(initial?.totalAmount ?? '0');
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [ndaChecks, setNdaChecks] = useState<string[]>(initial?.ndaChecks ?? []);
  const [mouChecks, setMouChecks] = useState<string[]>(initial?.mouChecks ?? []);
  const [legalReviewConfirmed, setLegalReviewConfirmed] = useState(initial?.legalReviewConfirmed ?? false);
  const [lending, setLending] = useState({ lendSeal: initial?.lendSeal ?? 'no', lendSealNote: initial?.lendSealNote ?? '' });
  const [files, setFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existingAttachments = mode.kind === 'create' ? 0 : mode.existingAttachmentCount;
  const needsLegal = (LEGAL_REVIEW_DOCUMENT_TYPES as readonly string[]).includes(documentType);

  const pickDocumentType = (type: ContractDocumentType) => {
    setDocumentType(type);
    setNdaChecks((prev) => checksFor(type, 'nda', prev));
    setMouChecks((prev) => checksFor(type, 'mou', prev));
  };

  const onSubmit = async () => {
    setError(null);
    const input: ContractSealInput = {
      ...common,
      documentType,
      seals,
      periodStart,
      periodEnd,
      totalAmount,
      counterparty,
      subject,
      ndaChecks,
      mouChecks,
      legalReviewConfirmed: needsLegal && legalReviewConfirmed,
      ...lending,
    };
    const parsed = parseContractSealInput(input, today);
    if (!parsed.ok) return setError(parsed.error);
    if (files.length + existingAttachments === 0) return setError(NO_FILES);

    setSubmitting(true);
    const result = await sendSealForm({
      mode,
      input,
      files,
      idempotencyKey,
      submit: submitContractSealRequest,
      revise: reviseContractSealRequest,
    });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    const failed = result.attachmentErrors.length;
    router.push(`/seal-requests/contracts/${result.sealRequestId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  return (
    <div className="card !p-0">
      <h1 className="border-b border-td-border px-5 py-4 text-xl font-bold text-td-blue-dark">用印申請單(合約類)</h1>

      <div className="grid divide-y divide-dashed divide-td-border md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="px-5 py-5">
          <p className="text-sm font-semibold text-td-blue-dark">注意事項1</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-td-blue-dark">
            <li>合約/協議書(NDA及MOU除外)之用印申請：需額外附上法律顧問確認完成信件。</li>
            <li>NDA及MOU：因無償金設定且爭議較小，故無需經法律顧問，申請人送申請前請確認下方各項須備事項。</li>
          </ol>
        </div>
        <div className="px-5 py-5">
          <p className="text-sm font-semibold text-td-blue-dark">注意事項2</p>
          <a
            href={NDA_MOU_NOTES_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-td-blue hover:underline"
          >
            <span className="rounded bg-red-500 px-1 text-[9px] font-bold leading-4 text-white">PDF</span>
            NDA_MOU審閱注意事項
          </a>
        </div>
      </div>

      <SealCommonFields value={common} onChange={setCommon} parties={parties} applicationDate={applicationDate} today={today} />

      <FieldRow cols={2}>
        <Field label="文件類別" required>
          <div role="radiogroup" aria-label="文件類別">
            {CONTRACT_DOCUMENT_TYPES.map((d) => (
              <label key={d.code} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-td-blue-dark">
                <input
                  type="radio"
                  name="documentType"
                  checked={documentType === d.code}
                  onChange={() => pickDocumentType(d.code)}
                  className="h-4 w-4 border-td-border text-td-blue focus:ring-td-blue/30"
                />
                {d.label}
              </label>
            ))}
          </div>
          {needsLegal && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <input
                type="checkbox"
                checked={legalReviewConfirmed}
                onChange={(e) => setLegalReviewConfirmed(e.target.checked)}
                className={`${checkboxCls} mt-0.5`}
              />
              <span>
                已經管理部窗口轉法律顧問審閱，並於附件附上<strong>法律顧問確認完成信件</strong>
                <span className="text-red-500">*</span>
              </span>
            </label>
          )}
        </Field>
        <SealCheckboxes options={CONTRACT_SEAL_OPTIONS} value={seals} onChange={setSeals} />
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="起訖日" required>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={periodStart}
              onChange={(e) => {
                setPeriodStart(e.target.value);
                if (!periodEnd || e.target.value > periodEnd) setPeriodEnd(e.target.value);
              }}
              className={inputCls}
              aria-label="起始日"
            />
            <span className="text-td-muted">-</span>
            <input
              type="date"
              value={periodEnd}
              min={periodStart || undefined}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className={inputCls}
              aria-label="結束日"
            />
          </div>
        </Field>
        <Field label="總價" required hint="新臺幣；無價金（如 NDA、MOU）請填 0">
          <input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            className={inputCls}
          />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="客戶/廠商名稱" required>
          <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="請輸入文字" className={inputCls} />
        </Field>
        <Field label="標的" required>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="請輸入文字" className={inputCls} />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="保密協議/NDA須備事項" required hint="用印文件為保密協議/NDA，須完全符合3個須備事項">
          <MultiHint max={NDA_CHECKS.length} />
          <div className="mt-2">
            {NDA_CHECKS.map((c) => (
              <CheckOption
                key={c.code}
                label={c.label}
                checked={ndaChecks.includes(c.code)}
                onChange={() => setNdaChecks((prev) => toggleCheck(prev, c.code))}
              />
            ))}
            <CheckOption
              label={NDA_NOT_APPLICABLE_LABEL}
              checked={ndaChecks.includes(NOT_APPLICABLE)}
              onChange={() => setNdaChecks((prev) => toggleCheck(prev, NOT_APPLICABLE))}
            />
          </div>
        </Field>
        <Field label="合作備忘錄/MOU須備事項" required hint="用印文件為合作備忘錄/MOU，須完全符合2個須備事項">
          <MultiHint max={MOU_CHECKS.length} />
          <div className="mt-2">
            {MOU_CHECKS.map((c) => (
              <CheckOption
                key={c.code}
                label={c.label}
                checked={mouChecks.includes(c.code)}
                onChange={() => setMouChecks((prev) => toggleCheck(prev, c.code))}
              />
            ))}
            <CheckOption
              label={MOU_NOT_APPLICABLE_LABEL}
              checked={mouChecks.includes(NOT_APPLICABLE)}
              onChange={() => setMouChecks((prev) => toggleCheck(prev, NOT_APPLICABLE))}
            />
          </div>
        </Field>
      </FieldRow>

      <LendSealFields value={lending} onChange={setLending} />

      <FieldRow cols={2}>
        <Field label="附件(一個檔案上限2MB，可上傳多個檔案)" required hint="請上傳用印文件；合約、協議書、意向書另附法律顧問確認完成信件">
          <PendingFilesField files={files} onChange={setFiles} existingCount={existingAttachments} />
        </Field>
        <SealReminderBlock text="完成線上簽核流程後，請印出核准之用印申請單，連同原始附件提供給相關單位用印/簽名，用印/簽名完成之文件，請交至管理部歸檔，謝謝。" />
      </FieldRow>

      <SealSubmitBar mode={mode} error={error} submitting={submitting} onSubmit={onSubmit} />
    </div>
  );
}
