import { redirect } from 'next/navigation';
import { getSimulatorData } from '@/lib/admin/org/queries';
import { FlowSimulator } from './flow-simulator';

export const dynamic = 'force-dynamic';

export default async function OrgSimulatorPage() {
  const data = await getSimulatorData();
  if (!data) redirect('/dashboard');
  return <FlowSimulator data={data} />;
}
