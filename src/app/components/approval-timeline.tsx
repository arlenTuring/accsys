import { getApprovalTimeline, type TimelineNode, type TimelineNodeState } from '@/lib/approval/timeline';
import type { FormType } from '@/lib/procurement/form-registry';

const HEADLINE: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '簽核完成',
  returned: '已退回',
  withdrawn: '已撤回',
};

const STATE: Record<TimelineNodeState, { icon: string; text: string; ring: string; badge: string }> = {
  approved: { icon: '✓', text: '已核准', ring: 'border-emerald-500 bg-emerald-50 text-emerald-700', badge: 'text-emerald-700' },
  returned: { icon: '↺', text: '已退回', ring: 'border-amber-500 bg-amber-50 text-amber-700', badge: 'text-amber-700' },
  current: { icon: '●', text: '簽核中', ring: 'border-td-blue bg-td-blue-light text-td-blue-dark', badge: 'text-td-blue' },
  waiting: { icon: '○', text: '尚未輪到', ring: 'border-slate-300 bg-white text-slate-400', badge: 'text-td-muted' },
  auto_approved: { icon: '⚙', text: '由系統代簽', ring: 'border-slate-400 bg-slate-50 text-slate-600', badge: 'text-slate-600' },
  skipped: { icon: '–', text: '略過', ring: 'border-dashed border-slate-300 bg-white text-slate-400', badge: 'text-td-muted' },
};

const timeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const when = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : null);
const initial = (name: string | null) => (name ? Array.from(name.trim())[0] ?? '?' : '?');

function Node({
  top,
  name,
  state,
  time,
  detail,
  note,
}: {
  top: string;
  name: string;
  state: TimelineNodeState | 'applicant';
  time: string | null;
  detail?: string | null;
  note?: string | null;
}) {
  const s = state === 'applicant' ? null : STATE[state];
  return (
    <li className="relative flex min-w-0 gap-3 pb-5 after:absolute after:bottom-0 after:left-5 after:top-11 after:w-px after:bg-td-border last:pb-0 last:after:hidden sm:w-40 sm:shrink-0 sm:flex-col sm:items-center sm:gap-1 sm:pb-0 sm:text-center sm:after:bottom-auto sm:after:left-[calc(50%+1.5rem)] sm:after:top-5 sm:after:h-px sm:after:w-[calc(100%-3rem+0.5rem)] print:w-40 print:flex-col print:items-center print:text-center">
      <span
        aria-hidden
        className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${
          s ? s.ring : 'border-td-blue bg-td-blue text-white'
        }`}
      >
        {initial(name)}
        {s && (
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white text-[11px] shadow">
            {s.icon}
          </span>
        )}
      </span>
      <div className="min-w-0 sm:mt-1">
        <p className="text-xs text-td-muted">{top}</p>
        <p className="break-words text-sm font-semibold text-td-blue-dark">{name}</p>
        <p className={`text-xs font-medium ${s ? s.badge : 'text-td-blue'}`}>{s ? s.text : '送出申請'}</p>
        {time && <p className="text-xs text-td-muted">{time}</p>}
        {detail && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-amber-800">意見：{detail}</p>}
        {note && <p className="mt-1 break-words text-xs text-td-muted">{note}</p>}
      </div>
    </li>
  );
}

function Track({ applicantName, submittedAt, nodes }: { applicantName: string; submittedAt: string | null; nodes: TimelineNode[] }) {
  return (
    <ol className="flex flex-col sm:flex-row sm:gap-2 sm:overflow-x-auto sm:pb-2 print:flex-row print:flex-wrap print:gap-2">
      <Node top="申請人" name={applicantName} state="applicant" time={when(submittedAt)} />
      {nodes.map((n) => (
        <Node
          key={n.key}
          top={n.sourceLabel && n.sourceLabel !== n.label ? `${n.sourceLabel}・${n.label}` : n.label}
          name={
            n.approverName
              ? n.delegatedFromName
                ? `${n.delegatedFromName}（由 ${n.approverName} 代理）`
                : n.approverName
              : '（無簽核人）'
          }
          state={n.state}
          time={when(n.actedAt)}
          detail={n.state === 'returned' || n.state === 'approved' ? n.comment : null}
          note={n.systemNote}
        />
      ))}
    </ol>
  );
}

/** Approval progress in the style of the previous system's horizontal timeline (vertical on phones). */
export async function ApprovalTimeline({ formType, formId }: { formType: FormType; formId: string }) {
  const data = await getApprovalTimeline(formType, formId);
  if (!data) return null;
  return (
    <section className="card">
      <h2 className="mb-4 text-sm font-semibold text-td-blue-dark">
        簽核流程：<span className="text-td-blue">{HEADLINE[data.formStatus] ?? data.formStatus}</span>
      </h2>
      {data.nodes.length === 0 ? (
        <p className="text-sm text-td-muted">
          {data.formStatus === 'approved' ? '此表單不需簽核（已自動核准）。' : '目前沒有簽核關卡。'}
        </p>
      ) : (
        <Track applicantName={data.applicantName} submittedAt={data.submittedAt} nodes={data.nodes} />
      )}
      {data.previousRounds.length > 0 && (
        <details className="mt-4 rounded border border-td-border bg-slate-50/60 px-4 py-3 print:hidden">
          <summary className="cursor-pointer text-sm font-medium text-td-blue-dark">
            先前的送出紀錄（{data.previousRounds.length} 次）
          </summary>
          <div className="mt-3 space-y-4">
            {[...data.previousRounds].reverse().map((r) => (
              <div key={r.endedAt}>
                <p className="mb-2 text-xs text-td-muted">
                  {when(r.submittedAt) ?? '—'} 送出，{when(r.endedAt)} 重新送出
                </p>
                <Track applicantName={data.applicantName} submittedAt={r.submittedAt} nodes={r.nodes} />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
