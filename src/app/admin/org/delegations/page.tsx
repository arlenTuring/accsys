import { redirect } from 'next/navigation';
import { getOrgDirectory } from '@/lib/admin/org/queries';
import { DelegationsManager } from './delegations-manager';

export const dynamic = 'force-dynamic';

export default async function OrgDelegationsPage() {
  const data = await getOrgDirectory();
  if (!data) redirect('/dashboard');
  return <DelegationsManager data={data} />;
}
