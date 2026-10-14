import Link from 'next/link';
import { SubmissionList } from '@/app/f/submission-list';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { getMyRequests } from '@/lib/purchase-requests/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
  withdrawn: '已撤回',
};

const STATUS_BADGE: Record<string, string> = {
  pending_approval: 'badge-pending',
  approved: 'badge-approved',
  returned: 'badge-returned',
  withdrawn: 'badge-withdrawn',
};

export default async function RequestsPage() {
  const [requests, newItems, replacement] = await Promise.all([
    getMyRequests(),
    getMySubmissions({ legacyFormType: 'purchase_request' }),
    replacementFor('purchase_request'),
  ]);
  return (
    <main className="page-shell space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">採購流程</p>
          <h1 className="page-title">我的請購單</h1>
        </div>
        <Link href={replacement ? `/f/${replacement}/new` : '/requests/new'} className="btn-primary">
          新增請購單
        </Link>
      </div>

      {newItems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">新版請購單</h2>
          <SubmissionList items={newItems} showName />
        </section>
      )}

      {newItems.length > 0 && requests.length > 0 && <h2 className="-mb-4 text-sm font-semibold text-td-blue-dark">舊版請購單</h2>}
      {requests.length === 0 ? (
        newItems.length === 0 && <div className="card text-sm text-td-muted">目前沒有請購單。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {requests.map((r) => (
            <li key={r.id}>
              <Link
                href={`/requests/${r.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-td-blue-light/40"
              >
                <span className="mono-case">{r.caseNumber}</span>
                <span className={STATUS_BADGE[r.status] ?? 'badge-withdrawn'}>
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
                <span className="text-sm font-medium text-td-blue-dark">
                  NT$ {r.totalAmount.toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
