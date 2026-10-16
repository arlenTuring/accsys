import { redirect } from 'next/navigation';
import { listAccessRoles } from '@/lib/admin/access-roles/queries';
import { hasPermission } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { AccessRolesManager } from '../access-roles-manager';

export const dynamic = 'force-dynamic';

export default async function AccountsAccessRolesPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/accounts/roles');
  if (!hasPermission(employee.permissions, 'org.access_roles')) redirect('/admin/accounts');

  const roles = await listAccessRoles();
  return <AccessRolesManager roles={roles} />;
}
