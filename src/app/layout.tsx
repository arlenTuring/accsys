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
import { AppShell } from '@/app/components/app-shell';
import { DialogHost } from '@/app/components/dialog';
import { GlobalAssistantHost } from '@/app/components/global-assistant';

export const metadata: Metadata = {
  title: 'ACCSYS · 台灣智慧駕駛 電子採購與簽核',
  description: '台灣智慧駕駛內部電子採購與簽核系統',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployee();
  const [pendingApprovalCount, categories, sidebarProfile] = employee
    ? await Promise.all([
        getPendingApprovalCount(),
        getFormCatalog(),
        getSidebarEmployeeProfile(employee),
      ])
    : [0, [], null];

  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
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
        <GlobalAssistantHost enabled={Boolean(sidebarProfile)} />
      </body>
    </html>
  );
}
