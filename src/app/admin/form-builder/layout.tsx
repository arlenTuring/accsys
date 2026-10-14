import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function FormBuilderLayout({ children }: { children: ReactNode }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/form-builder');
  if (employee.role !== 'admin') redirect('/dashboard');
  return children;
}
