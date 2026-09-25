import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getUnreadNotificationCount } from '@/lib/notifications/queries';
import { getMyAcceptanceApprovalQueue } from '@/lib/acceptances/queries';
import { getMyExpenseRequestApprovalQueue } from '@/lib/expense-requests/queries';
import { getMyPurchaseOrderApprovalQueue } from '@/lib/purchase-orders/queries';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getMyRequests } from '@/lib/purchase-requests/queries';

const ROLE_LABELS: Record<string, string> = {
  staff: '一般員工',
  finance: '財會',
  admin: '系統管理員',
};

const STATUS_BADGE: Record<string, string> = {
  pending_approval: 'badge-pending',
  approved: 'badge-approved',
  returned: 'badge-returned',
  withdrawn: 'badge-withdrawn',
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回',
  withdrawn: '已撤回',
};

export default async function DashboardPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?error=not_registered');

  const [requestQueue, orderQueue, acceptanceQueue, expenseQueue, unread, myRequests] =
    await Promise.all([
      getMyApprovalQueue(),
      getMyPurchaseOrderApprovalQueue(),
      getMyAcceptanceApprovalQueue(),
      getMyExpenseRequestApprovalQueue(),
      getUnreadNotificationCount(),
      getMyRequests(),
    ]);

  const pendingCount =
    requestQueue.length + orderQueue.length + acceptanceQueue.length + expenseQueue.length;
  const isApplicant = employee.role === 'staff' && !employee.isGeneralManager;
  const isFinance = employee.role === 'finance' || employee.role === 'admin';

  return (
    <main className="page-shell">
      <section className="mb-8">
        <p className="section-title">工作台</p>
        <h1 className="page-title">你好，{employee.name}</h1>
        <p className="page-subtitle">
          {employee.departmentName} · {employee.title ?? ROLE_LABELS[employee.role]}
          {pendingCount > 0 ? ` · ${pendingCount} 件待您簽核` : ''}
          {unread > 0 ? ` · ${unread} 則未讀通知` : ''}
        </p>
      </section>

      {isApplicant && (
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/requests/new" className="btn-primary card !py-4 text-center">
            新增請購單
          </Link>
          <Link href="/expense-requests/new" className="btn-secondary card !py-4 text-center">
            新增費用申請
          </Link>
          <Link href="/requests" className="link-card">
            <span>我的請購單（{myRequests.length}）</span>
            <span className="text-td-blue">→</span>
          </Link>
          <Link href="/notifications" className="link-card">
            <span>通知（未讀 {unread}）</span>
            <span className="text-td-blue">→</span>
          </Link>
        </section>
      )}

      {!isApplicant && pendingCount > 0 && (
        <section className="mb-8">
          <div className="card border-td-apex/30 bg-td-apex-light/30">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="section-title text-td-apex-dark">待辦優先</p>
                <p className="text-lg font-semibold text-td-blue-dark">
                  您有 {pendingCount} 件表單等待簽核
                </p>
              </div>
              <Link href="/approvals" className="btn-primary">
                前往待簽核
              </Link>
            </div>
          </div>
        </section>
      )}

      {isFinance && (
        <section className="mb-8 grid gap-4 md:grid-cols-3">
          <Link href="/case-tracking" className="link-card">
            <div>
              <p className="section-title">財會視角</p>
              <p className="font-semibold text-td-blue-dark">簽核追蹤</p>
              <p className="mt-1 text-sm text-td-muted">檢視全公司案件 pipeline</p>
            </div>
            <span className="text-td-blue">→</span>
          </Link>
          <Link href="/budget-codes" className="link-card">
            <div>
              <p className="section-title">財會視角</p>
              <p className="font-semibold text-td-blue-dark">預算編號管理</p>
            </div>
            <span className="text-td-blue">→</span>
          </Link>
          <Link href="/approvals" className="link-card">
            <div>
              <p className="section-title">待辦</p>
              <p className="font-semibold text-td-blue-dark">待我簽核（{pendingCount}）</p>
            </div>
            <span className="text-td-blue">→</span>
          </Link>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-td-blue-dark">
              {isApplicant ? '我的最近案件' : '最近動態'}
            </h2>
          </div>
          {isApplicant ? (
            myRequests.length === 0 ? (
              <p className="text-sm text-td-muted">目前沒有請購單，可先建立一筆示範申請。</p>
            ) : (
              <ul className="divide-y divide-td-border">
                {myRequests.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/requests/${r.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-td-blue"
                    >
                      <span className="mono-case">{r.caseNumber}</span>
                      <span className={STATUS_BADGE[r.status] ?? 'badge-withdrawn'}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                      <span className="text-sm text-td-muted">
                        NT$ {r.totalAmount.toLocaleString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ul className="divide-y divide-td-border">
              {[...requestQueue, ...orderQueue, ...acceptanceQueue, ...expenseQueue]
                .slice(0, 5)
                .map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="mono-case">{item.caseNumber}</span>
                    <span className="text-sm">{item.applicantName}</span>
                    <span className="badge-pending">待簽核</span>
                    <span className="text-sm text-td-muted">
                      NT$ {item.totalAmount.toLocaleString()}
                    </span>
                  </li>
                ))}
              {pendingCount === 0 && (
                <li className="py-3 text-sm text-td-muted">目前沒有待簽核項目。</li>
              )}
            </ul>
          )}
        </div>

        <aside className="space-y-4">
          {!isApplicant && (
            <div className="card">
              <h2 className="mb-3 text-lg font-semibold text-td-blue-dark">快速連結</h2>
              <div className="flex flex-col gap-2">
                <Link href="/approvals" className="btn-primary w-full">
                  待我簽核（{pendingCount}）
                </Link>
                <Link href="/notifications" className="btn-secondary w-full">
                  通知（{unread}）
                </Link>
              </div>
            </div>
          )}

          <div className="card-muted">
            <p className="section-title">流程概覽</p>
            <p className="mt-2 text-sm leading-6 text-td-muted">
              請購 → 採購 → 驗收 → 費用申請。切換登入頁的角色可預覽申請人、主管、財會與管理員的不同介面。
            </p>
            <Link href="/tools" className="mt-3 inline-flex text-sm font-semibold text-td-blue hover:underline">
              開啟工具區 →
            </Link>
          </div>
        </aside>
      </section>
    </main>
  );
}
