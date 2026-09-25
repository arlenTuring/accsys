import { getMyAcceptanceApprovalQueue } from '@/lib/acceptances/queries';
import { getMyExpenseRequestApprovalQueue } from '@/lib/expense-requests/queries';
import { getMyPurchaseOrderApprovalQueue } from '@/lib/purchase-orders/queries';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';

export async function getPendingApprovalCount(): Promise<number> {
  const [requests, orders, acceptances, expenses] = await Promise.all([
    getMyApprovalQueue(),
    getMyPurchaseOrderApprovalQueue(),
    getMyAcceptanceApprovalQueue(),
    getMyExpenseRequestApprovalQueue(),
  ]);
  return requests.length + orders.length + acceptances.length + expenses.length;
}
