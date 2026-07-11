import Link from 'next/link';
import { getMyAcceptances } from '@/lib/acceptances/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function AcceptancesPage() {
  const acceptances = await getMyAcceptances();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的驗收單</h1>
        <Link href="/acceptances/new" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          + 新增驗收單
        </Link>
      </div>
      {acceptances.length === 0 ? (
        <p className="text-gray-500">尚無驗收單。</p>
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
            {acceptances.map((a) => (
              <tr key={a.id}>
                <td className="border p-2">
                  <Link href={`/acceptances/${a.id}`} className="text-blue-600 underline">
                    {a.caseNumber}
                  </Link>
                </td>
                <td className="border p-2">{STATUS_LABELS[a.status] ?? a.status}</td>
                <td className="border p-2 text-right">{a.totalAmount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
