import Link from 'next/link';
import { getMyApprovalQueueAll } from '@/lib/approvals/queue';
import { sealAmountLabel } from '@/lib/seal-requests/constants';

export default async function ApprovalsPage() {
  const queue = await getMyApprovalQueueAll();

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
                href={q.href}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-td-blue-light/40"
              >
                <span className="w-36 text-xs font-semibold uppercase tracking-wide text-td-muted">{q.label}</span>
                <span className="mono-case">{q.caseNumber}</span>
                <span className="text-sm text-td-blue-dark">{q.applicantName}</span>
                <span className="badge-pending">待簽核</span>
                <span className="text-sm font-medium text-td-blue-dark">{sealAmountLabel(q.totalAmount, q.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
