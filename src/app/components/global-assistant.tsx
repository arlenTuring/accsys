'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  ackLauncherEventsAction,
  createConversationAction,
  pollLauncherEventsAction,
  sendAiChatMessage,
} from '@/lib/ai-chat/actions';
import type { LauncherEvent } from '@/lib/ai-chat/launcher-events';
import { SafeMarkdown } from '@/app/tools/ai-chat/safe-markdown';
import { usePathname } from 'next/navigation';

const MUTE_KEY = 'accsys.ai.launcher.muteUntil';
const CURSOR_KEY = 'accsys.ai.launcher.cursor';
const SEEN_CHANNEL = 'accsys-ai-launcher';
const FULL_PATH = '/tools/ai-chat';

type Props = {
  /** Only mount for authenticated app shell. */
  enabled: boolean;
};

/**
 * Compact global helper — one mount in the authenticated layout.
 * Driven by durable notifications; never polls the model for “anything new?”.
 */
export function GlobalAssistant({ enabled }: Props) {
  const pathname = usePathname();
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
  const cursorRef = useRef<string | null>(null);
  const inputFocused = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  /** First Enter arms send; second Enter sends. Typing / blur clears the arm. */
  const enterArmedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    try {
      const m = Number(sessionStorage.getItem(MUTE_KEY) || '0');
      setMutedUntil(m);
      cursorRef.current = sessionStorage.getItem(CURSOR_KEY);
    } catch {
      /* ignore */
    }
  }, [enabled]);

  const absorbEvents = useCallback((incoming: LauncherEvent[]) => {
    if (!incoming.length) return;
    // Multi-tab coordination via BroadcastChannel
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
      return merged.slice(-8);
    });
    setUnread((n) => n + incoming.length);
    // Do not steal focus while typing.
    if (!inputFocused.current && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      // Soft open only when collapsed and not muted.
      const mute = Number(sessionStorage.getItem(MUTE_KEY) || '0');
      if (Date.now() > mute) setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    let delay = 15_000;

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
      const res = await pollLauncherEventsAction({ cursorCreatedAt: cursorRef.current });
      if (!cancelled && res.ok) {
        if (res.nextCursor) {
          cursorRef.current = res.nextCursor;
          try {
            sessionStorage.setItem(CURSOR_KEY, res.nextCursor);
          } catch {
            /* ignore */
          }
        }
        if (res.events.length) absorbEvents(res.events);
        delay = 15_000;
      } else {
        delay = Math.min(delay * 1.5, 90_000);
      }
      timer = window.setTimeout(tick, delay);
    }

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
        if (data?.type === 'events' && data.keys?.length) {
          // Another tab already surfaced these — still show in list but don't bump unread hard.
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
    setEvents((prev) => prev.filter((e) => !keys.includes(e.eventKey)));
    setUnread(0);
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

  // Hide on login and while already inside the full assistant workspace.
  if (!enabled || pathname === '/login' || pathname?.startsWith('/tools/ai-chat')) return null;

  const muted = Date.now() < mutedUntil;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 pb-[env(safe-area-inset-bottom)]">
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="pointer-events-auto w-[min(100vw-2rem,22rem)] rounded-2xl border border-td-border bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-td-border px-3 py-2">
            <h2 id={titleId} className="text-sm font-semibold text-td-blue-dark">
              ACCSYS 小助手
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs underline"
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
                靜音 1 小時
              </button>
              <button type="button" className="text-xs underline" onClick={() => setOpen(false)}>
                收合
              </button>
            </div>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto p-3 text-sm">
            {muted && <p className="text-xs text-td-muted">已暫時靜音主動提醒。</p>}
            {events.length === 0 && replies.length === 0 && (
              <p className="text-td-muted">沒有新的主動提醒。可問短問題，或進入完整助手。</p>
            )}
            {events.map((ev) => (
              <div key={ev.eventKey} className="rounded-lg border border-td-border px-2 py-2">
                <p className="font-medium text-td-blue-dark">{ev.title}</p>
                {ev.kind !== 'digest' && (
                  <p className="mt-0.5 text-xs text-td-muted whitespace-pre-wrap">
                    {ev.caseNumber ? `${ev.caseNumber} · ` : ''}
                    {ev.body}
                  </p>
                )}
                {ev.kind === 'digest' && ev.items && ev.items.length > 0 && (
                  <ul className="mt-1 space-y-2">
                    {ev.items.map((item) => (
                      <li key={item.eventKey} className="rounded border border-td-border/70 bg-slate-50 px-2 py-1.5 text-xs">
                        <p className="font-medium text-td-blue-dark">{item.title}</p>
                        <p className="mt-0.5 text-td-muted whitespace-pre-wrap">
                          {item.caseNumber ? `${item.caseNumber} · ` : ''}
                          {item.body}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {item.href && (
                            <Link
                              href={item.href}
                              className="underline"
                              onClick={() => dismiss([item.eventKey, ev.eventKey], 'viewed')}
                            >
                              查看單據
                            </Link>
                          )}
                          <button
                            type="button"
                            className="underline"
                            onClick={() => {
                              dismiss([item.eventKey, ev.eventKey], 'viewed');
                              ensureConversation((id) => {
                                window.location.href = `${FULL_PATH}?c=${encodeURIComponent(id)}`;
                              });
                            }}
                          >
                            在助手處理
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {ev.kind !== 'digest' && ev.href && (
                    <Link href={ev.href} className="underline" onClick={() => dismiss([ev.eventKey], 'viewed')}>
                      查看
                    </Link>
                  )}
                  {ev.kind !== 'digest' && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        dismiss([ev.eventKey], 'viewed');
                        ensureConversation((id) => {
                          window.location.href = `${FULL_PATH}?c=${encodeURIComponent(id)}`;
                        });
                      }}
                    >
                      繼續處理
                    </button>
                  )}
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      dismiss(
                        ev.kind === 'digest' && ev.items
                          ? [ev.eventKey, ...ev.items.map((i) => i.eventKey)]
                          : [ev.eventKey],
                        'dismissed'
                      )
                    }
                  >
                    稍後
                  </button>
                </div>
              </div>
            ))}
            {replies.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg px-2 py-1 text-xs ${
                  m.role === 'user' ? 'bg-td-blue text-white' : 'bg-slate-50'
                }`}
              >
                <SafeMarkdown text={m.text} />
              </div>
            ))}
            {error && <p className="text-xs text-amber-800">{error}</p>}
            {pending && <p className="text-xs text-td-muted">處理中…</p>}
          </div>

          <div className="space-y-2 border-t border-td-border p-3">
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-td-border px-2 py-1.5 text-sm"
                value={input}
                onChange={(e) => {
                  enterArmedRef.current = false;
                  setInput(e.target.value);
                }}
                onFocus={() => {
                  inputFocused.current = true;
                }}
                onBlur={() => {
                  inputFocused.current = false;
                  enterArmedRef.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (enterArmedRef.current) {
                    enterArmedRef.current = false;
                    sendQuick();
                  } else {
                    enterArmedRef.current = true;
                  }
                }}
                placeholder="簡短提問…（按兩次 Enter 傳送）"
                aria-label="小助手訊息"
              />
              <button type="button" className="btn-primary text-sm" disabled={pending} onClick={sendQuick}>
                送出
              </button>
            </div>
            <Link
              href={conversationId ? `${FULL_PATH}?c=${encodeURIComponent(conversationId)}` : FULL_PATH}
              className="block text-center text-xs font-medium text-td-blue underline"
              onClick={() => {
                if (conversationId) {
                  try {
                    sessionStorage.setItem('accsys.ai.activeConversation', conversationId);
                  } catch {
                    /* ignore */
                  }
                }
              }}
            >
              在完整助手繼續
            </Link>
          </div>
        </div>
      )}

      <button
        type="button"
        className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full border border-td-border bg-white text-sm font-semibold text-td-blue-dark shadow-md"
        aria-label={open ? '收合小助手' : '開啟小助手'}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setUnread(0);
        }}
      >
        AI
        {unread > 0 && !open && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}

/** Prefetch nothing on login pages — layout gates with enabled. */
export function GlobalAssistantHost({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <GlobalAssistant enabled />;
}
