import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { SubmissionList } from '@/app/f/submission-list';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';

export default async function PurchaseOrdersPage() {
  const [orders, newItems, replacement] = await Promise.all([
    getMyPurchaseOrders(),
    getMySubmissions({ legacyFormType: 'purchase_order' }),
    replacementFor('purchase_order'),
  ]);
  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">採購流程</p>
          <h1 className="page-title">我的採購單</h1>
          <p className="page-subtitle">請購核准後，選擇供應商建立採購單。</p>
        </div>
        <Link href={replacement ? `/f/${replacement}/new` : '/purchase-orders/new'} className="btn-primary">
          + 新增採購單
        </Link>
      </section>

      {newItems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">新版採購單</h2>
          <SubmissionList items={newItems} showName />
        </section>
      )}

      {newItems.length > 0 && orders.length > 0 && <h2 className="-mb-4 text-sm font-semibold text-td-blue-dark">舊版採購單</h2>}
      {orders.length === 0 ? (
        newItems.length === 0 && <div className="card text-sm text-td-muted">尚無採購單。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/purchase-orders/${o.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-td-blue-light/40"
              >
                <span className="mono-case">{o.caseNumber}</span>
                <span className={STATUS_BADGE[o.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[o.status] ?? o.status}</span>
                <span className="text-sm font-medium text-td-blue-dark">NT$ {o.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
