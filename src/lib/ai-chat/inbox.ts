import { getMyApprovalQueueAll, type ApprovalQueueItem } from '@/lib/approvals/queue';
import { getMyCustomApprovalQueue, getMySubmissions } from '@/lib/custom-forms/queries';
import { getMyExpenseClaims } from '@/lib/expense-claims/queries';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';
import { getMyRequests } from '@/lib/purchase-requests/queries';
import {
  enrichWithSnapshots,
  formatWaitingDuration,
  type ApprovalSnapshot,
} from './approval-snapshot';

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
  currentNodeLabel?: string | null;
  pendingApproverNames?: string[];
  waitingSinceIso?: string | null;
  waitingFor?: string | null;
};

export type AssistantInbox = {
  fetchedAt: string;
  pendingApprovals: InboxItem[];
  myInProgress: InboxItem[];
  loadError: string | null;
  hasMorePending: boolean;
  hasMoreMine: boolean;
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
  };
}

function applySnapshot(item: InboxItem, snapshot: ApprovalSnapshot | null): InboxItem {
  if (!snapshot) return item;
  return {
    ...item,
    currentNodeLabel: snapshot.currentNodeLabel,
    pendingApproverNames: snapshot.pendingApproverNames,
    waitingSinceIso: snapshot.waitingSinceIso,
    waitingFor: formatWaitingDuration(snapshot.waitingSinceIso),
  };
}

/**
 * Backend-authoritative inbox for the assistant workspace.
 * On failure returns loadError with empty lists — UI must not claim “沒有待辦”.
 */
export async function loadAssistantInbox(limitPerSection = 8): Promise<AssistantInbox> {
  const fetchedAt = new Date().toISOString();
  try {
    const [queue, requests, orders, claims, customQueue, submissions] = await Promise.all([
      getMyApprovalQueueAll(),
      getMyRequests(),
      getMyPurchaseOrders(),
      getMyExpenseClaims(),
      getMyCustomApprovalQueue(),
      getMySubmissions(),
    ]);

    const pendingAll: InboxItem[] = [
      ...queue.map(asQueueItem),
      ...customQueue.map((q) => ({
        kind: 'pending_approval' as const,
        formType: 'custom',
        label: q.label,
        id: q.id,
        caseNumber: q.caseNumber,
        applicantName: q.applicantName,
        totalAmount: q.totalAmount,
        href: `/f/_/${q.id}`,
      })),
    ];

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
        })),
    ];

    const pendingSlice = pendingAll.slice(0, limitPerSection);
    const mineSlice = mineAll.slice(0, limitPerSection);

    const [pendingEnriched, mineEnriched] = await Promise.all([
      enrichWithSnapshots(pendingSlice),
      enrichWithSnapshots(mineSlice),
    ]);

    return {
      fetchedAt,
      pendingApprovals: pendingEnriched.map((p) => applySnapshot(p, p.snapshot)),
      myInProgress: mineEnriched.map((p) => applySnapshot(p, p.snapshot)),
      loadError: null,
      hasMorePending: pendingAll.length > limitPerSection,
      hasMoreMine: mineAll.length > limitPerSection,
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
