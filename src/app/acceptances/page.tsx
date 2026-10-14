import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { getMyAcceptances } from '@/lib/acceptances/queries';

export default async function AcceptancesPage() {
  const acceptances = await getMyAcceptances();
  return (
    <main className="page-shell">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">採購流程</p>
          <h1 className="page-title">我的驗收單</h1>
          <p className="page-subtitle">收到貨品或服務後，針對已核准的採購單辦理驗收。</p>
        </div>
        <Link href="/acceptances/new" className="btn-primary">
          + 新增驗收單
        </Link>
      </section>
      {acceptances.length === 0 ? (
        <div className="card text-sm text-td-muted">尚無驗收單。</div>
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
