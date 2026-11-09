import type { AiMessageBlock } from './blocks';
import type { ApprovalProgress, ApprovalSnapshot } from './approval-snapshot';
import type { InboxItem } from './inbox';
import type { MySubmissionHit } from './submissions-search';

function money(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return `NT$ ${n.toLocaleString('en-US')}`;
}

type CardProgress = NonNullable<Extract<AiMessageBlock, { kind: 'submission_card' }>['progress']>;

function cardProgress(
  snapshot: ApprovalSnapshot | null | undefined,
  fallbackStatus?: string
): CardProgress | undefined {
  if (!snapshot?.progress) return undefined;
  const p: ApprovalProgress = snapshot.progress;
  if (p.total <= 0 && fallbackStatus !== 'approved') return undefined;
  return {
    done: p.done,
    total: p.total || (fallbackStatus === 'approved' ? 1 : 0),
    remaining: p.remaining,
    percent: p.percent,
    currentLabel: snapshot.currentNodeLabel ?? undefined,
    waitingNames: snapshot.pendingApproverNames.length ? snapshot.pendingApproverNames : undefined,
    steps: p.steps.length
      ? p.steps.map((s) => ({
          key: s.key,
          label: s.label,
          name: s.name,
          state: s.state,
        }))
      : undefined,
  };
}

/** Build interactive outline cards for the approval queue. */
export function cardsFromPendingApprovals(
  items: Array<InboxItem & { snapshot?: ApprovalSnapshot | null }>
): AiMessageBlock[] {
  return items.slice(0, 12).map((i) => {
    const lines: Array<{ label: string; value: string }> = [];
    if (i.applicantName) lines.push({ label: '申請人', value: i.applicantName });
    if (i.summary) lines.push({ label: '摘要', value: i.summary });
    if (i.currentNodeLabel) lines.push({ label: '目前關卡', value: i.currentNodeLabel });
    if (i.waitingFor) lines.push({ label: '已等待', value: i.waitingFor });
    const amt = money(i.totalAmount);
    if (amt) lines.push({ label: '金額', value: amt });
    const progress = cardProgress(i.snapshot, i.status);
    return {
      kind: 'submission_card' as const,
      id: `sc_appr_${i.id}`,
      formType: i.formType,
      formId: i.id,
      formKey: i.formKey,
      formNumber: i.caseNumber,
      formName: i.label,
      mode: 'approve' as const,
      status: 'pending_approval',
      summary: i.summary || i.label,
      lines,
      applicantName: i.applicantName,
      canApprove: true,
      href: i.href,
      progress,
    };
  });
}

/** Build interactive outline cards for the owner's own submissions. */
export function cardsFromMySubmissions(
  items: Array<MySubmissionHit & { snapshot?: ApprovalSnapshot | null }>
): AiMessageBlock[] {
  return items.slice(0, 30).map((i) => {
    const lines: Array<{ label: string; value: string }> = [];
    if (i.summary) lines.push({ label: '摘要', value: i.summary });
    lines.push({ label: '狀態', value: statusLabel(i.status) });
    if (i.currentNodeLabel) lines.push({ label: '目前關卡', value: i.currentNodeLabel });
    const amt = money(i.totalAmount);
    if (amt) lines.push({ label: '金額', value: amt });
    if (i.returnReason) lines.push({ label: '退回原因', value: i.returnReason });
    if (i.approvedAt) lines.push({ label: '核准時間', value: i.approvedAt.replace('T', ' ').slice(0, 16) });
    const progress = cardProgress(i.snapshot, i.status);
    return {
      kind: 'submission_card' as const,
      id: `sc_mine_${i.formId}`,
      formType: i.formType,
      formId: i.formId,
      formKey: i.formKey || undefined,
      formNumber: i.formNumber,
      formName: i.formName,
      mode: 'mine' as const,
      status: i.status,
      summary: i.summary || i.formName,
      lines,
      canApprove: false,
      href: i.href || (i.formKey ? `/f/${i.formKey}/${i.formId}` : `/applications`),
      progress,
    };
  });
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending_approval':
      return '簽核中';
    case 'approved':
      return '已核准';
    case 'returned':
      return '已退回';
    case 'withdrawn':
      return '已撤回';
    default:
      return status;
  }
}
