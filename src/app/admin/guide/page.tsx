import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { resolveGuideRoleTiers } from '@/lib/guide/resolve-role-tiers';
import { VisualRoleGuide } from '@/components/guide/visual-role-guide';

export const dynamic = 'force-dynamic';

export default async function AdminGuidePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/guide');

  const { allowedTiers, highestTier, currentRoleLabel } =
    resolveGuideRoleTiers(employee);

  if (highestTier === 'staff') {
    redirect('/tools/guide');
  }

  return (
    <main className="page-shell max-w-6xl space-y-6">
      <VisualRoleGuide
        allowedTiers={allowedTiers}
        initialTier={highestTier}
        currentRoleLabel={currentRoleLabel}
      />
    </main>
  );
}
