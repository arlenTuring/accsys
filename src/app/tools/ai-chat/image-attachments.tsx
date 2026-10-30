'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type ClientImageAttachment,
  canAttachToDraft,
  statusLabel,
} from './image-attachment-utils';
import {
  attachStagedFilesToDraftAction,
  confirmStagedInvoiceReminderAction,
} from '@/lib/ai-chat/actions-staged-invoice';

export type { ClientImageAttachment, ClientImageStatus } from './image-attachment-utils';
export {
  AI_CHAT_IMAGE_ACCEPT,
  AI_CHAT_IMAGE_MAX_BYTES,
  AI_CHAT_IMAGE_MAX_COUNT,
  ALLOWED_IMAGE_MIMES,
  buildImageCandidates,
  formatBytes,
  planAcceptedAttachments,
  statusLabel,
  canSendToModel,
  canAttachToDraft,
  statusAfterInvoiceCheck,
  invoiceReminderFromCheck,
} from './image-attachment-utils';

type Props = {
  items: ClientImageAttachment[];
  draftId?: string | null;
  draftVersion?: number | null;
  onRemove: (clientAttachmentId: string) => void;
  onRetry: (clientAttachmentId: string) => void;
  onConfirmed?: (clientAttachmentId: string) => void;
  /** After files are on the draft — parent should clear the strip so chat stays usable. */
  onAttachedToDraft?: (info: { draftId: string; version: number; count: number }) => void;
};

export function ImageAttachmentStrip({
  items,
  draftId,
  draftVersion,
  onRemove,
  onRetry,
  onConfirmed,
  onAttachedToDraft,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (items.length === 0) return null;

  const attachable = items.filter((i) => i.stagedId && canAttachToDraft(i.status));
  const needsConfirm = items.filter((i) => i.stagedId && i.status === 'needs_confirm');

  const confirm = async (item: ClientImageAttachment) => {
    if (!item.stagedId) return;
    if (!draftId) {
      setLocalError('請先開啟右側草稿');
      return;
    }
    setBusyId(item.clientAttachmentId);
    setLocalError(null);
    const res = await confirmStagedInvoiceReminderAction({
      stagedId: item.stagedId,
      draftId,
      userNote: null,
    });
    setBusyId(null);
    if (!res.ok) {
      setLocalError(res.error);
      return;
    }
    onConfirmed?.(item.clientAttachmentId);
  };

  const attachToDraft = async (opts?: { confirmReminders?: boolean }) => {
    if (!draftId) {
      setLocalError('請先開啟右側草稿');
      return;
    }
    const stagedIds = [
      ...attachable.map((i) => i.stagedId!),
      ...(opts?.confirmReminders ? needsConfirm.map((i) => i.stagedId!) : []),
    ];
    if (stagedIds.length === 0) {
      setLocalError(needsConfirm.length > 0 ? '請先確認提醒' : '尚無可夾入檔案');
      return;
    }
    setAttaching(true);
    setLocalError(null);
    const res = await attachStagedFilesToDraftAction({
      draftId,
      expectedVersion: draftVersion && draftVersion >= 1 ? draftVersion : 1,
      stagedIds,
      confirmReminders: opts?.confirmReminders ?? false,
      userNote: '使用者於左側一鍵夾入草稿',
    });
    setAttaching(false);
    if (!res.ok) {
      setLocalError(res.message ?? res.error);
      if (res.error === 'version_conflict' && res.draft) {
        onAttachedToDraft?.({ draftId, version: res.draft.version, count: 0 });
      }
      return;
    }
    for (const item of needsConfirm) {
      if (opts?.confirmReminders && item.stagedId && stagedIds.includes(item.stagedId)) {
        onConfirmed?.(item.clientAttachmentId);
      }
    }
    onAttachedToDraft?.({
      draftId: res.draft.id,
      version: res.draft.version,
      count: res.attached.length,
    });
  };

  return (
    <div className="mb-1.5 space-y-1">
      {localError && <p className="text-[11px] text-amber-800">{localError}</p>}
      <div className="flex items-center gap-2">
        <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5" aria-label="待傳送圖片">
          {items.map((item) => {
            const statusTone =
              item.status === 'failed'
                ? 'ring-amber-400'
                : item.status === 'needs_confirm'
                  ? 'ring-amber-300'
                  : item.status === 'ready' || item.status === 'confirmed'
                    ? 'ring-emerald-300'
                    : 'ring-td-border';
            return (
              <li key={item.clientAttachmentId} className="relative shrink-0">
                <div
                  className={`h-12 w-12 overflow-hidden rounded-md bg-slate-100 ring-1 ${statusTone}`}
                  title={`${item.fileName} · ${statusLabel(item.status)}${item.error ? `：${item.error}` : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                </div>
                <button
                  type="button"
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[10px] leading-none text-white"
                  aria-label="移除"
                  onClick={() => onRemove(item.clientAttachmentId)}
                >
                  ×
                </button>
                {item.status === 'failed' && (
                  <button
                    type="button"
                    className="absolute inset-x-0 bottom-0 bg-amber-800/90 text-[9px] text-white"
                    onClick={() => onRetry(item.clientAttachmentId)}
                  >
                    重試
                  </button>
                )}
                {item.status === 'needs_confirm' && (
                  <button
                    type="button"
                    className="absolute inset-x-0 bottom-0 bg-amber-700/95 px-0.5 text-[9px] leading-tight text-white"
                    disabled={busyId === item.clientAttachmentId}
                    onClick={() => void confirm(item)}
                  >
                    {busyId === item.clientAttachmentId ? '…' : '仍要夾帶'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {(attachable.length > 0 || needsConfirm.length > 0) && (
          <div className="flex shrink-0 flex-col gap-1">
            {attachable.length > 0 && (
              <button
                type="button"
                className="btn-primary whitespace-nowrap px-2 py-1 text-xs"
                disabled={attaching}
                onClick={() => void attachToDraft({ confirmReminders: false })}
              >
                {attaching ? '夾入中…' : `夾入草稿（${attachable.length}）`}
              </button>
            )}
            {needsConfirm.length > 0 && (
              <button
                type="button"
                className="btn-secondary whitespace-nowrap px-2 py-1 text-xs"
                disabled={attaching}
                onClick={() => void attachToDraft({ confirmReminders: true })}
              >
                確認並夾入
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Revoke object URLs only when an item leaves the list or its URL changes.
 * Must not revoke on every status patch (that would blank previews).
 */
export function useObjectUrlCleanup(items: ClientImageAttachment[]) {
  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const next = new Map(items.map((i) => [i.clientAttachmentId, i.previewUrl]));
    for (const [id, url] of prev.current) {
      if (!next.has(id) || next.get(id) !== url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
    }
    prev.current = next;
  }, [items]);

  useEffect(() => {
    return () => {
      for (const url of prev.current.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
      prev.current = new Map();
    };
  }, []);
}
