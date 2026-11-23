'use client';

import { useEffect, useState } from 'react';
import {
  formatElapsedZh,
  stepElapsedMs,
  type ChatProgressStep,
} from '@/lib/ai-chat/progress';
import { useI18n } from '@/lib/i18n/context';

function formatLiveTenthsTimer(ms: number): string {
  const tenths = Math.max(1, Math.floor(ms / 100));
  const secs = (tenths / 10).toFixed(1);
  if (ms < 60_000) return `${secs}s`;
  const mins = Math.floor(ms / 60_000);
  const remSec = ((ms % 60_000) / 1000).toFixed(1);
  return `${mins}m ${remSec}s`;
}

function formatElapsedLocalized(ms: number, locale: 'zh-Hant' | 'en' | 'ja'): string {
  if (locale === 'zh-Hant') return formatElapsedZh(ms);
  const sec = Math.max(0, Math.round(ms / 1000));
  if (locale === 'en') {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

export function TurnProgressList({ steps }: { steps: ChatProgressStep[] }) {
  const { locale, tr } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const hasRunning = steps.some((s) => s.status === 'running');

  useEffect(() => {
    if (!hasRunning) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [hasRunning]);

  if (steps.length === 0) return null;

  const active =
    [...steps].reverse().find((s) => s.status === 'running') ??
    steps[steps.length - 1]!;
  const firstStartedAt = steps[0]?.startedAt ?? now;
  const totalElapsedMs = Math.max(100, now - firstStartedAt);
  const completedCount = steps.filter((s) => s.status === 'done').length;

  return (
    <div
      className="mr-auto w-full max-w-[42rem] rounded-2xl border border-indigo-200/80 bg-gradient-to-r from-white via-indigo-50/40 to-amber-50/30 p-3.5 shadow-xs"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {/* Claude-style animated starburst + orbital spinner */}
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
            {active.status === 'running' ? (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/30" />
                <span className="absolute inset-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 border-r-amber-500" />
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 animate-pulse text-amber-600"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 2L14.2 8.8L21 11L14.2 13.2L12 20L9.8 13.2L3 11L9.8 8.8L12 2Z" />
                </svg>
              </>
            ) : (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                ✓
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold text-slate-800">
                {tr(active.label)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <span>{active.status === 'running' ? tr('AI 分析執行中') : tr('分析步驟已完成')}</span>
              <span>·</span>
              <span>
                {locale === 'en'
                  ? `Step ${Math.min(steps.length, completedCount + 1)} / ${steps.length}`
                  : locale === 'ja'
                    ? `ステップ ${Math.min(steps.length, completedCount + 1)} / ${steps.length}`
                    : `步驟 ${Math.min(steps.length, completedCount + 1)} / ${steps.length}`}
              </span>
              {active.status === 'running' && (
                <span className="inline-flex items-center gap-0.5 pl-1">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.25s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.12s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-500" />
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-2.5 py-1 font-mono text-xs font-bold text-indigo-700 tabular-nums shadow-2xs">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                active.status === 'running'
                  ? 'animate-pulse bg-emerald-500'
                  : 'bg-emerald-600'
              }`}
            />
            <span>{formatLiveTenthsTimer(totalElapsedMs)}</span>
          </div>
          <span className="text-xs text-slate-400" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {/* Animated progress bar */}
      {active.status === 'running' && (
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/70">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-amber-500 transition-all duration-300"
            style={{
              width: `${Math.min(
                95,
                Math.max(18, ((completedCount + 1) / Math.max(2, steps.length)) * 75 + ((totalElapsedMs / 1000) % 3) * 5)
              )}%`,
            }}
          />
        </div>
      )}

      {expanded && (
        <ul className="mt-2.5 space-y-1 border-t border-indigo-100/80 pt-2">
          {steps.map((step) => {
            const showDetail = detailId === step.id;
            const hasDetail = Boolean(step.detail);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-xs text-td-blue-dark hover:bg-white/80 disabled:cursor-default"
                  disabled={!hasDetail}
                  onClick={() => setDetailId((id) => (id === step.id ? null : step.id))}
                  aria-expanded={showDetail}
                >
                  <span className="mt-0.5 shrink-0 font-bold text-indigo-600" aria-hidden>
                    {step.status === 'running' ? '●' : step.status === 'error' ? '!' : '✓'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{tr(step.label)}</span>
                    {showDetail && step.detail && (
                      <span className="mt-1 block whitespace-pre-wrap text-slate-500">
                        {step.detail}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-slate-500">
                    {formatElapsedLocalized(stepElapsedMs(step, now), locale)}
                  </span>
                  {hasDetail && (
                    <span className="shrink-0 text-slate-400" aria-hidden>
                      {showDetail ? '▾' : '▸'}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ClaudeThinkingFallback() {
  const { tr } = useI18n();
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);
    return () => window.clearInterval(t);
  }, [startedAt]);

  const sec = elapsedMs / 1000;
  const stageIdx = sec < 2.0 ? 0 : sec < 4.5 ? 1 : 2;
  const labels = [
    tr('正在解析您的問題與對話脈絡…'),
    tr('正在檢索表單規則與工具資料…'),
    tr('正在深度思考並整理結構化回覆…'),
  ];

  return (
    <div
      className="mr-auto w-full max-w-[42rem] rounded-2xl border border-indigo-200/80 bg-gradient-to-r from-white via-indigo-50/40 to-amber-50/30 p-3.5 shadow-xs"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/30" />
            <span className="absolute inset-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 border-r-amber-500" />
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 animate-pulse text-amber-600"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 2L14.2 8.8L21 11L14.2 13.2L12 20L9.8 13.2L3 11L9.8 8.8L12 2Z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-slate-800">
              {labels[stageIdx]}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <span>{tr('AI 助手思考分析中')}</span>
              <span className="inline-flex items-center gap-0.5 pl-1">
                <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.25s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.12s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-indigo-500" />
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-2.5 py-1 font-mono text-xs font-bold text-indigo-700 tabular-nums shadow-2xs">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span>{formatLiveTenthsTimer(elapsedMs)}</span>
        </div>
      </div>

      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/70">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-amber-500 transition-all duration-300"
          style={{
            width: `${Math.min(92, Math.max(20, (stageIdx + 1) * 28 + (sec % 3) * 4))}%`,
          }}
        />
      </div>
    </div>
  );
}

/** Merge a progress step into the timeline (replace same id). */
export function upsertProgressStep(
  prev: ChatProgressStep[],
  step: ChatProgressStep
): ChatProgressStep[] {
  const i = prev.findIndex((s) => s.id === step.id);
  if (i < 0) return [...prev, step];
  const next = prev.slice();
  next[i] = step;
  return next;
}
