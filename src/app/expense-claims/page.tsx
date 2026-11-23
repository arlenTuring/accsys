import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { SubmissionList } from '@/app/f/submission-list';
import { UNIFIED_EXPENSE_CLAIM_KEY } from '@/lib/custom-forms/migrated/expense-claims';
import { TRAVEL_EXPENSE_FORM } from '@/lib/custom-forms/migrated/travel';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { EDITIONS } from '@/lib/expense-claims/editions';
import { getMyExpenseClaims } from '@/lib/expense-claims/queries';
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';

const routeOf = (edition: keyof typeof EDITIONS) => FORM_ROUTE_PREFIX[EDITIONS[edition].formType];

export default async function ExpenseClaimsPage() {
  const [items, expenseSubmissions] = await Promise.all([
    getMyExpenseClaims(),
    getMySubmissions({ categoryKey: 'expense' }),
  ]);
  const newItems = expenseSubmissions.filter((s) => s.key !== TRAVEL_EXPENSE_FORM.key);
  return (
    <main className="page-shell">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">費用報支</p>
          <h1 className="page-title">我的費用申請</h1>
          <p className="page-subtitle">
            已整併為單一《費用申請單》：以兩層式選單選擇「部門預算、產品專案或營收專案」與「預算科目（自動帶出預算負責人）」。採購／購置類單筆 NT$ 30,000（三萬元）以下可直接報支，超過三萬元才提示請先開立請購單。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/f/${UNIFIED_EXPENSE_CLAIM_KEY}/new`} className="btn-primary">
            + 新增費用申請單
          </Link>
        </div>
      </section>

      {newItems.length > 0 && (
        <section className="mb-6 space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">新版費用申請</h2>
          <SubmissionList items={newItems} showName />
        </section>
      )}

      {newItems.length > 0 && items.length > 0 && <h2 className="mb-2 text-sm font-semibold text-td-blue-dark">舊版費用申請</h2>}
      {items.length === 0 ? (
        newItems.length === 0 && <div className="card text-sm text-td-muted">尚無費用申請單。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {items.map((e) => (
            <li key={`${e.edition}-${e.id}`}>
              <Link
                href={`${routeOf(e.edition)}/${e.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-td-blue-light/40 sm:grid-cols-[9rem_8rem_1fr_auto_auto] sm:items-center sm:gap-4"
              >
                <span className="mono-case">{e.caseNumber}</span>
                <span className="text-xs font-semibold text-td-muted">{EDITIONS[e.edition].shortLabel}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-td-blue-dark">
                    {e.firstItem}
                    {e.lineCount > 1 && <span className="text-td-muted">（等 {e.lineCount} 項）</span>}
                  </span>
                  <span className="text-xs text-td-muted">
                    {e.departmentName} · 申請日期 {e.applicationDate.replaceAll('-', '/')}
                  </span>
                </span>
                <span className={STATUS_BADGE[e.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[e.status] ?? e.status}</span>
                <span className="text-right text-sm font-medium text-td-blue-dark">NT$ {e.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
