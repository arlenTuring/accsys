'use client';

import { useEffect, useState } from 'react';
import {
  formatElapsedZh,
  stepElapsedMs,
  type ChatProgressStep,
} from '@/lib/ai-chat/progress';

export function TurnProgressList({ steps }: { steps: ChatProgressStep[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (!steps.some((s) => s.status === 'running')) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [steps]);

  if (steps.length === 0) return null;

  const active = [...steps].reverse().find((s) => s.status === 'running') ?? steps[steps.length - 1]!;

  return (
    <div className="mr-auto w-full max-w-[60rem] space-y-1" role="status" aria-live="polite">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-base text-td-muted hover:bg-slate-50"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span
          className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
            active.status === 'running'
              ? 'animate-spin border-td-border border-t-td-blue'
              : 'border-td-border border-t-emerald-600'
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{active.label}</span>
        <span className="shrink-0 tabular-nums text-sm">{formatElapsedZh(stepElapsedMs(active, now))}</span>
        <span className="shrink-0 text-td-muted" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <ul className="space-y-1 border-l border-td-border pl-3">
          {steps.map((step) => {
            const showDetail = detailId === step.id;
            const hasDetail = Boolean(step.detail);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-sm text-td-blue-dark hover:bg-slate-50 disabled:cursor-default"
                  disabled={!hasDetail}
                  onClick={() => setDetailId((id) => (id === step.id ? null : step.id))}
                  aria-expanded={showDetail}
                >
                  <span className="mt-0.5 shrink-0 text-td-muted" aria-hidden>
                    {step.status === 'running' ? '…' : step.status === 'error' ? '!' : '✓'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{step.label}</span>
                    {showDetail && step.detail && (
                      <span className="mt-1 block whitespace-pre-wrap text-td-muted">{step.detail}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-td-muted">
                    {formatElapsedZh(stepElapsedMs(step, now))}
                  </span>
                  {hasDetail && (
                    <span className="shrink-0 text-td-muted" aria-hidden>
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
