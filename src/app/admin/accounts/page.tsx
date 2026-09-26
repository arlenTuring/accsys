import { redirect } from 'next/navigation';
import { getAccountsOverview } from '@/lib/admin/accounts/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { AccountsManager } from './accounts-manager';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/accounts');
  if (employee.role !== 'admin') redirect('/dashboard');

  const { requests, accounts } = await getAccountsOverview();
  return (
    <main className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">帳號與登入綁定</h1>
        <p className="mt-1 text-sm text-gray-600">
          Google 帳號須由管理員核准綁定到員工後才能登入；電子郵件相同不會自動綁定。以下操作需 15 分鐘內登入過，並記錄稽核。
        </p>
      </div>
      <AccountsManager currentEmployeeId={employee.id} requests={requests} accounts={accounts} />
    </main>
  );
}
