'use client';

import { useState } from 'react';
import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { QuickPrintButton } from '@/app/components/print-button';
import { getTrackingDocumentDetailAction } from '@/app/case-tracking/actions';
import type { MyApplicationCategoryKey } from '@/lib/applications/my-applications';
import type { CompanyApprovalTrackingItem } from '@/lib/case-tracking/all-documents';
import type { EmailApprovalDocumentSummary } from '@/lib/email/submission-detail-html';
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
    dot: 'bg-purple-500',
    badge: 'bg-purple-50 text-purple-800 border-purple-200',
    border: 'border-l-purple-500',
  },
};

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt);
}

function TrackingStepPipeline({
  progress,
}: {
  progress: CompanyApprovalTrackingItem['progress'];
}) {
  const { t, tr } = useI18n();
  const steps = progress?.steps ?? [];
  if (steps.length === 0) return null;

  const totalSteps = progress?.total ?? steps.length;
  const doneSteps = progress?.done ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs">
      <span className="shrink-0 rounded bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-2xs ring-1 ring-slate-200/90">
        {t.approvalsPage.stepBadge(doneSteps, totalSteps)}
      </span>

      <ol className="flex min-w-[14rem] flex-1 items-start gap-0 overflow-x-auto">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const lineDone =
            step.state === 'done' && next && (next.state === 'done' || next.state === 'current');
          const linePartial = step.state === 'done' && next?.state === 'waiting';
          const lineReturnedLeft = step.state === 'returned' && i > 0;
          const lineReturnedRight = next?.state === 'returned';
          const stateText =
            step.state === 'done'
              ? '已簽核'
              : step.state === 'current'
                ? '目前待簽'
                : step.state === 'returned'
                  ? '已退回'
                  : '待後續簽核';
          return (
            <li
              key={step.key}
              className="flex min-w-[4.75rem] flex-1 flex-col items-center text-center"
            >
              <span
                className={`mb-0.5 text-[10px] leading-none ${
                  step.state === 'current'
                    ? 'font-bold text-td-blue'
                    : step.state === 'done'
                      ? 'font-semibold text-emerald-600'
                      : step.state === 'returned'
                        ? 'font-bold text-rose-700'
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
                        ? 'border-2 border-td-blue bg-white text-td-blue ring-2 ring-td-blue/15'
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
                    <span className="h-1.5 w-1.5 rounded-full bg-td-blue" aria-hidden />
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
                    className={`truncate text-xs font-semibold ${
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

function ExpandedDocumentDetailPanel({
  item,
  detail,
  loading,
}: {
  item: CompanyApprovalTrackingItem;
  detail: EmailApprovalDocumentSummary | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-500">
        正在載入單據完整欄位內文與簽核軌跡紀錄…
      </div>
    );
  }

  const fields = detail?.fields ?? [];
  const tables = detail?.tables ?? [];
  const steps = detail?.steps ?? [];

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      {/* Read-only System Tracking Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200/80 bg-blue-50/70 px-3.5 py-2 text-xs text-blue-900">
        <div className="flex items-center gap-2 font-medium">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
            i
          </span>
          <span>
            系統紀錄追蹤檢視：以下為單據完整填報內文、品項明細與各關卡簽核軌跡（此頁面僅供管理追蹤查閱，不執行簽核操作）。
          </span>
        </div>
        <Link
          href={item.href}
          className="shrink-0 font-semibold text-td-blue hover:underline"
        >
          開啟獨立單據頁面 →
        </Link>
      </div>

      {/* 1. Document Fields Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700">
          📋 單據欄位內文明細（{item.formLabel} · {item.caseNumber}）
        </div>
        <div className="grid grid-cols-1 divide-y divide-slate-100 text-xs sm:grid-cols-2 sm:divide-y-0">
          <div className="flex border-b border-slate-100 px-3.5 py-2">
            <span className="w-32 shrink-0 font-semibold text-slate-500">申請部門</span>
            <span className="font-medium text-slate-900">
              {item.departmentName} ({item.departmentCode})
            </span>
          </div>
          <div className="flex border-b border-slate-100 px-3.5 py-2">
            <span className="w-32 shrink-0 font-semibold text-slate-500">申請人員</span>
            <span className="font-medium text-slate-900">{item.applicantName}</span>
          </div>
          <div className="flex border-b border-slate-100 px-3.5 py-2">
            <span className="w-32 shrink-0 font-semibold text-slate-500">申請日期</span>
            <span className="font-medium text-slate-900">{item.dateLabel}</span>
          </div>
          <div className="flex border-b border-slate-100 px-3.5 py-2">
            <span className="w-32 shrink-0 font-semibold text-slate-500">單據總金額</span>
            <span className="font-mono font-bold text-emerald-700">
              {item.totalAmount !== null && item.totalAmount > 0
                ? sealAmountLabel(item.totalAmount, item.currency)
                : detail?.totalAmountText ?? '—'}
            </span>
          </div>
          {fields
            .filter((f) => f.label !== '單據總金額')
            .map((f, idx) => (
              <div
                key={`${f.label}-${idx}`}
                className="flex border-b border-slate-100 px-3.5 py-2 sm:col-span-2"
              >
                <span className="w-32 shrink-0 font-semibold text-slate-500">{f.label}</span>
                <span className="whitespace-pre-wrap text-slate-800">{f.value}</span>
              </div>
            ))}
          {fields.length === 0 && item.summary && (
            <div className="flex border-b border-slate-100 px-3.5 py-2 sm:col-span-2">
              <span className="w-32 shrink-0 font-semibold text-slate-500">單據摘要說明</span>
              <span className="whitespace-pre-wrap text-slate-800">{item.summary}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Line-Item Tables */}
      {tables.map((tbl, tIdx) => (
        <div
          key={`${tbl.title}-${tIdx}`}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700">
            📑 {tbl.title}（共 {tbl.rows.length} 筆）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600">
                  <th className="w-10 px-3 py-2 text-center font-bold">#</th>
                  {tbl.headers.map((h, hIdx) => (
                    <th
                      key={`${h.label}-${hIdx}`}
                      className={`px-3 py-2 font-bold ${
                        h.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tbl.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 text-center text-slate-400">{rIdx + 1}</td>
                    {row.map((cell, cIdx) => {
                      const align = tbl.headers[cIdx]?.align ?? 'left';
                      return (
                        <td
                          key={cIdx}
                          className={`px-3 py-2 text-slate-800 ${
                            align === 'right' ? 'text-right font-mono' : 'text-left'
                          }`}
                        >
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {tbl.totalValue && (
                  <tr className="border-t border-slate-200 bg-slate-50/90 font-bold text-slate-900">
                    <td
                      colSpan={tbl.headers.length}
                      className="px-3 py-2 text-right text-slate-600"
                    >
                      {tbl.totalLabel ?? '合計'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">
                      {tbl.totalValue}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* 3. Approval Steps Audit Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700">
          🔄 簽核流程與各關卡簽核狀況紀錄
        </div>
        {steps.length === 0 ? (
          <div className="px-3.5 py-3 text-xs text-slate-500">尚無簽核關卡紀錄</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-slate-600">
                  <th className="w-20 px-3.5 py-2 font-bold">關卡順序</th>
                  <th className="px-3.5 py-2 font-bold">簽核關卡名稱</th>
                  <th className="px-3.5 py-2 font-bold">負責簽核人</th>
                  <th className="px-3.5 py-2 font-bold">簽核狀態</th>
                  <th className="px-3.5 py-2 font-bold">簽核時間</th>
                  <th className="px-3.5 py-2 font-bold">簽核意見／退回原因</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {steps.map((st) => {
                  const isApproved = st.status === 'approved' || st.status === 'auto_approved';
                  const isReturned = st.status === 'returned';
                  return (
                    <tr
                      key={st.stepOrder}
                      className={
                        st.isCurrent
                          ? 'bg-blue-50/60'
                          : isReturned
                            ? 'bg-rose-50/40'
                            : 'hover:bg-slate-50/50'
                      }
                    >
                      <td className="px-3.5 py-2 font-semibold text-slate-600">
                        第 {st.stepOrder} 關
                      </td>
                      <td className="px-3.5 py-2 font-semibold text-slate-900">
                        {st.stepLabel}
                      </td>
                      <td className="px-3.5 py-2 font-medium text-slate-800">
                        {st.approverName}
                      </td>
                      <td className="px-3.5 py-2">
                        {isApproved ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                            ✓ 已核准
                          </span>
                        ) : isReturned ? (
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">
                            ↩ 已退回
                          </span>
                        ) : st.isCurrent ? (
                          <span className="inline-flex items-center rounded-full border border-blue-300 bg-blue-100/80 px-2.5 py-0.5 text-[11px] font-bold text-blue-800">
                            ● 目前關卡（待簽核）
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
                            ○ 待後續簽核
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2 font-mono text-slate-600">
                        {st.actedAt
                          ? formatDateTime(st.actedAt)
                          : st.isCurrent
                            ? '待簽核處理中'
                            : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-slate-700">
                        {st.comment ? (
                          <span
                            className={
                              isReturned ? 'font-semibold text-rose-700' : 'text-slate-800'
                            }
                          >
                            {st.comment}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TrackingDocumentRow({
  item,
  forceExpanded,
}: {
  item: CompanyApprovalTrackingItem;
  forceExpanded?: boolean | null;
}) {
  const { t, tr } = useI18n();
  const [localOpen, setLocalOpen] = useState(false);
  const [detail, setDetail] = useState<EmailApprovalDocumentSummary | null>(item.detail);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const isOpen = forceExpanded !== null && forceExpanded !== undefined ? forceExpanded : localOpen;
  const rawStatusLabel = STATUS_LABELS[item.status] ?? item.status;
  const accent = CATEGORY_ACCENT[item.categoryKey] ?? CATEGORY_ACCENT.other;

  async function handleToggleExpand() {
    const nextOpen = !isOpen;
    setLocalOpen(nextOpen);
    if (nextOpen && !detail && !loadingDetail) {
      setLoadingDetail(true);
      try {
        const fetched = await getTrackingDocumentDetailAction(item.formType, item.id);
        if (fetched) setDetail(fetched);
      } finally {
        setLoadingDetail(false);
      }
    }
  }

  return (
    <div
      className={`space-y-2 px-4 py-3 transition ${
        item.status === 'returned'
          ? 'bg-rose-50/20'
          : isOpen
            ? 'bg-blue-50/15'
            : 'hover:bg-slate-50/70'
      }`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${accent.badge}`}
            >
              {tr(item.categoryLabel)}
            </span>
            <span className="text-sm font-bold text-td-blue-dark">{tr(item.formLabel)}</span>
            <Link href={item.href} className="mono-case text-xs hover:underline">
              {item.caseNumber}
            </Link>
            {item.procurementCaseNumber &&
              item.procurementCaseNumber !== item.caseNumber && (
                <Link
                  href={`/cases/${item.procurementCaseNumber}`}
                  className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:underline"
                  title="關聯採購案號"
                >
                  案號 {item.procurementCaseNumber}
                </Link>
              )}
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {item.departmentName}
            </span>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-td-blue-dark">
              申請人：{item.applicantName}
            </span>
            <span className={STATUS_BADGE[item.status] ?? 'badge-withdrawn'}>
              {tr(rawStatusLabel)}
            </span>
            {item.status === 'pending_approval' && item.pendingApproverNames.length > 0 && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
                目前待簽核：{item.pendingApproverNames.join('、')}
                {item.currentNodeLabel ? `（${item.currentNodeLabel}）` : ''}
              </span>
            )}
            {item.status === 'pending_approval' && item.waitingFor && (
              <span className="text-xs text-td-muted">
                {t.approvalsPage.waitingForPrefix(item.waitingFor)}
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

        {/* Right Side: Amount + Date + Expand Button + View Page */}
        <div className="flex flex-wrap items-center gap-2">
          {item.totalAmount !== null && item.totalAmount > 0 && (
            <span className="text-base font-bold text-td-blue-dark">
              {sealAmountLabel(item.totalAmount, item.currency)}
            </span>
          )}
          <span className="text-xs text-td-muted">{item.dateLabel}</span>

          <button
            type="button"
            onClick={() => void handleToggleExpand()}
            aria-expanded={isOpen}
            className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              isOpen
                ? 'border-td-blue bg-td-blue text-white shadow-2xs'
                : 'border-blue-200 bg-blue-50/70 text-td-blue-dark hover:bg-blue-100/70'
            }`}
          >
            <span>{isOpen ? '收合單據內文' : '展開內文與簽核明細'}</span>
            <svg
              className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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

          <QuickPrintButton href={item.href} size="sm" />

          <Link
            href={item.href}
            className="rounded-lg border border-td-border bg-white px-2.5 py-1.5 text-xs font-medium text-td-text hover:bg-slate-50"
          >
            單據頁
          </Link>
        </div>
      </div>

      {/* Streamlined Approval Pipeline */}
      <TrackingStepPipeline progress={item.progress} />

      {/* Expandable Full Inner Content & Step Audit Table */}
      {isOpen && (
        <ExpandedDocumentDetailPanel
          item={item}
          detail={detail}
          loading={loadingDetail}
        />
      )}
    </div>
  );
}

export function CaseTrackingClientList({
  items,
  groupedByCategory,
}: {
  items: CompanyApprovalTrackingItem[];
  groupedByCategory: Array<{
    categoryKey: MyApplicationCategoryKey;
    categoryLabel: string;
    items: CompanyApprovalTrackingItem[];
  }>;
}) {
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandAllDetails, setExpandAllDetails] = useState<boolean | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  function toggleCategory(catKey: string) {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catKey]: !prev[catKey],
    }));
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: View Mode + Expand All Inner Contents */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-td-border bg-white px-4 py-2.5 text-xs shadow-2xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-600">
          <span className="font-semibold text-td-blue-dark">
            共檢索出 {items.length} 張全公司簽核單據
          </span>
          <span className="text-slate-300">|</span>
          <span>點擊任一單據右側「展開內文與簽核明細」即可原地檢視完整填報內容與簽核關卡紀錄</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                viewMode === 'grouped'
                  ? 'bg-white text-td-blue shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              依單據類別分組
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flat')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                viewMode === 'flat'
                  ? 'bg-white text-td-blue shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              時間排序總表
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              setExpandAllDetails((prev) => (prev === true ? false : true))
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {expandAllDetails === true ? '▴ 全部收合單據內文' : '▾ 全部展開單據內文'}
          </button>
        </div>
      </div>

      {viewMode === 'grouped' ? (
        <div className="space-y-4">
          {groupedByCategory.map((group) => {
            const accent = CATEGORY_ACCENT[group.categoryKey] ?? CATEGORY_ACCENT.other;
            const isCatOpen = !collapsedCategories[group.categoryKey];
            return (
              <div
                key={group.categoryKey}
                className={`overflow-hidden rounded-xl border border-td-border border-l-4 ${accent.border} bg-white shadow-2xs`}
              >
                <button
                  type="button"
                  onClick={() => toggleCategory(group.categoryKey)}
                  aria-expanded={isCatOpen}
                  className="flex w-full items-center justify-between gap-3 bg-slate-50/80 px-4 py-2.5 text-left transition hover:bg-slate-100/80"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
                    <span className="text-sm font-bold text-td-blue-dark">
                      {group.categoryLabel}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${accent.badge}`}
                    >
                      {group.items.length} 張單據
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-td-muted">
                    <span>{isCatOpen ? '收合分類' : '展開分類'}</span>
                    <svg
                      className={`h-4 w-4 transition-transform ${isCatOpen ? 'rotate-180' : ''}`}
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

                {isCatOpen && (
                  <div className="divide-y divide-slate-100">
                    {group.items.map((item) => (
                      <TrackingDocumentRow
                        key={`${item.formType}-${item.id}`}
                        item={item}
                        forceExpanded={expandAllDetails}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-td-border bg-white shadow-2xs">
          {items.map((item) => (
            <TrackingDocumentRow
              key={`${item.formType}-${item.id}`}
              item={item}
              forceExpanded={expandAllDetails}
            />
          ))}
        </div>
      )}
    </div>
  );
}
