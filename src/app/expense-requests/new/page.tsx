import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseOrdersForExpenseRequest } from '@/lib/expense-requests/queries';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { ExpenseRequestForm } from './expense-request-form';
import { StandaloneExpenseRequestForm } from './standalone-expense-request-form';

export default async function NewExpenseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; mode?: string }>;
}) {
  const { orderId, mode } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  if (mode === 'standalone') {
    const [budgetCodes, suppliersResult] = await Promise.all([
      getBudgetCodeList(),
      supabase.from('suppliers').select('id, name').order('name'),
    ]);
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增費用申請單（免走採購流程）</h1>
        <StandaloneExpenseRequestForm
          budgetCodes={budgetCodes}
          suppliers={(suppliersResult.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        />
      </main>
    );
  }

  const eligible = await getEligiblePurchaseOrdersForExpenseRequest();

  if (!orderId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增費用申請單</h1>
        <p className="mb-4">
          <Link href="/expense-requests/new?mode=standalone" className="text-blue-600 underline">
            免走採購流程建立費用申請單（金額低於 1 萬元）
          </Link>
        </p>
        {eligible.length === 0 ? (
          <p className="text-gray-500">
            目前沒有已核准、尚未建立費用申請單的採購單（需已完成驗收，或付款條件為預付款）。
          </p>
        ) : (
          <ul className="space-y-2">
            {eligible.map((o) => (
              <li key={o.id}>
                <a href={`/expense-requests/new?orderId=${o.id}`} className="text-blue-600 underline">
                  {o.caseNumber}（{o.paymentTerms}）
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const selected = eligible.find((o) => o.id === orderId);
  if (!selected) redirect('/expense-requests/new');

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-2xl font-bold">新增費用申請單</h1>
      <p className="mb-6 font-mono text-gray-600">{selected.caseNumber}</p>
      <ExpenseRequestForm
        purchaseOrderId={selected.id}
        sourceItems={selected.sourceItems}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
