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
    <main className="page-shell">
      <section className="mb-6">
        <p className="section-title">簽核</p>
        <h1 className="page-title">待我簽核</h1>
        <p className="page-subtitle">
          {queue.length > 0 ? `共 ${queue.length} 件等待您的審核` : '目前沒有待簽核的表單'}
        </p>
      </section>

      {queue.length === 0 ? (
        <div className="card text-sm text-td-muted">目前沒有待簽核的表單。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {queue.map((q) => (
            <li key={`${q.formType}-${q.id}`}>
              <Link
                href={`${FORM_ROUTE_PREFIX[q.formType]}/${q.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-td-blue-light/40"
              >
                <span className="w-24 text-xs font-semibold uppercase tracking-wide text-td-muted">
                  {FORM_LABELS[q.formType]}
                </span>
                <span className="mono-case">{q.caseNumber}</span>
                <span className="text-sm text-td-blue-dark">{q.applicantName}</span>
                <span className="badge-pending">待簽核</span>
                <span className="text-sm font-medium text-td-blue-dark">
                  NT$ {q.totalAmount.toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
