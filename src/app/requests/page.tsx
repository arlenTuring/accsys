import Link from 'next/link';
import { getMyRequests } from '@/lib/purchase-requests/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function RequestsPage() {
  const requests = await getMyRequests();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的請購單</h1>
        <Link href="/requests/new" className="rounded bg-blue-600 px-4 py-2 text-white">
          新增請購單
        </Link>
      </div>
      {requests.length === 0 ? (
        <p className="text-gray-500">目前沒有請購單。</p>
      ) : (
        <ul className="divide-y rounded border">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`} className="flex justify-between p-4 hover:bg-gray-50">
                <span className="font-mono">{r.caseNumber}</span>
                <span>NT$ {r.totalAmount.toLocaleString()}</span>
                <span>{STATUS_LABELS[r.status] ?? r.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
