import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getSealPartyOptions } from '@/lib/seal-requests/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { GeneralSealForm } from '../general-seal-form';

export default async function NewGeneralSealPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const replacement = await replacementFor('general_seal_request');
  if (replacement) redirect(`/f/${replacement}/new`);
  const parties = await getSealPartyOptions();
  const today = taipeiToday();

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/seal-requests" className="hover:text-td-blue">
          用印申請
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">新增（非合約類）</span>
      </nav>
      <GeneralSealForm
        currentEmployee={{ id: employee.id, departmentId: employee.departmentId }}
        parties={parties}
        applicationDate={today}
        today={today}
        mode={{ kind: 'create' }}
      />
    </main>
  );
}
