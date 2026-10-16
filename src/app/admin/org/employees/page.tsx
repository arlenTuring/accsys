import { redirect } from 'next/navigation';
import { listAssignableAccessRoles } from '@/lib/admin/access-roles/queries';
import { getEmployeeAdminData } from '@/lib/admin/employees/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { EmployeesManager } from './employees-manager';

export const dynamic = 'force-dynamic';

export default async function OrgEmployeesPage() {
  const employee = await getCurrentEmployee();
  if (!employee || (!employee.permissions.includes('org.manage') && employee.role !== 'admin')) redirect('/dashboard');
  const [data, roles] = await Promise.all([getEmployeeAdminData(), listAssignableAccessRoles()]);
  return <EmployeesManager data={data} roles={roles} currentEmployeeId={employee.id} />;
}
