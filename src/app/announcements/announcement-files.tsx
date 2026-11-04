'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import {
  removeAnnouncementAttachmentAction,
  uploadAnnouncementAttachmentAction,
} from '@/lib/announcements/actions';
import { formatBytesLabel } from '@/lib/attachments/policy';

export type AnnouncementFileItem = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: string;
};

export function AnnouncementFiles(props: {
  announcementId: string;
  files: AnnouncementFileItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!props.canManage && props.files.length === 0) return null;

  return (
    <section className="space-y-2 border-t pt-4">
      <h2 className="text-sm font-semibold">附件</h2>
      {props.files.length === 0 ? (
        <p className="text-sm text-td-muted">尚無附件</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {props.files.map((f) => {
            const ready = f.scanStatus === 'clean' || f.scanStatus === 'unscanned';
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                {ready ? (
                  <a
                    className="underline"
                    href={`/api/announcements/${props.announcementId}/attachments/${f.id}`}
                  >
                    {f.fileName}
                  </a>
                ) : (
                  <span>
                    {f.fileName}
                    <span className="ml-1 text-xs text-amber-800">（{f.scanStatus}）</span>
                  </span>
                )}
                <span className="text-xs text-td-muted">{formatBytesLabel(f.fileSizeBytes)}</span>
                {props.canManage && (
                  <button
                    type="button"
                    className="text-xs text-amber-900 underline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setError(null);
                        const res = await removeAnnouncementAttachmentAction(props.announcementId, f.id);
                        if (!res.ok) setError(res.error);
                        else router.refresh();
                      })
                    }
                  >
                    移除
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {props.canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              start(async () => {
                setError(null);
                const fd = new FormData();
                fd.set('file', file);
                const res = await uploadAnnouncementAttachmentAction(props.announcementId, fd);
                if (!res.ok) setError(res.error);
                else router.refresh();
              });
            }}
          />
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? '處理中…' : '上傳附件'}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-amber-800">{error}</p>}
    </section>
  );
}
