import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { getProjectList } from '@/lib/projects/queries';
import { BudgetCodesManager } from './budget-codes-manager';

export default async function BudgetCodesPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');
  if (employee.role !== 'finance') redirect('/dashboard');

  const [budgetCodes, projects] = await Promise.all([getBudgetCodeList(), getProjectList()]);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-bold">預算編號管理</h1>
      <BudgetCodesManager budgetCodes={budgetCodes} projects={projects} />
    </main>
  );
}
