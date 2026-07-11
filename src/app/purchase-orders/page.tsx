import Link from 'next/link';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function PurchaseOrdersPage() {
  const orders = await getMyPurchaseOrders();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的採購單</h1>
        <Link href="/purchase-orders/new" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          + 新增採購單
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="text-gray-500">尚無採購單。</p>
      ) : (
        <table className="w-full border text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2">案件單號</th>
              <th className="border p-2">狀態</th>
              <th className="border p-2">總計</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="border p-2">
                  <Link href={`/purchase-orders/${o.id}`} className="text-blue-600 underline">
                    {o.caseNumber}
                  </Link>
                </td>
                <td className="border p-2">{STATUS_LABELS[o.status] ?? o.status}</td>
                <td className="border p-2 text-right">{o.totalAmount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
