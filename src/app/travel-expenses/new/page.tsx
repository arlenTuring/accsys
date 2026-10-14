import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { taipeiToday } from '@/lib/taipei-date';
import { getTravelBudgetOptions } from '@/lib/travel-expenses/queries';
import { TravelExpenseForm } from '../travel-expense-form';

export default async function NewTravelExpensePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const replacement = await replacementFor('travel_expense');
  if (replacement) redirect(`/f/${replacement}/new`);
  const budgetOptions = await getTravelBudgetOptions();

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/travel-expenses" className="hover:text-td-blue">
          出差報支
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">新增</span>
      </nav>
      <TravelExpenseForm
        applicantName={employee.name}
        departmentName={employee.departmentName}
        formDate={taipeiToday()}
        budgetOptions={budgetOptions}
        mode={{ kind: 'create' }}
      />
    </main>
  );
}
