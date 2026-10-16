import { redirect } from 'next/navigation';
import { listAssignableAccessRoles } from '@/lib/admin/access-roles/queries';
import { getAccountsOverview } from '@/lib/admin/accounts/queries';
import { hasPermission } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { AccountsManager } from './accounts-manager';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/accounts');
  if (!hasPermission(employee.permissions, 'accounts.manage')) redirect('/dashboard');

  const [{ requests, accounts }, roles] = await Promise.all([getAccountsOverview(), listAssignableAccessRoles()]);
  return (
    <main className="page-shell max-w-5xl space-y-6">
      <div>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">帳號與登入綁定</h1>
        <p className="page-subtitle">
          Google 帳號須由管理員核准綁定到員工後才能登入；權限角色在「組織設定 → 權限角色」建立。以下操作需 15 分鐘內登入過，並記錄稽核。
        </p>
      </div>
      <AccountsManager currentEmployeeId={employee.id} requests={requests} accounts={accounts} roles={roles} />
    </main>
  );
}
