import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { hasAnyPermission, hasPermission } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { AccountsTabs } from './accounts-tabs';

const AREA = ['accounts.manage', 'org.access_roles'] as const;

export default async function AccountsAdminLayout({ children }: { children: ReactNode }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/accounts');
  if (!hasAnyPermission(employee.permissions, AREA)) redirect('/dashboard');

  return (
    <main className="page-shell max-w-5xl space-y-6">
      <div>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">帳號與權限</h1>
        <p className="page-subtitle">
          核准 Google 登入綁定、停權／復權，並由系統管理員建立權限角色（與員工是否已綁定 Google 無關）。帳號操作需 15 分鐘內登入過；權限角色需 1 小時內登入過，皆記錄稽核。
        </p>
      </div>
      <AccountsTabs
        showAccounts={hasPermission(employee.permissions, 'accounts.manage')}
        showRoles={hasPermission(employee.permissions, 'org.access_roles')}
      />
      {children}
    </main>
  );
}
