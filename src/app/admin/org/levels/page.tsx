import { redirect } from 'next/navigation';
import { getOrgDirectory } from '@/lib/admin/org/queries';
import { LevelsManager } from './levels-manager';

export const dynamic = 'force-dynamic';

export default async function OrgLevelsPage() {
  const data = await getOrgDirectory();
  if (!data) redirect('/dashboard');
  return <LevelsManager levels={data.levels} inUse={data.inUse.levels} />;
}
