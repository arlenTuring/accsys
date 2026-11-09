import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getServerI18n } from '@/lib/i18n/server';
import { TOOL_CATALOG } from './catalog';

export default async function ToolsHubPage() {
  if (!(await getCurrentEmployee())) redirect('/login?returnTo=/tools');
  const { t } = await getServerI18n();

  return (
    <main className="page-shell">
      <section className="mb-8">
        <p className="section-title">{t.toolsPage.sectionTitle}</p>
        <h1 className="page-title">{t.toolsPage.title}</h1>
        <p className="page-subtitle">{t.toolsPage.subtitle}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOL_CATALOG.map((tool) => {
          const title =
            tool.id === 'pdf-editor'
              ? t.toolsPage.pdfEditorTitle
              : tool.id === 'coming-soon'
                ? t.toolsPage.comingSoonTitle
                : tool.title;
          const desc =
            tool.id === 'pdf-editor'
              ? t.toolsPage.pdfEditorDesc
              : tool.id === 'coming-soon'
                ? t.toolsPage.comingSoonDesc
                : tool.description;
          const badge =
            tool.status === 'ready' ? t.toolsPage.statusReady : t.toolsPage.statusSoon;

          const inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-td-blue-dark">{title}</h2>
                <span
                  className={
                    tool.status === 'ready'
                      ? 'badge-approved'
                      : 'badge bg-slate-100 text-td-muted'
                  }
                >
                  {badge}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-td-muted">{desc}</p>
              {tool.status === 'ready' && (
                <span className="mt-4 inline-flex text-sm font-semibold text-td-blue">
                  {t.toolsPage.openTool}
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
