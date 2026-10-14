import Link from 'next/link';
import { redirect } from 'next/navigation';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { getMyApprovalQueueAll } from '@/lib/approvals/queue';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { FINANCE_LINKS } from '@/lib/forms/catalog';
import { getFormCatalog } from '@/lib/forms/catalog-server';
import { getUnreadNotificationCount } from '@/lib/notifications/queries';
import { getMyRequests } from '@/lib/purchase-requests/queries';
import { sealAmountLabel } from '@/lib/seal-requests/constants';

const ROLE_LABELS: Record<string, string> = {
  staff: '一般員工',
  finance: '財會',
  admin: '系統管理員',
};

const FINANCE_HINTS: Record<string, string> = {
  '/case-tracking': '檢視全公司案件 pipeline',
  '/budget-codes': '預算編號與年度預算',
  '/assets': '財產保管人、地點與狀態',
};

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?error=not_registered');

  const [pendingQueue, unread, myRequests, categories] = await Promise.all([
    getMyApprovalQueueAll(),
    getUnreadNotificationCount(),
    getMyRequests(),
    getFormCatalog(),
  ]);
  const pendingCount = pendingQueue.length;
  const isApplicant = employee.role === 'staff' && !employee.isGeneralManager;
  const isFinance = employee.role === 'finance' || employee.role === 'admin';

  return (
    <main className="page-shell space-y-8">
      <section>
        <p className="section-title">工作台</p>
        <h1 className="page-title">你好，{employee.name}</h1>
        <p className="page-subtitle">
          {employee.departmentName} · {employee.title ?? ROLE_LABELS[employee.role]}
          {pendingCount > 0 ? ` · ${pendingCount} 件待您簽核` : ''}
          {unread > 0 ? ` · ${unread} 則未讀通知` : ''}
        </p>
      </section>

      {pendingCount > 0 && (
        <section className="card border-td-apex/30 bg-td-apex-light/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="section-title text-td-apex-dark">待辦優先</p>
              <p className="text-lg font-semibold text-td-blue-dark">您有 {pendingCount} 件表單等待簽核</p>
            </div>
            <Link href="/approvals" className="btn-primary">
              前往待簽核
            </Link>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-td-blue-dark">我要申請</h2>
          <Link href="/forms" className="text-sm font-semibold text-td-blue hover:underline">
            所有表單與說明 →
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {categories.map((c) => (
            <div key={c.id} className="card flex flex-col !p-4">
              <Link href={`/forms#${c.id}`} className="font-semibold text-td-blue-dark hover:text-td-blue">
                {c.title}
              </Link>
              <ul className="mt-2 flex-1 space-y-0.5">
                {c.forms.map((f) => (
                  <li key={f.href}>
                    <Link
                      href={f.href}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-td-blue-dark hover:bg-td-blue-light/60 hover:text-td-blue"
                    >
                      <span>{f.title}</span>
                      <span className="text-td-blue">+</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-td-border pt-3">
                {c.records.map((r) => (
                  <Link key={r.href} href={r.href} className="text-xs font-semibold text-td-muted hover:text-td-blue">
                    {r.label} →
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {isFinance && (
        <section className="grid gap-4 md:grid-cols-3">
          {FINANCE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="link-card">
              <div>
                <p className="section-title">財會管理</p>
                <p className="font-semibold text-td-blue-dark">{l.label}</p>
                <p className="mt-1 text-sm text-td-muted">{FINANCE_HINTS[l.href]}</p>
              </div>
              <span className="text-td-blue">→</span>
            </Link>
          ))}
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-td-blue-dark">{isApplicant ? '我的最近請購' : '待我簽核'}</h2>
          {isApplicant ? (
            myRequests.length === 0 ? (
              <p className="text-sm text-td-muted">目前沒有請購單。</p>
            ) : (
              <ul className="divide-y divide-td-border">
                {myRequests.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-td-blue">
                      <span className="mono-case">{r.caseNumber}</span>
                      <span className={STATUS_BADGE[r.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[r.status] ?? r.status}</span>
                      <span className="text-sm text-td-muted">NT$ {r.totalAmount.toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : pendingCount === 0 ? (
            <p className="text-sm text-td-muted">目前沒有待簽核項目。</p>
          ) : (
            <ul className="divide-y divide-td-border">
              {pendingQueue.slice(0, 5).map((item) => (
                <li key={`${item.formType}-${item.id}`}>
                  <Link
                    href={item.href}
                    className="grid gap-1 py-3 hover:text-td-blue sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-3"
                  >
                    <span className="mono-case">{item.caseNumber}</span>
                    <span className="text-sm">
                      {item.applicantName}
                      <span className="ml-2 text-xs text-td-muted">{item.label}</span>
                    </span>
                    <span className="text-sm text-td-muted">{sealAmountLabel(item.totalAmount, item.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="space-y-4">
          <div className="space-y-3">
            <Link href="/approvals" className="link-card">
              <span>待我簽核（{pendingCount}）</span>
              <span className="text-td-blue">→</span>
            </Link>
            <Link href="/notifications" className="link-card">
              <span>通知（未讀 {unread}）</span>
              <span className="text-td-blue">→</span>
            </Link>
          </div>
          <div className="card-muted">
            <p className="section-title">使用提示</p>
            <p className="mt-2 text-sm leading-6 text-td-muted">
              上方「申請表單」依分類列出所有表單，「我的申請」可查看已送出表單的進度。切換登入頁的角色可預覽申請人、主管、財會與管理員的不同介面。
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
