import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { SubmissionList } from '@/app/f/submission-list';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getMyTravelExpenses } from '@/lib/travel-expenses/queries';

export default async function TravelExpensesPage() {
  const [items, newItems, replacement] = await Promise.all([
    getMyTravelExpenses(),
    getMySubmissions({ legacyFormType: 'travel_expense' }),
    replacementFor('travel_expense'),
  ]);
  const newHref = replacement ? `/f/${replacement}/new` : '/travel-expenses/new';
  return (
    <main className="page-shell">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">費用報支</p>
          <h1 className="page-title">我的出差報支</h1>
          <p className="page-subtitle">出差報告暨旅費報支單：填寫行程與旅費、上傳單據，送出後依預算來源跑線上簽核。</p>
        </div>
        <Link href={newHref} className="btn-primary">
          + 新增出差報支
        </Link>
      </section>

      {newItems.length > 0 && (
        <section className="mb-6 space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">新版出差報支</h2>
          <SubmissionList items={newItems} showName={false} />
        </section>
      )}

      {newItems.length > 0 && items.length > 0 && <h2 className="mb-2 text-sm font-semibold text-td-blue-dark">舊版出差報支</h2>}
      {items.length === 0 ? (
        newItems.length === 0 && (
          <div className="card text-sm text-td-muted">
            尚無出差報支單。
            <Link href={newHref} className="ml-2 font-semibold text-td-blue hover:underline">
              立即新增 →
            </Link>
          </div>
        )
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/travel-expenses/${t.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-td-blue-light/40 sm:grid-cols-[9rem_1fr_auto_auto] sm:items-center sm:gap-4"
              >
                <span className="mono-case">{t.caseNumber}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-td-blue-dark">{t.purpose}</span>
                  <span className="text-xs text-td-muted">
                    出差期間 {t.tripStartDate.replaceAll('-', '/')} ~ {t.tripEndDate.replaceAll('-', '/')}
                  </span>
                </span>
                <span className={STATUS_BADGE[t.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[t.status] ?? t.status}</span>
                <span className="text-right text-sm font-medium text-td-blue-dark">NT$ {t.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
