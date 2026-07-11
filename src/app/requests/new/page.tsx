import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { PurchaseRequestForm, type BudgetCodeOption } from './purchase-request-form';

export default async function NewRequestPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const { data } = await supabase
    .from('budget_codes')
    .select('id, code, category, departments(name), owner:employees!owner_employee_id(id, name)')
    .order('code');

  const budgetCodes: BudgetCodeOption[] = (data ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    category: b.category,
    departmentName: (b.departments as unknown as { name: string } | null)?.name ?? '',
    ownerId: (b.owner as unknown as { id: string } | null)?.id ?? '',
    ownerName: (b.owner as unknown as { name: string } | null)?.name ?? '（未指定）',
  }));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">新增請購申請單</h1>
      <p className="mb-4 text-sm text-gray-600">
        申請單位：{employee.name}｜提醒：一張請購單的所有預算編號必須屬於同一位預算負責人。
      </p>
      <PurchaseRequestForm budgetCodes={budgetCodes} />
    </main>
  );
}
