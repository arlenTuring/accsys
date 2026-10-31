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
  /** Draft open right now; only used when the person presses 確認並檢查. */
  draftId?: string | null;
  draftTitle?: string | null;
  draftVersion?: number | null;
  onRemove: (clientAttachmentId: string) => void;
  onRetry: (clientAttachmentId: string) => void;
  onPatch: (clientAttachmentId: string, patch: Partial<ClientImageAttachment>) => void;
  onEdit?: (item: ClientImageAttachment) => void;
  /** After files are on the draft: the parent drops exactly those entries and refreshes the draft. */
  onAttachedToDraft?: (info: { draftId: string; version: number; clientAttachmentIds: string[]; notice: string }) => void;
};

function Thumb({ item }: { item: ClientImageAttachment }) {
  const [broken, setBroken] = useState(false);
  const isPdf = item.mimeType === 'application/pdf';
  const isHeic = /^image\/hei[cf]$/.test(item.mimeType);
  // HEIC shows through the server's JPEG view once uploaded (most browsers cannot draw it locally).
  const src = item.stagedId && (isHeic || item.edited) ? `/api/ai-chat/staged/${item.stagedId}?preview=1&v=${item.edited ?? 0}` : item.previewUrl;
  const tile = isPdf ? 'PDF' : isHeic ? 'HEIC' : '檔案';
  const href = item.stagedId ? `/api/ai-chat/staged/${item.stagedId}${isHeic || item.edited ? '?preview=1' : ''}` : item.previewUrl;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={`預覽 ${item.fileName}`} className="block h-full w-full">
      {isPdf || broken ? (
        <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-td-muted">{tile}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt={item.fileName} className="h-full w-full object-cover" onError={() => setBroken(true)} />
      )}
    </a>
  );
}

export function ImageAttachmentStrip({ items, conversationId, draftId, draftTitle, draftVersion, onRemove, onRetry, onPatch, onEdit, onAttachedToDraft }: Props) {
  const [localError, setLocalError] = useState<string | null>(null);
  const attachingRef = useRef(false);

  const attach = useCallback(
    async (list: ClientImageAttachment[], opts: { confirmReminders: boolean }) => {
      if (!conversationId || attachingRef.current) return;
      const group = list.filter((i) => i.stagedId && i.target);
      if (group.length === 0) return;
      const target = group[0].target!;
      const same = group.filter((i) => i.target?.draftId === target.draftId);
      attachingRef.current = true;
      setLocalError(null);
      same.forEach((i) => onPatch(i.clientAttachmentId, { status: 'attaching', error: undefined }));
      let res: Awaited<ReturnType<typeof attachStagedFilesToDraftAction>>;
      try {
        res = await attachStagedFilesToDraftAction({
          conversationId,
          draftId: target.draftId,
          expectedVersion: target.draftId === draftId && draftVersion ? draftVersion : 1,
          stagedIds: same.map((i) => i.stagedId!),
          confirmReminders: opts.confirmReminders,
          userNote: '使用者確認提醒後夾入草稿',
        });
      } catch {
        res = { ok: false, error: 'attach_failed', message: '連線中斷，檔案尚未加入草稿。' };
      }
      attachingRef.current = false;
      if (!res.ok) {
        const message = 'message' in res && res.message ? res.message : res.error;
        same.forEach((i) => onPatch(i.clientAttachmentId, { status: 'attach_failed', error: message }));
        setLocalError(`尚未加入草稿：${message}`);
        return;
      }
      const done = same.filter((i) => res.ok && res.attached.some((a) => a.fileName === i.fileName) && !res.skipped?.includes(i.stagedId!));
      const missed = same.filter((i) => !done.includes(i));
      missed.forEach((i) => onPatch(i.clientAttachmentId, { status: 'attach_failed', error: '檔案尚未就緒，沒有加入草稿' }));
      const notes = done.map((i) => `${i.fileName}${i.invoice?.summary ? `：${i.invoice.summary}` : ''}`).join('；');
      onAttachedToDraft?.({
        draftId: res.draft.id,
        version: res.draft.version,
        clientAttachmentIds: done.map((i) => i.clientAttachmentId),
        notice: `已加入「${target.title}」：${notes}`,
      });
    },
    [conversationId, draftId, draftVersion, onAttachedToDraft, onPatch]
  );

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const checking = items.filter((i) => i.status === 'checking' && i.stagedId).map((i) => i.stagedId!);
  const checkingKey = checking.join(',');

  // Poll the background AI check; passed files go straight to the chosen draft.
  useEffect(() => {
    if (!checkingKey) return;
    let stopped = false;
    const ids = checkingKey.split(',');
    const tick = async () => {
      const res = await getStagedCheckStatesAction({ stagedIds: ids }).catch(() => null);
      if (stopped || !res?.ok) return;
      const passed: ClientImageAttachment[] = [];
      for (const st of res.states) {
        if (st.state !== 'done') continue;
        const item = itemsRef.current.find((i) => i.stagedId === st.stagedId);
        if (!item) continue;
        const invoice = invoiceReminderFromCheck(st.result);
        const status = statusAfterInvoiceCheck(invoice);
        onPatch(item.clientAttachmentId, { status, invoice });
        if (status === 'ready') passed.push({ ...item, status, invoice });
      }
      if (passed.length) void attach(passed, { confirmReminders: false });
    };
    const timer = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [checkingKey, attach, onPatch]);

  if (items.length === 0) return null;

  const scanned = items.filter((i) => i.stagedId && i.status === 'scanned');
  const needsConfirm = items.filter((i) => i.stagedId && i.status === 'needs_confirm');
  const retryAttach = items.filter((i) => i.stagedId && i.target && canAttachToDraft(i.status));

  const confirmAndCheck = async () => {
    if (!draftId) {
      setLocalError('請先開啟要加入檔案的草稿（右側文件區），再按「確認並檢查」。');
      return;
    }
    setLocalError(null);
    const target = { draftId, title: draftTitle ?? '草稿' };
    scanned.forEach((i) => onPatch(i.clientAttachmentId, { status: 'checking', target, error: undefined }));
    const res = await startStagedCheckAction({ stagedIds: scanned.map((i) => i.stagedId!), targetDraftId: draftId }).catch(() => null);
    if (!res?.ok) {
      scanned.forEach((i) => onPatch(i.clientAttachmentId, { status: 'scanned' }));
      setLocalError('無法開始檢查，請再按一次。');
    }
  };

  return (
    <div className="mb-1.5 space-y-1">
      {localError && <p role="alert" className="text-[11px] text-amber-800">{localError}</p>}
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
              <li key={item.clientAttachmentId} className="relative w-20 shrink-0">
                <div className={`h-12 w-full overflow-hidden rounded-md bg-slate-100 ring-1 ${statusTone}`} title={`${item.fileName}${item.error ? `：${item.error}` : ''}`}>
                  <Thumb item={item} />
                </div>
                <button
                  type="button"
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[10px] leading-none text-white"
                  aria-label={`移除 ${item.fileName}`}
                  onClick={() => onRemove(item.clientAttachmentId)}
                >
                  ×
                </button>
                <p className="mt-0.5 text-[10px] leading-tight text-td-muted">
                  {statusLabel(item.status)}
                  {item.status === 'uploading' && typeof item.progress === 'number' ? ` ${item.progress}%` : ''}
                </p>
                {item.status === 'failed' && (
                  <button type="button" className="text-[10px] underline" onClick={() => onRetry(item.clientAttachmentId)}>
                    重試
                  </button>
                )}
                {item.stagedId && item.mimeType.startsWith('image/') && ['scanned', 'needs_confirm', 'attach_failed'].includes(item.status) && (
                  <button type="button" className="ml-1 text-[10px] underline" onClick={() => onEdit?.(item)}>
                    編輯
                  </button>
                )}
                {item.error && item.status !== 'attach_failed' && <p className="text-[10px] leading-tight text-red-700">{item.error}</p>}
              </li>
            );
          })}
        </ul>
        {scanned.length > 0 && (
          <button type="button" className="btn-primary shrink-0 whitespace-nowrap px-2 py-1 text-xs" onClick={() => void confirmAndCheck()}>
            確認並檢查（{scanned.length}）
          </button>
        )}
      </div>
      {scanned.length > 0 && (
        <p className="text-[10px] text-td-muted">
          {draftId ? `按下後才會送 AI 檢查，通過即加入「${draftTitle ?? '目前草稿'}」。` : '尚未開啟草稿；開啟後才能加入。'}
        </p>
      )}
      {retryAttach.length > 0 && items.some((i) => i.status === 'attach_failed') && (
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void attach(retryAttach, { confirmReminders: false })}>
          重新加入草稿（{retryAttach.length}）
        </button>
      )}
      {needsConfirm.map((item) => {
        const moved = Boolean(draftId && item.target && draftId !== item.target.draftId);
        return (
          <div key={item.clientAttachmentId} role="group" aria-label={`${item.fileName} 提醒`} className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
            <p>
              <span className="font-semibold">{item.fileName}</span>：{item.invoice?.summary ?? '需要確認'}
            </p>
            <p className="mt-0.5 text-[11px]">這是業務提醒，不是安全問題。將加入「{item.target?.title ?? '草稿'}」。</p>
            {moved && (
              <button
                type="button"
                className="mt-1 mr-2 underline"
                onClick={() => onPatch(item.clientAttachmentId, { target: { draftId: draftId!, title: draftTitle ?? '草稿' } })}
              >
                目前開啟的是「{draftTitle}」，改加入這一張
              </button>
            )}
            <div className="mt-1 flex gap-2">
              <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => void attach([item], { confirmReminders: true })}>
                仍要夾帶
              </button>
              <button type="button" className="underline" onClick={() => onRemove(item.clientAttachmentId)}>
                不要這個檔案
              </button>
            </div>
          </div>
        );
      })}
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
