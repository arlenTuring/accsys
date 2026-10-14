import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { TOOL_CATALOG } from './catalog';

export default async function ToolsHubPage() {
  if (!(await getCurrentEmployee())) redirect('/login?returnTo=/tools');
  return (
    <main className="page-shell">
      <section className="mb-8">
        <p className="section-title">工具區</p>
        <h1 className="page-title">實用工具</h1>
        <p className="page-subtitle">
          與採購簽核流程互補的小工具入口。點進個別工具開始使用，之後會持續擴充。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOL_CATALOG.map((tool) => {
          const inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-td-blue-dark">{tool.title}</h2>
                <span
                  className={
                    tool.status === 'ready'
                      ? 'badge-approved'
                      : 'badge bg-slate-100 text-td-muted'
                  }
                >
                  {tool.badge}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-td-muted">{tool.description}</p>
              {tool.status === 'ready' && (
                <span className="mt-4 inline-flex text-sm font-semibold text-td-blue">
                  進入工具 →
                </span>
              )}
            </>
          );

          if (tool.status === 'ready') {
            return (
              <Link
                key={tool.id}
                href={tool.href}
                className="card transition hover:border-td-blue/40 hover:shadow-md"
              >
                {inner}
              </Link>
            );
          }

          return (
            <div key={tool.id} className="card cursor-not-allowed opacity-70" aria-disabled>
              {inner}
            </div>
          );
        })}
      </section>
    </main>
  );
}
