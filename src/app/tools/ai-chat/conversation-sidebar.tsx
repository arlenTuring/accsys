'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  archiveConversationAction,
  listConversationsAction,
  renameConversationAction,
} from '@/lib/ai-chat/actions';

type Item = { id: string; title: string; updatedAt: string };

type Props = {
  /** Desktop: docked. Mobile overlay when mobileOpen. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Expanded rail width in px (ignored while collapsed). */
  width?: number;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  refreshKey?: number;
};

const COLLAPSE_PREF = 'accsys.ai.sidebarCollapsed';
const WIDTH_PREF = 'accsys.ai.sidebarWidth';
export const SIDEBAR_WIDTH_DEFAULT = 208;
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 420;

export function loadSidebarCollapsedPref(employeeKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(`${COLLAPSE_PREF}:${employeeKey}`) === '1';
  } catch {
    return false;
  }
}

export function saveSidebarCollapsedPref(employeeKey: string, collapsed: boolean) {
  try {
    sessionStorage.setItem(`${COLLAPSE_PREF}:${employeeKey}`, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function loadSidebarWidthPref(employeeKey: string): number {
  if (typeof window === 'undefined') return SIDEBAR_WIDTH_DEFAULT;
  try {
    const raw = sessionStorage.getItem(`${WIDTH_PREF}:${employeeKey}`);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
    return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

export function saveSidebarWidthPref(employeeKey: string, width: number) {
  try {
    sessionStorage.setItem(`${WIDTH_PREF}:${employeeKey}`, String(Math.round(width)));
  } catch {
    /* ignore */
  }
}

export function ConversationSidebar({
  collapsed,
  onCollapsedChange,
  width = SIDEBAR_WIDTH_DEFAULT,
  mobileOpen,
  onMobileOpenChange,
  activeId,
  onSelect,
  onNew,
  refreshKey = 0,
}: Props) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<{ updatedAt: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(reset: boolean, cursor?: { updatedAt: string; id: string } | null) {
    start(async () => {
      const res = await listConversationsAction({
        query: query.trim() || undefined,
        cursorUpdatedAt: reset ? null : cursor?.updatedAt,
        cursorId: reset ? null : cursor?.id,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setNextCursor(res.nextCursor);
    });
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    const t = window.setTimeout(() => load(true), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [mobileOpen, onMobileOpenChange]);

  const list = (
    <>
      <div className="space-y-2 border-b border-td-border p-3">
        <button type="button" className="btn-primary w-full text-base" onClick={onNew}>
          新對話
        </button>
        <label className="block text-sm text-td-muted">
          搜尋對話
          <input
            ref={searchRef}
            className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="對話名稱"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {error && <p className="px-2 text-base text-amber-800">{error}</p>}
        {pending && items.length === 0 && <p className="px-2 text-base text-td-muted">載入中…</p>}
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <ConversationRow
                item={item}
                active={item.id === activeId}
                onSelect={() => {
                  onSelect(item.id);
                  onMobileOpenChange(false);
                }}
                onRenamed={(title) =>
                  setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, title } : x)))
                }
                onArchived={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
              />
            </li>
          ))}
        </ul>
        {nextCursor && (
          <button
            type="button"
            className="mt-2 w-full text-base text-td-blue underline"
            onClick={() => load(false, nextCursor)}
          >
            載入更多
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop docked rail */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-slate-200/80 bg-[#f8f9fb] md:flex ${
          collapsed ? 'w-12' : ''
        }`}
        style={collapsed ? undefined : { width: `${width}px` }}
        aria-label="對話側欄"
      >
        <div className="flex h-14 items-center justify-between gap-1 border-b border-slate-200/70 px-3">
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-extrabold italic tracking-wide text-td-blue-dark">
                  TURING DRIVE
                </span>
                <span className="rounded bg-td-blue/10 px-1.5 py-0.5 text-[10px] font-bold text-td-blue">
                  ACCSYS
                </span>
              </div>
              <h2 id={titleId} className="truncate text-[11px] font-semibold text-slate-500">
                AI 助手 · 對話紀錄
              </h2>
            </div>
          )}
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-td-blue-dark"
            aria-label={collapsed ? '展開側欄' : '收合側欄'}
            title={collapsed ? '展開' : '收合'}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        {collapsed ? (
          <nav className="flex flex-col items-center gap-1 p-2" aria-label="側欄捷徑">
            <IconBtn label="新對話" onClick={onNew}>
              ✎
            </IconBtn>
            <IconBtn
              label="搜尋對話"
              onClick={() => {
                onCollapsedChange(false);
                window.setTimeout(() => searchRef.current?.focus(), 50);
              }}
            >
              ⌕
            </IconBtn>
          </nav>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{list}</div>
        )}
      </aside>

      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="flex-1 bg-black/30"
            aria-label="關閉對話清單"
            onClick={() => onMobileOpenChange(false)}
          />
          <aside className="flex h-full w-full max-w-sm flex-col border-l border-td-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-td-border px-4 py-3">
              <h2 id={titleId} className="text-base font-semibold text-td-blue-dark">
                對話清單
              </h2>
              <button type="button" className="btn-secondary text-base" onClick={() => onMobileOpenChange(false)}>
                關閉
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{list}</div>
          </aside>
        </div>
      )}
    </>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-10 items-center justify-center rounded-lg text-lg hover:bg-white"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ConversationRow({
  item,
  active,
  onSelect,
  onRenamed,
  onArchived,
}: {
  item: Item;
  active: boolean;
  onSelect: () => void;
  onRenamed: (title: string) => void;
  onArchived: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(item.title);

  return (
    <div
      className={`rounded-lg border px-2 py-2 ${
        active ? 'border-td-blue bg-td-blue-light/40' : 'border-transparent hover:bg-white'
      }`}
    >
      {renaming ? (
        <form
          className="flex gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await renameConversationAction({ conversationId: item.id, title });
            if (res.ok) {
              onRenamed(res.title);
              setRenaming(false);
            }
          }}
        >
          <input
            className="flex-1 rounded border border-td-border px-2 py-1 text-base"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="對話名稱"
            autoFocus
          />
          <button type="submit" className="text-base text-td-blue">
            存
          </button>
        </form>
      ) : (
        <div className="flex items-start gap-1">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
            <div className="truncate text-base font-medium text-td-blue-dark">{item.title || '對話'}</div>
            <div className="text-sm text-td-muted">
              {new Date(item.updatedAt).toLocaleString('zh-TW', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </button>
          <button
            type="button"
            className="px-1 text-td-muted"
            aria-label="對話選單"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            ⋯
          </button>
        </div>
      )}
      {menu && !renaming && (
        <div className="mt-1 flex gap-2 text-base">
          <button
            type="button"
            className="underline"
            onClick={() => {
              setMenu(false);
              setRenaming(true);
            }}
          >
            重新命名
          </button>
          <button
            type="button"
            className="underline text-amber-800"
            onClick={async () => {
              if (!window.confirm('封存此對話？草稿與單據不會刪除。')) return;
              const res = await archiveConversationAction({ conversationId: item.id });
              if (res.ok) onArchived();
              setMenu(false);
            }}
          >
            封存
          </button>
        </div>
      )}
    </div>
  );
}
