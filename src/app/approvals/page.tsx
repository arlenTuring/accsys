import Link from 'next/link';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';

export default async function ApprovalsPage() {
  const queue = await getMyApprovalQueue();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">待我簽核</h1>
      {queue.length === 0 ? (
        <p className="text-gray-500">目前沒有待簽核的請購單。</p>
      ) : (
        <ul className="divide-y rounded border">
          {queue.map((q) => (
            <li key={q.id}>
              <Link href={`/requests/${q.id}`} className="flex justify-between p-4 hover:bg-gray-50">
                <span className="font-mono">{q.caseNumber}</span>
                <span>{q.applicantName}</span>
                <span>NT$ {q.totalAmount.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
