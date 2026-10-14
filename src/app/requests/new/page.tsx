import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { PurchaseRequestForm, type BudgetCodeOption } from './purchase-request-form';

export default async function NewRequestPage() {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
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
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/requests" className="hover:text-td-blue">
          我的請購單
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">新增</span>
      </nav>
      <section className="mb-6">
        <p className="section-title">採購流程</p>
        <h1 className="page-title">新增請購單</h1>
        <p className="page-subtitle">
          申請人：{employee.name}｜提醒：一張請購單的所有預算編號必須屬於同一位預算負責人。
        </p>
      </section>
      <PurchaseRequestForm budgetCodes={budgetCodes} />
    </main>
  );
}
