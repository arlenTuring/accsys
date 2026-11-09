'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { QuickPrintButton } from '@/app/components/print-button';
import type {
  MyApplicationCategoryKey,
  MyApplicationItem,
  PendingApprovalRichItem,
} from '@/lib/applications/my-applications';
import {
  quickApproveFormAction,
  quickReturnFormAction,
} from '@/lib/applications/quick-actions';
import { useI18n } from '@/lib/i18n/context';
import { sealAmountLabel } from '@/lib/seal-requests/constants';

const CATEGORY_ACCENT: Record<
  MyApplicationCategoryKey,
  { dot: string; badge: string; border: string }
> = {
  procurement: {
    dot: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-800 border-sky-200',
    border: 'border-l-sky-500',
  },
  expense: {
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    border: 'border-l-indigo-500',
  },
  seal: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-900 border-amber-200',
    border: 'border-l-amber-500',
  },
  asset: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    border: 'border-l-emerald-500',
  },
  other: {
    dot: 'bg-slate-500',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    border: 'border-l-slate-400',
  },
};

/**
 * Streamlined, compact approval step pipeline with state above the progress ball.
 */
function StreamlinedStepPipeline({
  progress,
  highlightSelf,
}: {
  progress: MyApplicationItem['progress'];
  highlightSelf?: boolean;
}) {
  const { t, tr } = useI18n();
  const steps = progress?.steps ?? [];
  if (steps.length === 0) return null;

  const totalSteps = progress?.total ?? steps.length;
  const doneSteps = progress?.done ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200/70 bg-slate-50/60 px-2.5 py-1.5 text-xs">
      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 shadow-2xs ring-1 ring-slate-200/80">
        {t.approvalsPage.stepBadge(doneSteps, totalSteps)}
      </span>

      <ol className="flex min-w-[12rem] flex-1 items-start gap-0 overflow-x-auto">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const lineDone =
            step.state === 'done' && next && (next.state === 'done' || next.state === 'current');
          const linePartial = step.state === 'done' && next?.state === 'waiting';
          const lineReturnedLeft = step.state === 'returned' && i > 0;
          const lineReturnedRight = next?.state === 'returned';
          const stateText =
            step.state === 'done'
              ? '已簽'
              : step.state === 'current'
                ? '簽核中'
                : step.state === 'returned'
                  ? '已退回'
                  : '待簽';
          return (
            <li
              key={step.key}
              className="flex min-w-[4.25rem] flex-1 flex-col items-center text-center"
            >
              <span
                className={`mb-0.5 text-[10px] leading-none ${
                  step.state === 'current'
                    ? highlightSelf
                      ? 'font-semibold text-amber-700'
                      : 'font-semibold text-td-blue'
                    : step.state === 'done'
                      ? 'font-medium text-emerald-600'
                      : step.state === 'returned'
                        ? 'font-semibold text-rose-700'
                        : 'text-slate-400'
                }`}
              >
                {tr(stateText)}
              </span>
              <div className="flex w-full items-center">
                <div
                  className={`h-0.5 flex-1 ${
                    i === 0
                      ? 'bg-transparent'
                      : lineReturnedLeft
                        ? 'bg-rose-400'
                        : lineDone || linePartial
                          ? 'bg-emerald-500'
                          : 'bg-slate-200'
                  }`}
                  aria-hidden
                />
                <span
                  className={`relative z-[1] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    step.state === 'done'
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : step.state === 'current'
                        ? highlightSelf
                          ? 'border-2 border-amber-500 bg-white text-amber-600 ring-2 ring-amber-400/20'
                          : 'border-2 border-td-blue bg-white text-td-blue ring-2 ring-td-blue/15'
                        : step.state === 'returned'
                          ? 'border-rose-500 bg-rose-500 text-white'
                          : 'border-slate-300 bg-white text-slate-400'
                  }`}
                >
                  {step.state === 'done' ? (
                    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 5-5L12.6 5.1z"
                      />
                    </svg>
                  ) : step.state === 'returned' ? (
                    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M4.2 4.2 5.3 3.1 8 5.8l2.7-2.7 1.1 1.1L9.1 7l2.7 2.7-1.1 1.1L8 8.1 5.3 10.8 4.2 9.7 6.9 7z"
                      />
                    </svg>
                  ) : step.state === 'current' ? (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        highlightSelf ? 'bg-amber-500' : 'bg-td-blue'
                      }`}
                      aria-hidden
                    />
                  ) : null}
                </span>
                <div
                  className={`h-0.5 flex-1 ${
                    i === steps.length - 1
                      ? 'bg-transparent'
                      : lineReturnedRight
                        ? 'bg-rose-400'
                        : lineDone
                          ? 'bg-emerald-500'
                          : 'bg-slate-200'
                  }`}
                  aria-hidden
                />
              </div>
              <div className="mt-0.5 flex max-w-full flex-wrap items-baseline justify-center gap-x-1 px-0.5 leading-tight">
                {step.name && (
                  <span
                    className={`truncate text-xs font-medium ${
                      step.state === 'current'
                        ? 'text-td-blue-dark'
                        : step.state === 'done'
                          ? 'text-emerald-800'
                          : step.state === 'returned'
                            ? 'text-rose-800'
                            : 'text-td-muted'
                    }`}
                  >
                    {step.name}
                  </span>
                )}
                <span className="truncate text-[10px] text-td-muted">{tr(step.label)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function CollapsibleSection({
  variant = 'section',
  categoryKey,
  badgeText,
  badgeClass,
  title,
  countText,
  headerActions,
  defaultOpen = true,
  children,
}: {
  variant?: 'section' | 'group';
  categoryKey?: MyApplicationCategoryKey;
  badgeText?: string;
  badgeClass?: string;
  title: string;
  countText: string;
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);

  if (variant === 'group') {
    const accent = CATEGORY_ACCENT[categoryKey ?? 'other'] ?? CATEGORY_ACCENT.other;
    return (
      <div
        className={`overflow-hidden rounded-xl border border-td-border border-l-4 ${accent.border} bg-white shadow-2xs`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 bg-slate-50/70 px-4 py-2.5 text-left transition hover:bg-slate-100/70"
        >
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
            <span className="text-sm font-bold text-td-blue-dark">{title}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${accent.badge}`}
            >
              {countText}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-td-muted">
            <span>{open ? t.approvalsPage.collapseGroup : t.approvalsPage.expandGroup}</span>
            <svg
              className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </button>

        {open && <div className="divide-y divide-slate-100">{children}</div>}
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-td-border bg-white px-4 py-3 shadow-2xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 flex-wrap items-center gap-2.5 text-left"
        >
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          {badgeText && (
            <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${badgeClass ?? ''}`}>
              {badgeText}
            </span>
          )}
          <h2 className="text-base font-bold text-td-blue-dark">{title}</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            {countText}
          </span>
          <span className="ml-auto text-xs font-medium text-td-muted hover:text-td-blue">
            {open ? t.approvalsPage.collapseSection : t.approvalsPage.expandSection}
          </span>
        </button>

        {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
      </div>

      {open && <div className="space-y-3 pl-0 sm:pl-1.5">{children}</div>}
    </section>
  );
}

export function QuickPendingApprovalRow({ item }: { item: PendingApprovalRichItem }) {
  const router = useRouter();
  const { t, tr } = useI18n();
  const [phase, setPhase] = useState<
    'idle' | 'approving' | 'returning' | 'approved' | 'returned'
  >('idle');
  const [showReturnInput, setShowReturnInput] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const busy = phase === 'approving' || phase === 'returning';

  async function handleApprove() {
    if (busy) return;
    setPhase('approving');
    setError(null);
    const res = await quickApproveFormAction(
      item.formType,
      item.id,
      item.version ?? undefined
    );
    if (!res.ok) {
      setPhase('idle');
      setError(res.error);
      return;
    }
    setPhase('approved');
    router.refresh();
  }

  async function handleReturn() {
    if (busy) return;
    setPhase('returning');
    setError(null);
    const res = await quickReturnFormAction(
      item.formType,
      item.id,
      returnReason,
      item.version ?? undefined
    );
    if (!res.ok) {
      setPhase('idle');
      setError(res.error);
      return;
    }
    setPhase('returned');
    setShowReturnInput(false);
    router.refresh();
  }

  return (
    <div
      className={`space-y-1.5 px-3.5 py-2.5 transition ${
        phase === 'approved'
          ? 'bg-emerald-50/40'
          : phase === 'returned'
            ? 'bg-rose-50/40'
            : 'hover:bg-amber-50/15'
      }`}
    >
      {/* Top Row: Form Title + Case Number + Applicant + Summary vs Amount + Actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-td-blue-dark">{tr(item.formLabel)}</span>
            <Link href={item.href} className="mono-case text-xs hover:underline">
              {item.caseNumber}
            </Link>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-td-blue-dark">
              {t.approvalsPage.applicantPrefix}
              {item.applicantName}
            </span>
            {item.waitingFor && (
              <span className="text-xs text-td-muted">
                {t.approvalsPage.waitingForPrefix(item.waitingFor)}
              </span>
            )}
          </div>

          {item.summary && <p className="text-sm text-td-text">{item.summary}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {item.totalAmount !== null && item.totalAmount > 0 && (
            <span className="text-base font-bold text-td-blue-dark">
              {sealAmountLabel(item.totalAmount, item.currency)}
            </span>
          )}

          {phase === 'approved' ? (
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              {t.approvalsPage.approvedDone}
            </span>
          ) : phase === 'returned' ? (
            <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700">
              {t.approvalsPage.returnedDone}
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={handleApprove}
                style={{ backgroundColor: '#059669', color: '#ffffff' }}
                className="btn-quick-approve inline-flex items-center gap-1 rounded-lg border border-emerald-700/20 bg-status-approved px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:opacity-95 disabled:opacity-50"
              >
                {phase === 'approving' ? t.approvalsPage.approving : t.approvalsPage.quickApprove}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowReturnInput((v) => !v)}
                className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
              >
                {t.approvalsPage.returnBtn}
              </button>
              <Link
                href={item.href}
                className="rounded-lg border border-td-border bg-white px-2.5 py-1.5 text-xs font-medium text-td-text transition hover:bg-slate-50"
              >
                {t.common.details}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Directly visible streamlined approval pipeline */}
      <StreamlinedStepPipeline progress={item.progress} highlightSelf />

      {/* Inline Return Input */}
      {showReturnInput && phase !== 'approved' && phase !== 'returned' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/70 p-2.5">
          <input
            type="text"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder={t.approvalsPage.returnReasonPlaceholder}
            className="min-w-[14rem] flex-1 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs focus:border-rose-400 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={handleReturn}
            className="rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {phase === 'returning' ? t.approvalsPage.returning : t.approvalsPage.confirmReturn}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowReturnInput(false)}
            className="px-2 py-1 text-xs text-slate-600 hover:underline"
          >
            {t.common.cancel}
          </button>
        </div>
      )}

      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}

export function CompactMyApplicationRow({ item }: { item: MyApplicationItem }) {
  const { t, tr } = useI18n();
  const rawStatusLabel = STATUS_LABELS[item.status] ?? item.status;

  return (
    <div
      className={`space-y-1.5 px-3.5 py-2.5 transition hover:bg-slate-50/60 ${
        item.status === 'returned' ? 'bg-rose-50/20' : ''
      }`}
    >
      {/* Top Row: Form Title + Case Number + Status + Summary vs Amount + Date + Actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-td-blue-dark">{tr(item.formLabel)}</span>
            <Link href={item.href} className="mono-case text-xs hover:underline">
              {item.caseNumber}
            </Link>
            <span className={STATUS_BADGE[item.status] ?? 'badge-withdrawn'}>
              {tr(rawStatusLabel)}
            </span>
            {item.status === 'pending_approval' && item.pendingApproverNames.length > 0 && (
              <span className="text-xs font-medium text-td-blue-dark">
                {t.approvalsPage.pendingApproversPrefix}
                {item.pendingApproverNames.join('、')}
              </span>
            )}
          </div>

          {item.summary && <p className="text-sm text-td-text">{item.summary}</p>}

          {item.status === 'returned' && (
            <div className="rounded-md border border-rose-200 bg-rose-50/80 px-3 py-1.5 text-xs text-rose-900">
              <span className="font-semibold">
                {t.approvalsPage.returnReasonPrefix}
                {item.returnedByName ? ` (${item.returnedByName})` : ''}:{' '}
              </span>
              <span>{item.returnReason || t.approvalsPage.defaultReturnHint}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {item.totalAmount !== null && item.totalAmount > 0 && (
            <span className="text-base font-bold text-td-blue-dark">
              {sealAmountLabel(item.totalAmount, item.currency)}
            </span>
          )}
          <span className="text-xs text-td-muted">{item.dateLabel}</span>
          {item.status === 'approved' && <QuickPrintButton href={item.href} size="sm" />}
          {item.editHref && (
            <Link
              href={item.editHref}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              {t.approvalsPage.editAndResubmit}
            </Link>
          )}
          <Link
            href={item.href}
            className="rounded-lg border border-td-border bg-white px-3 py-1.5 text-xs font-medium text-td-blue hover:bg-slate-50"
          >
            {t.common.viewDetails}
          </Link>
        </div>
      </div>

      {/* Directly visible streamlined approval pipeline */}
      <StreamlinedStepPipeline progress={item.progress} />
    </div>
  );
}
