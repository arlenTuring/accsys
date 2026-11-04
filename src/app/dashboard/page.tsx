import Link from 'next/link';
import { redirect } from 'next/navigation';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import {
  activateDueScheduled,
  listUnreadForEmployee,
  listVisibleAnnouncements,
} from '@/lib/announcements/service';
import { getMyApplicationsAll } from '@/lib/applications/my-applications';
import { getMyApprovalQueueAll } from '@/lib/approvals/queue';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { FINANCE_LINKS, MY_APPLICATION_LINKS } from '@/lib/forms/catalog';
import { getFormCatalog } from '@/lib/forms/catalog-server';
import { getUnreadNotificationCount } from '@/lib/notifications/queries';
import { sealAmountLabel } from '@/lib/seal-requests/constants';
import { taipeiToday } from '@/lib/taipei-date';

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

  await activateDueScheduled();

  const [pendingQueue, unread, myApplications, categories, announcements, unreadAnnouncements] =
    await Promise.all([
      getMyApprovalQueueAll(),
      getUnreadNotificationCount(),
      getMyApplicationsAll(),
      getFormCatalog(),
      listVisibleAnnouncements({
        employeeId: employee.id,
        departmentId: employee.departmentId,
      }),
      listUnreadForEmployee({
        employeeId: employee.id,
        departmentId: employee.departmentId,
        limit: 20,
      }),
    ]);
  const pendingCount = pendingQueue.length;
  const myInProgressCount = myApplications.filter(
    (a) => a.status === 'pending_approval' || a.status === 'returned'
  ).length;
  const isFinance =
    employee.role === 'finance' ||
    employee.role === 'admin' ||
    employee.permissions.some((p) => p === 'finance.budget' || p === 'finance.cases' || p === 'finance.assets' || p === 'forms.read_all');
  const unreadAnnouncementIds = new Set(unreadAnnouncements.map((a) => a.id));
  const homeAnnouncements = announcements
    .filter((a) => a.status === 'published' || a.status === 'expired' || a.status === 'scheduled')
    .slice(0, 5);

  return (
    <main className="page-shell space-y-8">
      <section>
        <p className="section-title">工作台</p>
        <h1 className="page-title">你好，{employee.name}</h1>
        <p className="page-subtitle">
          {employee.departmentName} · {employee.title ?? ROLE_LABELS[employee.role] ?? employee.role}
          {pendingCount > 0 ? ` · ${pendingCount} 件待您簽核` : ''}
          {unread > 0 ? ` · ${unread} 則未讀通知` : ''}
          {unreadAnnouncements.length > 0 ? ` · ${unreadAnnouncements.length} 則未讀公告` : ''}
        </p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-td-blue-dark">公司公告</h2>
          <Link href="/announcements" className="text-sm font-semibold text-td-blue hover:underline">
            全部公告 →
          </Link>
        </div>
        {homeAnnouncements.length === 0 ? (
          <p className="card text-sm text-td-muted">目前沒有公告。</p>
        ) : (
          <ul className="grid gap-3">
            {homeAnnouncements.map((a) => {
              const isUnread = unreadAnnouncementIds.has(a.id);
              return (
                <li key={a.id} className={`card space-y-1 !p-4 ${isUnread ? 'border-td-blue/40 bg-td-blue-light/20' : ''}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/announcements/${a.id}`} className="text-base font-semibold text-td-blue-dark hover:text-td-blue hover:underline">
                      {a.pinned ? '[置頂] ' : ''}
                      {a.title}
                      {isUnread ? <span className="ml-2 text-xs font-semibold text-td-blue">未讀</span> : null}
                    </Link>
                    <span className="text-xs text-td-muted">
                      {a.publishedAt ? taipeiToday(a.publishedAt) : a.publishAt ? taipeiToday(a.publishAt) : ''}
                      {a.priority !== 'normal' ? ` · ${a.priority}` : ''}
                    </span>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm text-td-muted">{a.body.slice(0, 160)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {pendingCount > 0 && (
        <section className="card border-td-apex/30 bg-td-apex-light/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="section-title text-td-apex-dark">待辦優先</p>
              <p className="text-lg font-semibold text-td-blue-dark">您有 {pendingCount} 件表單等待簽核</p>
            </div>
            <Link href="/applications?status=to_approve" className="btn-primary">
              前往審核簽核
            </Link>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-td-blue-dark">我要申請</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {MY_APPLICATION_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="text-sm font-semibold text-td-blue hover:underline">
                {l.label} →
              </Link>
            ))}
            <Link href="/forms" className="text-sm font-semibold text-td-blue hover:underline">
              所有表單與說明 →
            </Link>
          </div>
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
        <div className="space-y-6">
          <div className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-td-blue-dark">我的申請進度</h2>
                <p className="text-xs text-td-muted">
                  共 {myApplications.length} 件申請（{myInProgressCount} 件進行中或待修改）
                </p>
              </div>
              <Link href="/applications" className="text-sm font-semibold text-td-blue hover:underline">
                查看全部申請進度 →
              </Link>
            </div>
            {myApplications.length === 0 ? (
              <p className="text-sm text-td-muted">目前沒有已送出的申請表單。</p>
            ) : (
              <ul className="divide-y divide-td-border">
                {myApplications.slice(0, 5).map((r) => (
                  <li key={`${r.formType}-${r.id}`}>
                    <Link
                      href={r.href}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-td-blue"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono-case">{r.caseNumber}</span>
                        <span className="text-sm font-medium text-td-blue-dark">{r.formLabel}</span>
                        <span className={STATUS_BADGE[r.status] ?? 'badge-withdrawn'}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                        {r.status === 'pending_approval' && r.currentNodeLabel && (
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-td-blue-dark">
                            {r.progress && r.progress.total > 0
                              ? `第 ${r.progress.done}/${r.progress.total} 關 · `
                              : ''}
                            {r.currentNodeLabel}
                            {r.pendingApproverNames.length > 0
                              ? `（${r.pendingApproverNames.join('、')}）`
                              : ''}
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-td-muted">
                        {r.totalAmount === null ? r.dateLabel : sealAmountLabel(r.totalAmount, r.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pendingCount > 0 && (
            <div className="card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-td-blue-dark">待我簽核</h2>
                <Link href="/approvals" className="text-sm font-semibold text-td-blue hover:underline">
                  全部待簽核（{pendingCount}）→
                </Link>
              </div>
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
                      <span className="text-sm text-td-muted">
                        {sealAmountLabel(item.totalAmount, item.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="space-y-3">
            <Link href="/applications" className="link-card">
              <span>簽核管理（待簽 {pendingCount} · 進行中 {myInProgressCount}）</span>
              <span className="text-td-blue">→</span>
            </Link>
            <Link href="/applications/drafts" className="link-card">
              <span>我的草稿庫</span>
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
              上方「簽核管理」集中顯示等待您簽核的表單以及您自己送出的所有單據與簽核關卡進度。
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
