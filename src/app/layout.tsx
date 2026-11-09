import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import './globals.css';
import { getPendingApprovalCount } from '@/lib/approvals/pending-count';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getSidebarEmployeeProfile } from '@/lib/auth/sidebar-profile';
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
  const [employee, { locale }] = await Promise.all([
    getCurrentEmployee(),
    getServerI18n(),
  ]);

  const [pendingApprovalCount, categories, sidebarProfile] = employee
    ? await Promise.all([
        getPendingApprovalCount(),
        getFormCatalog(),
        getSidebarEmployeeProfile(employee),
      ])
    : [0, [], null];

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        <I18nProvider initialLocale={locale}>
          {sidebarProfile ? (
            <AppShell
              profile={sidebarProfile}
              pendingApprovalCount={pendingApprovalCount}
              categories={categories}
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
