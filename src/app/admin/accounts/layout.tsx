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
          Google 綁定與權限角色。詳細規則見{' '}
          <a href="/admin/guide#accounts" className="font-semibold text-td-blue underline">
            系統操作教學
          </a>
          。
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
