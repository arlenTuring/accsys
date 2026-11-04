import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SurveyCloseButton } from '@/app/surveys/[id]/survey-close-button';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { activateDueSurveys, canManageSurveys, listSurveysForViewer } from '@/lib/surveys/service';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  scheduled: '預約發布',
  open: '進行中',
  closed: '已結束',
  archived: '已封存',
};

type SurveyRow = {
  id: string;
  title: string;
  status: string;
  version: number;
  opensAt?: Date | null;
  closesAt?: Date | null;
};

function ManageList(props: {
  title: string;
  empty: string;
  items: SurveyRow[];
  hrefFor: (s: SurveyRow) => string;
  showClose?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-td-blue-dark">
        {props.title}
        <span className="ml-2 font-normal text-td-muted">({props.items.length})</span>
      </h2>
      {props.items.length === 0 ? (
        <p className="text-sm text-td-muted">{props.empty}</p>
      ) : (
        <ul className="grid gap-2">
          {props.items.map((s) => (
            <li key={s.id} className="card flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 space-y-0.5">
                <Link className="font-semibold text-td-blue-dark underline" href={props.hrefFor(s)}>
                  {s.title}
                </Link>
                <p className="text-xs text-td-muted">
                  {STATUS_LABEL[s.status] ?? s.status}
                  {s.status === 'scheduled' && s.opensAt
                    ? ` · ${s.opensAt.toLocaleString('zh-TW', { hour12: false })}`
                    : ''}
                  {s.closesAt ? ` · 截止 ${s.closesAt.toLocaleString('zh-TW', { hour12: false })}` : ''}
                </p>
              </div>
              {props.showClose && s.status === 'open' && (
                <SurveyCloseButton surveyId={s.id} version={s.version} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function AdminSurveysPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageSurveys(employee))) redirect('/surveys');

  await activateDueSurveys();
  const all = await listSurveysForViewer({
    employeeId: employee.id,
    departmentId: employee.departmentId,
    manage: true,
  });

  const drafts = all.filter((s) => s.status === 'draft' || s.status === 'scheduled');
  const publishing = all.filter((s) => s.status === 'open');
  const completed = all.filter((s) => s.status === 'closed' || s.status === 'archived');

  return (
    <main className="page-shell space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">問卷管理</h1>
        </div>
        <Link href="/admin/surveys/new" className="btn-primary text-sm">
          新增問卷
        </Link>
      </section>

      <ManageList
        title="草稿／預約"
        empty="沒有草稿"
        items={drafts}
        hrefFor={(s) => `/admin/surveys/${s.id}/edit`}
      />
      <ManageList
        title="發布中"
        empty="目前沒有發布中的問卷"
        items={publishing}
        hrefFor={(s) => `/surveys/${s.id}`}
        showClose
      />
      <ManageList
        title="已完成"
        empty="尚無已結束的問卷"
        items={completed}
        hrefFor={(s) => `/surveys/${s.id}`}
      />

      <p className="text-sm">
        <Link href="/surveys" className="underline">
          前往同仁填寫頁 →
        </Link>
      </p>
    </main>
  );
}
