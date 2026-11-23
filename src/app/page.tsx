import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getSystemFeatureFlags } from '@/lib/feature-flags/service';

export default async function HomePage() {
  const [employee, featureFlags] = await Promise.all([
    getCurrentEmployee(),
    getSystemFeatureFlags(),
  ]);
  if (!employee) redirect('/login');
  redirect(featureFlags.ai_chat ? '/tools/ai-chat' : '/applications');
}
