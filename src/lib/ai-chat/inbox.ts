import { and, eq, gte, inArray } from 'drizzle-orm';
import { getMyApprovalQueueAll, type ApprovalQueueItem } from '@/lib/approvals/queue';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { getDb } from '@/lib/db';
import { approvalSteps, notifications } from '@/lib/db/schema';
import { getMyExpenseClaims } from '@/lib/expense-claims/queries';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';
import { getMyRequests } from '@/lib/purchase-requests/queries';
import { taipeiToday } from '@/lib/taipei-date';
import {
  enrichWithSnapshots,
  formatWaitingDuration,
  type ApprovalSnapshot,
} from './approval-snapshot';
import { factsFor, factsLine, loadFormFacts } from './form-facts';

export type InboxItem = {
  kind: 'pending_approval' | 'my_in_progress';
  formType: string;
  label: string;
  id: string;
  caseNumber: string;
  status?: string;
  applicantName?: string;
  totalAmount: number | null;
  href: string;
  /** Designer form key when formType is custom. */
  formKey?: string;
  currentNodeLabel?: string | null;
  pendingApproverNames?: string[];
  waitingSinceIso?: string | null;
  waitingFor?: string | null;
  /** Purpose, place, date, amount: what lets a person recognise the form without its number. */
  summary?: string;
  /** Attached when inbox enrichment runs (for card progress bars). */
  snapshot?: import('./approval-snapshot').ApprovalSnapshot | null;
};

export type AssistantInbox = {
  fetchedAt: string;
  pendingApprovals: InboxItem[];
  myInProgress: InboxItem[];
  loadError: string | null;
  hasMorePending: boolean;
  hasMoreMine: boolean;
  /** Real totals, not the size of the page above. */
  pendingTotal: number;
  mineTotal: number;
  returnedTotal: number;
  /** My forms with an approval decision today (company calendar). */
  progressToday: number;
};

const IN_PROGRESS = new Set(['pending_approval', 'returned']);

function asQueueItem(q: ApprovalQueueItem): InboxItem {
  return {
    kind: 'pending_approval',
    formType: q.formType,
    label: q.label,
    id: q.id,
    caseNumber: q.caseNumber,
    applicantName: q.applicantName,
    totalAmount: q.totalAmount,
    href: q.href,
    formKey: q.formKey,
  };
}

/** Forms of mine an approver acted on today, finished ones included. */
async function countProgressToday(mine: InboxItem[]): Promise<number> {
  const employee = await getCurrentEmployee();
  if (!employee) return 0;
  const dayStart = new Date(`${taipeiToday()}T00:00:00+08:00`);
  const db = getDb();
  const touched = new Set<string>();
  const ids = mine.map((m) => m.id);
  if (ids.length > 0) {
    const acted = await db
      .select({ formType: approvalSteps.formType, formId: approvalSteps.formId })
      .from(approvalSteps)
      .where(and(inArray(approvalSteps.formId, ids), inArray(approvalSteps.status, ['approved', 'returned']), gte(approvalSteps.actedAt, dayStart)));
    for (const a of acted) touched.add(`${a.formType}:${a.formId}`);
  }
  const outcomes = await db
    .select({ formType: notifications.formType, formId: notifications.formId })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientEmployeeId, employee.id),
        inArray(notifications.type, ['request_returned', 'request_approved']),
        gte(notifications.createdAt, dayStart)
      )
    );
  for (const o of outcomes) touched.add(`${o.formType}:${o.formId}`);
  return touched.size;
}

function applySnapshot(item: InboxItem, snapshot: ApprovalSnapshot | null): InboxItem {
  if (!snapshot) return { ...item, snapshot: null };
  return {
    ...item,
    currentNodeLabel: snapshot.currentNodeLabel,
    pendingApproverNames: snapshot.pendingApproverNames,
    waitingSinceIso: snapshot.waitingSinceIso,
    waitingFor: formatWaitingDuration(snapshot.waitingSinceIso),
    snapshot,
  };
}

/**
 * Backend-authoritative inbox for the assistant workspace.
 * On failure returns loadError with empty lists — UI must not claim “沒有待辦”.
 */
export async function loadAssistantInbox(limitPerSection = 8): Promise<AssistantInbox> {
  const fetchedAt = new Date().toISOString();
  try {
    const [queue, requests, orders, claims, submissions] = await Promise.all([
      getMyApprovalQueueAll(),
      getMyRequests(),
      getMyPurchaseOrders(),
      getMyExpenseClaims(),
      getMySubmissions(),
    ]);

    // getMyApprovalQueueAll already covers designer forms.
    const pendingAll: InboxItem[] = queue.map(asQueueItem);

    const mineAll: InboxItem[] = [
      ...requests
        .filter((r) => IN_PROGRESS.has(r.status))
        .map((r) => ({
          kind: 'my_in_progress' as const,
          formType: 'purchase_request',
          label: FORM_LABELS.purchase_request,
          id: r.id,
          caseNumber: r.caseNumber,
          status: r.status,
          totalAmount: r.totalAmount,
          href: `${FORM_ROUTE_PREFIX.purchase_request}/${r.id}`,
        })),
      ...orders
        .filter((o) => IN_PROGRESS.has(o.status))
        .map((o) => ({
          kind: 'my_in_progress' as const,
          formType: 'purchase_order',
          label: FORM_LABELS.purchase_order,
          id: o.id,
          caseNumber: o.caseNumber,
          status: o.status,
          totalAmount: o.totalAmount,
          href: `${FORM_ROUTE_PREFIX.purchase_order}/${o.id}`,
        })),
      ...claims
        .filter((c) => IN_PROGRESS.has(c.status))
        .map((c) => ({
          kind: 'my_in_progress' as const,
          formType: String(c.edition),
          label: `費用申請（${c.edition}）`,
          id: c.id,
          caseNumber: c.caseNumber,
          status: c.status,
          totalAmount: c.totalAmount,
          href: `/expense-claims/${c.edition}/${c.id}`,
        })),
      ...submissions
        .filter((s) => IN_PROGRESS.has(s.status))
        .map((s) => ({
          kind: 'my_in_progress' as const,
          formType: 'custom' as const,
          label: s.name,
          id: s.id,
          caseNumber: s.formNumber,
          status: s.status,
          totalAmount: s.totalAmount === null ? null : Number(s.totalAmount),
          href: `/f/${s.key}/${s.id}`,
          formKey: s.key,
        })),
    ];

    const pendingSlice = pendingAll.slice(0, limitPerSection);
    const mineSlice = mineAll.slice(0, limitPerSection);

    const [pendingEnriched, mineEnriched, progressToday, facts] = await Promise.all([
      enrichWithSnapshots(pendingSlice),
      enrichWithSnapshots(mineSlice),
      countProgressToday(mineAll),
      loadFormFacts([...pendingSlice, ...mineSlice].map((i) => ({ formType: i.formType, formId: i.id }))),
    ]);
    const withSummary = (item: InboxItem): InboxItem => {
      const f = factsFor(facts, { formType: item.formType, formId: item.id });
      return f ? { ...item, summary: factsLine(f) } : item;
    };

    return {
      fetchedAt,
      pendingApprovals: pendingEnriched.map((p) => withSummary(applySnapshot(p, p.snapshot))),
      myInProgress: mineEnriched.map((p) => withSummary(applySnapshot(p, p.snapshot))),
      loadError: null,
      hasMorePending: pendingAll.length > limitPerSection,
      hasMoreMine: mineAll.length > limitPerSection,
      pendingTotal: pendingAll.length,
      mineTotal: mineAll.length,
      returnedTotal: mineAll.filter((m) => m.status === 'returned').length,
      progressToday,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'inbox_load_failed';
    return {
      fetchedAt,
      pendingApprovals: [],
      myInProgress: [],
      loadError: message.slice(0, 200),
      hasMorePending: false,
      hasMoreMine: false,
      pendingTotal: 0,
      mineTotal: 0,
      returnedTotal: 0,
      progressToday: 0,
    };
  }
}

/** Load more items for one section (offset-based). */
export async function loadAssistantInboxMore(
  section: 'pending' | 'mine',
  offset: number,
  limit = 8
): Promise<{ items: InboxItem[]; hasMore: boolean; loadError: string | null }> {
  const inbox = await loadAssistantInbox(Math.max(offset + limit + 1, 8));
  if (inbox.loadError) return { items: [], hasMore: false, loadError: inbox.loadError };
  // loadAssistantInbox caps each section; for "more" re-fetch with a larger cap.
  const wide = await loadAssistantInbox(Math.max(offset + limit + 8, 24));
  const source = section === 'pending' ? wide.pendingApprovals : wide.myInProgress;
  const items = source.slice(offset, offset + limit);
  return {
    items,
    hasMore: source.length > offset + limit,
    loadError: wide.loadError,
  };
}

export type { FormType };
