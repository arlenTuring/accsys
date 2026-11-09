'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  ackLauncherEventsAction,
  createConversationAction,
  pollLauncherEventsAction,
  sendAiChatMessage,
  startResubmissionAction,
} from '@/lib/ai-chat/actions';
import type { LauncherEvent } from '@/lib/ai-chat/launcher-events';
import { useI18n } from '@/lib/i18n/context';
import { SafeMarkdown } from '@/app/tools/ai-chat/safe-markdown';
import { usePathname } from 'next/navigation';

const MUTE_KEY = 'accsys.ai.launcher.muteUntil';
const SEEN_CHANNEL = 'accsys-ai-launcher';
/** One-time hand-over to the full assistant: a URL parameter would reopen the draft on every reload. */
const OPEN_DRAFT_KEY = 'accsys.ai.openDraft';
const FULL_PATH = '/tools/ai-chat';

type Props = {
  /** Only mount for authenticated app shell. */
  enabled: boolean;
};

/**
 * Compact global helper — placed in the bottom-left sidebar rail right above the employee account avatar.
 * Opens on mouse hover (or click) and stays open while interacting with the panel.
 */
export function GlobalAssistant({ enabled }: Props) {
  const pathname = usePathname();
  const { t } = useI18n();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [mutedUntil, setMutedUntil] = useState(0);
  const [events, setEvents] = useState<LauncherEvent[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [replies, setReplies] = useState<Array<{ id: string; role: 'user' | 'model'; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [unread, setUnread] = useState(0);
  const inputFocused = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimer = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const clearHoverClose = useCallback(() => {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    clearHoverClose();
    hoverCloseTimer.current = window.setTimeout(() => {
      if (!inputFocused.current) {
        setOpen(false);
      }
    }, 220);
  }, [clearHoverClose]);

  useEffect(() => {
    return () => clearHoverClose();
  }, [clearHoverClose]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!enabled) return;
    try {
      const m = Number(sessionStorage.getItem(MUTE_KEY) || '0');
      setMutedUntil(m);
    } catch {
      /* ignore */
    }
  }, [enabled]);

  const absorbEvents = useCallback((incoming: LauncherEvent[]) => {
    if (!incoming.length) return;
    try {
      const bc = new BroadcastChannel(SEEN_CHANNEL);
      bc.postMessage({ type: 'events', keys: incoming.map((e) => e.eventKey) });
      bc.close();
    } catch {
      /* ignore */
    }
    setEvents((prev) => {
      const keys = new Set(prev.map((e) => e.eventKey));
      const merged = [...prev];
      for (const e of incoming) {
        if (!keys.has(e.eventKey)) merged.push(e);
      }
      return merged;
    });
    const fresh = incoming.filter((e) => e.fresh).length;
    if (fresh === 0) return;
    setUnread((n) => n + fresh);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    let delay = 15_000;

    async function drain(scope: 'fresh' | 'delivered'): Promise<boolean> {
      let after: string | null = null;
      for (let page = 0; page < 25 && !cancelled; page++) {
        const res = await pollLauncherEventsAction({ scope, after });
        if (!res.ok) return false;
        if (res.events.length) absorbEvents(res.events);
        if (!res.hasMore) break;
        after = res.nextAfter;
      }
      return true;
    }

    async function tick() {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        delay = 60_000;
        timer = window.setTimeout(tick, delay);
        return;
      }
      const mute = Number(sessionStorage.getItem(MUTE_KEY) || '0');
      if (Date.now() < mute) {
        timer = window.setTimeout(tick, delay);
        return;
      }
      const ok = await drain('fresh').catch(() => false);
      delay = ok ? 15_000 : Math.min(delay * 1.5, 90_000);
      if (!cancelled) timer = window.setTimeout(tick, delay);
    }

    void drain('delivered').catch(() => false);
    timer = window.setTimeout(tick, 4_000);

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        delay = 5_000;
        window.clearTimeout(timer);
        timer = window.setTimeout(tick, 500);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(SEEN_CHANNEL);
      bc.onmessage = (ev) => {
        const data = ev.data as { type?: string; keys?: string[] };
        if (data?.type === 'ack' && data.keys?.length) {
          setEvents((prev) => prev.filter((e) => !data.keys!.includes(e.eventKey)));
        }
      };
    } catch {
      /* ignore */
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      bc?.close();
    };
  }, [enabled, absorbEvents]);

  function dismiss(keys: string[], state: 'viewed' | 'dismissed' | 'muted' = 'dismissed') {
    void ackLauncherEventsAction({ eventKeys: keys, state });
    try {
      const bc = new BroadcastChannel(SEEN_CHANNEL);
      bc.postMessage({ type: 'ack', keys });
      bc.close();
    } catch {
      /* ignore */
    }
    const left = events.filter((e) => !keys.includes(e.eventKey));
    setEvents(left);
    setUnread(0);
    if (left.length === 0 && replies.length === 0) setOpen(false);
  }

  function resubmit(ev: LauncherEvent) {
    start(async () => {
      const res = await startResubmissionAction({ submissionId: ev.formId! }).catch(() => null);
      if (!res || !res.ok) {
        setError(res?.error ?? '連線中斷，補件草稿沒有建立，請重試。');
        return;
      }
      dismiss([ev.eventKey], 'viewed');
      try {
        sessionStorage.setItem(OPEN_DRAFT_KEY, JSON.stringify({ draftId: res.draftId, title: res.title }));
      } catch {
        /* the draft is still listed in the conversation */
      }
      window.location.href = `${FULL_PATH}?c=${encodeURIComponent(res.conversationId)}`;
    });
  }

  function ensureConversation(then: (id: string) => void) {
    start(async () => {
      if (conversationId) {
        then(conversationId);
        return;
      }
      const created = await createConversationAction();
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setConversationId(created.conversationId);
      then(created.conversationId);
    });
  }

  function sendQuick() {
    const text = input.trim();
    if (!text) return;
    ensureConversation((id) => {
      const clientMessageId = crypto.randomUUID();
      setReplies((prev) => [...prev, { id: clientMessageId, role: 'user', text }]);
      setInput('');
      start(async () => {
        const res = await sendAiChatMessage({
          message: text,
          clientMessageId,
          conversationId: id,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setConversationId(res.conversationId);
        setReplies((prev) => [
          ...prev.filter((m) => m.id !== clientMessageId),
          { id: res.userMessageId, role: 'user', text },
          { id: res.modelMessageId, role: 'model', text: res.reply },
        ]);
      });
    });
  }

  if (!enabled || pathname === '/login') return null;

  const muted = Date.now() < mutedUntil;
  const badgeCount = unread > 0 ? unread : events.length;

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col items-center"
      onMouseEnter={() => {
        clearHoverClose();
        setOpen(true);
        setUnread(0);
      }}
      onMouseLeave={() => {
        scheduleHoverClose();
      }}
    >
      <button
        type="button"
        title={t.assistantWidget.hoverTooltip}
        className={`relative flex h-10 w-10 items-center justify-center rounded-full border text-xs font-extrabold transition ${
          open
            ? 'border-td-blue bg-td-blue text-white shadow-md'
            : 'border-slate-200/90 bg-white text-td-blue-dark shadow-xs hover:scale-105 hover:border-td-blue/60 hover:text-td-blue'
        }`}
        aria-label={t.assistantWidget.title}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setUnread(0);
        }}
      >
        AI
        {badgeCount > 0 && !open && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-2xs">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onMouseEnter={() => clearHoverClose()}
          onMouseLeave={() => scheduleHoverClose()}
          className="fixed bottom-16 left-16 z-50 w-[min(100vw-5rem,22rem)] rounded-2xl border border-td-border bg-white text-td-blue-dark shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-td-border px-3.5 py-2.5">
            <h2 id={titleId} className="text-sm font-bold text-td-blue-dark">
              {t.assistantWidget.title}
            </h2>
            <div className="flex gap-2.5">
              <button
                type="button"
                className="text-xs text-td-muted underline hover:text-td-blue-dark"
                onClick={() => {
                  const until = Date.now() + 60 * 60 * 1000;
                  setMutedUntil(until);
                  try {
                    sessionStorage.setItem(MUTE_KEY, String(until));
                  } catch {
                    /* ignore */
                  }
                  setOpen(false);
                }}
              >
                {t.assistantWidget.mute1h}
              </button>
              <button
                type="button"
                className="text-xs text-td-muted underline hover:text-td-blue-dark"
                onClick={() => setOpen(false)}
              >
                {t.assistantWidget.collapse}
              </button>
            </div>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto p-3 text-sm">
            {muted && <p className="text-xs text-td-muted">{t.assistantWidget.mutedNotice}</p>}
            {events.length === 0 && replies.length === 0 && (
              <p className="text-xs text-td-muted">{t.assistantWidget.emptyNotice}</p>
            )}
            {events.length > 0 && (
              <div className="flex items-center justify-between text-xs">
                <p className="font-semibold text-td-blue-dark">
                  {t.assistantWidget.remindersCount(events.length)}
                </p>
                {events.length > 1 && (
                  <button
                    type="button"
                    className="underline hover:text-td-blue"
                    onClick={() => dismiss(events.map((e) => e.eventKey), 'dismissed')}
                  >
                    {t.assistantWidget.dismissAllLater}
                  </button>
                )}
              </div>
            )}
            {[...events]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((ev) => (
                <div key={ev.eventKey} className="rounded-xl border border-td-border px-3 py-2.5">
                  <p className="font-semibold text-td-blue-dark">{ev.title}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-td-muted">{ev.body}</p>
                  {ev.reason && !ev.reason.missing && ev.reason.full !== ev.reason.short && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer underline">
                        {t.assistantWidget.viewFullReason}
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap">{ev.reason.full}</p>
                    </details>
                  )}
                  {ev.caseNumber && (
                    <p className="mt-0.5 text-[11px] text-td-muted">
                      {t.assistantWidget.caseNoPrefix} {ev.caseNumber}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2.5 text-xs">
                    {ev.canResubmit && ev.formId && (
                      <button
                        type="button"
                        className="font-semibold underline hover:text-td-blue"
                        disabled={pending}
                        onClick={() => resubmit(ev)}
                      >
                        {t.assistantWidget.resubmit}
                      </button>
                    )}
                    {ev.href && (
                      <Link
                        href={ev.href}
                        className="underline hover:text-td-blue"
                        onClick={() => {
                          dismiss([ev.eventKey], 'viewed');
                          setOpen(false);
                        }}
                      >
                        {t.assistantWidget.view}
                      </Link>
                    )}
                    <button
                      type="button"
                      className="underline hover:text-td-blue"
                      onClick={() => dismiss([ev.eventKey], 'dismissed')}
                    >
                      {t.assistantWidget.later}
                    </button>
                  </div>
                </div>
              ))}
            {replies.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg px-2.5 py-1.5 text-xs ${
                  m.role === 'user' ? 'bg-td-blue text-white' : 'bg-slate-50'
                }`}
              >
                <SafeMarkdown text={m.text} />
              </div>
            ))}
            {error && <p className="text-xs text-amber-800">{error}</p>}
            {pending && <p className="text-xs text-td-muted">{t.common.processing}</p>}
          </div>

          <div className="space-y-2 border-t border-td-border p-3">
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-td-border px-2.5 py-1.5 text-sm focus:border-td-blue focus:outline-none"
                value={input}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                  lastCompositionEndAtRef.current = performance.now();
                }}
                onChange={(e) => {
                  setInput(e.target.value);
                }}
                onFocus={() => {
                  inputFocused.current = true;
                  clearHoverClose();
                }}
                onBlur={() => {
                  inputFocused.current = false;
                  isComposingRef.current = false;
                }}
                onKeyDown={(e) => {
                  if (
                    e.key !== 'Enter' ||
                    e.nativeEvent.isComposing ||
                    isComposingRef.current ||
                    e.nativeEvent.keyCode === 229 ||
                    performance.now() - lastCompositionEndAtRef.current < 40
                  ) {
                    return;
                  }
                  e.preventDefault();
                  sendQuick();
                }}
                placeholder={t.assistantWidget.inputPlaceholder}
                aria-label={t.assistantWidget.title}
              />
              <button type="button" className="btn-primary text-sm" disabled={pending} onClick={sendQuick}>
                {t.assistantWidget.sendButton}
              </button>
            </div>
            <Link
              href={conversationId ? `${FULL_PATH}?c=${encodeURIComponent(conversationId)}` : FULL_PATH}
              className="block text-center text-xs font-medium text-td-blue underline"
              onClick={() => {
                setOpen(false);
                if (conversationId) {
                  try {
                    sessionStorage.setItem('accsys.ai.activeConversation', conversationId);
                  } catch {
                    /* ignore */
                  }
                }
              }}
            >
              {t.assistantWidget.continueInFull}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Legacy host export kept as no-op so nothing renders in the bottom-right corner. */
export function GlobalAssistantHost({ enabled: _enabled }: { enabled: boolean }) {
  return null;
}
