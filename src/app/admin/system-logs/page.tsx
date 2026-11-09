import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { hasPermission } from '@/lib/authz/permissions';
import {
  formatLogTime,
  listAiUsers,
  listAuthAuditLogs,
  listPermissionAuditLogs,
  listSystemOperationAuditLogs,
  roleLabel,
  type SystemOperationCategory,
} from '@/lib/admin/system-logs/queries';

export const dynamic = 'force-dynamic';

type LogTab = 'permissions' | 'operations' | 'auth' | 'ai';

const TABS: Array<{ key: LogTab; label: string; subtitle: string }> = [
  {
    key: 'permissions',
    label: '權限異動查詢',
    subtitle: '紀錄哪個管理員帳號在什麼時間修改了哪位人員的角色、存取權限、Google 綁定或權限角色定義。',
  },
  {
    key: 'operations',
    label: '系統操作紀錄',
    subtitle: '紀錄設定與發布公司公告、發布內部問卷、製作與發布表單、維護公司規章及組織架構等系統大型變更。',
  },
  {
    key: 'auth',
    label: '登入登出紀錄',
    subtitle: '完整記錄全體人員（含一般員工、財會與管理員）的系統登入、主動登出與登入遭拒事件。',
  },
  {
    key: 'ai',
    label: '助手對話紀錄',
    subtitle: '蒐集並檢視員工與 AI 助手的歷史對話內容、助手回覆與工具呼叫紀錄。',
  },
];

function parseTab(raw?: string): LogTab {
  if (raw === 'operations' || raw === 'auth' || raw === 'ai' || raw === 'permissions') {
    return raw;
  }
  return 'permissions';
}

function permissionActionBadgeClass(action: string): string {
  if (action === 'employee.role_changed') {
    return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200';
  }
  if (action === 'employee.access_disabled' || action === 'identity.revoked' || action === 'access_role.deactivated') {
    return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
  }
  if (action === 'employee.access_enabled' || action.startsWith('identity.')) {
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  }
  return 'bg-amber-50 text-amber-800 ring-1 ring-amber-200';
}

function operationCategoryBadgeClass(cat: Exclude<SystemOperationCategory, 'all'>): string {
  switch (cat) {
    case 'announcement':
      return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
    case 'survey':
      return 'bg-purple-50 text-purple-700 ring-1 ring-purple-200';
    case 'form':
      return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200';
    case 'regulation':
      return 'bg-teal-50 text-teal-700 ring-1 ring-teal-200';
    case 'org':
      return 'bg-amber-50 text-amber-800 ring-1 ring-amber-200';
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
  }
}

function authStatusBadge(status: 'login' | 'logout' | 'denied', title: string) {
  if (status === 'login') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {title}
      </span>
    );
  }
  if (status === 'logout') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        {title}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
      {title}
    </span>
  );
}

export default async function SystemLogsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    filter?: string;
    category?: string;
    status?: string;
  }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!hasPermission(employee.permissions, 'audit.read')) redirect('/dashboard');

  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const filter = typeof sp.filter === 'string' ? sp.filter.trim() : 'all';
  const category = typeof sp.category === 'string' ? sp.category.trim() : 'all';
  const statusFilter = typeof sp.status === 'string' ? sp.status.trim() : 'all';

  const currentTabMeta = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  const [permissionLogs, operationLogs, authLogs, aiUsers] = await Promise.all([
    activeTab === 'permissions'
      ? listPermissionAuditLogs({
          query: q || undefined,
          actionFilter: filter !== 'all' ? filter : undefined,
          limit: 120,
        })
      : Promise.resolve([]),
    activeTab === 'operations'
      ? listSystemOperationAuditLogs({
          query: q || undefined,
          category: category !== 'all' ? category : undefined,
          limit: 120,
        })
      : Promise.resolve([]),
    activeTab === 'auth'
      ? listAuthAuditLogs({
          query: q || undefined,
          statusFilter: statusFilter !== 'all' ? statusFilter : undefined,
          limit: 150,
        })
      : Promise.resolve([]),
    activeTab === 'ai'
      ? listAiUsers({ query: q || undefined, limit: 100 })
      : Promise.resolve([]),
  ]);

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">系統日誌</h1>
          <p className="mt-1 text-sm text-td-muted">{currentTabMeta.subtitle}</p>
        </div>
      </section>

      {/* 四大日誌分頁導覽 */}
      <nav
        aria-label="系統日誌分類"
        className="flex flex-wrap gap-1 border-b border-td-border"
      >
        {TABS.map((t) => {
          const active = t.key === activeTab;
          return (
            <Link
              key={t.key}
              href={`/admin/system-logs?tab=${t.key}`}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                active
                  ? 'border-td-blue text-td-blue-dark'
                  : 'border-transparent text-td-muted hover:border-slate-300 hover:text-td-blue-dark'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* ================================================================= */}
      {/* 1. 權限異動查詢 */}
      {/* ================================================================= */}
      {activeTab === 'permissions' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: '全部權限異動' },
                { key: 'role_change', label: '變更人員角色' },
                { key: 'access_toggle', label: '啟停用存取權限' },
                { key: 'identity', label: 'Google 帳號綁定' },
                { key: 'role_def', label: '權限角色定義' },
              ].map((pill) => {
                const isActive = (filter || 'all') === pill.key;
                const params = new URLSearchParams();
                params.set('tab', 'permissions');
                if (pill.key !== 'all') params.set('filter', pill.key);
                if (q) params.set('q', q);
                return (
                  <Link
                    key={pill.key}
                    href={`/admin/system-logs?${params.toString()}`}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      isActive
                        ? 'bg-td-blue text-white shadow-xs'
                        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {pill.label}
                  </Link>
                );
              })}
            </div>

            <form className="flex flex-wrap items-center gap-2" method="get">
              <input type="hidden" name="tab" value="permissions" />
              {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
              <input
                name="q"
                defaultValue={q}
                placeholder="搜尋操作帳號、目標人員、工號或角色..."
                className="min-w-[16rem] rounded-lg border border-td-border bg-white px-3 py-1.5 text-sm"
              />
              <button type="submit" className="btn-secondary py-1.5 text-sm">
                搜尋
              </button>
              {q && (
                <Link
                  href={`/admin/system-logs?tab=permissions${filter !== 'all' ? `&filter=${filter}` : ''}`}
                  className="text-xs text-td-muted underline hover:text-td-blue-dark"
                >
                  清除
                </Link>
              )}
            </form>
          </div>

          {permissionLogs.length === 0 ? (
            <div className="rounded-xl border border-td-border bg-white p-8 text-center text-sm text-td-muted">
              尚無符合條件的權限異動紀錄。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-td-border bg-white">
              <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-td-border bg-slate-50/80 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    <th className="px-4 py-3">異動時間</th>
                    <th className="px-4 py-3">操作帳號（執行人）</th>
                    <th className="px-4 py-3">異動對象（人員／角色）</th>
                    <th className="px-4 py-3">異動類型</th>
                    <th className="px-4 py-3">權限異動內容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-td-border">
                  {permissionLogs.map((item) => (
                    <tr key={item.id} className="align-top hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {formatLogTime(item.occurredAt)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-td-blue-dark">
                          {item.actorName}
                          {item.actorCode && (
                            <span className="ml-1.5 font-normal text-xs text-td-muted">
                              {item.actorCode}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-td-muted">
                          {item.actorDepartment ?? item.actorEmail ?? '系統程序'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">
                          {item.targetName}
                          {item.targetCode && (
                            <span className="ml-1.5 font-normal text-xs text-td-muted">
                              {item.targetCode}
                            </span>
                          )}
                        </p>
                        {item.targetDepartment && (
                          <p className="text-xs text-td-muted">{item.targetDepartment}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${permissionActionBadgeClass(
                            item.action
                          )}`}
                        >
                          {item.actionTitle}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <p>{item.summary}</p>
                        {Object.keys(item.details).length > 0 && (
                          <details className="mt-1 text-xs text-td-muted">
                            <summary className="cursor-pointer select-none hover:text-td-blue-dark">
                              檢視原始參數
                            </summary>
                            <pre className="mt-1.5 max-w-xl overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/70">
                              {JSON.stringify(item.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* 2. 系統操作紀錄 */}
      {/* ================================================================= */}
      {activeTab === 'operations' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: '全部變更' },
                { key: 'announcement', label: '公司公告' },
                { key: 'survey', label: '內部問卷' },
                { key: 'form', label: '表單設計' },
                { key: 'regulation', label: '公司規章' },
                { key: 'org', label: '組織與人事' },
                { key: 'master', label: '公司與資產設定' },
              ].map((pill) => {
                const isActive = (category || 'all') === pill.key;
                const params = new URLSearchParams();
                params.set('tab', 'operations');
                if (pill.key !== 'all') params.set('category', pill.key);
                if (q) params.set('q', q);
                return (
                  <Link
                    key={pill.key}
                    href={`/admin/system-logs?${params.toString()}`}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      isActive
                        ? 'bg-td-blue text-white shadow-xs'
                        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {pill.label}
                  </Link>
                );
              })}
            </div>

            <form className="flex flex-wrap items-center gap-2" method="get">
              <input type="hidden" name="tab" value="operations" />
              {category !== 'all' && <input type="hidden" name="category" value={category} />}
              <input
                name="q"
                defaultValue={q}
                placeholder="搜尋操作帳號、公告／問卷／表單名稱..."
                className="min-w-[16rem] rounded-lg border border-td-border bg-white px-3 py-1.5 text-sm"
              />
              <button type="submit" className="btn-secondary py-1.5 text-sm">
                搜尋
              </button>
              {q && (
                <Link
                  href={`/admin/system-logs?tab=operations${category !== 'all' ? `&category=${category}` : ''}`}
                  className="text-xs text-td-muted underline hover:text-td-blue-dark"
                >
                  清除
                </Link>
              )}
            </form>
          </div>

          {operationLogs.length === 0 ? (
            <div className="rounded-xl border border-td-border bg-white p-8 text-center text-sm text-td-muted">
              尚無符合條件的系統操作紀錄。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-td-border bg-white">
              <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-td-border bg-slate-50/80 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    <th className="px-4 py-3">操作時間</th>
                    <th className="px-4 py-3">操作帳號（執行人）</th>
                    <th className="px-4 py-3">變更模組</th>
                    <th className="px-4 py-3">變更標的（公告／問卷／表單／設定）</th>
                    <th className="px-4 py-3">操作動作與明細</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-td-border">
                  {operationLogs.map((item) => (
                    <tr key={item.id} className="align-top hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {formatLogTime(item.occurredAt)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-td-blue-dark">
                          {item.actorName}
                          {item.actorCode && (
                            <span className="ml-1.5 font-normal text-xs text-td-muted">
                              {item.actorCode}
                            </span>
                          )}
                        </p>
                        {item.actorDepartment && (
                          <p className="text-xs text-td-muted">{item.actorDepartment}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${operationCategoryBadgeClass(
                            item.category
                          )}`}
                        >
                          {item.categoryLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {item.targetTitle}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <p>{item.summary}</p>
                        {Object.keys(item.details).length > 0 && (
                          <details className="mt-1 text-xs text-td-muted">
                            <summary className="cursor-pointer select-none hover:text-td-blue-dark">
                              檢視變更明細
                            </summary>
                            <pre className="mt-1.5 max-w-xl overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/70">
                              {JSON.stringify(item.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* 3. 登入登出紀錄 */}
      {/* ================================================================= */}
      {activeTab === 'auth' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: '全部紀錄' },
                { key: 'login', label: '登入成功' },
                { key: 'logout', label: '登出系統' },
                { key: 'denied', label: '登入遭拒／待綁定' },
              ].map((pill) => {
                const isActive = (statusFilter || 'all') === pill.key;
                const params = new URLSearchParams();
                params.set('tab', 'auth');
                if (pill.key !== 'all') params.set('status', pill.key);
                if (q) params.set('q', q);
                return (
                  <Link
                    key={pill.key}
                    href={`/admin/system-logs?${params.toString()}`}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      isActive
                        ? 'bg-td-blue text-white shadow-xs'
                        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {pill.label}
                  </Link>
                );
              })}
            </div>

            <form className="flex flex-wrap items-center gap-2" method="get">
              <input type="hidden" name="tab" value="auth" />
              {statusFilter !== 'all' && (
                <input type="hidden" name="status" value={statusFilter} />
              )}
              <input
                name="q"
                defaultValue={q}
                placeholder="搜尋員工姓名、工號、部門或信箱..."
                className="min-w-[16rem] rounded-lg border border-td-border bg-white px-3 py-1.5 text-sm"
              />
              <button type="submit" className="btn-secondary py-1.5 text-sm">
                搜尋
              </button>
              {q && (
                <Link
                  href={`/admin/system-logs?tab=auth${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`}
                  className="text-xs text-td-muted underline hover:text-td-blue-dark"
                >
                  清除
                </Link>
              )}
            </form>
          </div>

          {authLogs.length === 0 ? (
            <div className="rounded-xl border border-td-border bg-white p-8 text-center text-sm text-td-muted">
              尚無符合條件的登入登出紀錄。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-td-border bg-white">
              <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-td-border bg-slate-50/80 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    <th className="px-4 py-3">發生時間</th>
                    <th className="px-4 py-3">人員帳號（含全體員工）</th>
                    <th className="px-4 py-3">部門／權限角色</th>
                    <th className="px-4 py-3">事件狀態</th>
                    <th className="px-4 py-3">驗證方式與說明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-td-border">
                  {authLogs.map((item) => (
                    <tr key={item.id} className="align-top hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {formatLogTime(item.occurredAt)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-td-blue-dark">
                          {item.employeeName}
                          {item.employeeCode && (
                            <span className="ml-1.5 font-normal text-xs text-td-muted">
                              {item.employeeCode}
                            </span>
                          )}
                        </p>
                        {item.email && (
                          <p className="text-xs text-td-muted">{item.email}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>{item.departmentName ?? '—'}</p>
                        {item.role && (
                          <p className="text-td-muted">{roleLabel(item.role)}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {authStatusBadge(item.status, item.actionTitle)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <p className="font-medium text-slate-800">{item.methodLabel}</p>
                        <p className="text-xs text-td-muted">{item.note}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* 4. 助手對話紀錄 */}
      {/* ================================================================= */}
      {activeTab === 'ai' && (
        <section className="space-y-4">
          <form className="flex flex-wrap gap-2" method="get">
            <input type="hidden" name="tab" value="ai" />
            <input
              name="q"
              defaultValue={q}
              placeholder="搜尋員工姓名、工號、部門..."
              className="min-w-[16rem] flex-1 rounded-lg border border-td-border bg-white px-3 py-2 text-sm"
            />
            <button type="submit" className="btn-secondary text-sm">
              搜尋
            </button>
            {q && (
              <Link
                href="/admin/system-logs?tab=ai"
                className="inline-flex items-center px-2 text-xs text-td-muted underline hover:text-td-blue-dark"
              >
                清除
              </Link>
            )}
          </form>

          {aiUsers.length === 0 ? (
            <div className="rounded-xl border border-td-border bg-white p-8 text-center text-sm text-td-muted">
              尚無符合的 AI 助手對話紀錄。
            </div>
          ) : (
            <ul className="divide-y divide-td-border rounded-xl border border-td-border bg-white">
              {aiUsers.map((u) => (
                <li key={u.employeeId}>
                  <Link
                    href={`/admin/system-logs/${u.employeeId}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-semibold text-td-blue-dark">
                        {u.name}
                        <span className="ml-2 font-normal text-td-muted">
                          {u.employeeCode}
                        </span>
                      </p>
                      <p className="text-sm text-td-muted">
                        {u.departmentName ?? '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-right text-sm text-td-muted">
                      <div>
                        <p className="font-medium text-slate-700">
                          {u.conversationCount} 則對話串
                          {u.deletedConversationCount > 0 && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                              含 {u.deletedConversationCount} 則使用者已刪除
                            </span>
                          )}
                          {' · '}
                          {u.messageCount} 則訊息
                        </p>
                        <p className="text-xs">
                          最近活動：{formatLogTime(u.lastActivityAt)}
                        </p>
                      </div>
                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-td-blue-dark">
                        查看對話 →
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
