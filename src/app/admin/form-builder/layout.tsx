import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function FormBuilderLayout({ children }: { children: ReactNode }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/form-builder');
  if (!hasPermission(employee.permissions, 'forms.design')) redirect('/dashboard');
  return children;
}
