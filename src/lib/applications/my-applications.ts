import { and, desc, eq, inArray } from 'drizzle-orm';
import { getMyAcceptances } from '@/lib/acceptances/queries';
import {
  enrichWithSnapshots,
  formatWaitingDuration,
  type ApprovalProgress,
} from '@/lib/ai-chat/approval-snapshot';
import { factsFor, loadFormFacts } from '@/lib/ai-chat/form-facts';
import { getMyApprovalQueueAll } from '@/lib/approvals/queue';
import { getMyAssetTransfers } from '@/lib/asset-transfers/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { getDb } from '@/lib/db';
import { approvalSteps, employees, formCategories, formDefinitions } from '@/lib/db/schema';
import { EDITIONS } from '@/lib/expense-claims/editions';
import { getMyExpenseClaims } from '@/lib/expense-claims/queries';
import { getMyExpenseRequests } from '@/lib/expense-requests/queries';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';
import { getMyRequests } from '@/lib/purchase-requests/queries';
import { getMySealRequests } from '@/lib/seal-requests/lists';
import { getMyTravelExpenses } from '@/lib/travel-expenses/queries';
import { listFormDraftsForOwner } from '@/lib/form-drafts/service';

export type MyApplicationCategoryKey =
  | 'procurement'
  | 'expense'
  | 'seal'
  | 'asset'
  | 'other';

export const APPLICATION_CATEGORY_LABELS: Record<MyApplicationCategoryKey, string> = {
  procurement: '採購流程',
  expense: '費用與差旅報支',
  seal: '用印申請',
  asset: '資產管理',
  other: '差勤與其他表單',
};

export type MyApplicationItem = {
  id: string;
  formType: FormType;
  formKey?: string;
  formLabel: string;
  categoryKey: MyApplicationCategoryKey;
  categoryLabel: string;
  caseNumber: string;
  status: string;
  totalAmount: number | null;
  currency?: string;
  dateLabel: string;
  sortTimestamp: number;
  href: string;
  editHref?: string;
  cloneHref?: string;
  draftId?: string;
  canSelfEditBeforeFirstApproval?: boolean;
  summary: string;
  /** Approval progress details */
  progress: ApprovalProgress | null;
  currentNodeLabel: string | null;
  pendingApproverNames: string[];
  waitingFor: string | null;
  /** Populated when status === 'returned' */
  returnReason: string | null;
  returnedByName: string | null;
};

export type PendingApprovalRichItem = {
  id: string;
  formType: FormType;
  formKey?: string;
  formLabel: string;
  categoryKey: MyApplicationCategoryKey;
  categoryLabel: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number | null;
  currency?: string;
  href: string;
  summary: string;
  version: number | null;
  progress: ApprovalProgress | null;
  currentNodeLabel: string | null;
  waitingFor: string | null;
};

function mapCustomCategoryKey(rawKey: string | undefined, formKey: string): MyApplicationCategoryKey {
  if (formKey === 'standalone-payment') {
    return 'expense';
  }
  if (rawKey === 'procurement' || formKey.includes('purchase') || formKey === 'acceptance' || formKey === 'procurement-payment') {
    return 'procurement';
  }
  if (
    rawKey === 'expense' ||
    formKey.includes('expense') ||
    formKey.includes('payment') ||
    formKey.includes('trip')
  ) {
    return 'expense';
  }
  if (rawKey === 'seal' || formKey.includes('seal')) {
    return 'seal';
  }
  if (rawKey === 'asset' || formKey.includes('asset')) {
    return 'asset';
  }
  return 'other';
}

function mapFormTypeCategoryKey(
  formType: FormType,
  formKey: string | undefined,
  catByFormKey: Map<string, string>
): MyApplicationCategoryKey {
  if (formType === 'custom') {
    return mapCustomCategoryKey(formKey ? catByFormKey.get(formKey) : undefined, formKey ?? '');
  }
  if (
    formType === 'purchase_request' ||
    formType === 'purchase_order' ||
    formType === 'acceptance' ||
    formType === 'expense_request'
  ) {
    return 'procurement';
  }
  if (
    formType === 'department_expense' ||
    formType === 'project_expense' ||
    formType === 'revenue_expense' ||
    formType === 'minor_expense' ||
    formType === 'travel_expense'
  ) {
    return 'expense';
  }
  if (
    formType === 'contract_seal_request' ||
    formType === 'general_seal_request' ||
    formType === 'invoice_seal_request'
  ) {
    return 'seal';
  }
  if (formType === 'asset_transfer') {
    return 'asset';
  }
  return 'other';
}

function parseTimestamp(dateStrOrDate: Date | string | null | undefined, fallbackIdx = 0): number {
  if (!dateStrOrDate) return Date.now() - fallbackIdx * 1000;
  if (dateStrOrDate instanceof Date) return dateStrOrDate.getTime();
  const parsed = Date.parse(dateStrOrDate);
  return Number.isFinite(parsed) ? parsed : Date.now() - fallbackIdx * 1000;
}

const fmtDate = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export async function getMyPendingApprovalsEnriched(): Promise<PendingApprovalRichItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];

  const db = getDb();
  const [queue, defCategories] = await Promise.all([
    getMyApprovalQueueAll(),
    db
      .select({
        key: formDefinitions.key,
        catKey: formCategories.key,
      })
      .from(formDefinitions)
      .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId)),
  ]);

  if (queue.length === 0) return [];

  const catByFormKey = new Map(defCategories.map((d) => [d.key, d.catKey]));

  const [snapshots, factsMap] = await Promise.all([
    enrichWithSnapshots(queue),
    loadFormFacts(queue.map((q) => ({ formType: q.formType, formId: q.id }))),
  ]);

  return snapshots.map((q) => {
    const catKey = mapFormTypeCategoryKey(q.formType, q.formKey, catByFormKey);
    const f = factsFor(factsMap, { formType: q.formType, formId: q.id });
    const summary = f ? [f.what, f.where, f.when].filter(Boolean).join(' · ') : '';
    const snap = q.snapshot;

    return {
      id: q.id,
      formType: q.formType,
      formKey: q.formKey,
      formLabel: q.label,
      categoryKey: catKey,
      categoryLabel: APPLICATION_CATEGORY_LABELS[catKey],
      caseNumber: q.caseNumber,
      applicantName: q.applicantName,
      totalAmount: q.totalAmount,
      currency: q.currency,
      href: q.href,
      summary,
      version: snap?.version ?? null,
      progress: snap?.progress ?? null,
      currentNodeLabel: snap?.currentNodeLabel ?? null,
      waitingFor: snap ? formatWaitingDuration(snap.waitingSinceIso) : null,
    };
  });
}

export async function getMyApplicationsAll(): Promise<MyApplicationItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];

  const db = getDb();

  const [
    customSubs,
    requests,
    orders,
    acceptances,
    expenseRequests,
    expenseClaims,
    travelExpenses,
    sealRequests,
    assetTransfers,
    defCategories,
  ] = await Promise.all([
    getMySubmissions(),
    getMyRequests(),
    getMyPurchaseOrders(),
    getMyAcceptances(),
    getMyExpenseRequests(),
    getMyExpenseClaims(),
    getMyTravelExpenses(),
    getMySealRequests(),
    getMyAssetTransfers(),
    db
      .select({
        key: formDefinitions.key,
        catKey: formCategories.key,
      })
      .from(formDefinitions)
      .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId)),
  ]);

  const catByFormKey = new Map(defCategories.map((d) => [d.key, d.catKey]));

  const baseItems: (Omit<
    MyApplicationItem,
    | 'summary'
    | 'progress'
    | 'currentNodeLabel'
    | 'pendingApproverNames'
    | 'waitingFor'
    | 'returnReason'
    | 'returnedByName'
  > & { fallbackSummary?: string })[] = [
    ...customSubs.map((s) => {
      const catKey = mapCustomCategoryKey(catByFormKey.get(s.key), s.key);
      return {
        id: s.id,
        formType: 'custom' as const,
        formKey: s.key,
        formLabel: s.name,
        categoryKey: catKey,
        categoryLabel: APPLICATION_CATEGORY_LABELS[catKey],
        caseNumber: s.formNumber,
        status: s.status,
        totalAmount: s.totalAmount,
        dateLabel: fmtDate.format(s.createdAt),
        sortTimestamp: s.createdAt.getTime(),
        href: `/f/${s.key}/${s.id}`,
        editHref: `/f/${s.key}/${s.id}/edit`,
        cloneHref: `/f/${s.key}/new?copyFrom=${s.id}`,
      };
    }),
    ...requests.map((r, i) => ({
      id: r.id,
      formType: 'purchase_request' as const,
      formLabel: FORM_LABELS.purchase_request,
      categoryKey: 'procurement' as const,
      categoryLabel: APPLICATION_CATEGORY_LABELS.procurement,
      caseNumber: r.caseNumber,
      status: r.status,
      totalAmount: r.totalAmount,
      dateLabel: r.requestDate,
      sortTimestamp: parseTimestamp(r.requestDate, i),
      href: `${FORM_ROUTE_PREFIX.purchase_request}/${r.id}`,
      editHref: r.status === 'returned' ? `${FORM_ROUTE_PREFIX.purchase_request}/${r.id}/edit` : undefined,
    })),
    ...orders.map((o, i) => ({
      id: o.id,
      formType: 'purchase_order' as const,
      formLabel: FORM_LABELS.purchase_order,
      categoryKey: 'procurement' as const,
      categoryLabel: APPLICATION_CATEGORY_LABELS.procurement,
      caseNumber: o.caseNumber,
      status: o.status,
      totalAmount: o.totalAmount,
      dateLabel: o.caseNumber.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3'),
      sortTimestamp: parseTimestamp(null, 100 + i),
      href: `${FORM_ROUTE_PREFIX.purchase_order}/${o.id}`,
      editHref: o.status === 'returned' ? `${FORM_ROUTE_PREFIX.purchase_order}/${o.id}/edit` : undefined,
    })),
    ...acceptances.map((a, i) => ({
      id: a.id,
      formType: 'acceptance' as const,
      formLabel: FORM_LABELS.acceptance,
      categoryKey: 'procurement' as const,
      categoryLabel: APPLICATION_CATEGORY_LABELS.procurement,
      caseNumber: a.caseNumber,
      status: a.status,
      totalAmount: a.totalAmount,
      dateLabel: a.caseNumber.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3'),
      sortTimestamp: parseTimestamp(null, 200 + i),
      href: `${FORM_ROUTE_PREFIX.acceptance}/${a.id}`,
      editHref: a.status === 'returned' ? `${FORM_ROUTE_PREFIX.acceptance}/${a.id}/edit` : undefined,
    })),
    ...expenseRequests.map((e, i) => ({
      id: e.id,
      formType: 'expense_request' as const,
      formLabel: FORM_LABELS.expense_request,
      categoryKey: 'procurement' as const,
      categoryLabel: APPLICATION_CATEGORY_LABELS.procurement,
      caseNumber: e.caseNumber,
      status: e.status,
      totalAmount: e.totalAmount,
      dateLabel: e.caseNumber.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3'),
      sortTimestamp: parseTimestamp(null, 300 + i),
      href: `${FORM_ROUTE_PREFIX.expense_request}/${e.id}`,
      editHref: e.status === 'returned' ? `${FORM_ROUTE_PREFIX.expense_request}/${e.id}/edit` : undefined,
    })),
    ...expenseClaims.map((c) => {
      const ft = EDITIONS[c.edition].formType;
      return {
        id: c.id,
        formType: ft,
        formLabel: FORM_LABELS[ft],
        categoryKey: 'expense' as const,
        categoryLabel: APPLICATION_CATEGORY_LABELS.expense,
        caseNumber: c.caseNumber,
        status: c.status,
        totalAmount: c.totalAmount,
        dateLabel: c.applicationDate || fmtDate.format(c.createdAt),
        sortTimestamp: c.createdAt.getTime(),
        href: `/expense-claims/${c.edition}/${c.id}`,
        editHref: c.status === 'returned' ? `/expense-claims/${c.edition}/${c.id}/edit` : undefined,
        fallbackSummary: c.firstItem
          ? c.lineCount > 1
            ? `${c.firstItem} 等 ${c.lineCount} 項`
            : c.firstItem
          : '',
      };
    }),
    ...travelExpenses.map((t, i) => ({
      id: t.id,
      formType: 'travel_expense' as const,
      formLabel: FORM_LABELS.travel_expense,
      categoryKey: 'expense' as const,
      categoryLabel: APPLICATION_CATEGORY_LABELS.expense,
      caseNumber: t.caseNumber,
      status: t.status,
      totalAmount: t.totalAmount,
      dateLabel: t.formDate || t.tripStartDate,
      sortTimestamp: parseTimestamp(t.formDate || t.tripStartDate, 400 + i),
      href: `${FORM_ROUTE_PREFIX.travel_expense}/${t.id}`,
      editHref: t.status === 'returned' ? `${FORM_ROUTE_PREFIX.travel_expense}/${t.id}/edit` : undefined,
      fallbackSummary: [t.purpose, `${t.tripStartDate} ～ ${t.tripEndDate}`].filter(Boolean).join(' · '),
    })),
    ...sealRequests.map((s) => ({
      id: s.id,
      formType: s.formType,
      formLabel: FORM_LABELS[s.formType],
      categoryKey: 'seal' as const,
      categoryLabel: APPLICATION_CATEGORY_LABELS.seal,
      caseNumber: s.caseNumber,
      status: s.status,
      totalAmount: s.totalAmount,
      currency: s.currency,
      dateLabel: fmtDate.format(s.createdAt),
      sortTimestamp: s.createdAt.getTime(),
      href: `${FORM_ROUTE_PREFIX[s.formType]}/${s.id}`,
      editHref: s.status === 'returned' ? `${FORM_ROUTE_PREFIX[s.formType]}/${s.id}/edit` : undefined,
      fallbackSummary: [s.title, s.documentLabel].filter(Boolean).join(' · '),
    })),
    ...assetTransfers.map((a, i) => ({
      id: a.id,
      formType: 'asset_transfer' as const,
      formLabel: FORM_LABELS.asset_transfer,
      categoryKey: 'asset' as const,
      categoryLabel: APPLICATION_CATEGORY_LABELS.asset,
      caseNumber: a.caseNumber,
      status: a.status,
      totalAmount: null,
      dateLabel: a.applicationDate,
      sortTimestamp: parseTimestamp(a.applicationDate, 500 + i),
      href: `${FORM_ROUTE_PREFIX.asset_transfer}/${a.id}`,
      editHref: a.status === 'returned' ? `${FORM_ROUTE_PREFIX.asset_transfer}/${a.id}/edit` : undefined,
      fallbackSummary: a.firstAsset
        ? a.lineCount > 1
          ? `${a.firstAsset} 等 ${a.lineCount} 項`
          : a.firstAsset
        : '',
    })),
  ];

  if (baseItems.length === 0) return [];

  const returnedIds = baseItems.filter((i) => i.status === 'returned').map((i) => i.id);

  const [snapshots, factsMap, returnRows] = await Promise.all([
    enrichWithSnapshots(baseItems),
    loadFormFacts(baseItems.map((i) => ({ formType: i.formType, formId: i.id }))),
    returnedIds.length > 0
      ? db
          .select({
            formType: approvalSteps.formType,
            formId: approvalSteps.formId,
            comment: approvalSteps.comment,
            approverName: employees.name,
            actedAt: approvalSteps.actedAt,
          })
          .from(approvalSteps)
          .leftJoin(employees, eq(employees.id, approvalSteps.approverEmployeeId))
          .where(and(inArray(approvalSteps.formId, returnedIds), eq(approvalSteps.status, 'returned')))
          .orderBy(desc(approvalSteps.actedAt))
      : Promise.resolve([]),
  ]);

  const returnByKey = new Map<string, { reason: string | null; byName: string | null }>();
  for (const r of returnRows) {
    const key = `${r.formType}:${r.formId}`;
    if (!returnByKey.has(key)) {
      returnByKey.set(key, {
        reason: r.comment?.trim() || null,
        byName: r.approverName ?? null,
      });
    }
  }

  const enriched: MyApplicationItem[] = snapshots.map((item) => {
    const f = factsFor(factsMap, { formType: item.formType, formId: item.id });
    const factParts = f ? [f.what, f.where, f.when].filter(Boolean).join(' · ') : '';
    const fallback = item.fallbackSummary ?? '';
    const summary = factParts || fallback || '';

    const snap = item.snapshot;
    const ret = returnByKey.get(`${item.formType}:${item.id}`);
    const canSelfEditBeforeFirstApproval =
      item.status === 'pending_approval' && (snap?.progress?.done ?? 0) === 0;
    const rawEditHref =
      item.editHref ?? `${item.href}/edit`;
    const effectiveEditHref =
      item.status === 'returned' || canSelfEditBeforeFirstApproval ? rawEditHref : undefined;

    return {
      id: item.id,
      formType: item.formType,
      formKey: item.formKey,
      formLabel: item.formLabel,
      categoryKey: item.categoryKey,
      categoryLabel: item.categoryLabel,
      caseNumber: item.caseNumber,
      status: item.status,
      totalAmount: item.totalAmount,
      currency: item.currency,
      dateLabel: item.dateLabel,
      sortTimestamp: item.sortTimestamp,
      href: item.href,
      editHref: effectiveEditHref,
      cloneHref: item.cloneHref,
      canSelfEditBeforeFirstApproval,
      summary,
      progress: snap?.progress ?? null,
      currentNodeLabel: snap?.currentNodeLabel ?? null,
      pendingApproverNames: snap?.pendingApproverNames ?? [],
      waitingFor: snap ? formatWaitingDuration(snap.waitingSinceIso) : null,
      returnReason: ret?.reason ?? null,
      returnedByName: ret?.byName ?? null,
    };
  });

  const statusRank = (s: string) => {
    if (s === 'draft') return -1;
    if (s === 'returned') return 0;
    if (s === 'pending_approval') return 1;
    if (s === 'approved') return 2;
    return 3;
  };

  const { getSystemFeatureFlags } = await import('@/lib/feature-flags/service');
  const { resolveFeatureFlagForFormKey } = await import('@/lib/feature-flags/definitions');
  const featureFlags = await getSystemFeatureFlags();

  return enriched
    .filter((item) => {
      const flag = resolveFeatureFlagForFormKey(
        item.formKey ?? item.formType,
        item.categoryKey
      );
      return !flag || Boolean(featureFlags[flag]);
    })
    .sort((a, b) => {
      const rDiff = statusRank(a.status) - statusRank(b.status);
      if (rDiff !== 0) return rDiff;
      return b.sortTimestamp - a.sortTimestamp;
    });
}

export type QueueNavEntry = {
  id: string;
  formLabel: string;
  caseNumber: string;
  href: string;
  categoryLabel: string;
  applicantName?: string;
};

export type DetailQueueNavigation = {
  mode: 'to_approve' | 'mine' | 'just_processed' | 'general';
  queueTitle: string;
  currentIndex: number | null;
  totalCount: number;
  prevItem: QueueNavEntry | null;
  nextItem: QueueNavEntry | null;
  allItems: QueueNavEntry[];
};

const ORDERED_CATEGORY_KEYS: MyApplicationCategoryKey[] = [
  'procurement',
  'expense',
  'seal',
  'asset',
  'other',
];

/**
 * Resolves the user's current position, previous item, and next item in the
 * 「簽核與單據追蹤」(/applications) list so detail pages can render intuitive
 * "Back to list" and "Prev / Next" navigation controls.
 */
export async function getDetailQueueNavigation(
  currentId: string
): Promise<DetailQueueNavigation> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return {
      mode: 'general',
      queueTitle: '簽核與單據追蹤',
      currentIndex: null,
      totalCount: 0,
      prevItem: null,
      nextItem: null,
      allItems: [],
    };
  }

  const db = getDb();
  const [rawApprovalQueue, defCategories] = await Promise.all([
    getMyApprovalQueueAll(),
    db
      .select({
        key: formDefinitions.key,
        catKey: formCategories.key,
      })
      .from(formDefinitions)
      .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId)),
  ]);

  const catByFormKey = new Map(defCategories.map((d) => [d.key, d.catKey]));

  const approvalWithCat = rawApprovalQueue.map((q) => {
    const catKey = mapFormTypeCategoryKey(q.formType, q.formKey, catByFormKey);
    return {
      id: q.id,
      formLabel: q.label,
      caseNumber: q.caseNumber,
      href: q.href,
      categoryKey: catKey,
      categoryLabel: APPLICATION_CATEGORY_LABELS[catKey],
      applicantName: q.applicantName,
    };
  });

  // Order exactly as shown in /applications (grouped by ORDERED_CATEGORY_KEYS)
  const orderedApprovals: QueueNavEntry[] = ORDERED_CATEGORY_KEYS.flatMap((catKey) =>
    approvalWithCat.filter((item) => item.categoryKey === catKey)
  );

  const approvalIdx = orderedApprovals.findIndex((item) => item.id === currentId);
  if (approvalIdx !== -1) {
    return {
      mode: 'to_approve',
      queueTitle: '待我簽核佇列',
      currentIndex: approvalIdx + 1,
      totalCount: orderedApprovals.length,
      prevItem: approvalIdx > 0 ? orderedApprovals[approvalIdx - 1]! : null,
      nextItem:
        approvalIdx < orderedApprovals.length - 1
          ? orderedApprovals[approvalIdx + 1]!
          : null,
      allItems: orderedApprovals,
    };
  }

  // Otherwise check the user's own submitted applications
  const allMine = (await getMyApplicationsAll()).filter((i) => i.status !== 'draft');
  const orderedMine: QueueNavEntry[] = ORDERED_CATEGORY_KEYS.flatMap((catKey) =>
    allMine
      .filter((item) => item.categoryKey === catKey)
      .map((item) => ({
        id: item.id,
        formLabel: item.formLabel,
        caseNumber: item.caseNumber,
        href: item.href,
        categoryLabel: item.categoryLabel,
      }))
  );

  const mineIdx = orderedMine.findIndex((item) => item.id === currentId);
  if (mineIdx !== -1) {
    return {
      mode: 'mine',
      queueTitle: '我的申請單據',
      currentIndex: mineIdx + 1,
      totalCount: orderedMine.length,
      prevItem: mineIdx > 0 ? orderedMine[mineIdx - 1]! : null,
      nextItem:
        mineIdx < orderedMine.length - 1 ? orderedMine[mineIdx + 1]! : null,
      allItems: orderedMine,
    };
  }

  // If the user just approved/returned this item and still has pending approvals left
  if (orderedApprovals.length > 0) {
    return {
      mode: 'just_processed',
      queueTitle: '待我簽核佇列',
      currentIndex: null,
      totalCount: orderedApprovals.length,
      prevItem: null,
      nextItem: orderedApprovals[0]!,
      allItems: orderedApprovals,
    };
  }

  return {
    mode: 'general',
    queueTitle: '簽核與單據追蹤',
    currentIndex: null,
    totalCount: orderedMine.length,
    prevItem: null,
    nextItem: orderedMine[0] ?? null,
    allItems: orderedMine,
  };
}
