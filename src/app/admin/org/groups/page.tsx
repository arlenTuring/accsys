import { redirect } from 'next/navigation';
import { getOrgDirectory } from '@/lib/admin/org/queries';
import { GroupsManager } from './groups-manager';

export const dynamic = 'force-dynamic';

export default async function OrgGroupsPage() {
  const data = await getOrgDirectory();
  if (!data) redirect('/dashboard');
  return <GroupsManager data={data} />;
}
