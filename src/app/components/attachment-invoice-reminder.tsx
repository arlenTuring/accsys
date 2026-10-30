'use client';

import { useState } from 'react';
import { confirmAttachDespiteReminderAction } from '@/lib/attachments/actions-confirm';

export function AttachmentInvoiceReminder({
  attachmentId,
  analysisId,
  contentSha256,
  companyProfileVersion,
  formType,
  formId,
  draftId,
  status,
  summary,
}: {
  attachmentId: string;
  analysisId?: string | null;
  contentSha256: string;
  companyProfileVersion?: number | null;
  formType?: string | null;
  formId?: string | null;
  draftId?: string | null;
  status: string;
  summary: string;
}) {
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'match' || status === 'not_invoice') return null;

  const reminderCode =
    status === 'mismatch'
      ? 'tax_id_mismatch'
      : status === 'not_found'
        ? 'tax_id_missing'
        : status === 'company_unset'
          ? 'company_unset'
          : status === 'analysis_failed'
            ? 'analysis_failed'
            : status === 'unclear'
              ? 'unclear'
              : 'other';

  const onConfirm = async () => {
    setBusy(true);
    setMsg(null);
    const result = await confirmAttachDespiteReminderAction({
      attachmentId,
      analysisId,
      expectedContentSha256: contentSha256,
      companyProfileVersion,
      formType,
      formId,
      draftId,
      reminderCode,
      reminderSummary: summary,
      userNote: note || null,
    });
    setBusy(false);
    setMsg(result.ok ? '已記錄確認並保留夾帶（簽核者仍可見此提醒）' : result.error);
  };

  return (
    <div className="mt-2 space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">業務提醒（非安全阻擋）</p>
      <p>{summary}</p>
      <p className="text-xs text-amber-800">
        「相符」不代表發票合法可抵稅；「未辨識到」不代表原件確定沒有統編。
      </p>
      <textarea
        className="w-full rounded border px-2 py-1 text-sm"
        rows={2}
        placeholder="選填說明／人工更正（會標示為人工聲明）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary !py-1" disabled={busy} onClick={() => void onConfirm()}>
          仍要夾帶
        </button>
        <a className="btn-secondary !py-1" href={`/api/attachments/${attachmentId}/preview`} target="_blank" rel="noreferrer">
          查看原檔預覽
        </a>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
    </div>
  );
}
