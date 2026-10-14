import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { getMyExpenseRequests } from '@/lib/expense-requests/queries';

export default async function ExpenseRequestsPage() {
  const expenseRequests = await getMyExpenseRequests();
  return (
    <main className="page-shell">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">採購流程</p>
          <h1 className="page-title">我的採購付款</h1>
          <p className="page-subtitle">
            費用申請單(採購付款)：驗收完成或預付款時，向供應商申請付款。不經採購的一般費用請改用「費用報支」分類下的表單。
          </p>
        </div>
        <Link href="/expense-requests/new" className="btn-primary">
          + 新增採購付款
        </Link>
      </section>
      {expenseRequests.length === 0 ? (
        <div className="card text-sm text-td-muted">尚無採購付款申請。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {expenseRequests.map((e) => (
            <li key={e.id}>
              <Link
                href={`/expense-requests/${e.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-td-blue-light/40"
              >
                <span className="mono-case">{e.caseNumber}</span>
                <span className={STATUS_BADGE[e.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[e.status] ?? e.status}</span>
                <span className="text-sm font-medium text-td-blue-dark">NT$ {e.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
