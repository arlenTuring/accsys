'use client';

import { useRef, useState } from 'react';
import { getAttachmentDownloadUrl, uploadAttachment } from '@/lib/attachments/actions';
import type { AttachmentRow } from '@/lib/attachments/queries';
import { fmtFileSize } from './pending-files-field';

const SCAN_LABELS: Record<string, string> = {
  pending: '掃描中',
  infected: '未通過安全掃描',
  scan_failed: '掃描失敗，待重新掃描',
  unscanned: '未掃描',
};
const BLOCKED = new Set(['pending', 'infected', 'scan_failed']);

export function AttachmentsPanel({
  formType,
  formId,
  attachments,
  canUpload = true,
}: {
  formType: string;
  formId: string;
  attachments: AttachmentRow[];
  /** Display only; uploads are authorized on the server either way. */
  canUpload?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);

  const onUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('請選擇檔案');
      return;
    }
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.set('file', file);
    const result = await uploadAttachment(formType, formId, formData);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      if (/掃描/.test(result.error)) window.location.reload();
      return;
    }
    window.location.reload();
  };

  const onPreview = async (attachmentId: string) => {
    setError(null);
    setPreviewBusyId(attachmentId);
    const url = await getAttachmentDownloadUrl(attachmentId);
    setPreviewBusyId(null);
    if (!url) {
      setError('無法取得檔案下載連結');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="rounded border p-4">
      <h2 className="mb-2 font-semibold">附件</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {attachments.length === 0 ? (
        <p className="mb-2 text-sm text-gray-500">尚無附件。</p>
      ) : (
        <ul className="mb-2 space-y-1 text-sm">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              {BLOCKED.has(a.scanStatus) ? (
                <span className="text-gray-500">{a.fileName}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onPreview(a.id)}
                  disabled={previewBusyId === a.id}
                  className="text-blue-600 underline disabled:opacity-50"
                >
                  {a.fileName}
                </button>
              )}
              <span className="text-gray-400">
                {fmtFileSize(a.fileSizeBytes)}｜{a.uploadedByName}
              </span>
              {SCAN_LABELS[a.scanStatus] && (
                <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                  {SCAN_LABELS[a.scanStatus]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-sm" />
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
          >
            {uploading ? '上傳中…' : '上傳附件'}
          </button>
        </div>
      )}
    </section>
  );
}
