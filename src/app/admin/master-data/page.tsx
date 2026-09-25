import { redirect } from 'next/navigation';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function MasterDataPage() {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/login');
  }
  if (employee.role !== 'admin') {
    redirect('/dashboard');
  }

  const [
    { data: departments },
    { data: employees },
    { data: budgetCodes },
    { data: suppliers },
  ] = await Promise.all([
    supabase.from('departments').select('code, name').order('code'),
    supabase
      .from('employees')
      .select('employee_code, name, department_id, role')
      .order('employee_code'),
    supabase.from('budget_codes').select('code, category, fiscal_year').order('code'),
    supabase.from('suppliers').select('name, phone, email').order('name'),
  ]);

  return (
    <main className="space-y-8 p-8">
      <h1 className="text-2xl font-bold">主檔資料總覽</h1>

      <section>
        <h2 className="text-lg font-semibold">部門（{departments?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {departments?.map((d) => (
            <li key={d.code}>
              {d.code} — {d.name}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">員工（{employees?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {employees?.map((e) => (
            <li key={e.employee_code}>
              {e.employee_code} — {e.name}（{e.role}）
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">預算編號（{budgetCodes?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {budgetCodes?.map((b) => (
            <li key={b.code}>
              {b.code} — {b.category}（{b.fiscal_year}年）
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">供應商（{suppliers?.length ?? 0}）</h2>
        <ul className="list-disc pl-6">
          {suppliers?.map((s) => (
            <li key={s.name}>
              {s.name}
              {s.phone ? ` — ${s.phone}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
