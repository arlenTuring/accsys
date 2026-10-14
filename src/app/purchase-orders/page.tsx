import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';

export default async function PurchaseOrdersPage() {
  const orders = await getMyPurchaseOrders();
  return (
    <main className="page-shell">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">採購流程</p>
          <h1 className="page-title">我的採購單</h1>
          <p className="page-subtitle">請購核准後，選擇供應商建立採購單。</p>
        </div>
        <Link href="/purchase-orders/new" className="btn-primary">
          + 新增採購單
        </Link>
      </section>
      {orders.length === 0 ? (
        <div className="card text-sm text-td-muted">尚無採購單。</div>
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
