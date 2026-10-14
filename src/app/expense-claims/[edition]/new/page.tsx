import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { EDITIONS, isExpenseEdition } from '@/lib/expense-claims/editions';
import { getDepartmentOptions, getExpenseBudgetOptions, getPayeeSupplierOptions } from '@/lib/expense-claims/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { ExpenseClaimForm } from '../../expense-claim-form';

export default async function NewExpenseClaimPage({ params }: { params: Promise<{ edition: string }> }) {
  const { edition } = await params;
  if (!isExpenseEdition(edition)) notFound();
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const replacement = await replacementFor(EDITIONS[edition].formType);
  if (replacement) redirect(`/f/${replacement}/new`);
  const [departments, budgetOptions, suppliers] = await Promise.all([
    getDepartmentOptions(),
    getExpenseBudgetOptions(edition),
    getPayeeSupplierOptions(),
  ]);
  const today = taipeiToday();

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/expense-claims" className="hover:text-td-blue">
          費用申請
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">新增（{EDITIONS[edition].shortLabel}）</span>
      </nav>
      <ExpenseClaimForm
        edition={edition}
        applicantName={employee.name}
        today={today}
        applicationDate={today}
        departments={departments}
        budgetOptions={budgetOptions}
        suppliers={suppliers}
        mode={{ kind: 'create' }}
        initial={{ departmentId: employee.departmentId }}
      />
    </main>
  );
}
