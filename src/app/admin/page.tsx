import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function AdminRootPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/company');
  redirect('/admin/company');
}
