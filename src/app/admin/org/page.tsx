import { redirect } from 'next/navigation';
import { getOrgDirectory } from '@/lib/admin/org/queries';
import { DepartmentsManager } from './departments-manager';

export const dynamic = 'force-dynamic';

export default async function OrgDepartmentsPage() {
  const data = await getOrgDirectory();
  if (!data) redirect('/dashboard');
  return <DepartmentsManager data={data} />;
}
