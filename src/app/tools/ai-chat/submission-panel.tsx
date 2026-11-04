'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { getSubmissionPanelAction } from '@/lib/ai-chat/actions';
import { ActionSpinner, useSubmissionAction } from './submission-actions';

type Panel = Extract<Awaited<ReturnType<typeof getSubmissionPanelAction>>, { ok: true }>;

const timeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function SubmissionPanel({
  submissionId,
  focusApprove,
}: {
  submissionId: string;
  /** Scroll to the approve/return controls when opened via 簽核. */
  focusApprove?: boolean;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [loadPending, startLoad] = useTransition();
  const approveRef = useRef<HTMLElement>(null);
  const tick = useRef(0);
  const action = useSubmissionAction(submissionId);

  const load = () => {
    const my = ++tick.current;
    startLoad(async () => {
      setError(null);
      const res = await getSubmissionPanelAction(submissionId);
      if (my !== tick.current) return;
      if (!res.ok) {
        setPanel(null);
        setError(res.error);
        return;
      }
      setPanel(res);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the opened submission changes
  }, [submissionId]);

  useEffect(() => {
    if (action.phase !== 'approved' && action.phase !== 'returned') return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh panel when shared action completes
  }, [action.phase, submissionId]);

  useEffect(() => {
    if (!focusApprove || !panel?.isCurrentApprover) return;
    if (action.phase === 'approved' || action.phase === 'returned') return;
    approveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusApprove, panel?.isCurrentApprover, panel?.id, action.phase]);

  if (error) {
    return (
      <div className="space-y-2 p-4 text-base">
        <p className="text-red-700">{error}</p>
        <a className="text-td-blue underline" href={`/f/_/${submissionId}`}>
          開啟正式單據頁
        </a>
      </div>
    );
  }

  if (!panel) {
    return <p className="p-4 text-base text-td-muted">{loadPending ? '載入單據…' : '載入中…'}</p>;
  }

  const showApproverBox =
    (panel.isCurrentApprover || action.phase === 'approving' || action.phase === 'returning') &&
    action.phase !== 'approved' &&
    action.phase !== 'returned';

  const doneBanner =
    action.phase === 'approved' ? (
      <div
        role="status"
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-base text-emerald-900"
      >
        已完成簽核
      </div>
    ) : action.phase === 'returned' ? (
      <div
        role="status"
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-950"
      >
        已退回此單據
      </div>
    ) : null;

  return (
    <div className="space-y-4 p-4 text-base">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-td-blue-dark">{panel.formName}</h2>
          <span className={STATUS_BADGE[panel.status] ?? 'badge-withdrawn'}>
            {STATUS_LABELS[panel.status] ?? panel.status}
          </span>
        </div>
        <p className="mono-case text-sm text-td-muted">{panel.formNumber}</p>
        {panel.submittedAt && (
          <p className="text-sm text-td-muted">送出時間 {timeFmt.format(new Date(panel.submittedAt))}</p>
        )}
        <a className="inline-block text-sm text-td-blue underline" href={panel.href} target="_blank" rel="noreferrer">
          開啟完整頁面
        </a>
      </header>

      {doneBanner}

      <section className="rounded-lg border border-td-border bg-slate-50/80 px-3 py-2">
        <h3 className="mb-2 text-sm font-semibold text-td-muted">大綱</h3>
        <dl className="space-y-1.5">
          {panel.header.map((row) => (
            <div key={row.label} className="grid grid-cols-[6rem_1fr] gap-2">
              <dt className="text-sm text-td-muted">{row.label}</dt>
              <dd className="whitespace-pre-wrap text-td-blue-dark">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {panel.fields.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-td-muted">內容</h3>
          <dl className="space-y-2">
            {panel.fields.map((row) => (
              <div key={row.label}>
                <dt className="text-sm text-td-muted">{row.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-td-blue-dark">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {panel.timeline.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-td-muted">簽核進度</h3>
          <ol className="space-y-2">
            {panel.timeline.map((n) => (
              <li key={n.key} className="rounded border border-td-border px-2 py-1.5 text-sm">
                <p className="font-medium text-td-blue-dark">
                  {n.label}
                  {n.name ? ` · ${n.name}` : ''}
                </p>
                <p className="text-td-muted">
                  {n.state}
                  {n.actedAt ? ` · ${timeFmt.format(new Date(n.actedAt))}` : ''}
                </p>
                {n.comment && <p className="mt-1 text-td-blue-dark">{n.comment}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {showApproverBox && (
        <section
          ref={approveRef}
          className="rounded-lg border border-td-blue/30 bg-td-blue-light/40 p-3"
        >
          <h3 className="mb-2 font-semibold text-td-blue-dark">您是目前的簽核人</h3>
          {(action.error || null) && (
            <p className="mb-2 rounded bg-red-50 px-2 py-1 text-sm text-red-700">{action.error}</p>
          )}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn inline-flex items-center justify-center gap-1.5 bg-status-approved text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-70"
              disabled={action.busy}
              aria-busy={action.phase === 'approving'}
              onClick={() => {
                void action.approve(panel.version);
              }}
            >
              {action.phase === 'approving' ? (
                <>
                  <ActionSpinner />
                  核准中…
                </>
              ) : (
                '核准'
              )}
            </button>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="退回原因（非必填）"
              disabled={action.busy}
              className="rounded border border-td-border bg-white px-3 py-2 text-base focus:border-td-blue focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              className="btn inline-flex items-center justify-center gap-1.5 border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-70"
              disabled={action.busy}
              aria-busy={action.phase === 'returning'}
              onClick={() => {
                // Reason is optional in chat UI; empty becomes a default on the server side of the shared action.
                void action.returnSubmission(reason, panel.version);
              }}
            >
              {action.phase === 'returning' ? (
                <>
                  <ActionSpinner tone="danger" />
                  退回中…
                </>
              ) : (
                '退回'
              )}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
