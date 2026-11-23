import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { resolveGuideRoleTiers } from '@/lib/guide/resolve-role-tiers';
import { VisualRoleGuide } from '@/components/guide/visual-role-guide';

export const dynamic = 'force-dynamic';

export default async function StaffGuidePage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/tools/guide');

  const { allowedTiers, currentRoleLabel } = resolveGuideRoleTiers(employee);

  return (
    <main className="page-shell max-w-6xl space-y-6">
      <VisualRoleGuide
        allowedTiers={allowedTiers}
        initialTier="staff"
        currentRoleLabel={currentRoleLabel}
      />
    </main>
  );
}
