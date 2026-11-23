import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ADMIN_NAV_PERMISSIONS, hasAnyPermission } from '@/lib/authz/permissions';
import {
  getFeatureFlagHistory,
  getSystemLicenseState,
} from '@/lib/feature-flags/service';
import { ensureLocalLicenseStudioRunning } from '@/lib/feature-flags/local-license-server';
import { FeatureFlagsClient } from './feature-flags-client';

export default async function AdminFeatureFlagsPage() {
  await ensureLocalLicenseStudioRunning();
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/login');
  }

  if (
    employee.role !== 'admin' &&
    !hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS)
  ) {
    redirect('/applications');
  }

  const [licenseState, initialHistory] = await Promise.all([
    getSystemLicenseState(),
    getFeatureFlagHistory(15),
  ]);

  return (
    <main className="page-shell space-y-6">
      <FeatureFlagsClient
        initialLicense={licenseState.license}
        initialFlags={licenseState.flags}
        initialHistory={initialHistory}
      />
    </main>
  );
}
