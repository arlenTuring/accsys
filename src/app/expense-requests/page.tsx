import Link from 'next/link';
import { getMyExpenseRequests } from '@/lib/expense-requests/queries';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function ExpenseRequestsPage() {
  const expenseRequests = await getMyExpenseRequests();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的費用申請單</h1>
        <Link href="/expense-requests/new" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
          + 新增費用申請單
        </Link>
      </div>
      {expenseRequests.length === 0 ? (
        <p className="text-gray-500">尚無費用申請單。</p>
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
            {expenseRequests.map((e) => (
              <tr key={e.id}>
                <td className="border p-2">
                  <Link href={`/expense-requests/${e.id}`} className="text-blue-600 underline">
                    {e.caseNumber}
                  </Link>
                </td>
                <td className="border p-2">{STATUS_LABELS[e.status] ?? e.status}</td>
                <td className="border p-2 text-right">{e.totalAmount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
