import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getEligiblePurchaseOrdersForExpenseRequest } from '@/lib/expense-requests/queries';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { ExpenseRequestForm } from './expense-request-form';
import { StandaloneExpenseRequestForm } from './standalone-expense-request-form';
import { SourcePicker } from '@/app/components/source-picker';

export default async function NewExpenseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; mode?: string }>;
}) {
  const { orderId, mode } = await searchParams;
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const replacement = await replacementFor(mode === 'standalone' ? 'standalone_expense_request' : 'expense_request');
  if (replacement) redirect(`/f/${replacement}/new`);

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
      <SourcePicker
        title="新增費用申請單(採購付款)"
        hint="請選擇要申請付款的採購單（需已完成驗收，或付款條件為預付款）。"
        empty="目前沒有已核准、尚未建立付款申請的採購單（需已完成驗收，或付款條件為預付款）。"
        backHref="/expense-requests"
        backLabel="我的採購付款"
        options={eligible.map((o) => ({ href: `/expense-requests/new?orderId=${o.id}`, label: `${o.caseNumber}（${o.paymentTerms}）` }))}
        footer={
          <Link href="/expense-requests/new?mode=standalone" className="text-sm font-semibold text-td-blue hover:underline">
            免走採購流程建立費用申請單（金額低於 1 萬元）→
          </Link>
        }
      />
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
