import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { SubmissionList } from '@/app/f/submission-list';
import { getMyAcceptances } from '@/lib/acceptances/queries';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getMySubmissions } from '@/lib/custom-forms/queries';

export default async function AcceptancesPage() {
  const [acceptances, newItems, replacement] = await Promise.all([
    getMyAcceptances(),
    getMySubmissions({ legacyFormType: 'acceptance' }),
    replacementFor('acceptance'),
  ]);
  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">採購流程</p>
          <h1 className="page-title">我的驗收單</h1>
          <p className="page-subtitle">收到貨品或服務後，針對已核准的採購單辦理驗收。</p>
        </div>
        <Link href={replacement ? `/f/${replacement}/new` : '/acceptances/new'} className="btn-primary">
          + 新增驗收單
        </Link>
      </section>

      {newItems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">新版驗收單</h2>
          <SubmissionList items={newItems} showName />
        </section>
      )}

      {newItems.length > 0 && acceptances.length > 0 && <h2 className="-mb-4 text-sm font-semibold text-td-blue-dark">舊版驗收單</h2>}
      {acceptances.length === 0 ? (
        newItems.length === 0 && <div className="card text-sm text-td-muted">尚無驗收單。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {acceptances.map((a) => (
            <li key={a.id}>
              <Link
                href={`/acceptances/${a.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-td-blue-light/40"
              >
                <span className="mono-case">{a.caseNumber}</span>
                <span className={STATUS_BADGE[a.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[a.status] ?? a.status}</span>
                <span className="text-sm font-medium text-td-blue-dark">NT$ {a.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
