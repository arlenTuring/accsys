import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getSealPartyOptions } from '@/lib/seal-requests/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { InvoiceSealForm } from '../invoice-seal-form';

export default async function NewInvoiceSealPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const replacement = await replacementFor('invoice_seal_request');
  if (replacement) redirect(`/f/${replacement}/new`);
  const parties = await getSealPartyOptions();

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/seal-requests" className="hover:text-td-blue">
          用印申請
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">新增（開立發票/Invoice）</span>
      </nav>
      <InvoiceSealForm
        currentEmployee={{ id: employee.id, departmentId: employee.departmentId }}
        parties={parties}
        applicationDate={taipeiToday()}
        mode={{ kind: 'create' }}
      />
    </main>
  );
}
