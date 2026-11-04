import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  activateDueSurveys,
  listPendingSurveysForEmployee,
  listSurveysForViewer,
} from '@/lib/surveys/service';

const STATUS_LABEL: Record<string, string> = {
  open: '進行中',
  closed: '已結束',
};

export default async function SurveysPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  await activateDueSurveys();

  const [all, pending] = await Promise.all([
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

  const others = all.filter(
    (s) =>
      (s.status === 'open' || s.status === 'closed') && !pending.some((p) => p.id === s.id)
  );

  return (
    <main className="page-shell space-y-8">
      <section>
        <p className="section-title">公司資訊</p>
        <h1 className="page-title">內部問卷</h1>
      </section>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">
            待填寫
            <span className="ml-2 font-normal text-td-muted">({pending.length})</span>
          </h2>
          <ul className="grid gap-2">
            {pending.map((s) => (
              <li key={s.id} className="card p-3 text-sm">
                <Link className="font-semibold underline" href={s.href}>
                  {s.title}
                </Link>
                {s.closesAt && (
                  <p className="text-xs text-td-muted">截止 {new Date(s.closesAt).toLocaleString('zh-TW')}</p>
                )}
                {s.draft && <p className="text-xs text-td-muted">已有暫存</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-td-blue-dark">
          問卷
          <span className="ml-2 font-normal text-td-muted">({others.length})</span>
        </h2>
        {others.length === 0 ? (
          <p className="text-sm text-td-muted">{pending.length > 0 ? '沒有其他問卷' : '目前沒有問卷'}</p>
        ) : (
          <ul className="grid gap-2">
            {others.map((s) => (
              <li key={s.id} className="card flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm">
                <Link className="font-semibold text-td-blue-dark underline" href={`/surveys/${s.id}`}>
                  {s.title}
                </Link>
                <span className="text-xs text-td-muted">{STATUS_LABEL[s.status] ?? s.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
