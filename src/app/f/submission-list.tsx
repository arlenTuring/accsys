import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { enrichWithSnapshots } from '@/lib/ai-chat/approval-snapshot';
import type { SubmissionListItem } from '@/lib/custom-forms/queries';

const fmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export async function SubmissionList({
  items,
  showName,
}: {
  items: SubmissionListItem[];
  showName: boolean;
}) {
  if (items.length === 0) {
    return <div className="card text-sm text-td-muted">目前沒有申請紀錄。</div>;
  }

  const enriched = await enrichWithSnapshots(
    items.map((s) => ({ ...s, formType: 'custom' as const }))
  );

  return (
    <ul className="card divide-y divide-td-border !p-0">
      {enriched.map((s) => {
        const snap = s.snapshot;
        const progress = snap?.progress;
        return (
          <li key={s.id}>
            <Link
              href={`/f/${s.key}/${s.id}`}
              className="block space-y-2 px-5 py-4 transition hover:bg-td-blue-light/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="mono-case">{s.formNumber}</span>
                  {showName && (
                    <span className="text-sm font-semibold text-td-blue-dark">{s.name}</span>
                  )}
                  <span className={STATUS_BADGE[s.status] ?? 'badge-withdrawn'}>
                    {STATUS_LABELS[s.status] ?? s.status}
                  </span>
                  {s.status === 'pending_approval' && snap?.currentNodeLabel && (
                    <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-td-blue-dark">
                      {progress && progress.total > 0
                        ? `第 ${progress.done}/${progress.total} 關 · `
                        : ''}
                      待 {snap.currentNodeLabel}
                      {snap.pendingApproverNames.length > 0
                        ? `（${snap.pendingApproverNames.join('、')}）`
                        : ''}{' '}
                      簽核
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm">
                  {s.totalAmount !== null && (
                    <span className="font-semibold text-td-blue-dark">
                      NT$ {s.totalAmount.toLocaleString()}
                    </span>
                  )}
                  <span className="text-xs text-td-muted">{fmt.format(s.createdAt)}</span>
                </div>
              </div>

              {progress && progress.steps.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {progress.steps.map((step, idx) => {
                    const cls =
                      step.state === 'done'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : step.state === 'current'
                          ? 'bg-blue-50 text-td-blue-dark border-td-blue font-semibold'
                          : step.state === 'returned'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 font-semibold'
                            : 'bg-slate-50 text-slate-500 border-slate-200';
                    const mark =
                      step.state === 'done'
                        ? '✓'
                        : step.state === 'current'
                          ? '●'
                          : step.state === 'returned'
                            ? '↩'
                            : `${idx + 1}`;
                    return (
                      <span key={step.key} className="inline-flex items-center gap-1">
                        <span className={`rounded-full border px-2 py-0.5 ${cls}`}>
                          {mark} {step.label}
                          {step.name ? ` · ${step.name}` : ''}
                        </span>
                        {idx < progress.steps.length - 1 && (
                          <span className="text-slate-300">→</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
