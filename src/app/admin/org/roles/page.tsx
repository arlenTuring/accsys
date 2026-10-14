import { redirect } from 'next/navigation';
import { getOrgDirectory } from '@/lib/admin/org/queries';
import { RolesManager } from './roles-manager';

export const dynamic = 'force-dynamic';

export default async function OrgRolesPage() {
  const data = await getOrgDirectory();
  if (!data) redirect('/dashboard');
  return <RolesManager data={data} />;
}
