import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import './globals.css';
import { getMyTaskCounts } from '@/lib/approvals/pending-count';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getSidebarEmployeeProfile } from '@/lib/auth/sidebar-profile';
import { DEFAULT_FEATURE_FLAGS } from '@/lib/feature-flags/definitions';
import { ensureLocalLicenseStudioRunning } from '@/lib/feature-flags/local-license-server';
import { getSystemFeatureFlags } from '@/lib/feature-flags/service';
import { getFormCatalog } from '@/lib/forms/catalog-server';
import { I18nProvider } from '@/lib/i18n/context';
import { getServerI18n } from '@/lib/i18n/server';
import { AppShell } from '@/app/components/app-shell';
import { DialogHost } from '@/app/components/dialog';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t.common.appName,
    description: t.common.companyName,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  void ensureLocalLicenseStudioRunning();
  const [employee, { locale }, featureFlags] = await Promise.all([
    getCurrentEmployee(),
    getServerI18n(),
    getSystemFeatureFlags(),
  ]);

  const [taskCounts, categories, sidebarProfile] = employee
    ? await Promise.all([
        getMyTaskCounts(),
        getFormCatalog(),
        getSidebarEmployeeProfile(employee),
      ])
    : [
        {
          approvalsAndReturned: 0,
          budgetTasks: 0,
          assetHandovers: 0,
          pendingSurveys: 0,
          total: 0,
        },
        [],
        null,
      ];

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        <I18nProvider initialLocale={locale}>
          {sidebarProfile ? (
            <AppShell
              profile={sidebarProfile}
              pendingApprovalCount={taskCounts.approvalsAndReturned}
              taskCounts={taskCounts}
              categories={categories}
              featureFlags={featureFlags}
            >
              {children}
            </AppShell>
          ) : (
            children
          )}
          <DialogHost />
        </I18nProvider>
      </body>
    </html>
  );
}
