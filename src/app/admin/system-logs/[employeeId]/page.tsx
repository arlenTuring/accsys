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
        <Link href="/admin/system-logs" className="btn-secondary text-sm">
          返回名單
        </Link>
      </section>

      <nav className="flex gap-2 border-b border-td-border pb-2 text-sm">
        <Link
          href={`/admin/system-logs/${employeeId}?tab=ai`}
          className={tab === 'ai' ? 'font-semibold text-td-blue-dark' : 'text-td-muted underline'}
        >
          AI 對話
        </Link>
        <Link
          href={`/admin/system-logs/${employeeId}?tab=ops`}
          className={tab === 'ops' ? 'font-semibold text-td-blue-dark' : 'text-td-muted underline'}
        >
          操作／簽核紀錄
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
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <aside className="rounded-xl border border-td-border bg-white">
            <p className="border-b border-td-border px-3 py-2 text-sm font-semibold text-td-blue-dark">對話清單</p>
            {conversations.length === 0 ? (
              <p className="p-3 text-sm text-td-muted">尚無對話</p>
            ) : (
              <ul className="max-h-[70vh] overflow-y-auto">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/system-logs/${employeeId}?tab=ai&conversation=${c.id}`}
                      className={`block border-b border-td-border px-3 py-2 text-sm hover:bg-slate-50 ${
                        c.id === activeConversationId ? 'bg-td-blue-light/40 font-semibold' : ''
                      }`}
                    >
                      <span className="line-clamp-2">{c.title || '（未命名）'}</span>
                      <span className="mt-0.5 block text-xs text-td-muted">
                        {c.messageCount} 則 · {formatLogTime(c.updatedAt)}
                        {c.archivedAt ? ' · 已封存' : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="min-h-[24rem] rounded-xl border border-td-border bg-white">
            {!thread.conversation ? (
              <p className="p-4 text-sm text-td-muted">請選擇左側對話。</p>
            ) : (
              <>
                <header className="border-b border-td-border px-4 py-3">
                  <h2 className="font-semibold text-td-blue-dark">{thread.conversation.title || '（未命名）'}</h2>
                  <p className="text-xs text-td-muted">
                    {thread.messages.length} 則訊息 · 更新於 {formatLogTime(thread.conversation.updatedAt)}
                  </p>
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
