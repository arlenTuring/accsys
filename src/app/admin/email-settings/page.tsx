import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ADMIN_NAV_PERMISSIONS, hasAnyPermission } from '@/lib/authz/permissions';
import { getEmailSystemConfig, toPublicEmailConfig } from '@/lib/email/config';
import { EMAIL_CATEGORIES } from '@/lib/email/templates';
import { WORK_SCENARIOS } from '@/lib/email/work-scenarios';
import { EmailSettingsClient } from './email-settings-client';

export default async function AdminEmailSettingsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/admin/email-settings');
  if (
    employee.role !== 'admin' &&
    !hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS)
  ) {
    redirect('/dashboard');
  }

  const rawConfig = await getEmailSystemConfig();
  const publicConfig = toPublicEmailConfig(rawConfig);

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">信箱與通知模板設定（Google Service Account + Gmail API）</h1>
          <p className="page-subtitle">
            採用 Google 官方推薦之 Service Account（服務帳戶）+ Domain-Wide Delegation（網域層級委派）偽裝指定寄件信箱發信，權限嚴格限縮於{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              https://www.googleapis.com/auth/gmail.send
            </code>
            。
          </p>
        </div>
      </section>

      <EmailSettingsClient
        initialConfig={publicConfig}
        categories={EMAIL_CATEGORIES}
        viewerEmail={employee.email}
        scenarios={WORK_SCENARIOS}
      />
    </main>
  );
}
