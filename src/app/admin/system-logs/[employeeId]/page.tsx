import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { hasPermission } from '@/lib/authz/permissions';
import {
  actionLabel,
  formatLogTime,
  getEmployeeBrief,
  listAuditForEmployee,
  listConversationsForEmployee,
  listMessagesForConversation,
  roleLabel,
} from '@/lib/admin/system-logs/queries';

export const dynamic = 'force-dynamic';

function roleZh(role: string): string {
  if (role === 'user') return '使用者';
  if (role === 'model') return 'AI 助手';
  if (role === 'system') return '系統';
  return role;
}

const LOG_TABS = [
  { key: 'permissions', label: '權限異動查詢', href: '/admin/system-logs?tab=permissions' },
  { key: 'operations', label: '系統操作紀錄', href: '/admin/system-logs?tab=operations' },
  { key: 'auth', label: '登入登出紀錄', href: '/admin/system-logs?tab=auth' },
  { key: 'ai', label: '助手對話紀錄', href: '/admin/system-logs?tab=ai' },
] as const;

export default async function SystemLogsEmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ conversation?: string; tab?: string }>;
}) {
  const viewer = await getCurrentEmployee();
  if (!viewer) redirect('/login');
  if (!hasPermission(viewer.permissions, 'audit.read')) redirect('/dashboard');

  const { employeeId } = await params;
  const sp = await searchParams;
  const tab = sp.tab === 'ops' ? 'ops' : 'ai';
  const person = await getEmployeeBrief(employeeId);
  if (!person) notFound();

  const conversations = await listConversationsForEmployee(employeeId);
  const activeConversationId =
    (typeof sp.conversation === 'string' && conversations.some((c) => c.id === sp.conversation)
      ? sp.conversation
      : conversations[0]?.id) ?? null;

  const thread =
    activeConversationId != null
      ? await listMessagesForConversation(activeConversationId, employeeId)
      : { conversation: null, messages: [] };

  const audits = tab === 'ops' ? await listAuditForEmployee(employeeId, { limit: 120 }) : [];

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理 · 系統日誌</p>
          <h1 className="page-title">
            {person.name}
            <span className="ml-2 text-base font-normal text-td-muted">{person.employeeCode}</span>
          </h1>
          <p className="mt-1 text-sm text-td-muted">
            {person.departmentName} · {roleLabel(person.role)}
          </p>
        </div>
        <Link href="/admin/system-logs?tab=ai" className="btn-secondary text-sm">
          ← 返回助手對話名單
        </Link>
      </section>

      <nav
        aria-label="系統日誌分類"
        className="flex flex-wrap gap-1 border-b border-td-border"
      >
        {LOG_TABS.map((t) => {
          const active = t.key === 'ai';
          return (
            <Link
              key={t.key}
              href={t.href}
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

      <nav className="flex gap-2 text-sm">
        <Link
          href={`/admin/system-logs/${employeeId}?tab=ai`}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            tab === 'ai'
              ? 'bg-td-blue text-white'
              : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          AI 對話紀錄
        </Link>
        <Link
          href={`/admin/system-logs/${employeeId}?tab=ops`}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            tab === 'ops'
              ? 'bg-td-blue text-white'
              : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          個人操作／簽核紀錄
        </Link>
      </nav>

      {tab === 'ops' ? (
        <section className="space-y-2">
          {audits.length === 0 ? (
            <p className="text-sm text-td-muted">此人員尚無操作紀錄。</p>
          ) : (
            <ul className="space-y-2">
              {audits.map((a) => (
                <li key={a.id} className="rounded-lg border border-td-border bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-td-blue-dark">{actionLabel(a.action)}</p>
                    <p className="text-td-muted">{formatLogTime(a.occurredAt)}</p>
                  </div>
                  <p className="mt-0.5 text-td-muted">
                    {a.entityType}
                    {a.entityId ? ` · ${a.entityId.slice(0, 8)}…` : ''}
                  </p>
                  {Boolean(a.details && typeof a.details === 'object' && Object.keys(a.details as object).length > 0) && (
                    <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-td-blue-dark">
                      {JSON.stringify(a.details, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <aside className="rounded-xl border border-td-border bg-white">
            <div className="flex items-center justify-between border-b border-td-border px-3 py-2.5">
              <p className="text-sm font-semibold text-td-blue-dark">對話清單（含已刪除保留）</p>
              <span className="text-xs text-td-muted">共 {conversations.length} 則</span>
            </div>
            {conversations.length === 0 ? (
              <p className="p-3 text-sm text-td-muted">尚無對話</p>
            ) : (
              <ul className="max-h-[70vh] overflow-y-auto divide-y divide-td-border">
                {conversations.map((c) => {
                  const isDeleted = Boolean(c.archivedAt);
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/admin/system-logs/${employeeId}?tab=ai&conversation=${c.id}`}
                        className={`block px-3 py-2.5 text-sm transition hover:bg-slate-50 ${
                          c.id === activeConversationId ? 'bg-td-blue-light/40' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`line-clamp-1 font-medium ${c.id === activeConversationId ? 'font-semibold text-td-blue-dark' : 'text-slate-800'}`}>
                            {c.title || '（未命名）'}
                          </span>
                          {isDeleted ? (
                            <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                              使用者已刪除
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                              保留中
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 space-y-0.5 text-xs text-td-muted">
                          <p>建立時間：{formatLogTime(c.createdAt)}</p>
                          {c.archivedAt ? (
                            <p className="font-medium text-rose-700">
                              刪除時間：{formatLogTime(c.archivedAt)}
                            </p>
                          ) : (
                            <p>最後互動：{formatLogTime(c.updatedAt)}</p>
                          )}
                          <p className="text-[11px] text-slate-400">共 {c.messageCount} 則訊息</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="min-h-[24rem] rounded-xl border border-td-border bg-white">
            {!thread.conversation ? (
              <p className="p-4 text-sm text-td-muted">請選擇左側對話。</p>
            ) : (
              <>
                <header className="border-b border-td-border px-4 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-td-blue-dark">
                      {thread.conversation.title || '（未命名）'}
                    </h2>
                    {thread.conversation.archivedAt ? (
                      <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                        使用者已刪除此對話（系統日誌完整保留）
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        使用者端未刪除
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <div>
                      <span className="font-medium text-slate-500">建立對話時間：</span>
                      <span className="font-semibold text-slate-800">{formatLogTime(thread.conversation.createdAt)}</span>
                    </div>
                    <div>
                      <span className="font-medium text-slate-500">刪除對話時間：</span>
                      {thread.conversation.archivedAt ? (
                        <span className="font-semibold text-rose-700">{formatLogTime(thread.conversation.archivedAt)}</span>
                      ) : (
                        <span className="text-slate-400">尚未刪除</span>
                      )}
                    </div>
                    <div>
                      <span className="font-medium text-slate-500">訊息總數：</span>
                      <span className="font-semibold text-slate-800">{thread.messages.length} 則</span>
                      <span className="ml-2 text-slate-400">（最後更新於 {formatLogTime(thread.conversation.updatedAt)}）</span>
                    </div>
                  </div>
                </header>
                <ol className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
                  {thread.messages.map((m) => {
                    const tools = Array.isArray(m.toolsUsed) ? (m.toolsUsed as string[]) : [];
                    return (
                      <li
                        key={m.id}
                        className={`rounded-lg px-3 py-2 text-sm ${
                          m.role === 'user'
                            ? 'ml-8 bg-slate-100'
                            : m.role === 'model'
                              ? 'mr-8 border border-td-border bg-white'
                              : 'bg-amber-50'
                        }`}
                      >
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-td-muted">
                          <span className="font-semibold text-td-blue-dark">{roleZh(m.role)}</span>
                          <span>{formatLogTime(m.createdAt)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-td-blue-dark">{m.contentText || '（無文字）'}</p>
                        {tools.length > 0 && (
                          <p className="mt-1 text-xs text-td-muted">工具：{tools.join('、')}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
