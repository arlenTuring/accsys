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
  if (!hasPermission(employee.permissions, 'accounts.manage')) {
    if (hasPermission(employee.permissions, 'org.access_roles')) redirect('/admin/accounts/roles');
    redirect('/dashboard');
  }

  const [{ requests, accounts }, roles] = await Promise.all([getAccountsOverview(), listAssignableAccessRoles()]);
  return <AccountsManager currentEmployeeId={employee.id} requests={requests} accounts={accounts} roles={roles} />;
}
