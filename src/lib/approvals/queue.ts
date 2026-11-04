import { getMyAcceptanceApprovalQueue } from '@/lib/acceptances/queries';
import { ensureDemoPendingApprovals } from '@/lib/applications/seed-pending-demo';
import { getMyAssetTransferApprovalQueue } from '@/lib/asset-transfers/queries';
import { getMyCustomApprovalQueue } from '@/lib/custom-forms/queries';
import { getMyExpenseClaimApprovalQueue } from '@/lib/expense-claims/queries';
import { getMyExpenseRequestApprovalQueue } from '@/lib/expense-requests/queries';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { getMyPurchaseOrderApprovalQueue } from '@/lib/purchase-orders/queries';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getMySealApprovalQueue } from '@/lib/seal-requests/lists';
import { getMyTravelExpenseApprovalQueue } from '@/lib/travel-expenses/queries';

export type ApprovalQueueItem = {
  formType: FormType;
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number | null;
  currency?: string;
  /** Form name shown in lists (designer forms use their own name). */
  label: string;
  href: string;
  /** Designer form URL key when formType is custom. */
  formKey?: string;
};

async function queryAllQueues() {
  return Promise.all([
    getMyApprovalQueue(),
    getMyPurchaseOrderApprovalQueue(),
    getMyAcceptanceApprovalQueue(),
    getMyExpenseRequestApprovalQueue(),
    getMyTravelExpenseApprovalQueue(),
    getMyExpenseClaimApprovalQueue(),
    getMySealApprovalQueue(),
    getMyAssetTransferApprovalQueue(),
    getMyCustomApprovalQueue(),
  ]);
}

/** Every form waiting for the current employee's decision, across all form types. */
export async function getMyApprovalQueueAll(): Promise<ApprovalQueueItem[]> {
  let [
    requests,
    orders,
    acceptances,
    expenseRequests,
    travelExpenses,
    expenseClaims,
    seals,
    assetTransfers,
    custom,
  ] = await queryAllQueues();

  const initialTotal =
    requests.length +
    orders.length +
    acceptances.length +
    expenseRequests.length +
    travelExpenses.length +
    expenseClaims.length +
    seals.length +
    assetTransfers.length +
    custom.length;

  if (initialTotal === 0) {
    try {
      const created = await ensureDemoPendingApprovals();
      if (created > 0) {
        custom = await getMyCustomApprovalQueue();
      }
    } catch {
      // Ignore demo seed errors so queue loading never fails
    }
  }

  const items: (Omit<ApprovalQueueItem, 'label' | 'href'> & { label?: string })[] = [
    ...requests.map((q) => ({ ...q, formType: 'purchase_request' as const })),
    ...orders.map((q) => ({ ...q, formType: 'purchase_order' as const })),
    ...acceptances.map((q) => ({ ...q, formType: 'acceptance' as const })),
    ...expenseRequests.map((q) => ({ ...q, formType: 'expense_request' as const })),
    ...travelExpenses.map((q) => ({ ...q, formType: 'travel_expense' as const })),
    ...expenseClaims,
    ...seals,
    ...assetTransfers,
    ...custom,
  ];
  return items.map((q) => {
    const formKey = 'formKey' in q && typeof q.formKey === 'string' ? q.formKey : undefined;
    return {
      ...q,
      label: q.label ?? FORM_LABELS[q.formType],
      href: formKey ? `/f/${formKey}/${q.id}` : `${FORM_ROUTE_PREFIX[q.formType]}/${q.id}`,
      formKey,
    };
  });
}
