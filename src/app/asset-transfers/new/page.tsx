import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAssetOptions, getEmployeeOptions, getUsageBudgetOptions } from '@/lib/asset-transfers/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getDepartmentOptions } from '@/lib/expense-claims/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { AssetTransferForm } from '../asset-transfer-form';

export default async function NewAssetTransferPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const replacement = await replacementFor('asset_transfer');
  if (replacement) redirect(`/f/${replacement}/new`);
  const [departments, budgetOptions, employees, assets] = await Promise.all([
    getDepartmentOptions(),
    getUsageBudgetOptions(),
    getEmployeeOptions(),
    getAssetOptions(),
  ]);

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/asset-transfers" className="hover:text-td-blue">
          資產異動
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">新增</span>
      </nav>
      <AssetTransferForm
        applicantName={employee.name}
        applicationDate={taipeiToday()}
        departments={departments}
        budgetOptions={budgetOptions}
        employees={employees}
        assets={assets}
        mode={{ kind: 'create' }}
        initial={{ departmentId: employee.departmentId }}
      />
    </main>
  );
}
