'use client';

import { useMemo, useRef, useState } from 'react';
import { getAttachmentDownloadUrl, uploadAttachment } from '@/lib/attachments/actions';
import type { AttachmentRow } from '@/lib/attachments/queries';
import { AttachmentViewer, type ViewerItem } from '@/app/components/attachment-viewer';
import type { AttachmentPanelExtra } from '@/lib/attachments/analysis-queries';
import { optimizeImageForUpload } from '@/lib/attachments/client-image-optimize';
import { AttachmentInvoiceReminder } from '@/app/components/attachment-invoice-reminder';
import { fmtFileSize } from './pending-files-field';

export type { AttachmentPanelExtra };

const SCAN_LABELS: Record<string, string> = {
  pending: '掃描中',
  infected: '未通過安全掃描',
  scan_failed: '掃描失敗，待重新掃描',
  unscanned: '未掃描',
};
const BLOCKED = new Set(['pending', 'infected', 'scan_failed']);

const ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.xlsx,.pptx,image/*,application/pdf';

export function AttachmentsPanel({
  formType,
  formId,
  attachments,
  canUpload = true,
  extras,
}: {
  formType: string;
  formId: string;
  attachments: AttachmentRow[];
  /** Display only; uploads are authorized on the server either way. */
  canUpload?: boolean;
  extras?: Record<string, AttachmentPanelExtra>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const viewerItems: ViewerItem[] = useMemo(
    () =>
      attachments
        .filter((a) => !BLOCKED.has(a.scanStatus))
        .map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSizeBytes: a.fileSizeBytes,
          previewUrl: `/api/attachments/${a.id}/preview`,
          downloadUrl: `/api/attachments/${a.id}`,
          analysisSummary: extras?.[a.id]?.analysisSummary ?? null,
          confirmationNote: extras?.[a.id]?.confirmationNote ?? null,
        })),
    [attachments, extras]
  );

  const onUpload = async () => {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setError('請選擇檔案');
      return;
    }
    setError(null);
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      const raw = files.item(i);
      if (!raw) continue;
      const { file } = await optimizeImageForUpload(raw);
      const formData = new FormData();
      formData.set('file', file);
      const result = await uploadAttachment(formType, formId, formData);
      if (!result.ok) {
        setUploading(false);
        setError(result.error);
        if (/掃描/.test(result.error)) window.location.reload();
        return;
      }
    }
    setUploading(false);
    window.location.reload();
  };

  const openViewer = (attachmentId: string) => {
    const idx = viewerItems.findIndex((v) => v.id === attachmentId);
    if (idx < 0) {
      setError('此附件目前無法預覽');
      return;
    }
    setViewerIndex(idx);
    setViewerOpen(true);
  };

  const onDownload = async (attachmentId: string) => {
    setError(null);
    const url = await getAttachmentDownloadUrl(attachmentId);
    if (!url) {
      setError('無法取得檔案下載連結');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="card space-y-3">
      <h2 className="text-base font-semibold text-td-blue-dark">附件</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {attachments.length === 0 ? (
        <p className="text-sm text-td-muted">尚無附件。</p>
      ) : (
        <ul className="space-y-3" aria-label="已上傳附件">
          {attachments.map((a) => {
            const extra = extras?.[a.id];
            const blocked = BLOCKED.has(a.scanStatus);
            const canThumb = !blocked && /^image\/(jpeg|png|webp)/.test(a.mimeType);
            return (
              <li key={a.id} className="rounded-lg border border-td-border bg-white p-2 text-sm">
                <div className="flex gap-3">
                  {canThumb ? (
                    <button
                      type="button"
                      onClick={() => openViewer(a.id)}
                      className="h-16 w-16 shrink-0 overflow-hidden rounded bg-slate-100"
                      title="預覽"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/attachments/${a.id}/preview`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => (!blocked ? openViewer(a.id) : undefined)}
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-td-muted disabled:cursor-default"
                      title={blocked ? undefined : '預覽'}
                    >
                      {blocked ? '掃描中' : a.mimeType.includes('pdf') ? 'PDF' : '檔案'}
                    </button>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {blocked ? (
                        <span className="text-td-muted">{a.fileName}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openViewer(a.id)}
                          className="truncate font-medium text-td-blue hover:underline"
                        >
                          預覽 {a.fileName}
                        </button>
                      )}
                      {!blocked && (
                        <button
                          type="button"
                          onClick={() => void onDownload(a.id)}
                          className="text-xs text-td-muted underline"
                        >
                          下載原檔
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-td-muted">
                      {fmtFileSize(a.fileSizeBytes)}｜{a.uploadedByName}
                    </p>
                    {SCAN_LABELS[a.scanStatus] && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        {SCAN_LABELS[a.scanStatus]}
                      </span>
                    )}
                    {extra?.analysisSummary && !extra.needsConfirm && (
                      <p className="text-xs text-amber-800">AI 檢查：{extra.analysisSummary}</p>
                    )}
                    {extra?.confirmationNote && (
                      <p className="text-xs text-slate-600">申請人已確認提醒：{extra.confirmationNote}</p>
                    )}
                  </div>
                </div>
                {extra?.needsConfirm &&
                  extra.contentSha256 &&
                  extra.overallStatus &&
                  extra.analysisSummary && (
                    <AttachmentInvoiceReminder
                      attachmentId={a.id}
                      analysisId={extra.analysisId}
                      contentSha256={extra.contentSha256}
                      companyProfileVersion={extra.companyProfileVersion}
                      formType={formType}
                      formId={formId}
                      status={extra.overallStatus}
                      summary={extra.analysisSummary}
                    />
                  )}
              </li>
            );
          })}
        </ul>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInputRef} type="file" accept={ACCEPT} multiple />
          <button type="button" onClick={() => void onUpload()} disabled={uploading} className="btn-primary !py-1.5">
            {uploading ? '上傳中…' : '上傳附件'}
          </button>
        </div>
      )}
      <AttachmentViewer
        items={viewerItems}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </section>
  );
}
