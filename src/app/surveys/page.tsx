import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getServerI18n } from '@/lib/i18n/server';
import {
  activateDueSurveys,
  listPendingSurveysForEmployee,
  listSurveysForViewer,
} from '@/lib/surveys/service';

export default async function SurveysPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  await activateDueSurveys();

  const [{ locale, t }, all, pending] = await Promise.all([
    getServerI18n(),
    listSurveysForViewer({
      employeeId: employee.id,
      departmentId: employee.departmentId,
      manage: false,
    }),
    listPendingSurveysForEmployee({
      employeeId: employee.id,
      departmentId: employee.departmentId,
    }),
  ]);

  const statusLabel: Record<string, string> = {
    open: t.surveysPage.statusOpen,
    closed: t.surveysPage.statusClosed,
  };

  const others = all.filter(
    (s) =>
      (s.status === 'open' || s.status === 'closed') && !pending.some((p) => p.id === s.id)
  );

  return (
    <main className="page-shell space-y-8">
      <section>
        <p className="section-title">{t.surveysPage.sectionTitle}</p>
        <h1 className="page-title">{t.surveysPage.title}</h1>
      </section>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">
            {t.surveysPage.pendingSection}
            <span className="ml-2 font-normal text-td-muted">({pending.length})</span>
          </h2>
          <ul className="grid gap-2">
            {pending.map((s) => (
              <li key={s.id} className="card p-3 text-sm">
                <Link className="font-semibold underline" href={s.href}>
                  {s.title}
                </Link>
                {s.closesAt && (
                  <p className="text-xs text-td-muted">
                    {t.surveysPage.closesAtPrefix}{' '}
                    {new Date(s.closesAt).toLocaleString(locale === 'zh-Hant' ? 'zh-TW' : locale)}
                  </p>
                )}
                {s.draft && <p className="text-xs text-td-muted">{t.surveysPage.hasDraft}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-td-blue-dark">
          {t.surveysPage.allSurveysSection}
          <span className="ml-2 font-normal text-td-muted">({others.length})</span>
        </h2>
        {others.length === 0 ? (
          <p className="text-sm text-td-muted">
            {pending.length > 0 ? t.surveysPage.noOtherSurveys : t.surveysPage.noSurveys}
          </p>
        ) : (
          <ul className="grid gap-2">
            {others.map((s) => (
              <li
                key={s.id}
                className="card flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm"
              >
                <Link
                  className="font-semibold text-td-blue-dark underline"
                  href={`/surveys/${s.id}`}
                >
                  {s.title}
                </Link>
                <span className="text-xs text-td-muted">
                  {statusLabel[s.status] ?? s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
