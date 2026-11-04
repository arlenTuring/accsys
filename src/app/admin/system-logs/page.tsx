import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { hasPermission } from '@/lib/authz/permissions';
import {
  formatLogTime,
  listAiUsers,
} from '@/lib/admin/system-logs/queries';

export const dynamic = 'force-dynamic';

export default async function SystemLogsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!hasPermission(employee.permissions, 'audit.read')) redirect('/dashboard');

  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const users = await listAiUsers({ query: q || undefined, limit: 80 });

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">系統日誌</h1>
          <p className="mt-1 text-sm text-td-muted">
            依人員查看 AI 對話（含助手回應）、工具使用與簽核／操作紀錄。
          </p>
        </div>
      </section>

      <form className="flex flex-wrap gap-2" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜尋姓名、工號、部門"
          className="min-w-[16rem] flex-1 rounded-lg border border-td-border px-3 py-2 text-sm"
        />
        <button type="submit" className="btn-secondary text-sm">
          搜尋
        </button>
      </form>

      {users.length === 0 ? (
        <p className="text-sm text-td-muted">尚無符合的 AI 使用紀錄。</p>
      ) : (
        <ul className="divide-y divide-td-border rounded-xl border border-td-border bg-white">
          {users.map((u) => (
            <li key={u.employeeId}>
              <Link
                href={`/admin/system-logs/${u.employeeId}`}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="font-semibold text-td-blue-dark">
                    {u.name}
                    <span className="ml-2 font-normal text-td-muted">{u.employeeCode}</span>
                  </p>
                  <p className="text-sm text-td-muted">{u.departmentName ?? '—'}</p>
                </div>
                <div className="text-right text-sm text-td-muted">
                  <p>
                    {u.conversationCount} 對話 · {u.messageCount} 訊息
                  </p>
                  <p>最近 {formatLogTime(u.lastActivityAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
