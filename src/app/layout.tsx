import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import './globals.css';
import { getPendingApprovalCount } from '@/lib/approvals/pending-count';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getFormCatalog } from '@/lib/forms/catalog-server';
import { DialogHost } from '@/app/components/dialog';
import { TopNav } from '@/app/components/top-nav';
import type { MenuEmployee } from '@/app/components/user-menu';

export const metadata: Metadata = {
  title: 'ACCSYS · 台灣智慧駕駛 電子採購與簽核',
  description: '台灣智慧駕駛內部電子採購與簽核系統',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployee();
  const [pendingApprovalCount, categories] = employee ? await Promise.all([getPendingApprovalCount(), getFormCatalog()]) : [0, []];
  // Only what the menu shows is serialized to the browser (no session id or login time).
  const menuEmployee: MenuEmployee | null = employee && {
    name: employee.name,
    email: employee.email,
    employeeCode: employee.employeeCode,
    title: employee.title,
    departmentName: employee.departmentName,
    departmentCode: employee.departmentCode,
    role: employee.role,
    permissions: employee.permissions,
    isGeneralManager: employee.isGeneralManager,
    isChairman: employee.isChairman,
  };

  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        {menuEmployee && <TopNav employee={menuEmployee} pendingApprovalCount={pendingApprovalCount} categories={categories} />}
        {children}
        <DialogHost />
      </body>
    </html>
  );
}
