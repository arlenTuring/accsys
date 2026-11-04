'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ClientImageAttachment,
  canAttachToDraft,
  invoiceReminderFromCheck,
  statusAfterInvoiceCheck,
  statusLabel,
} from './image-attachment-utils';
import {
  attachStagedFilesToDraftAction,
  getStagedCheckStatesAction,
  startStagedCheckAction,
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
  conversationId: string | null;
  /** Currently open draft — used when the person presses 加入附件. */
  draftId?: string | null;
  draftTitle?: string | null;
  draftVersion?: number | null;
  onRemove: (clientAttachmentId: string) => void;
  onRetry: (clientAttachmentId: string) => void;
  onPatch: (clientAttachmentId: string, patch: Partial<ClientImageAttachment>) => void;
  onEdit?: (item: ClientImageAttachment) => void;
  /** After files are on the draft: the parent drops exactly those entries and refreshes the draft. */
  onAttachedToDraft?: (info: {
    draftId: string;
    version: number;
    clientAttachmentIds: string[];
    notice: string;
  }) => void;
};

function Thumb({ item }: { item: ClientImageAttachment }) {
  const [broken, setBroken] = useState(false);
  const isPdf = item.mimeType === 'application/pdf';
  const isHeic = /^image\/hei[cf]$/.test(item.mimeType);
  const src =
    item.stagedId && (isHeic || item.edited)
      ? `/api/ai-chat/staged/${item.stagedId}?preview=1&v=${item.edited ?? 0}`
      : item.previewUrl;
  const tile = isPdf ? 'PDF' : isHeic ? 'HEIC' : '檔案';
  const href = item.stagedId
    ? `/api/ai-chat/staged/${item.stagedId}${isHeic || item.edited ? '?preview=1' : ''}`
    : item.previewUrl;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={`預覽 ${item.fileName}`} className="block h-full w-full">
      {isPdf || broken ? (
        <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-td-muted">
          {tile}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt={item.fileName} className="h-full w-full object-cover" onError={() => setBroken(true)} />
      )}
    </a>
  );
}

function CheckSpinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-td-border border-t-td-blue-dark"
      aria-hidden
    />
  );
}

export function ImageAttachmentStrip({
  items,
  conversationId,
  draftId,
  draftTitle,
  draftVersion,
  onRemove,
  onRetry,
  onPatch,
  onEdit,
  onAttachedToDraft,
}: Props) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const attachingRef = useRef(false);
  const startedCheckRef = useRef(new Set<string>());

  const attach = useCallback(
    async (list: ClientImageAttachment[], opts?: { draftId?: string; draftTitle?: string }) => {
      if (!conversationId || attachingRef.current) return;
      const targetDraftId = opts?.draftId ?? draftId;
      if (!targetDraftId) {
        setLocalError('請先開啟要加入的草稿，或在對話中指定目標草稿。');
        return;
      }
      const title = opts?.draftTitle ?? draftTitle ?? '草稿';
      const group = list.filter((i) => i.stagedId && canAttachToDraft(i.status));
      if (group.length === 0) return;
      const target = { draftId: targetDraftId, title };
      attachingRef.current = true;
      setLocalError(null);
      group.forEach((i) => onPatch(i.clientAttachmentId, { status: 'attaching', target, error: undefined }));
      let res: Awaited<ReturnType<typeof attachStagedFilesToDraftAction>>;
      try {
        res = await attachStagedFilesToDraftAction({
          conversationId,
          draftId: target.draftId,
          expectedVersion: target.draftId === draftId && draftVersion ? draftVersion : 1,
          stagedIds: group.map((i) => i.stagedId!),
          // Reminders do not block attach; record acknowledgement when present.
          confirmReminders: true,
          userNote: '使用者按加入附件（提醒不阻擋）',
        });
      } catch {
        res = { ok: false, error: 'attach_failed', message: '連線中斷，檔案尚未加入草稿。' };
      }
      attachingRef.current = false;
      if (!res.ok) {
        const message = 'message' in res && res.message ? res.message : res.error;
        group.forEach((i) => onPatch(i.clientAttachmentId, { status: 'attach_failed', error: message }));
        setLocalError(`尚未加入草稿：${message}`);
        return;
      }
      const attachedIds = new Set(res.attached.map((a) => a.id));
      const done = group.filter((i) => {
        const hit = res.ok && res.attached.some((a) => a.fileName === i.fileName || i.stagedId === a.id);
        return hit && !res.skipped?.includes(i.stagedId!);
      });
      // Prefer matching by source staged id via fileName fallback already above.
      void attachedIds;
      const missed = group.filter((i) => !done.includes(i));
      missed.forEach((i) =>
        onPatch(i.clientAttachmentId, { status: 'attach_failed', error: '檔案尚未就緒，沒有加入草稿' })
      );
      const notes = done.map((i) => i.fileName).join('、');
      onAttachedToDraft?.({
        draftId: res.draft.id,
        version: res.draft.version,
        clientAttachmentIds: done.map((i) => i.clientAttachmentId),
        notice: `已加入「${target.title}」${done.length} 個附件${notes ? `：${notes}` : ''}`,
      });
    },
    [conversationId, draftId, draftTitle, draftVersion, onAttachedToDraft, onPatch]
  );

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // After security scan, auto-start AI analysis (no confirm button; draft not required).
  useEffect(() => {
    const pending = items.filter(
      (i) => i.stagedId && i.status === 'scanned' && !startedCheckRef.current.has(i.stagedId)
    );
    if (pending.length === 0) return;
    for (const i of pending) startedCheckRef.current.add(i.stagedId!);
    pending.forEach((i) => onPatch(i.clientAttachmentId, { status: 'checking', error: undefined }));
    void startStagedCheckAction({ stagedIds: pending.map((i) => i.stagedId!) }).then((res) => {
      if (!res?.ok) {
        pending.forEach((i) => {
          startedCheckRef.current.delete(i.stagedId!);
          onPatch(i.clientAttachmentId, { status: 'scanned', checkIncomplete: true, error: '檢查未開始，可重試' });
        });
      }
    });
  }, [items, onPatch]);

  const checking = items.filter((i) => i.status === 'checking' && i.stagedId).map((i) => i.stagedId!);
  const checkingKey = checking.join(',');

  useEffect(() => {
    if (!checkingKey) return;
    let stopped = false;
    const ids = checkingKey.split(',');
    const tick = async () => {
      const res = await getStagedCheckStatesAction({ stagedIds: ids }).catch(() => null);
      if (stopped || !res?.ok) return;
      for (const st of res.states) {
        if (st.state !== 'done') continue;
        const item = itemsRef.current.find((i) => i.stagedId === st.stagedId);
        if (!item) continue; // removed while checking — never revive
        const invoice = invoiceReminderFromCheck(st.result);
        const status = statusAfterInvoiceCheck(invoice);
        const incomplete = !st.result || st.result.overallStatus === 'analysis_failed' || st.result.complete === false;
        onPatch(item.clientAttachmentId, {
          status,
          invoice,
          checkBrief: invoice?.summary?.slice(0, 80) ?? null,
          checkIncomplete: incomplete,
        });
      }
    };
    const timer = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [checkingKey, onPatch]);

  if (items.length === 0) return null;

  const attachable = items.filter((i) => i.stagedId && canAttachToDraft(i.status) && i.status !== 'attaching');
  const detail = detailId ? items.find((i) => i.clientAttachmentId === detailId) : null;

  return (
    <div className="mb-1.5 space-y-1">
      {localError && (
        <p role="alert" className="text-xs text-amber-800">
          {localError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5" aria-label="待處理附件">
          {items.map((item) => {
            const statusTone =
              item.status === 'failed' || item.status === 'blocked' || item.status === 'attach_failed'
                ? 'ring-red-400'
                : item.status === 'needs_confirm'
                  ? 'ring-amber-300'
                  : item.status === 'ready' || item.status === 'confirmed'
                    ? 'ring-emerald-300'
                    : 'ring-td-border';
            return (
              <li key={item.clientAttachmentId} className="relative w-24 shrink-0">
                <div
                  className={`h-12 w-full overflow-hidden rounded-md bg-slate-100 ring-1 ${statusTone}`}
                  title={`${item.fileName}${item.error ? `：${item.error}` : ''}`}
                >
                  <Thumb item={item} />
                </div>
                <button
                  type="button"
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs leading-none text-white"
                  aria-label={`移除 ${item.fileName}`}
                  onClick={() => onRemove(item.clientAttachmentId)}
                >
                  ×
                </button>
                <p className="mt-0.5 flex items-center gap-1 text-xs leading-tight text-td-muted">
                  {item.status === 'checking' && <CheckSpinner />}
                  {statusLabel(item.status)}
                  {item.status === 'uploading' && typeof item.progress === 'number' ? ` ${item.progress}%` : ''}
                </p>
                {item.sizeNote && <p className="text-[10px] leading-tight text-td-muted">{item.sizeNote}</p>}
                {item.checkBrief && item.status !== 'checking' && (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => setDetailId(item.clientAttachmentId)}
                  >
                    {item.checkBrief.slice(0, 24)}
                    {item.checkBrief.length > 24 ? '…' : ''} · 詳細
                  </button>
                )}
                {item.checkIncomplete && item.status !== 'checking' && (
                  <p className="text-xs text-amber-800">檢查中／未完成（仍可加入）</p>
                )}
                {item.status === 'failed' && (
                  <button type="button" className="text-xs underline" onClick={() => onRetry(item.clientAttachmentId)}>
                    重試
                  </button>
                )}
                {item.stagedId &&
                  item.mimeType.startsWith('image/') &&
                  canAttachToDraft(item.status) &&
                  item.status !== 'attaching' && (
                    <button type="button" className="ml-1 text-xs underline" onClick={() => onEdit?.(item)}>
                      編輯
                    </button>
                  )}
                {item.error && item.status !== 'attach_failed' && (
                  <p className="text-xs leading-tight text-red-700">{item.error}</p>
                )}
              </li>
            );
          })}
        </ul>
        {attachable.length > 0 && (
          <button
            type="button"
            className="btn-primary shrink-0 whitespace-nowrap px-2 py-1 text-sm"
            onClick={() => void attach(attachable)}
          >
            加入附件（{attachable.length}）
          </button>
        )}
      </div>
      {attachable.length > 0 && !draftId && (
        <p className="text-xs text-td-muted">尚未開啟草稿；開啟後按「加入附件」，或在對話指定目標草稿。</p>
      )}
      {detail && (
        <div className="rounded-lg border border-td-border bg-slate-50 px-2 py-1.5 text-sm" role="dialog">
          <p className="font-semibold">{detail.fileName}</p>
          {detail.sizeNote && <p className="text-td-muted">{detail.sizeNote}</p>}
          {detail.invoice?.summary && <p className="mt-1 whitespace-pre-wrap">{detail.invoice.summary}</p>}
          <button type="button" className="mt-1 underline" onClick={() => setDetailId(null)}>
            關閉詳細
          </button>
        </div>
      )}
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
