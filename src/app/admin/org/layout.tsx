import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { hasAnyPermission } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { OrgTabs } from './org-tabs';

const ORG_AREA = ['org.manage', 'org.directory', 'org.access_roles'] as const;

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
          簽核流程依這裡的部門、層級、職務、群組與代理人決定簽核人；「權限角色」決定誰能進管理與財會功能。修改需 1 小時內登入過，每次修改都會記錄稽核；正在被簽核流程使用的項目不能刪除或停用。
        </p>
      </section>
      <OrgTabs />
      {children}
    </main>
  );
}
