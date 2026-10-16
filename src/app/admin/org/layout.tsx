import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { hasAnyPermission } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { OrgTabs } from './org-tabs';

const ORG_AREA = ['org.manage', 'org.directory'] as const;

export default async function OrgAdminLayout({ children }: { children: ReactNode }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/org');
  if (!hasAnyPermission(employee.permissions, ORG_AREA)) redirect('/dashboard');
  return (
    <main className="page-shell space-y-5">
      <section>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">組織與簽核設定</h1>
        <p className="page-subtitle">
          維護簽核用組織資料。規則見{' '}
          <a href="/admin/guide#org" className="font-semibold text-td-blue underline">
            系統操作教學
          </a>
          。
        </p>
      </section>
      <OrgTabs />
      {children}
    </main>
  );
}
