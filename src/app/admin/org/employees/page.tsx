import { redirect } from 'next/navigation';
import { getEmployeeAdminData } from '@/lib/admin/employees/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { EmployeesManager } from './employees-manager';

export const dynamic = 'force-dynamic';

export default async function OrgEmployeesPage() {
  const employee = await getCurrentEmployee();
  if (!employee || employee.role !== 'admin') redirect('/dashboard');
  return <EmployeesManager data={await getEmployeeAdminData()} />;
}
