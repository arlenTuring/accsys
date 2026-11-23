import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { getMyAcceptances } from '@/lib/acceptances/queries';
import { getMyApprovalQueueAll, type ApprovalQueueItem } from '@/lib/approvals/queue';
import { getMyAssetTransfers } from '@/lib/asset-transfers/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { getDb } from '@/lib/db';
import { approvalSteps, notifications } from '@/lib/db/schema';
import { EDITIONS } from '@/lib/expense-claims/editions';
import { getMyExpenseClaims } from '@/lib/expense-claims/queries';
import { getMyExpenseRequests } from '@/lib/expense-requests/queries';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';
import { getMyRequests } from '@/lib/purchase-requests/queries';
import { getMySealRequests } from '@/lib/seal-requests/lists';
import { taipeiToday } from '@/lib/taipei-date';
import { getMyTravelExpenses } from '@/lib/travel-expenses/queries';
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

export type ApprovedNoticeItem = {
  id: string;
  formType: string;
  formId: string;
  caseNumber: string;
  message: string;
  createdAt: string;
};

export type AssistantInbox = {
  fetchedAt: string;
  pendingApprovals: InboxItem[];
  myInProgress: InboxItem[];
  recentlyApproved?: ApprovedNoticeItem[];
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
async function countProgressToday(mine: InboxItem[]): Promise<{
  progressToday: number;
  recentlyApproved: ApprovedNoticeItem[];
}> {
  const employee = await getCurrentEmployee();
  if (!employee) return { progressToday: 0, recentlyApproved: [] };
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
    .select({
      id: notifications.id,
      type: notifications.type,
      formType: notifications.formType,
      formId: notifications.formId,
      caseNumber: notifications.caseNumber,
      message: notifications.message,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientEmployeeId, employee.id),
        inArray(notifications.type, ['request_returned', 'request_approved']),
        or(gte(notifications.createdAt, dayStart), eq(notifications.isRead, false))
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(20);
  for (const o of outcomes) touched.add(`${o.formType}:${o.formId}`);
  const recentlyApproved: ApprovedNoticeItem[] = outcomes
    .filter((o) => o.type === 'request_approved')
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      formType: o.formType,
      formId: o.formId,
      caseNumber: o.caseNumber,
      message: o.message,
      createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
    }));
  return { progressToday: touched.size, recentlyApproved };
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
export async function loadAssistantInbox(limitPerSection = 20): Promise<AssistantInbox> {
  const fetchedAt = new Date().toISOString();
  try {
    const [
      queue,
      requests,
      orders,
      acceptances,
      expenseRequests,
      claims,
      travelExpenses,
      sealRequests,
      assetTransfers,
      submissions,
    ] = await Promise.all([
      getMyApprovalQueueAll(),
      getMyRequests(),
      getMyPurchaseOrders(),
      getMyAcceptances(),
      getMyExpenseRequests(),
      getMyExpenseClaims(),
      getMyTravelExpenses(),
      getMySealRequests(),
      getMyAssetTransfers(),
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
      ...acceptances
        .filter((a) => IN_PROGRESS.has(a.status))
        .map((a) => ({
          kind: 'my_in_progress' as const,
          formType: 'acceptance',
          label: FORM_LABELS.acceptance,
          id: a.id,
          caseNumber: a.caseNumber,
          status: a.status,
          totalAmount: a.totalAmount,
          href: `${FORM_ROUTE_PREFIX.acceptance}/${a.id}`,
        })),
      ...expenseRequests
        .filter((e) => IN_PROGRESS.has(e.status))
        .map((e) => ({
          kind: 'my_in_progress' as const,
          formType: 'expense_request',
          label: FORM_LABELS.expense_request,
          id: e.id,
          caseNumber: e.caseNumber,
          status: e.status,
          totalAmount: e.totalAmount,
          href: `${FORM_ROUTE_PREFIX.expense_request}/${e.id}`,
        })),
      ...claims
        .filter((c) => IN_PROGRESS.has(c.status))
        .map((c) => {
          const ft = EDITIONS[c.edition].formType;
          return {
            kind: 'my_in_progress' as const,
            formType: ft,
            label: FORM_LABELS[ft],
            id: c.id,
            caseNumber: c.caseNumber,
            status: c.status,
            totalAmount: c.totalAmount,
            href: `/expense-claims/${c.edition}/${c.id}`,
          };
        }),
      ...travelExpenses
        .filter((t) => IN_PROGRESS.has(t.status))
        .map((t) => ({
          kind: 'my_in_progress' as const,
          formType: 'travel_expense',
          label: FORM_LABELS.travel_expense,
          id: t.id,
          caseNumber: t.caseNumber,
          status: t.status,
          totalAmount: t.totalAmount,
          href: `${FORM_ROUTE_PREFIX.travel_expense}/${t.id}`,
        })),
      ...sealRequests
        .filter((s) => IN_PROGRESS.has(s.status))
        .map((s) => ({
          kind: 'my_in_progress' as const,
          formType: s.formType,
          label: FORM_LABELS[s.formType],
          id: s.id,
          caseNumber: s.caseNumber,
          status: s.status,
          totalAmount: s.totalAmount,
          href: `${FORM_ROUTE_PREFIX[s.formType]}/${s.id}`,
        })),
      ...assetTransfers
        .filter((a) => IN_PROGRESS.has(a.status))
        .map((a) => ({
          kind: 'my_in_progress' as const,
          formType: 'asset_transfer',
          label: FORM_LABELS.asset_transfer,
          id: a.id,
          caseNumber: a.caseNumber,
          status: a.status,
          totalAmount: null,
          href: `${FORM_ROUTE_PREFIX.asset_transfer}/${a.id}`,
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

    const [pendingEnriched, mineEnriched, progressInfo, facts] = await Promise.all([
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
      recentlyApproved: progressInfo.recentlyApproved,
      loadError: null,
      hasMorePending: pendingAll.length > limitPerSection,
      hasMoreMine: mineAll.length > limitPerSection,
      pendingTotal: pendingAll.length,
      mineTotal: mineAll.length,
      returnedTotal: mineAll.filter((m) => m.status === 'returned').length,
      progressToday: progressInfo.progressToday,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'inbox_load_failed';
    return {
      fetchedAt,
      pendingApprovals: [],
      myInProgress: [],
      recentlyApproved: [],
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
