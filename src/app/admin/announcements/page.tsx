import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  activateDueScheduled,
  canManageAnnouncements,
  listVisibleAnnouncements,
} from '@/lib/announcements/service';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  scheduled: '預約發布',
  published: '已發布',
  expired: '已過期',
  withdrawn: '已撤下',
};

function ManageList(props: {
  title: string;
  empty: string;
  items: Array<{ id: string; title: string; status: string; priority: string; pinned: boolean }>;
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
          {props.items.map((a) => (
            <li key={a.id} className="card flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm">
              <Link href={`/admin/announcements/${a.id}/edit`} className="font-semibold underline">
                {a.pinned ? '[置頂] ' : ''}
                {a.title}
              </Link>
              <span className="text-xs text-td-muted">
                {STATUS_LABEL[a.status] ?? a.status}
                {a.priority !== 'normal' ? ` · ${a.priority}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function AdminAnnouncementsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageAnnouncements(employee))) redirect('/announcements');

  await activateDueScheduled();
  const managed = await listVisibleAnnouncements({
    employeeId: employee.id,
    departmentId: employee.departmentId,
    manage: true,
  });

  const drafts = managed.filter((a) => a.status === 'draft' || a.status === 'scheduled');
  const published = managed.filter((a) => a.status === 'published' || a.status === 'expired');
  const withdrawn = managed.filter((a) => a.status === 'withdrawn');

  return (
    <main className="page-shell space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">公告管理</h1>
        </div>
        <Link href="/admin/announcements/new" className="btn-primary text-sm">
          新增公告
        </Link>
      </section>

      <ManageList title="草稿／預約" empty="沒有草稿" items={drafts} />
      <ManageList title="已發布" empty="目前沒有已發布公告" items={published} />
      {withdrawn.length > 0 && <ManageList title="已撤下" empty="" items={withdrawn} />}

      <p className="text-sm">
        <Link href="/announcements" className="underline">
          前往同仁閱覽頁 →
        </Link>
      </p>
    </main>
  );
}
