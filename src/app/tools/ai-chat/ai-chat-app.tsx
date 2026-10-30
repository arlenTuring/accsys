'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  bootstrapAssistantConversation,
  createConversationAction,
  getAiChatStatus,
  getAssistantInboxAction,
  loadOlderMessagesAction,
  purgeStagedAiChatImageAction,
  sendAiChatMessage,
  stageAiChatImageAction,
} from '@/lib/ai-chat/actions';
import { attachStagedFilesToDraftAction } from '@/lib/ai-chat/actions-staged-invoice';
import type { AiMessageBlock } from '@/lib/ai-chat/blocks';
import type { OpenResourceEvent } from '@/lib/ai-chat/open-resource';
import {
  ConversationSidebar,
  loadSidebarCollapsedPref,
  saveSidebarCollapsedPref,
} from './conversation-sidebar';
import {
  AI_CHAT_IMAGE_ACCEPT,
  AI_CHAT_IMAGE_MAX_BYTES,
  AI_CHAT_IMAGE_MAX_COUNT,
  type ClientImageAttachment,
  buildImageCandidates,
  canAttachToDraft,
  canSendToModel,
  formatBytes,
  ImageAttachmentStrip,
  invoiceReminderFromCheck,
  planAcceptedAttachments,
  statusAfterInvoiceCheck,
  useObjectUrlCleanup,
} from './image-attachments';
import {
  type DocTab,
  loadDocTabsPref,
  openDraftLibraryTab,
  openFromEvent,
  saveDocTabsPref,
  tabKey,
} from './document-tabs';
import { DraftLibraryPanel } from './draft-library-panel';
import { DraftPanel } from './draft-panel';
import { MessageBlocks } from './message-blocks';
import { SafeMarkdown } from './safe-markdown';

type UiMessage = {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  toolsUsed?: string[];
  blocks?: AiMessageBlock[];
  createdAt?: string;
};

const CONV_PREF = 'accsys.ai.activeConversation';
const BOUND_DRAFT_PREF = 'accsys.ai.boundDraft';
const SIDEBAR_PREF_USER = 'local';

function newClientId(): string {
  return crypto.randomUUID();
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** User wants chat photos copied onto the open draft (not only model tool calls). */
function wantsDraftAttach(text: string): boolean {
  return /夾帶|夾進|附加到草稿|放到草稿|附上草稿|附到草稿/.test(text);
}

function stagedIdsFromMessageBlocks(msgs: UiMessage[]): string[] {
  const ids: string[] = [];
  for (const m of msgs) {
    if (m.role !== 'user' || !m.blocks) continue;
    for (const b of m.blocks) {
      if (
        b.kind === 'attachment_status' &&
        b.state === 'ready' &&
        typeof b.detail === 'string' &&
        b.detail.startsWith('staged:')
      ) {
        ids.push(b.detail.slice('staged:'.length));
      }
    }
  }
  return [...new Set(ids)];
}

export function AiChatApp() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState('AI 助手');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ClientImageAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [drawerRefresh, setDrawerRefresh] = useState(0);
  /** Bumps when chat tools write a draft so the right panel reloads even if version looks unchanged. */
  const [draftSyncTick, setDraftSyncTick] = useState(0);
  const [docsCollapsed, setDocsCollapsed] = useState(false);
  const [docsWidth, setDocsWidth] = useState(420);
  const [tabs, setTabs] = useState<DocTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [boundDraft, setBoundDraft] = useState<{
    draftId: string;
    title: string;
    version?: number;
  } | null>(null);
  const [mobilePane, setMobilePane] = useState<'chat' | 'docs'>('chat');
  const [statusMeta, setStatusMeta] = useState<{ model: string; ok: boolean } | null>(null);
  const [inboxHint, setInboxHint] = useState<string | null>(null);
  const bootGen = useRef(0);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  /** Bumps on conversation switch / logout so in-flight uploads cannot patch the wrong session. */
  const uploadEpochRef = useRef(0);
  const uploadInFlightRef = useRef(new Set<string>());
  const pendingPurgeRef = useRef<string[]>([]);
  const [purgeTick, setPurgeTick] = useState(0);
  /** First Enter arms send; second Enter sends. Enter never inserts a newline (use Shift+Enter). */
  const enterArmedRef = useRef(false);

  useObjectUrlCleanup(attachments);

  useEffect(() => {
    uploadEpochRef.current += 1;
    uploadInFlightRef.current.clear();
    setAttachments([]);
  }, [conversationId]);

  useEffect(() => {
    const toPurge = pendingPurgeRef.current;
    pendingPurgeRef.current = [];
    for (const stagedId of toPurge) {
      void purgeStagedAiChatImageAction({ stagedId });
    }
  }, [purgeTick]);

  const patchAttachment = useCallback(
    (
      clientAttachmentId: string,
      patch: Partial<ClientImageAttachment>,
      opts?: { epoch: number; conversationId: string }
    ) => {
      if (opts) {
        if (opts.epoch !== uploadEpochRef.current) return;
        if (opts.conversationId !== conversationIdRef.current) return;
      }
      setAttachments((prev) => {
        if (!prev.some((a) => a.clientAttachmentId === clientAttachmentId)) return prev;
        return prev.map((a) => (a.clientAttachmentId === clientAttachmentId ? { ...a, ...patch } : a));
      });
    },
    []
  );

  const runUpload = useCallback(
    async (convId: string, meta: ClientImageAttachment, file: File, epoch: number) => {
      const id = meta.clientAttachmentId;
      if (uploadInFlightRef.current.has(id)) return;
      uploadInFlightRef.current.add(id);
      const gate = { epoch, conversationId: convId };
      patchAttachment(id, { status: 'uploading', error: undefined }, gate);
      try {
        // Prefer multipart API (no base64 bloat). Fall back to Server Action for tiny files.
        patchAttachment(id, { status: 'uploading', error: undefined }, gate);
        type InvoiceRaw = {
          overallStatus?: string;
          summary?: string;
          pages?: Array<{ buyerTaxId?: string | null; sellerTaxId?: string | null }>;
        };
        type StageOk = { ok: true; stagedId: string; scanStatus: string; invoice?: InvoiceRaw | null };
        type StageRes = StageOk | { ok: false; error: string; code?: string };
        let res: StageRes;
        try {
          if (file.size > 512 * 1024) {
            const fd = new FormData();
            fd.set('file', file, meta.fileName);
            fd.set('conversationId', convId);
            fd.set('clientAttachmentId', id);
            const http = await fetch('/api/ai-chat/staged-upload', {
              method: 'POST',
              body: fd,
              credentials: 'same-origin',
            });
            const body = (await http.json().catch(() => ({}))) as {
              ok?: boolean;
              error?: string;
              code?: string;
              scanStatus?: string;
              staged?: { id: string; scanStatus: string };
              invoice?: InvoiceRaw | null;
            };
            if (!http.ok || !body.ok || !body.staged?.id) {
              res = {
                ok: false,
                error:
                  typeof body.error === 'string'
                    ? body.error
                    : http.status === 413
                      ? '檔案過大'
                      : '上傳或檢查失敗，請重試',
                code: body.code,
              };
            } else {
              res = {
                ok: true,
                stagedId: body.staged.id,
                scanStatus: body.scanStatus ?? body.staged.scanStatus,
                invoice: body.invoice ?? null,
              };
            }
          } else {
            let base64: string;
            try {
              base64 = await fileToBase64(file);
            } catch {
              patchAttachment(id, { status: 'failed', error: '讀取檔案失敗' }, gate);
              return;
            }
            const actionRes = await stageAiChatImageAction({
              conversationId: convId,
              clientAttachmentId: id,
              fileName: meta.fileName,
              mimeType: meta.mimeType,
              base64,
            });
            res = actionRes.ok
              ? {
                  ok: true,
                  stagedId: actionRes.stagedId,
                  scanStatus: actionRes.scanStatus,
                  invoice: actionRes.invoice ?? null,
                }
              : actionRes;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : '上傳失敗';
          patchAttachment(
            id,
            {
              status: 'failed',
              error: msg.includes('unauthenticated') || msg.includes('NEXT_REDIRECT')
                ? '登入已逾時，請重新登入後重試'
                : file.size > 8 * 1024 * 1024
                  ? '上傳失敗：檔案偏大，請重新整理頁面後再試'
                  : '上傳或檢查失敗，請重試',
            },
            gate
          );
          return;
        }
        if (!res.ok) {
          patchAttachment(id, { status: 'failed', error: res.error }, gate);
          return;
        }
        const scanReady = res.scanStatus === 'ready';
        const invoice = invoiceReminderFromCheck(res.invoice);
        const nextStatus = statusAfterInvoiceCheck(scanReady, invoice);
        patchAttachment(
          id,
          {
            status: nextStatus,
            stagedId: res.stagedId,
            invoice,
            error: scanReady ? undefined : '圖片掃描未通過',
            file: scanReady ? undefined : file,
          },
          gate
        );
      } finally {
        uploadInFlightRef.current.delete(id);
      }
    },
    [patchAttachment]
  );

  /** Worker: pick up newly selected attachments without relying on setState updater side effects. */
  useEffect(() => {
    if (!conversationId) return;
    const convId = conversationId;
    const epoch = uploadEpochRef.current;
    for (const item of attachments) {
      if (item.status !== 'selected' || !item.file) continue;
      if (uploadInFlightRef.current.has(item.clientAttachmentId)) continue;
      void runUpload(convId, item, item.file, epoch);
    }
  }, [attachments, conversationId, runUpload]);

  const applyOpenResources = useCallback((events: OpenResourceEvent[]) => {
    if (!events.length) return;
    let sawDraftUpdate = false;
    setTabs((prev) => {
      let next = prev;
      let active = activeTabId;
      for (const ev of events) {
        const r = openFromEvent(next, ev);
        next = r.tabs;
        active = r.activeTabId;
        if (ev.resourceType === 'application_draft') {
          if (ev.operation === 'updated') {
            sawDraftUpdate = true;
            setBoundDraft((bd) =>
              bd && bd.draftId === ev.resourceId
                ? { ...bd, version: ev.version ?? bd.version, title: ev.title || bd.title }
                : bd
            );
          } else {
            setBoundDraft({
              draftId: ev.resourceId,
              title: ev.title,
              version: ev.version,
            });
          }
        }
        if (ev.operation === 'updated') {
          next = next.map((t) =>
            t.resourceType === ev.resourceType && t.resourceId === ev.resourceId
              ? { ...t, version: ev.version ?? t.version, title: ev.title || t.title }
              : t
          );
        }
      }
      setActiveTabId(active);
      setDocsCollapsed(false);
      setMobilePane('docs');
      saveDocTabsPref(next, active);
      return next;
    });
    if (sawDraftUpdate) setDraftSyncTick((n) => n + 1);
  }, [activeTabId]);

  const openDraftMeta = useCallback(
    (draftId: string, meta?: { title?: string; version?: number; formKey?: string; status?: string }) => {
      applyOpenResources([
        {
          type: 'open_resource',
          resourceType: 'application_draft',
          resourceId: draftId,
          title: meta?.title || '草稿',
          version: meta?.version,
          operation: 'opened',
          formKey: meta?.formKey,
          status: meta?.status,
        },
      ]);
    },
    [applyOpenResources]
  );

  const loadConversation = useCallback(
    (opts?: { conversationId?: string | null; forceNew?: boolean }) => {
      const gen = ++bootGen.current;
      start(async () => {
        setError(null);
        const boot = await bootstrapAssistantConversation({
          conversationId: opts?.conversationId,
          forceNew: opts?.forceNew,
        });
        if (gen !== bootGen.current) return;
        if (!boot.ok) {
          setError(boot.error);
          return;
        }
        setConversationId(boot.conversationId);
        setTitle(boot.title);
        setMessages(
          boot.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            toolsUsed: m.toolsUsed,
            blocks: m.blocks,
            createdAt: m.createdAt,
          }))
        );
        setHasOlder(boot.hasOlder);
        try {
          sessionStorage.setItem(CONV_PREF, boot.conversationId);
        } catch {
          /* ignore */
        }
      });
    },
    []
  );

  useEffect(() => {
    let preferred: string | null = null;
    try {
      setSidebarCollapsed(loadSidebarCollapsedPref(SIDEBAR_PREF_USER));
      preferred = sessionStorage.getItem(CONV_PREF);
      const bound = sessionStorage.getItem(BOUND_DRAFT_PREF);
      if (bound) {
        const parsed = JSON.parse(bound) as { draftId: string; title: string; version?: number };
        if (parsed?.draftId) setBoundDraft(parsed);
      }
      const pref = loadDocTabsPref();
      if (pref.order.length) {
        const restored: DocTab[] = pref.order.map((o) => ({
          tabId: tabKey(o.resourceType, o.resourceId),
          resourceType: o.resourceType,
          resourceId: o.resourceId,
          title: o.title,
          loadState: 'loading',
          saveState: 'clean',
        }));
        setTabs(restored);
        setActiveTabId(pref.activeKey ?? restored[0]?.tabId ?? null);
      }
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('c');
    loadConversation({ conversationId: fromUrl || preferred });
    void getAiChatStatus().then((s) => setStatusMeta({ model: s.model, ok: s.ok && s.enabled }));
  }, [loadConversation]);

  useEffect(() => {
    try {
      if (boundDraft) sessionStorage.setItem(BOUND_DRAFT_PREF, JSON.stringify(boundDraft));
      else sessionStorage.removeItem(BOUND_DRAFT_PREF);
    } catch {
      /* ignore */
    }
  }, [boundDraft]);

  function handleIntent(intent: string) {
    if (intent === 'open_draft_library') {
      const r = openDraftLibraryTab(tabs);
      setTabs(r.tabs);
      setActiveTabId(r.activeTabId);
      setDocsCollapsed(false);
      setMobilePane('docs');
      return;
    }
    if (intent === 'view_pending' || intent === 'view_mine') {
      start(async () => {
        const res = await getAssistantInboxAction();
        if (!res.ok) {
          setInboxHint('待辦載入失敗，請稍後重試。（不是「沒有待辦」）');
          return;
        }
        const items = intent === 'view_pending' ? res.inbox.pendingApprovals : res.inbox.myInProgress;
        if (res.inbox.loadError) {
          setInboxHint('待辦載入失敗，請稍後重試。（不是「沒有待辦」）');
          return;
        }
        if (items.length === 0) {
          setInboxHint(intent === 'view_pending' ? '目前沒有待簽核事項。' : '目前沒有進行中的送件。');
          return;
        }
        const lines = items
          .slice(0, 8)
          .map((i) => `· ${i.label}（${i.caseNumber}）`)
          .join('\n');
        setInboxHint(`${intent === 'view_pending' ? '待簽核' : '送件進度'}：\n${lines}`);
      });
      return;
    }
    if (intent === 'create_form') {
      setInput('我想建立一張新單據，請列出我可填寫的表單。');
      inputRef.current?.focus();
    }
  }

  function closeTab(tabId: string) {
    const tab = tabs.find((t) => t.tabId === tabId);
    if (tab?.saveState === 'dirty' || tab?.saveState === 'error') {
      if (!window.confirm('此文件尚未儲存或儲存失敗。關閉將可能遺失未存內容，仍要關閉？')) return;
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.tabId !== tabId);
      const nextActive =
        activeTabId === tabId ? (next[next.length - 1]?.tabId ?? null) : activeTabId;
      setActiveTabId(nextActive);
      saveDocTabsPref(next, nextActive);
      if (next.length === 0) setMobilePane('chat');
      return next;
    });
  }

  function removeAttachment(clientAttachmentId: string) {
    const item = attachmentsRef.current.find((a) => a.clientAttachmentId === clientAttachmentId);
    uploadInFlightRef.current.delete(clientAttachmentId);
    setAttachments((prev) => prev.filter((a) => a.clientAttachmentId !== clientAttachmentId));
    if (item?.stagedId) {
      pendingPurgeRef.current.push(item.stagedId);
      setPurgeTick((n) => n + 1);
    }
  }

  function retryAttachment(clientAttachmentId: string) {
    if (!conversationId) return;
    const item = attachmentsRef.current.find((a) => a.clientAttachmentId === clientAttachmentId);
    if (!item?.file) return;
    uploadInFlightRef.current.delete(clientAttachmentId);
    patchAttachment(clientAttachmentId, { status: 'selected', error: undefined });
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    if (!conversationId) {
      setError('請先開啟對話再上傳圖片。');
      return;
    }
    const picked = [...fileList];
    // Show strip as「壓縮處理中」first so upload worker does NOT race with downscale
    // (a 13MB original must not be staged before optimize finishes).
    const { candidates: rawCandidates, invalid } = buildImageCandidates(picked, newClientId);
    const processing = rawCandidates.map((c) => ({ ...c, status: 'processing' as const }));
    const { accepted: provisional, overLimit } = planAcceptedAttachments(
      attachmentsRef.current.length,
      processing
    );
    for (const unused of processing.slice(provisional.length)) {
      try {
        URL.revokeObjectURL(unused.previewUrl);
      } catch {
        /* ignore */
      }
    }
    if (provisional.length === 0) {
      setError(
        `無法加入選取的檔案（僅 JPEG/PNG/WebP/HEIC/PDF、單檔 ≤ ${formatBytes(AI_CHAT_IMAGE_MAX_BYTES)}、最多 ${AI_CHAT_IMAGE_MAX_COUNT} 張）。`
      );
      return;
    }
    setError(null);
    setAttachments((prev) => {
      const { accepted: take } = planAcceptedAttachments(prev.length, provisional);
      if (take.length === 0) return prev;
      const existing = new Set(prev.map((a) => a.clientAttachmentId));
      const unique = take.filter((a) => !existing.has(a.clientAttachmentId));
      return unique.length ? [...prev, ...unique] : prev;
    });
    if (invalid > 0 || overLimit > 0) {
      setError(
        `部分檔案未加入（僅 JPEG/PNG/WebP/HEIC/PDF、單檔 ≤ ${formatBytes(AI_CHAT_IMAGE_MAX_BYTES)}、最多 ${AI_CHAT_IMAGE_MAX_COUNT} 張）。`
      );
    }

    try {
      const { optimizeImageForUpload } = await import('@/lib/attachments/client-image-optimize');
      for (const item of provisional) {
        if (!item.file) continue;
        const { file: next, optimized, originalBytes, outputBytes } = await optimizeImageForUpload(
          item.file
        );
        const stillThere = attachmentsRef.current.some(
          (a) => a.clientAttachmentId === item.clientAttachmentId && a.status === 'processing'
        );
        if (!stillThere) continue;
        const previewUrl = optimized ? URL.createObjectURL(next) : item.previewUrl;
        const oldPreview = item.previewUrl;
        patchAttachment(item.clientAttachmentId, {
          status: 'selected',
          file: next,
          fileName: next.name,
          mimeType: next.type || item.mimeType,
          sizeBytes: next.size,
          previewUrl,
        });
        if (optimized && previewUrl !== oldPreview) {
          try {
            URL.revokeObjectURL(oldPreview);
          } catch {
            /* ignore */
          }
          if (originalBytes > outputBytes) {
            console.info(
              '[ai-chat] optimized',
              item.fileName,
              `${originalBytes}→${outputBytes}`
            );
          }
        }
      }
    } catch (err) {
      console.warn('[ai-chat] image optimize failed; uploading originals:', err);
      for (const item of provisional) {
        patchAttachment(item.clientAttachmentId, { status: 'selected' });
      }
    }
  }

  function onSend() {
    if (!conversationId || pending) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const blocking = attachments.filter((a) => !canSendToModel(a.status));
    if (blocking.length > 0) {
      const failed = blocking.filter((a) => a.status === 'failed');
      if (failed.length > 0) {
        setError(`有 ${failed.length} 張圖片失敗，請重試或移除後再傳送訊息。`);
      } else {
        setError('圖片仍在上傳與檢查中，就緒後即可傳送訊息。');
      }
      return;
    }
    const stagedAttachmentIds = attachments
      .filter((a) => canSendToModel(a.status) && a.stagedId)
      .map((a) => a.stagedId!);
    const attachableNow = attachments
      .filter((a) => a.stagedId && canAttachToDraft(a.status))
      .map((a) => a.stagedId!);
    const draftTargetId =
      boundDraft?.draftId ??
      (activeTab?.resourceType === 'application_draft' ? activeTab.resourceId : null);
    const draftTargetVersion =
      boundDraft?.version ??
      (activeTab?.resourceType === 'application_draft' ? activeTab.version : undefined) ??
      1;
    const clientMessageId = newClientId();
    const optimistic: UiMessage = {
      id: clientMessageId,
      role: 'user',
      text: text || `（上傳 ${attachments.length} 張圖片）`,
    };
    setMessages((prev) => [...prev, optimistic]);
    setError(null);
    const expectedConversation = conversationId;
    const keptAttachments = attachments;
    const keptInput = input;
    const attachIntent = wantsDraftAttach(text);
    start(async () => {
      // Copy checked files onto the draft in the browser — do not wait for the model tool.
      let attachedOk = false;
      if (attachIntent) {
        if (!draftTargetId) {
          setError('請先開啟右側草稿，再夾帶檔案。');
        } else {
          const fromHistory = stagedIdsFromMessageBlocks(messages);
          const stagedIds = [...new Set([...attachableNow, ...fromHistory])];
          if (stagedIds.length === 0) {
            setError('沒有已檢查完成的檔案可夾入。請先上傳圖片並等就緒。');
          } else {
            const attached = await attachStagedFilesToDraftAction({
              draftId: draftTargetId,
              expectedVersion: draftTargetVersion >= 1 ? draftTargetVersion : 1,
              stagedIds,
              confirmReminders: false,
            });
            if (attached.ok) {
              attachedOk = true;
              setBoundDraft((prev) =>
                prev && prev.draftId === attached.draft.id
                  ? { ...prev, version: attached.draft.version }
                  : prev
              );
              setTabs((prev) =>
                prev.map((t) =>
                  t.resourceType === 'application_draft' && t.resourceId === attached.draft.id
                    ? { ...t, version: attached.draft.version }
                    : t
                )
              );
              setDrawerRefresh((n) => n + 1);
              setMobilePane('docs');
            } else if (attached.error === 'confirmation_required') {
              setError(attached.message ?? '請先在圖片上確認「仍要夾帶」再夾入草稿。');
            } else if (attached.error !== 'version_conflict') {
              setError(attached.message ?? attached.error);
            }
          }
        }
      }

      const result = await sendAiChatMessage({
        message: text,
        clientMessageId,
        conversationId: expectedConversation,
        stagedAttachmentIds,
      });
      if (bootGen.current && expectedConversation !== conversationId) {
        // Stale response for a previous conversation — ignore UI open side-effects.
      }
      if (!result.ok) {
        setError(result.error);
        setMessages((prev) => prev.filter((m) => m.id !== clientMessageId));
        setInput(keptInput);
        setAttachments(keptAttachments);
        return;
      }
      if (result.conversationId !== expectedConversation) return;
      setInput('');
      // Clear strip after attach / send so the composer stays usable.
      // Keep only unresolved business-reminder cards when attach did not complete.
      if (attachedOk) {
        setAttachments([]);
      } else {
        setAttachments((prev) => prev.filter((a) => a.status === 'needs_confirm'));
      }
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== clientMessageId);
        return [
          ...withoutOptimistic,
          {
            id: result.userMessageId,
            role: 'user',
            text: optimistic.text,
            blocks: stagedAttachmentIds.map((id, i) => ({
              kind: 'attachment_status' as const,
              id: `staged_${id}`,
              fileName: keptAttachments.find((a) => a.stagedId === id)?.fileName ?? `檔案 ${i + 1}`,
              state: 'ready' as const,
              detail: `staged:${id}`,
            })),
          },
          {
            id: result.modelMessageId,
            role: 'model',
            text: result.reply,
            toolsUsed: result.toolsUsed,
            blocks: result.blocks,
          },
        ];
      });
      if (result.openResources.length) applyOpenResources(result.openResources);
      // Always poke the open draft panel after a chat turn — open_resource can be
      // missing when the model only describes/patches without emitting events,
      // and CustomForm must remount from DB data.
      setDraftSyncTick((n) => n + 1);
      setDrawerRefresh((n) => n + 1);
    });
  }

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;
  const showDocs = tabs.length > 0 && !docsCollapsed;

  const openDraftLibrary = () => {
    const r = openDraftLibraryTab(tabs);
    setTabs(r.tabs);
    setActiveTabId(r.activeTabId);
    setDocsCollapsed(false);
    setMobilePane('docs');
  };

  return (
    <main className="flex h-[calc(100vh-4rem)] w-full max-w-none flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-row gap-0">
        <ConversationSidebar
          collapsed={sidebarCollapsed}
          onCollapsedChange={(collapsed) => {
            setSidebarCollapsed(collapsed);
            saveSidebarCollapsedPref(SIDEBAR_PREF_USER, collapsed);
          }}
          mobileOpen={mobileDrawerOpen}
          onMobileOpenChange={setMobileDrawerOpen}
          activeId={conversationId}
          refreshKey={drawerRefresh}
          onSelect={(id) => {
            bootGen.current += 1;
            loadConversation({ conversationId: id });
          }}
          onNew={() => {
            setMobileDrawerOpen(false);
            start(async () => {
              const res = await createConversationAction();
              if (!res.ok) {
                setError(res.error);
                return;
              }
              bootGen.current += 1;
              loadConversation({ conversationId: res.conversationId });
              setDrawerRefresh((n) => n + 1);
            });
          }}
          onOpenDraftLibrary={openDraftLibrary}
        />

        <div className="flex min-w-0 flex-1 flex-col px-3 pt-3 sm:px-4">
      <header className="mb-3 flex flex-wrap items-center gap-2 border-b border-td-border pb-3">
        <button
          type="button"
          className="btn-secondary text-sm md:hidden"
          aria-expanded={mobileDrawerOpen}
          onClick={() => setMobileDrawerOpen(true)}
        >
          對話清單
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-td-blue-dark">{title}</h1>
        {docsCollapsed && tabs.length > 0 && (
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setDocsCollapsed(false)}
          >
            顯示文件
          </button>
        )}
      </header>

      <div className="mb-2 flex gap-2 md:hidden">
        <button
          type="button"
          className={mobilePane === 'chat' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setMobilePane('chat')}
        >
          對話
        </button>
        <button
          type="button"
          className={mobilePane === 'docs' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setMobilePane('docs')}
          disabled={tabs.length === 0}
        >
          文件{tabs.length ? `（${tabs.length}）` : ''}
        </button>
      </div>

      <div className={`flex min-h-0 flex-1 gap-0 ${showDocs ? '' : ''}`}>
        <section
          className={`flex min-w-0 flex-col ${showDocs ? 'md:w-[min(100%,calc(100%-320px))]' : 'w-full'} ${
            mobilePane === 'chat' ? 'flex' : 'hidden md:flex'
          }`}
          style={showDocs ? { flex: '1 1 auto', maxWidth: `calc(100% - ${docsWidth}px)` } : undefined}
        >
          <div className="mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-td-border bg-white">
            {hasOlder && conversationId && messages[0] && (
              <button
                type="button"
                className="border-b border-td-border px-3 py-2 text-xs text-td-blue underline"
                onClick={() => {
                  const first = messages[0]!;
                  start(async () => {
                    const res = await loadOlderMessagesAction({
                      conversationId,
                      beforeCreatedAt: first.createdAt || new Date().toISOString(),
                      beforeId: first.id,
                    });
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    setHasOlder(res.hasOlder);
                    setMessages((prev) => [
                      ...res.messages.map((m) => ({
                        id: m.id,
                        role: m.role,
                        text: m.text,
                        toolsUsed: m.toolsUsed,
                        blocks: m.blocks,
                        createdAt: m.createdAt,
                      })),
                      ...prev,
                    ]);
                  });
                }}
              >
                載入更早訊息
              </button>
            )}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((m) => (
                <article
                  key={m.id}
                  className={`max-w-4xl rounded-xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'ml-auto bg-td-blue text-white'
                      : m.role === 'system'
                        ? 'bg-td-blue-light/50 text-td-blue-dark'
                        : 'bg-slate-50 text-td-blue-dark'
                  }`}
                >
                  <SafeMarkdown text={m.text} />
                  {m.toolsUsed && m.toolsUsed.length > 0 && (
                    <p className="mt-1 text-[10px] opacity-70">工具：{m.toolsUsed.join('、')}</p>
                  )}
                  {m.blocks && conversationId && (
                    <MessageBlocks
                      blocks={m.blocks}
                      conversationId={conversationId}
                      boundDraftId={boundDraft?.draftId ?? null}
                      boundDraftVersion={boundDraft?.version ?? null}
                      onDraftOpened={openDraftMeta}
                      onOpenResources={applyOpenResources}
                      onIntent={handleIntent}
                    />
                  )}
                </article>
              ))}
              {inboxHint && (
                <div className="max-w-4xl whitespace-pre-wrap rounded-xl border border-td-border bg-white px-3 py-2 text-sm">
                  {inboxHint}
                </div>
              )}
              {pending && <p className="text-sm text-td-muted">助手處理中…</p>}
            </div>

            <div className="border-t border-td-border p-3">
              {boundDraft && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-td-blue-light/60 px-2 py-1 text-td-blue-dark">
                    AI 目標草稿：{boundDraft.title}
                  </span>
                  <button type="button" className="underline" onClick={() => setBoundDraft(null)}>
                    解除
                  </button>
                  {activeTab?.resourceType === 'application_draft' &&
                    activeTab.resourceId !== boundDraft.draftId && (
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          setBoundDraft({
                            draftId: activeTab.resourceId,
                            title: activeTab.title,
                            version: activeTab.version,
                          })
                        }
                      >
                        改以目前頁籤繼續
                      </button>
                    )}
                </div>
              )}
              <ImageAttachmentStrip
                items={attachments}
                draftId={
                  boundDraft?.draftId ??
                  (activeTab?.resourceType === 'application_draft' ? activeTab.resourceId : null)
                }
                draftVersion={
                  boundDraft?.version ??
                  (activeTab?.resourceType === 'application_draft' ? activeTab.version : null)
                }
                onRemove={removeAttachment}
                onRetry={retryAttachment}
                onConfirmed={(clientAttachmentId) =>
                  patchAttachment(clientAttachmentId, { status: 'confirmed' })
                }
                onAttachedToDraft={({ draftId, version, count }) => {
                  // Close the composer strip so the input stays usable.
                  if (count > 0) setAttachments([]);
                  setBoundDraft((prev) =>
                    prev && prev.draftId === draftId ? { ...prev, version } : prev
                  );
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.resourceType === 'application_draft' && t.resourceId === draftId
                        ? { ...t, version }
                        : t
                    )
                  );
                  setDrawerRefresh((n) => n + 1);
                  setMobilePane('docs');
                }}
              />
              {error && <p className="mb-2 text-sm text-amber-800">{error}</p>}
              {!statusMeta?.ok && (
                <p className="mb-2 text-xs text-td-muted">語言模型尚未就緒時仍可查看對話與草稿庫。</p>
              )}
              <div className="flex gap-2">
                <label className="btn-secondary cursor-pointer text-sm">
                  圖片
                  <input
                    type="file"
                    accept={AI_CHAT_IMAGE_ACCEPT}
                    className="hidden"
                    multiple
                    disabled={!conversationId || pending}
                    onChange={(e) => {
                      void onFilesSelected(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
                <textarea
                  ref={inputRef}
                  className="min-h-[44px] flex-1 resize-y rounded-lg border border-td-border px-3 py-2 text-sm"
                  rows={2}
                  value={input}
                  onChange={(e) => {
                    enterArmedRef.current = false;
                    setInput(e.target.value);
                  }}
                  onBlur={() => {
                    enterArmedRef.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                    if (e.shiftKey) return; // Shift+Enter keeps newline
                    e.preventDefault();
                    if (enterArmedRef.current) {
                      enterArmedRef.current = false;
                      onSend();
                    } else {
                      enterArmedRef.current = true;
                    }
                  }}
                  placeholder="輸入訊息…（按兩次 Enter 傳送）"
                  aria-label="訊息"
                  disabled={!conversationId || pending}
                />
                <button
                  type="button"
                  className="btn-primary self-end"
                  disabled={
                    !conversationId ||
                    pending ||
                    attachments.some((a) => a.status !== 'ready' && a.status !== 'failed') ||
                    (attachments.length > 0 && attachments.every((a) => a.status === 'failed'))
                  }
                  title={
                    attachments.some((a) => a.status !== 'ready' && a.status !== 'failed')
                      ? '請等待圖片上傳與檢查完成'
                      : undefined
                  }
                  onClick={onSend}
                >
                  {pending
                    ? '傳送中…'
                    : attachments.some((a) => a.status !== 'ready' && a.status !== 'failed')
                      ? '上傳中…'
                      : '傳送訊息'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {showDocs && (
          <>
            <div
              className="hidden w-1 cursor-col-resize bg-td-border md:block"
              role="separator"
              aria-orientation="vertical"
              aria-label="調整文件區寬度"
              onMouseDown={(e) => {
                dragRef.current = { startX: e.clientX, startW: docsWidth };
                const onMove = (ev: MouseEvent) => {
                  if (!dragRef.current) return;
                  const delta = dragRef.current.startX - ev.clientX;
                  setDocsWidth(Math.min(720, Math.max(280, dragRef.current.startW + delta)));
                };
                const onUp = () => {
                  dragRef.current = null;
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            />
            <aside
              className={`min-w-0 flex-col border border-td-border bg-white ${
                mobilePane === 'docs' ? 'flex' : 'hidden md:flex'
              }`}
              style={{ width: docsWidth, minWidth: 280 }}
              aria-label="文件工作區"
            >
              <div className="flex items-center gap-1 border-b border-td-border p-1" role="tablist">
                <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                  {tabs.map((t) => (
                    <div key={t.tabId} className="flex shrink-0 items-center">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={t.tabId === activeTabId}
                        className={`max-w-[10rem] truncate rounded px-2 py-1 text-xs ${
                          t.tabId === activeTabId ? 'bg-td-blue-light font-semibold' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => {
                          setActiveTabId(t.tabId);
                          saveDocTabsPref(tabs, t.tabId);
                        }}
                      >
                        {t.title}
                        {t.saveState === 'dirty' ? ' •' : ''}
                      </button>
                      <button
                        type="button"
                        className="px-1 text-td-muted"
                        aria-label={`關閉 ${t.title}`}
                        onClick={() => closeTab(t.tabId)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded px-2 py-1 text-xs text-td-muted hover:bg-slate-50"
                  aria-label="收合文件區"
                  title="收合文件區"
                  onClick={() => setDocsCollapsed(true)}
                >
                  »
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {activeTab?.resourceType === 'draft_library' && (
                  <DraftLibraryPanel
                    onOpenDraft={(d) =>
                      openDraftMeta(d.id, {
                        title: d.title,
                        version: d.version,
                        formKey: d.formKey,
                        status: d.status,
                      })
                    }
                  />
                )}
                {activeTab?.resourceType === 'application_draft' && (
                  <DraftPanel
                    draftId={activeTab.resourceId}
                    refreshKey={`${activeTab.version ?? 0}:${draftSyncTick}`}
                    allowRemoteRefresh={activeTab.saveState === 'clean'}
                    onDirtyChange={(dirty) =>
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.tabId === activeTab.tabId
                            ? { ...t, saveState: dirty ? 'dirty' : 'clean' }
                            : t
                        )
                      )
                    }
                    onLoadState={(state, err) =>
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.tabId === activeTab.tabId
                            ? {
                                ...t,
                                loadState: state,
                                errorMessage: err,
                              }
                            : t
                        )
                      )
                    }
                    onVersionChange={(draft) =>
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.tabId === activeTab.tabId
                            ? { ...t, version: draft.version, saveState: 'clean' }
                            : t
                        )
                      )
                    }
                    onSubmitted={(info) => {
                      applyOpenResources([
                        {
                          type: 'open_resource',
                          resourceType: 'form_submission',
                          resourceId: info.submissionId,
                          title: info.formNumber,
                          operation: 'submitted',
                          formKey: info.formKey,
                          status: 'submitted',
                        },
                      ]);
                      setTabs((prev) =>
                        prev
                          .filter((t) => t.tabId !== activeTab.tabId)
                          .concat({
                            tabId: tabKey('form_submission', info.submissionId),
                            resourceType: 'form_submission',
                            resourceId: info.submissionId,
                            title: info.formNumber,
                            formKey: info.formKey,
                            status: 'submitted',
                            loadState: 'ready',
                            saveState: 'clean',
                          })
                      );
                    }}
                  />
                )}
                {activeTab?.resourceType === 'form_submission' && (
                  <div className="space-y-2 p-4 text-sm">
                    <p className="font-medium text-td-blue-dark">單據已送出：{activeTab.title}</p>
                    {activeTab.formKey && (
                      <a
                        className="text-td-blue underline"
                        href={`/f/${activeTab.formKey}/${activeTab.resourceId}`}
                      >
                        開啟正式單據
                      </a>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
        </div>
      </div>
    </main>
  );
}
