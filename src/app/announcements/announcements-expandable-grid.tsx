'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acknowledgeAction, markReadAction } from '@/lib/announcements/actions';
import { formatBytesLabel } from '@/lib/attachments/policy';
import type { AnnouncementFileItem } from './announcement-files';

export type ExpandableAnnouncementItem = {
  id: string;
  title: string;
  body: string;
  category: string;
  status: string;
  priority: string;
  pinned: boolean;
  audienceLabel: string;
  dateLabel: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  files: AnnouncementFileItem[];
};

const PRIORITY_STYLE: Record<string, { label: string; badge: string; ring: string }> = {
  urgent: {
    label: '緊急公告',
    badge: 'bg-rose-100 text-rose-800 border-rose-200',
    ring: 'border-rose-300',
  },
  important: {
    label: '重要公告',
    badge: 'bg-amber-100 text-amber-900 border-amber-200',
    ring: 'border-amber-300',
  },
  normal: {
    label: '一般公告',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    ring: 'border-td-border',
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  general: '一般行政',
  hr: '人資福委',
  finance: '財會稅務',
  it: '資訊安全',
  security: '資訊安全',
  event: '活動福委',
  facility: '總務廠務',
  policy: '制度規章',
};

type SavedRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

function toSavedRect(r: DOMRect): SavedRect {
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    centerX: r.left + r.width / 2,
    centerY: r.top + r.height / 2,
  };
}

export function AnnouncementsExpandableGrid({
  items,
  initialExpandedId,
}: {
  items: ExpandableAnnouncementItem[];
  initialExpandedId?: string | null;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.readAt).map((i) => i.id))
  );
  const [ackIds, setAckIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.acknowledgedAt).map((i) => i.id))
  );
  const [filter, setFilter] = useState<'all' | 'unread' | 'pinned'>('all');
  const [pendingAckId, setPendingAckId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const prevRectsRef = useRef<Map<string, SavedRect>>(new Map());
  const prevToolbarTopRef = useRef<number | null>(null);
  const shouldCenterOnExpandRef = useRef<boolean>(Boolean(initialExpandedId));

  // Auto-mark as read when a card is expanded
  useEffect(() => {
    if (!expandedId) return;
    if (readIds.has(expandedId)) return;
    setReadIds((prev) => new Set(prev).add(expandedId));
    startTransition(async () => {
      await markReadAction(expandedId);
    });
  }, [expandedId, readIds]);

  const filteredItems = items.filter((item) => {
    if (filter === 'unread') return !readIds.has(item.id);
    if (filter === 'pinned') return item.pinned;
    return true;
  });

  // Reorder the expanded card to the start of its 3-column row so there are never empty grid holes
  const orderedItems = (() => {
    if (!expandedId) return filteredItems;
    const idx = filteredItems.findIndex((i) => i.id === expandedId);
    if (idx === -1) return filteredItems;
    const rowStart = Math.floor(idx / 3) * 3;
    if (idx === rowStart) return filteredItems;
    const next = [...filteredItems];
    const [picked] = next.splice(idx, 1);
    next.splice(rowStart, 0, picked);
    return next;
  })();

  const unreadCount = items.filter((i) => !readIds.has(i.id)).length;
  const pinnedCount = items.filter((i) => i.pinned).length;

  function captureCurrentPositions() {
    const map = new Map<string, SavedRect>();
    for (const [id, el] of cardRefs.current.entries()) {
      if (el && el.isConnected) {
        map.set(id, toSavedRect(el.getBoundingClientRect()));
      }
    }
    prevRectsRef.current = map;
    if (toolbarRef.current) {
      prevToolbarTopRef.current = toolbarRef.current.getBoundingClientRect().top;
    }
  }

  function handleSelectCard(id: string | null) {
    captureCurrentPositions();
    const nextId = expandedId === id ? null : id;
    shouldCenterOnExpandRef.current = nextId !== null;
    setAnimatingId(nextId ?? expandedId);
    setExpandedId(nextId);
  }

  // FLIP animation + synchronous viewport centering before paint
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    const shouldCenter = shouldCenterOnExpandRef.current;
    shouldCenterOnExpandRef.current = false;

    // Step 1: If a card is expanded, center it vertically inside the scroll container before measuring final FLIP rects
    if (shouldCenter && expandedId) {
      const targetEl = cardRefs.current.get(expandedId);
      if (targetEl) {
        // Cancel any in-flight Web Animations on the target before measuring its layout box
        for (const anim of targetEl.getAnimations()) {
          anim.cancel();
        }
        const scrollParent = targetEl.closest('.overflow-y-auto') as HTMLElement | null;
        const rect = targetEl.getBoundingClientRect();

        if (scrollParent) {
          const parentRect = scrollParent.getBoundingClientRect();
          const cardCenterY = rect.top + rect.height / 2;
          const viewportCenterY = parentRect.top + parentRect.height / 2;
          // If the card is taller than 82% of the viewport, align top with a comfortable margin
          const deltaY =
            rect.height > parentRect.height * 0.82
              ? rect.top - parentRect.top - 28
              : cardCenterY - viewportCenterY;
          scrollParent.scrollTop = Math.max(0, scrollParent.scrollTop + deltaY);
        } else {
          const viewportCenterY = window.innerHeight / 2;
          const cardCenterY = rect.top + rect.height / 2;
          const deltaY =
            rect.height > window.innerHeight * 0.82
              ? rect.top - 28
              : cardCenterY - viewportCenterY;
          window.scrollBy({ top: deltaY, behavior: 'instant' as ScrollBehavior });
        }
      }
    }

    if (prevRects.size === 0) return;

    // Step 2: Animate toolbar smoothly if scroll position shifted
    if (toolbarRef.current && prevToolbarTopRef.current !== null) {
      for (const anim of toolbarRef.current.getAnimations()) {
        anim.cancel();
      }
      const newTop = toolbarRef.current.getBoundingClientRect().top;
      const dy = prevToolbarTopRef.current - newTop;
      if (Math.abs(dy) > 1) {
        toolbarRef.current.animate(
          [{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
          { duration: 400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
      }
    }

    // Step 3: FLIP animate every card from its old screen rect to its new centered/grid rect
    for (const [id, el] of cardRefs.current.entries()) {
      if (!el || !el.isConnected) continue;
      const oldRect = prevRects.get(id);
      if (!oldRect) continue;

      for (const anim of el.getAnimations()) {
        anim.cancel();
      }

      const newRect = toSavedRect(el.getBoundingClientRect());
      const dx = oldRect.centerX - newRect.centerX;
      const dy = oldRect.centerY - newRect.centerY;
      const sx = oldRect.width / Math.max(newRect.width, 1);
      const sy = oldRect.height / Math.max(newRect.height, 1);

      const isTarget = id === expandedId || id === animatingId;
      if (
        Math.abs(dx) < 1 &&
        Math.abs(dy) < 1 &&
        Math.abs(sx - 1) < 0.01 &&
        Math.abs(sy - 1) < 0.01
      ) {
        continue;
      }

      const animation = el.animate(
        [
          {
            transformOrigin: 'center center',
            transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
            opacity: id === expandedId ? 0.92 : 1,
          },
          {
            transformOrigin: 'center center',
            transform: 'translate3d(0, 0, 0) scale(1, 1)',
            opacity: 1,
          },
        ],
        {
          duration: isTarget ? 420 : 360,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }
      );

      if (id === animatingId) {
        animation.onfinish = () => setAnimatingId(null);
      }
    }

    prevRectsRef.current = new Map();
    prevToolbarTopRef.current = null;
  }, [expandedId, filter]);

  function handleAcknowledge(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (ackIds.has(id) || pendingAckId === id) return;
    setPendingAckId(id);
    startTransition(async () => {
      await acknowledgeAction(id);
      setAckIds((prev) => new Set(prev).add(id));
      setReadIds((prev) => new Set(prev).add(id));
      setPendingAckId(null);
      router.refresh();
    });
  }

  const activeOriginalIndex = expandedId
    ? filteredItems.findIndex((i) => i.id === expandedId)
    : -1;
  const prevItem =
    activeOriginalIndex > 0 ? filteredItems[activeOriginalIndex - 1] : null;
  const nextItem =
    activeOriginalIndex >= 0 && activeOriginalIndex < filteredItems.length - 1
      ? filteredItems[activeOriginalIndex + 1]
      : null;

  return (
    <div className={`space-y-5 ${expandedId ? 'pb-[26vh]' : 'pb-10'}`}>
      {/* Filter Pills */}
      <div
        ref={toolbarRef}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              captureCurrentPositions();
              setFilter('all');
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === 'all'
                ? 'bg-td-blue-dark text-white shadow-2xs'
                : 'bg-white text-td-text ring-1 ring-td-border hover:bg-slate-50'
            }`}
          >
            全部公告 ({items.length})
          </button>
          <button
            type="button"
            onClick={() => {
              captureCurrentPositions();
              setFilter('unread');
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === 'unread'
                ? 'bg-td-blue text-white shadow-2xs'
                : unreadCount > 0
                  ? 'bg-blue-50 text-td-blue ring-1 ring-blue-200 hover:bg-blue-100/70'
                  : 'bg-white text-td-text ring-1 ring-td-border hover:bg-slate-50'
            }`}
          >
            未讀 ({unreadCount})
          </button>
          {pinnedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                captureCurrentPositions();
                setFilter('pinned');
              }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                filter === 'pinned'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100/70'
              }`}
            >
              📌 置頂 ({pinnedCount})
            </button>
          )}
        </div>

        <p className="text-xs text-td-muted">
          點擊任意小卡會自動展開並置中顯示；再點其他小卡可無縫切換放大對象
        </p>
      </div>

      {orderedItems.length === 0 ? (
        <div className="card py-12 text-center text-sm text-td-muted">
          目前沒有符合條件的公司公告。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orderedItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const isAnimating = animatingId === item.id;
            const isRead = readIds.has(item.id);
            const isAck = ackIds.has(item.id);
            const prio = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.normal;
            const catLabel = CATEGORY_LABEL[item.category] ?? item.category;

            return (
              <article
                key={item.id}
                ref={(el) => {
                  if (el) {
                    cardRefs.current.set(item.id, el);
                  } else {
                    cardRefs.current.delete(item.id);
                  }
                }}
                role={isExpanded ? undefined : 'button'}
                tabIndex={isExpanded ? undefined : 0}
                onClick={isExpanded ? undefined : () => handleSelectCard(item.id)}
                onKeyDown={
                  isExpanded
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectCard(item.id);
                        }
                      }
                }
                className={
                  isExpanded
                    ? `relative z-20 col-span-1 mx-auto my-2 w-full max-w-4xl overflow-hidden rounded-2xl border-2 border-td-blue bg-white shadow-2xl ring-4 ring-td-blue/10 will-change-transform md:col-span-2 lg:col-span-3`
                    : `group relative ${
                        isAnimating ? 'z-10' : 'z-0'
                      } col-span-1 flex cursor-pointer flex-col justify-between rounded-2xl border bg-white p-5 text-left shadow-2xs transition-shadow duration-200 will-change-transform hover:-translate-y-0.5 hover:border-td-blue/60 hover:shadow-md ${
                        !isRead
                          ? 'border-l-4 border-l-td-blue border-t-td-border border-r-td-border border-b-td-border bg-blue-50/15'
                          : prio.ring
                      }`
                }
              >
                {isExpanded ? (
                  <>
                    {/* Top Banner */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-blue-50/80 via-slate-50 to-white px-6 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.pinned && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">
                            📌 置頂
                          </span>
                        )}
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${prio.badge}`}
                        >
                          {prio.label}
                        </span>
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                          {catLabel}
                        </span>
                        <span className="text-xs text-td-muted">
                          發布日期：{item.dateLabel} · 對象：{item.audienceLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {prevItem && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCard(prevItem.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-td-blue/50 hover:text-td-blue"
                            title={`上一則：${prevItem.title}`}
                          >
                            ← 上一則
                          </button>
                        )}
                        {nextItem && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCard(nextItem.id);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-td-blue/50 hover:text-td-blue"
                            title={`下一則：${nextItem.title}`}
                          >
                            下一則 →
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectCard(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          <span>收合卡片 ✕</span>
                        </button>
                      </div>
                    </div>

                    {/* Body Content */}
                    <div className="space-y-5 p-6 sm:p-7">
                      <h2 className="text-xl font-bold leading-snug text-td-blue-dark sm:text-2xl">
                        {item.title}
                      </h2>

                      <div className="whitespace-pre-wrap break-words rounded-xl bg-slate-50/70 p-5 text-base leading-relaxed text-td-blue-dark ring-1 ring-slate-100">
                        {item.body}
                      </div>

                      {/* Attachments */}
                      {item.files.length > 0 && (
                        <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white p-4">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-td-muted">
                            相關附件（{item.files.length}）
                          </h3>
                          <ul className="flex flex-wrap gap-2">
                            {item.files.map((f) => {
                              const ready =
                                f.scanStatus === 'clean' || f.scanStatus === 'unscanned';
                              return (
                                <li key={f.id}>
                                  {ready ? (
                                    <a
                                      href={`/api/announcements/${item.id}/attachments/${f.id}`}
                                      className="inline-flex items-center gap-2 rounded-lg border border-td-border bg-slate-50/70 px-3 py-2 text-xs font-semibold text-td-blue transition hover:border-td-blue hover:bg-blue-50/50"
                                    >
                                      <span>📎 {f.fileName}</span>
                                      <span className="text-[11px] font-normal text-td-muted">
                                        ({formatBytesLabel(f.fileSizeBytes)})
                                      </span>
                                    </a>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                      <span>{f.fileName}</span>
                                      <span className="text-[11px]">({f.scanStatus})</span>
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Bottom Action Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                            ✓ 已閱讀
                          </span>
                          {isAck && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-td-blue">
                              ✓ 已確認知悉
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {!isAck && (
                            <button
                              type="button"
                              disabled={pendingAckId === item.id}
                              onClick={(e) => handleAcknowledge(item.id, e)}
                              className="rounded-lg bg-td-blue px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-td-blue-dark disabled:opacity-50"
                            >
                              {pendingAckId === item.id ? '確認中…' : '✓ 我已知悉此公告'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2.5">
                      {/* Top Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.pinned && (
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                              📌 置頂
                            </span>
                          )}
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${prio.badge}`}
                          >
                            {prio.label}
                          </span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                            {catLabel}
                          </span>
                        </div>

                        {!isRead ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-td-blue px-2 py-0.5 text-[10px] font-bold text-white">
                            ● 未讀
                          </span>
                        ) : isAck ? (
                          <span className="text-[11px] font-medium text-emerald-700">
                            ✓ 已知悉
                          </span>
                        ) : (
                          <span className="text-[11px] text-td-muted">已讀</span>
                        )}
                      </div>

                      {/* Title */}
                      <h2 className="line-clamp-2 text-base font-bold text-td-blue-dark group-hover:text-td-blue">
                        {item.title}
                      </h2>

                      {/* Excerpt */}
                      <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-td-muted">
                        {item.body}
                      </p>
                    </div>

                    {/* Card Footer */}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-td-muted">
                      <div className="flex items-center gap-2">
                        <span>{item.dateLabel}</span>
                        {item.files.length > 0 && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                            📎 {item.files.length} 附件
                          </span>
                        )}
                      </div>
                      <span className="font-semibold text-td-blue group-hover:underline">
                        點擊展開 ⤢
                      </span>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
