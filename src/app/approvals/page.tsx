import Link from 'next/link';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getMyPurchaseOrderApprovalQueue } from '@/lib/purchase-orders/queries';
import { getMyAcceptanceApprovalQueue } from '@/lib/acceptances/queries';
import { getMyExpenseRequestApprovalQueue } from '@/lib/expense-requests/queries';
import { FORM_LABELS, FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';

export default async function ApprovalsPage() {
  const [requests, orders, acceptances, expenseRequests] = await Promise.all([
    getMyApprovalQueue(),
    getMyPurchaseOrderApprovalQueue(),
    getMyAcceptanceApprovalQueue(),
    getMyExpenseRequestApprovalQueue(),
  ]);

  const queue = [
    ...requests.map((q) => ({ ...q, formType: 'purchase_request' as const })),
    ...orders.map((q) => ({ ...q, formType: 'purchase_order' as const })),
    ...acceptances.map((q) => ({ ...q, formType: 'acceptance' as const })),
    ...expenseRequests.map((q) => ({ ...q, formType: 'expense_request' as const })),
  ];

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">待我簽核</h1>
      {queue.length === 0 ? (
        <p className="text-gray-500">目前沒有待簽核的表單。</p>
      ) : (
        <ul className="divide-y rounded border">
          {queue.map((q) => (
            <li key={`${q.formType}-${q.id}`}>
              <Link
                href={`${FORM_ROUTE_PREFIX[q.formType]}/${q.id}`}
                className="flex justify-between p-4 hover:bg-gray-50"
              >
                <span className="w-24 text-gray-500">{FORM_LABELS[q.formType]}</span>
                <span className="font-mono">{q.caseNumber}</span>
                <span>{q.applicantName}</span>
                <span>NT$ {q.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
