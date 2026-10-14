import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { SubmissionList } from '@/app/f/submission-list';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { getMyExpenseRequests } from '@/lib/expense-requests/queries';

export default async function ExpenseRequestsPage() {
  const [expenseRequests, newItems, replacement] = await Promise.all([
    getMyExpenseRequests(),
    getMySubmissions({ legacyFormType: ['expense_request', 'standalone_expense_request'] }),
    replacementFor('expense_request'),
  ]);
  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">採購流程</p>
          <h1 className="page-title">我的採購付款</h1>
          <p className="page-subtitle">
            費用申請單(採購付款)：驗收完成或預付款時，向供應商申請付款。不經採購的一般費用請改用「費用報支」分類下的表單。
          </p>
        </div>
        <Link href={replacement ? `/f/${replacement}/new` : '/expense-requests/new'} className="btn-primary">
          + 新增採購付款
        </Link>
      </section>

      {newItems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">新版付款申請</h2>
          <SubmissionList items={newItems} showName />
        </section>
      )}

      {newItems.length > 0 && expenseRequests.length > 0 && <h2 className="-mb-4 text-sm font-semibold text-td-blue-dark">舊版付款申請</h2>}
      {expenseRequests.length === 0 ? (
        newItems.length === 0 && <div className="card text-sm text-td-muted">尚無採購付款申請。</div>
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
