'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DetailQueueNavigation } from '@/lib/applications/my-applications';

export function DetailQueueNavClient({
  currentId,
  currentCaseNumber,
  currentFormLabel,
  nav,
  secondaryBackHref,
  secondaryBackLabel,
}: {
  currentId: string;
  currentCaseNumber: string;
  currentFormLabel?: string;
  nav: DetailQueueNavigation;
  secondaryBackHref?: string;
  secondaryBackLabel?: string;
}) {
  const router = useRouter();
  const [openDropdown, setOpenDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(false);
      }
    }
    if (openDropdown) {
      document.addEventListener('mousedown', onClickOutside);
      return () => document.removeEventListener('mousedown', onClickOutside);
    }
  }, [openDropdown]);

  // Support Alt + Left / Alt + Right (or [ / ] when not typing in an input) for power users
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.altKey && e.key === 'ArrowLeft' && nav.prevItem) {
        e.preventDefault();
        router.push(nav.prevItem.href);
      } else if (e.altKey && e.key === 'ArrowRight' && nav.nextItem) {
        e.preventDefault();
        router.push(nav.nextItem.href);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nav.prevItem, nav.nextItem, router]);

  const isToApprove = nav.mode === 'to_approve';
  const isJustProcessed = nav.mode === 'just_processed';

  return (
    <nav
      aria-label="簽核與單據追蹤導覽列"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-2.5 shadow-2xs print:hidden"
    >
      {/* Left: Prominent Back to List Button + Queue Position Pill & Quick Switcher */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          href="/applications"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-1.5 text-xs font-bold text-td-blue-dark shadow-2xs transition hover:border-td-blue hover:bg-blue-50 hover:text-td-blue"
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>返回簽核與單據追蹤</span>
        </Link>

        {secondaryBackHref && secondaryBackLabel && (
          <Link
            href={secondaryBackHref}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs font-semibold text-td-blue transition hover:bg-blue-100/70"
          >
            ← {secondaryBackLabel}
          </Link>
        )}

        <span className="hidden text-slate-300 sm:inline">|</span>

        {/* Queue Status & Quick Jump Dropdown */}
        <div className="relative" ref={dropdownRef}>
          {nav.allItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpenDropdown((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                isToApprove
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100/80'
                  : isJustProcessed
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100/80'
                    : 'border-blue-200 bg-blue-50/70 text-td-blue-dark hover:bg-blue-100/70'
              }`}
              title="點擊展開清單快速切換單據"
            >
              <span>
                {isToApprove
                  ? `⏳ 待我簽核 · 第 ${nav.currentIndex} / ${nav.totalCount} 筆`
                  : isJustProcessed
                    ? `✅ 此單已處理 · 尚有 ${nav.totalCount} 筆待簽核`
                    : nav.currentIndex !== null
                      ? `📄 ${nav.queueTitle} · 第 ${nav.currentIndex} / ${nav.totalCount} 筆`
                      : `📄 ${nav.queueTitle}（共 ${nav.totalCount} 筆）`}
              </span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${openDropdown ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              {currentFormLabel ? `${currentFormLabel} · ` : ''}
              <span className="font-mono font-semibold text-td-blue-dark">{currentCaseNumber}</span>
            </span>
          )}

          {openDropdown && nav.allItems.length > 0 && (
            <div className="absolute left-0 top-full z-40 mt-1.5 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-xs">
                <span className="font-bold text-td-blue-dark">
                  {nav.queueTitle}（共 {nav.totalCount} 筆）
                </span>
                <span className="text-[11px] text-slate-500">點擊直接跳轉</span>
              </div>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {nav.allItems.map((item, idx) => {
                  const isCurrent = item.id === currentId;
                  return (
                    <li key={`${item.id}-${idx}`}>
                      <Link
                        href={item.href}
                        onClick={() => setOpenDropdown(false)}
                        className={`flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs transition ${
                          isCurrent
                            ? 'bg-blue-50/90 font-bold text-td-blue-dark'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded bg-slate-200/80 px-1 text-[10px] font-bold text-slate-700">
                              {idx + 1}
                            </span>
                            <span className="truncate font-semibold text-td-blue-dark">
                              {item.formLabel}
                            </span>
                            {item.applicantName && (
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.2 text-[10px] text-slate-600">
                                {item.applicantName}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 pl-6 font-mono text-[11px] text-slate-500">
                            <span>{item.caseNumber}</span>
                            <span>·</span>
                            <span>{item.categoryLabel}</span>
                          </div>
                        </div>
                        {isCurrent && (
                          <span className="shrink-0 rounded-full bg-td-blue px-2 py-0.5 text-[10px] font-bold text-white">
                            目前檢視
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Right: Explicit Prev / Next Item Navigation Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {nav.prevItem ? (
          <Link
            href={nav.prevItem.href}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-td-blue hover:bg-slate-50 hover:text-td-blue"
            title={`上一筆：${nav.prevItem.formLabel}（${nav.prevItem.caseNumber}）`}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span>上一筆</span>
            <span className="hidden max-w-[10rem] truncate text-[11px] font-normal text-slate-500 md:inline">
              ({nav.prevItem.formLabel} {nav.prevItem.caseNumber})
            </span>
          </Link>
        ) : (
          <span
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-slate-200 bg-slate-100/70 px-3 py-1.5 text-xs font-medium text-slate-400 select-none"
            title="目前已是清單第一筆"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span>上一筆（首筆）</span>
          </span>
        )}

        {nav.nextItem ? (
          <Link
            href={nav.nextItem.href}
            className="inline-flex items-center gap-1.5 rounded-lg bg-td-blue px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-td-blue-dark"
            title={`下一筆：${nav.nextItem.formLabel}（${nav.nextItem.caseNumber}）`}
          >
            <span>
              {isJustProcessed ? '下一筆待簽核' : '下一筆'}：{nav.nextItem.formLabel}
            </span>
            <span className="hidden rounded bg-white/20 px-1.5 py-0.2 font-mono text-[11px] sm:inline">
              {nav.nextItem.caseNumber}
            </span>
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.4}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ) : (
          <Link
            href="/applications"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
            title="已是清單最後一筆，點擊返回簽核與單據追蹤"
          >
            <span>✓ 已是最後一筆 · 返回清單</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
