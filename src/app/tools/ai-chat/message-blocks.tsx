'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { QuickPrintButton } from '@/app/components/print-button';
import type { AiMessageBlock } from '@/lib/ai-chat/blocks';
import {
  answerChoiceAction,
  attachApprovedPdfAction,
  confirmChangeAction,
  confirmNudgeAction,
  getSubmissionProgressAction,
  listRecentProjectsAction,
  refreshCardAction,
  searchProjectsAction,
  selectProjectAction,
  submitFieldFormAction,
} from '@/lib/ai-chat/actions';
import type { OpenResourceEvent } from '@/lib/ai-chat/open-resource';
import { ActionSpinner, useSubmissionAction } from './submission-actions';
import { SafeMarkdown } from './safe-markdown';

type Props = {
  blocks: AiMessageBlock[];
  conversationId: string;
  boundDraftId?: string | null;
  boundDraftVersion?: number | null;
  onDraftOpened?: (draftId: string, meta?: { title?: string; version?: number; formKey?: string; status?: string }) => void;
  onOpenResources?: (events: OpenResourceEvent[]) => void;
  onIntent?: (intent: string) => void;
  onRefresh?: () => void;
  /** Send text as the person's own message (choice answers stay equivalent to typing). */
  onSendText?: (text: string) => void;
};

export function MessageBlocks({
  blocks,
  conversationId,
  boundDraftId,
  boundDraftVersion,
  onDraftOpened,
  onOpenResources,
  onIntent,
  onRefresh,
  onSendText,
}: Props) {
  if (!blocks.length) return null;
  return (
    <div className="mt-3 space-y-3">
      {blocks.map((b) => (
        <BlockView
          key={b.id}
          block={b}
          conversationId={conversationId}
          boundDraftId={boundDraftId}
          boundDraftVersion={boundDraftVersion}
          onDraftOpened={onDraftOpened}
          onOpenResources={onOpenResources}
          onIntent={onIntent}
          onRefresh={onRefresh}
          onSendText={onSendText}
        />
      ))}
    </div>
  );
}

function BlockView({
  block,
  conversationId,
  boundDraftId,
  boundDraftVersion,
  onDraftOpened,
  onOpenResources,
  onIntent,
  onRefresh,
  onSendText,
}: {
  block: AiMessageBlock;
  conversationId: string;
  boundDraftId?: string | null;
  boundDraftVersion?: number | null;
  onDraftOpened?: Props['onDraftOpened'];
  onOpenResources?: Props['onOpenResources'];
  onIntent?: Props['onIntent'];
  onRefresh?: () => void;
  onSendText?: Props['onSendText'];
}) {
  switch (block.kind) {
    case 'text':
      return <SafeMarkdown className="text-base" text={block.text} />;
    case 'choice':
      return (
        <ChoiceBlock
          block={block}
          conversationId={conversationId}
          onDraftOpened={onDraftOpened}
          onOpenResources={onOpenResources}
          onIntent={onIntent}
          onRefresh={onRefresh}
          onSendText={onSendText}
        />
      );
    case 'project_picker':
      return <ProjectPickerBlock block={block} conversationId={conversationId} onOpenResources={onOpenResources} onRefresh={onRefresh} />;
    case 'field_form':
      return null;
    case 'change_confirm':
      return <ChangeConfirmBlock block={block} conversationId={conversationId} onOpenResources={onOpenResources} onRefresh={onRefresh} />;
    case 'submission_card':
      return <SubmissionCardBlock block={block} onOpenResources={onOpenResources} />;
    case 'draft_reference':
      return (
        <button
          type="button"
          className="w-full rounded-lg border border-td-blue/30 bg-td-blue-light/40 px-3 py-2 text-left text-base"
          onClick={() =>
            onDraftOpened?.(block.draftId, {
              title: block.formName,
              version: block.version,
              formKey: block.formKey,
              status: block.status,
            })
          }
        >
          <span className="font-semibold text-td-blue-dark">草稿：{block.formName}</span>
          <span className="mt-0.5 block text-sm text-td-muted">
            {block.formKey} · v{block.version} · {block.status}
          </span>
        </button>
      );
    case 'action_result':
      return (
        <div
          className={`rounded-lg border px-3 py-2 text-base ${
            block.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <p>{block.message}</p>
          {block.href && (
            <a href={block.href} className="mt-1 inline-block text-sm font-medium underline">
              查看單據 {block.formNumber}
            </a>
          )}
        </div>
      );
    case 'nudge_confirm':
      return <NudgeBlock block={block} conversationId={conversationId} onRefresh={onRefresh} />;
    case 'document_picker':
      return (
        <DocumentPickerBlock
          block={block}
          conversationId={conversationId}
          boundDraftId={boundDraftId}
          boundDraftVersion={boundDraftVersion}
          onOpenResources={onOpenResources}
          onRefresh={onRefresh}
        />
      );
    case 'approved_pdf_card':
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-base text-emerald-900">
          <p className="font-medium">核准 PDF：{block.formNumber}</p>
          <p className="text-sm">{block.fileName}</p>
          <a href={block.previewHref} className="mt-1 inline-block text-sm underline" target="_blank" rel="noreferrer">
            預覽／下載
          </a>
        </div>
      );
    case 'attachment_status':
      return (
        <StagedImageThumb block={block} />
      );
    case 'document_summary':
      return (
        <div className="rounded-lg border border-td-border bg-white px-3 py-2 text-base">
          <p className="font-semibold">{block.title}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {block.fields.map((f, i) => (
              <li key={`${f.label}-${i}`}>
                <span className="text-td-muted">{f.label}</span>：{f.value}
                <span className="ml-1 text-xs text-td-muted">[{f.source}]</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'field_question':
      return <p className="text-base text-td-muted">{block.prompt}</p>;
    default:
      return null;
  }
}

type CardStep = NonNullable<
  NonNullable<Extract<AiMessageBlock, { kind: 'submission_card' }>['progress']>['steps']
>[number];

function normalizeWaitingText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (s === '未滿 1 小時') return '1 小時內';
  const hourMatch = s.match(/^(\d+)\s*小時$/);
  if (hourMatch) return `${hourMatch[1]} 小時前`;
  const dayMatch = s.match(/^(\d+)\s*天$/);
  if (dayMatch) return `${dayMatch[1]} 天前`;
  return s;
}

function ApprovalStepper({ steps }: { steps: CardStep[] }) {
  return (
    <ol className="flex w-full items-start gap-0 overflow-x-auto" aria-label="簽核關卡">
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
          <li key={step.key} className="flex min-w-[4.25rem] flex-1 flex-col items-center text-center">
            <span
              className={`mb-0.5 text-[10px] leading-none ${
                step.state === 'current'
                  ? 'font-semibold text-td-blue'
                  : step.state === 'done'
                    ? 'font-medium text-emerald-600'
                    : step.state === 'returned'
                      ? 'font-semibold text-amber-700'
                      : 'text-slate-400'
              }`}
            >
              {stateText}
            </span>
            <div className="flex w-full items-center">
              <div
                className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : lineReturnedLeft ? 'bg-amber-400' : lineDone || linePartial ? 'bg-emerald-500' : 'bg-slate-200'}`}
                aria-hidden
              />
              <span
                className={`relative z-[1] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  step.state === 'done'
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : step.state === 'current'
                      ? 'border-2 border-td-blue bg-white text-td-blue ring-2 ring-td-blue/15'
                      : step.state === 'returned'
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-slate-300 bg-white text-slate-400'
                }`}
                title={`${step.label}（${stateText}）`}
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
                ) : (
                  <span className="sr-only">待簽</span>
                )}
              </span>
              <div
                className={`h-0.5 flex-1 ${i === steps.length - 1 ? 'bg-transparent' : lineReturnedRight ? 'bg-amber-400' : lineDone ? 'bg-emerald-500' : 'bg-slate-200'}`}
                aria-hidden
              />
            </div>
            <div className="mt-0.5 flex max-w-full flex-wrap items-baseline justify-center gap-x-1 px-0.5 leading-tight">
              <span
                className={`truncate text-xs font-medium ${
                  step.state === 'current'
                    ? 'text-td-blue-dark'
                    : step.state === 'done'
                      ? 'text-emerald-800'
                      : step.state === 'returned'
                        ? 'text-amber-900'
                        : 'text-td-muted'
                }`}
              >
                {step.name || '未指定'}
              </span>
              <span className="truncate text-[10px] text-td-muted">{step.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SubmissionCardBlock({
  block,
  onOpenResources,
}: {
  block: Extract<AiMessageBlock, { kind: 'submission_card' }>;
  onOpenResources?: Props['onOpenResources'];
}) {
  const action = useSubmissionAction(block.formId);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [liveProgress, setLiveProgress] = useState(block.progress);

  useEffect(() => {
    setLiveProgress(block.progress);
    const hasSteps = Boolean(block.progress?.steps && block.progress.steps.length > 0);
    if (block.progress && block.progress.total > 0 && hasSteps) return;
    if (block.status !== 'pending_approval' && block.status !== 'approved' && block.status !== 'returned') return;
    let cancelled = false;
    void getSubmissionProgressAction(block.formType === 'custom' || block.formKey ? 'custom' : block.formType, block.formId).then(
      (res) => {
        if (cancelled || !res.ok) return;
        setLiveProgress(res.progress);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [block.formId, block.formType, block.formKey, block.progress, block.status]);

  const openPanel = () => {
    if (block.formType === 'custom' || block.formKey) {
      onOpenResources?.([
        {
          type: 'open_resource',
          resourceType: 'form_submission',
          resourceId: block.formId,
          title: `${block.formName} ${block.formNumber}`,
          operation: 'opened',
          formKey: block.formKey,
          status: block.status,
        },
      ]);
      return;
    }
    window.open(block.href, '_blank', 'noopener,noreferrer');
  };

  const badge =
    action.phase === 'approved'
      ? { text: '已簽核', className: 'bg-emerald-100 text-emerald-800' }
      : action.phase === 'returned'
        ? { text: '已退回', className: 'bg-amber-100 text-amber-900' }
        : action.phase === 'approving'
          ? { text: '簽核中…', className: 'bg-td-blue-light text-td-blue-dark' }
          : action.phase === 'returning'
            ? { text: '退回中…', className: 'bg-amber-50 text-amber-900' }
            : block.mode === 'approve'
              ? { text: '待您簽核', className: 'bg-slate-100 text-td-muted' }
              : block.status === 'pending_approval'
                ? { text: '簽核中', className: 'bg-blue-50 text-td-blue-dark' }
                : block.status === 'approved'
                  ? { text: '已核准', className: 'bg-emerald-100 text-emerald-800' }
                  : block.status === 'returned'
                    ? { text: '已退回', className: 'bg-amber-100 text-amber-900' }
                    : block.status === 'withdrawn'
                      ? { text: '已撤回', className: 'bg-slate-100 text-slate-600' }
                      : block.status === 'draft'
                        ? { text: '草稿', className: 'bg-slate-100 text-slate-600' }
                        : { text: block.status, className: 'bg-slate-100 text-td-muted' };

  const canAct = block.canApprove && action.phase !== 'approved' && action.phase !== 'returned';

  const waitingLine = block.lines.find((l) => l.label === '已等待')?.value;
  const waitingText = normalizeWaitingText(waitingLine);
  const applicantText =
    block.applicantName || block.lines.find((l) => l.label === '申請人')?.value || null;
  const amountLine = block.lines.find((l) => l.label === '金額')?.value || null;
  const showHeaderAmount = Boolean(amountLine && amountLine !== 'NT$ 0');
  const rawSummary = block.lines.find((l) => l.label === '摘要')?.value || block.summary;
  const cleanSummary = rawSummary ? rawSummary.replace(/\s*·\s*NT\$\s*0$/, '') : '';
  const hasStepper = Boolean(liveProgress && liveProgress.total > 0);
  const extraLines = block.lines.filter(
    (l) =>
      l.label !== '申請人' &&
      l.label !== '已等待' &&
      l.label !== '摘要' &&
      l.label !== '金額' &&
      l.label !== '狀態' &&
      !(hasStepper && l.label === '目前關卡')
  );

  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs shadow-2xs ${
        action.phase === 'returned'
          ? 'border-amber-300 bg-amber-50/60'
          : action.phase === 'approved'
            ? 'border-emerald-200 bg-emerald-50/40'
            : 'border-td-border bg-white'
      }`}
    >
      {/* Compact Header Row: Title + Case# + Applicant on Left | Status Badge + Waiting Time on Right */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-td-blue-dark">{block.formName}</span>
          <span className="mono-case text-xs text-td-muted">{block.formNumber}</span>
          {applicantText && (
            <span className="text-xs text-td-muted">
              申請人 <span className="font-medium text-td-blue-dark">{applicantText}</span>
            </span>
          )}
          {showHeaderAmount && (
            <span className="text-xs font-semibold text-td-blue-dark">{amountLine}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
            {badge.text}
          </span>
          {waitingText && <span className="text-[11px] text-td-muted">{waitingText}</span>}
        </div>
      </div>

      {/* Compact Summary Line */}
      {cleanSummary && (
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-600">{cleanSummary}</p>
      )}
      {extraLines.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {extraLines.map((line) => (
            <span key={`${line.label}:${line.value}`} className="text-td-muted">
              {line.label} <span className="text-td-blue-dark">{line.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Compact Approval Progress + Inline Action Buttons */}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-1.5">
        {liveProgress && liveProgress.total > 0 ? (
          <div className="min-w-[14rem] flex-1 space-y-1" aria-label="簽核進度">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-td-blue-dark">
                簽核進度 {liveProgress.done}/{liveProgress.total}
              </span>
              <span className="text-td-muted">
                {block.status === 'returned' ||
                action.phase === 'returned' ||
                liveProgress.steps?.some((s) => s.state === 'returned') ? (
                  <span className="font-medium text-amber-700">已退回</span>
                ) : liveProgress.remaining > 0 ? (
                  `還差 ${liveProgress.remaining} 關`
                ) : block.status === 'approved' || liveProgress.percent >= 100 ? (
                  '已全部簽完'
                ) : (
                  '進行中'
                )}
              </span>
            </div>
            {liveProgress.steps && liveProgress.steps.length > 0 ? (
              <ApprovalStepper steps={liveProgress.steps} />
            ) : (
              <>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-valuenow={liveProgress.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      liveProgress.percent >= 100
                        ? 'bg-emerald-500'
                        : block.status === 'returned'
                          ? 'bg-amber-500'
                          : 'bg-td-blue'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, liveProgress.percent))}%` }}
                  />
                </div>
                {(liveProgress.currentLabel ||
                  (liveProgress.waitingNames && liveProgress.waitingNames.length > 0)) && (
                  <p className="text-[11px] text-td-muted">
                    {liveProgress.currentLabel ? `目前：${liveProgress.currentLabel}` : null}
                    {liveProgress.waitingNames && liveProgress.waitingNames.length > 0
                      ? `${liveProgress.currentLabel ? ' · ' : ''}待簽：${liveProgress.waitingNames.join('、')}`
                      : null}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div />
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {(block.status === 'approved' || action.phase === 'approved') && (
            <QuickPrintButton href={block.href} size="xs" />
          )}
          <button
            type="button"
            className="rounded-lg border border-td-blue bg-white px-2.5 py-1 text-xs font-medium text-td-blue transition hover:bg-td-blue-light/50"
            onClick={openPanel}
          >
            詳情
          </button>
          {block.canApprove && action.phase === 'approved' && (
            <button
              type="button"
              style={{ backgroundColor: '#059669', color: '#ffffff' }}
              className="btn-quick-approve inline-flex cursor-default items-center gap-1 rounded-lg bg-status-approved px-2.5 py-1 text-xs font-medium text-white"
              disabled
            >
              ✓ 已簽核
            </button>
          )}
          {block.canApprove && action.phase === 'returned' && (
            <button
              type="button"
              className="inline-flex cursor-default items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900"
              disabled
            >
              已退回
            </button>
          )}
          {canAct && !returnOpen && (
            <>
              <button
                type="button"
                style={{ backgroundColor: '#059669', color: '#ffffff' }}
                className="btn-quick-approve inline-flex items-center gap-1 rounded-lg border border-emerald-700/20 bg-status-approved px-2.5 py-1 text-xs font-semibold text-white shadow-2xs transition hover:opacity-95 disabled:cursor-wait disabled:opacity-80"
                disabled={action.busy}
                aria-busy={action.phase === 'approving'}
                onClick={() => {
                  void action.approve();
                }}
              >
                {action.phase === 'approving' ? (
                  <>
                    <ActionSpinner />
                    簽核中…
                  </>
                ) : (
                  '✓ 快速簽核'
                )}
              </button>
              <button
                type="button"
                className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                disabled={action.busy}
                onClick={() => setReturnOpen(true)}
              >
                退回
              </button>
            </>
          )}
        </div>
      </div>

      {action.error && <p className="mt-1.5 text-xs text-red-700">{action.error}</p>}
      {canAct && returnOpen && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/80 p-2">
          <label className="block text-xs text-amber-950">
            退回原因
            <textarea
              className="mt-1 w-full resize-y rounded-md border border-td-border bg-white px-2.5 py-1.5 text-xs text-td-blue-dark"
              rows={2}
              value={returnReason}
              disabled={action.busy}
              placeholder="非必填"
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-70"
              disabled={action.busy}
              aria-busy={action.phase === 'returning'}
              onClick={() => {
                void action.returnSubmission(returnReason);
              }}
            >
              {action.phase === 'returning' ? (
                <>
                  <ActionSpinner tone="danger" />
                  退回中…
                </>
              ) : (
                '確認退回'
              )}
            </button>
            <button
              type="button"
              className="text-xs text-td-muted underline"
              disabled={action.busy}
              onClick={() => {
                setReturnOpen(false);
                setReturnReason('');
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChoiceBlock({
  block,
  conversationId,
  onDraftOpened,
  onOpenResources,
  onIntent,
  onRefresh,
  onSendText,
}: {
  block: Extract<AiMessageBlock, { kind: 'choice' }>;
  conversationId: string;
  onDraftOpened?: Props['onDraftOpened'];
  onOpenResources?: Props['onOpenResources'];
  onIntent?: Props['onIntent'];
  onRefresh?: () => void;
  onSendText?: Props['onSendText'];
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(block.status !== 'open');
  const [error, setError] = useState<string | null>(null);

  if (done || block.status !== 'open') {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-base text-td-muted">
        {block.prompt}
        <p className="mt-1 text-sm">
          {block.selectedOptionId
            ? `已選擇：${block.options.find((o) => o.id === block.selectedOptionId)?.label ?? block.selectedOptionId}`
            : '選項已失效或已回答'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3">
      <p className="text-base font-medium text-td-blue-dark">{block.prompt}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {block.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 text-base"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await answerChoiceAction({
                  conversationId,
                  blockId: block.id,
                  optionId: o.id,
                  optionValue: o.value,
                  optionLabel: o.label,
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setDone(true);
                if (res.intent) onIntent?.(res.intent);
                if (res.openResources?.length) onOpenResources?.(res.openResources);
                else if (res.draftId) onDraftOpened?.(res.draftId);
                if (res.sendText) onSendText?.(res.sendText);
                else onRefresh?.();
              });
            }}
          >
            {pending ? <ActionSpinner tone="muted" /> : null}
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function ProjectPickerBlock({
  block,
  conversationId,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'project_picker' }>;
  conversationId: string;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Array<{ id: string; code: string; name: string; source: string }>>([]);
  const [results, setResults] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(block.selectedLabel ?? null);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    void listRecentProjectsAction().then((res) => {
      if (res.ok) setRecent(res.projects);
    });
  }, []);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const seq = ++reqSeq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchProjectsAction({ query });
        if (seq !== reqSeq.current) return; // drop stale
        if (res.ok) setResults(res.projects);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (block.status !== 'open' || selected) {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-base">
        {selected ?? (block.status === 'expired' ? '草稿已更新，這張專案卡片已過期。' : '專案選取已完成或已失效')}
      </div>
    );
  }

  const pick = (id: string) => {
    setError(null);
    start(async () => {
      const res = await selectProjectAction({ conversationId, blockId: block.id, projectId: id });
      if (!res.ok) {
        setError(res.error);
        onRefresh?.();
        return;
      }
      setSelected(res.receipt);
      if (res.openResources?.length) onOpenResources?.(res.openResources);
      onRefresh?.();
    });
  };

  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3">
      <p className="text-base font-medium text-td-blue-dark">{block.prompt}</p>
      <input
        className="mt-2 w-full rounded-lg border border-td-border px-3 py-2 text-base"
        placeholder="輸入專案代碼或名稱搜尋…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-base">
        {query.trim().length < 1 &&
          recent.map((p) => (
            <button
              key={p.id}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-td-blue-light/50"
              disabled={pending}
              onClick={() => pick(p.id)}
            >
              <span className="font-medium">{p.code}</span> {p.name}
              <span className="ml-2 text-xs text-td-muted">
                {p.source === 'recent_used' ? '最近使用' : '近期建立'}
              </span>
            </button>
          ))}
        {results.map((p) => (
          <button
            key={p.id}
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-td-blue-light/50"
            disabled={pending}
            onClick={() => pick(p.id)}
          >
            <span className="font-medium">{p.code}</span> {p.name}
          </button>
        ))}
        {query.trim() && results.length === 0 && !pending && (
          <p className="px-2 py-1 text-sm text-td-muted">沒有符合的專案</p>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function NudgeBlock({
  block,
  conversationId,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'nudge_confirm' }>;
  conversationId: string;
  onRefresh?: () => void;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(block.status);
  const [msg, setMsg] = useState<string | null>(null);

  if (status !== 'open') {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-base text-td-muted">
        催簽：{block.caseNumber}
        {status === 'already_today' && ' — 今日已催簽'}
        {status === 'notified' && ' — 站內通知已建立'}
        {status === 'queued' && ' — 已排入通知'}
        {status === 'failed' && ' — 寄送失敗'}
        {msg && <p className="mt-1 text-sm">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-base">
      <p className="font-medium text-amber-950">提醒簽核：{block.caseNumber}</p>
      <p className="mt-1 text-sm text-amber-900">
        收件對象：{block.recipientNames.length ? block.recipientNames.join('、') : '（無待簽核人）'}
      </p>
      <p className="mt-1 text-xs text-amber-800">每張單依 Asia/Taipei 曆日全系統每天最多一次。</p>
      <button
        type="button"
        className="btn-primary mt-2 text-base"
        disabled={pending || block.recipientNames.length === 0}
        onClick={() => {
          start(async () => {
            const res = await confirmNudgeAction({
              formType: block.formType,
              formId: block.formId,
              conversationId,
            });
            if (!res.ok) {
              setStatus('failed');
              setMsg(res.error);
              return;
            }
            setStatus(res.status === 'already_today' ? 'already_today' : 'notified');
            setMsg(res.message);
            onRefresh?.();
          });
        }}
      >
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <ActionSpinner />
            處理中…
          </span>
        ) : (
          '確認提醒簽核'
        )}
      </button>
    </div>
  );
}

function StagedImageThumb({ block }: { block: Extract<AiMessageBlock, { kind: 'attachment_status' }> }) {
  const stagedId = block.detail?.startsWith('staged:') ? block.detail.slice('staged:'.length) : null;
  return (
    <div className="flex items-center gap-2 text-sm text-td-muted">
      {stagedId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/ai-chat/staged/${stagedId}`}
          alt={block.fileName}
          className="h-14 w-14 rounded border object-cover"
        />
      ) : null}
      <span>
        圖片 {block.fileName}：{block.state}
        {!stagedId && block.detail ? `（${block.detail}）` : ''}
      </span>
    </div>
  );
}

function DocumentPickerBlock({
  block,
  conversationId,
  boundDraftId,
  boundDraftVersion,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'document_picker' }>;
  conversationId: string;
  boundDraftId?: string | null;
  boundDraftVersion?: number | null;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const draftId = block.targetDraftId || boundDraftId || null;
  const draftVersion = block.targetDraftVersion ?? boundDraftVersion ?? null;

  if (block.status !== 'open') {
    return <p className="text-base text-td-muted">{block.prompt}（已關閉）</p>;
  }

  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3">
      <p className="text-base font-medium text-td-blue-dark">{block.prompt}</p>
      {!draftId && (
        <p className="mt-1 text-sm text-amber-800">請先綁定或開啟報支草稿，才能附加核准 PDF。</p>
      )}
      <ul className="mt-2 space-y-2">
        {block.items.map((item) => (
          <li key={item.formId} className="rounded-lg border border-td-border px-3 py-2 text-base">
            <div className="font-medium text-td-blue-dark">
              {item.formName} · {item.formNumber}
            </div>
            <div className="text-sm text-td-muted">
              {item.summary}
              {item.approvedAt
                ? ` · 核准 ${new Date(item.approvedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
                : ''}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <a className="underline" href={`/f/${item.formKey || '_'}/${item.formId}`}>
                預覽單據
              </a>
              <button
                type="button"
                className="underline"
                disabled={pending || !draftId || draftVersion == null || doneId === item.formId}
                onClick={() => {
                  if (!draftId || draftVersion == null) return;
                  setError(null);
                  start(async () => {
                    const res = await attachApprovedPdfAction({
                      sourceFormId: item.formId,
                      draftId,
                      expectedVersion: draftVersion,
                      conversationId,
                    });
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    setDoneId(item.formId);
                    onOpenResources?.([
                      {
                        type: 'open_resource',
                        resourceType: 'application_draft',
                        resourceId: draftId,
                        title: '報支草稿',
                        version: res.draftVersion,
                        operation: 'updated',
                      },
                    ]);
                    onRefresh?.();
                  });
                }}
              >
                {doneId === item.formId
                  ? '已附加'
                  : pending
                    ? '附加中…'
                    : '附加核准 PDF'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {block.items.length === 0 && <p className="mt-2 text-base text-td-muted">沒有可選的已核准單據。</p>}
      {error && <p className="mt-2 text-base text-amber-800">{error}</p>}
    </div>
  );
}

function CardOutcome({ block }: { block: { status: string; outcome?: string } }) {
  return (
    <p className={`mt-2 text-sm ${block.status === 'expired' ? 'text-amber-800' : 'text-emerald-800'}`}>
      {block.outcome ?? (block.status === 'expired' ? '這張卡片已過期，沒有寫入。' : '已完成')}
    </p>
  );
}

/** Small form for missing fields; native controls, so every input is keyboard reachable. */
function FieldFormBlock({
  block,
  conversationId,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'field_form' }>;
  conversationId: string;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ status: string; outcome?: string }>({ status: block.status, outcome: block.outcome });
  const [error, setError] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectHits, setProjectHits] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const hasProject = block.fields.some((f) => f.type === 'project');

  useEffect(() => {
    if (!hasProject || projectQuery.trim().length < 1) return;
    const t = setTimeout(() => {
      void searchProjectsAction({ query: projectQuery }).then((r) => r.ok && setProjectHits(r.projects));
    }, 250);
    return () => clearTimeout(t);
  }, [projectQuery, hasProject]);

  const head = (
    <p className="text-base font-medium text-td-blue-dark">
      {block.prompt}
      <span className="ml-1 text-sm font-normal text-td-muted">（{block.formName} v{block.draftVersion}）</span>
    </p>
  );

  if (state.status !== 'open') {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-base">
        {head}
        <CardOutcome block={state} />
        {state.status === 'expired' && (
          <button
            type="button"
            className="btn-secondary mt-2 text-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await refreshCardAction({ conversationId, blockId: block.id });
                if (!res.ok) setError(res.error);
                onRefresh?.();
              })
            }
          >
            以最新版本重新填寫
          </button>
        )}
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  const input = 'mt-1 w-full rounded-lg border border-td-border px-2 py-1.5 text-base';
  return (
    <form
      className="space-y-2 rounded-lg border border-td-border bg-white px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        setError(null);
        start(async () => {
          const res = await submitFieldFormAction({ conversationId, blockId: block.id, values });
          const b = res.block;
          if (b && (b.kind === 'field_form' || b.kind === 'change_confirm')) setState({ status: b.status, outcome: b.outcome });
          if (!res.ok) setError(res.error);
          else if (res.openResources?.length) onOpenResources?.(res.openResources);
          onRefresh?.();
        });
      }}
    >
      {head}
      {block.fields.map((f) => {
        const id = `${block.id}_${f.id}`;
        const set = (v: string) => setValues((prev) => ({ ...prev, [f.id]: v }));
        return (
          <div key={f.id}>
            <label htmlFor={id} className="text-sm font-semibold text-td-blue-dark">
              {f.label}
              {f.required && <span className="text-red-600"> *</span>}
              {f.current && <span className="ml-1 font-normal text-td-muted">目前：{f.current.replace('T', ' ')}</span>}
            </label>
            {f.type === 'select' || f.type === 'employee' ? (
              <select id={id} className={input} value={values[f.id] ?? ''} onChange={(e) => set(e.target.value)}>
                <option value="">請選擇</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'project' ? (
              <div>
                <input
                  id={id}
                  className={input}
                  placeholder="輸入專案代碼或名稱搜尋…"
                  value={projectQuery}
                  onChange={(e) => {
                    setProjectQuery(e.target.value);
                    if (!e.target.value.trim()) setProjectHits([]);
                    set('');
                  }}
                />
                {projectHits.length > 0 && !values[f.id] && (
                  <div role="listbox" aria-label="專案搜尋結果" className="mt-1 max-h-40 overflow-y-auto rounded border border-td-border">
                    {projectHits.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="block w-full px-2 py-1 text-left text-base hover:bg-td-blue-light/50"
                        onClick={() => {
                          set(p.id);
                          setProjectQuery(`${p.code} ${p.name}`);
                        }}
                      >
                        {p.code} {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : f.type === 'textarea' ? (
              <textarea id={id} className={input} rows={2} value={values[f.id] ?? ''} onChange={(e) => set(e.target.value)} />
            ) : (
              <input
                id={id}
                className={input}
                type={f.type === 'datetime' ? 'datetime-local' : f.type === 'date' ? 'date' : f.type === 'money' || f.type === 'number' ? 'number' : 'text'}
                value={values[f.id] ?? ''}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-secondary text-base" disabled={pending}>
          {pending ? '儲存中…' : '存入草稿'}
        </button>
        <span className="text-sm text-td-muted">只存入草稿，不會送出單據。</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function ChangeConfirmBlock({
  block,
  conversationId,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'change_confirm' }>;
  conversationId: string;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ status: string; outcome?: string }>({ status: block.status, outcome: block.outcome });
  const [error, setError] = useState<string | null>(null);
  const act = (accept: boolean) =>
    start(async () => {
      setError(null);
      const res = await confirmChangeAction({ conversationId, blockId: block.id, accept });
      const b = res.block;
      if (b && (b.kind === 'field_form' || b.kind === 'change_confirm')) setState({ status: b.status, outcome: b.outcome });
      if (!res.ok) setError(res.error);
      else if (res.openResources?.length) onOpenResources?.(res.openResources);
      onRefresh?.();
    });
  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3 text-base">
      <p className="font-medium text-td-blue-dark">
        {block.prompt}
        <span className="ml-1 text-sm font-normal text-td-muted">（{block.formName} v{block.draftVersion}）</span>
      </p>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-td-muted">
            <th className="py-1">欄位</th>
            <th>原值</th>
            <th>新值</th>
          </tr>
        </thead>
        <tbody>
          {block.changes.map((c) => (
            <tr key={c.field} className="border-t border-td-border">
              <td className="py-1">{c.label}</td>
              <td className="text-td-muted line-through">{c.from}</td>
              <td className="font-semibold">{c.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.status === 'open' ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 text-base"
            disabled={pending}
            aria-busy={pending}
            onClick={() => act(true)}
          >
            {pending ? (
              <>
                <ActionSpinner tone="muted" />
                處理中…
              </>
            ) : (
              '確認修改'
            )}
          </button>
          <button type="button" className="text-base underline" disabled={pending} onClick={() => act(false)}>
            取消
          </button>
        </div>
      ) : (
        <CardOutcome block={state} />
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
