import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AnnouncementFiles } from '@/app/announcements/announcement-files';
import { AnnouncementManageActions } from '@/app/announcements/[id]/manage-actions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { listAnnouncementAttachments } from '@/lib/announcements/attachments';
import {
  activateDueScheduled,
  canManageAnnouncements,
  getAnnouncementForViewer,
} from '@/lib/announcements/service';

export default async function AdminAnnouncementEditPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageAnnouncements(employee))) redirect('/announcements');

  await activateDueScheduled();
  const { id } = await params;
  const row = await getAnnouncementForViewer({
    id,
    employeeId: employee.id,
    departmentId: employee.departmentId,
    manage: true,
  });
  if (!row) notFound();

  const files = await listAnnouncementAttachments(id);
  const audienceLabel =
    row.audienceType === 'company'
      ? '全公司'
      : row.audienceType === 'department'
        ? `部門 ${row.audienceDepartmentIds?.length ?? 0} 個`
        : `員工 ${row.audienceEmployeeIds?.length ?? 0} 人`;

  return (
    <main className="page-shell space-y-6">
      <p className="text-sm">
        <Link href="/admin/announcements" className="underline">
          ← 公告管理
        </Link>
        {row.status === 'published' || row.status === 'expired' ? (
          <>
            <span className="mx-2 text-td-muted">·</span>
            <Link href={`/announcements/${id}`} className="underline">
              預覽閱覽頁
            </Link>
          </>
        ) : null}
      </p>
      <article className="card space-y-4 p-4 sm:p-6">
        <header className="space-y-1">
          <p className="section-title">編輯公告</p>
          <p className="text-xs text-td-muted">
            {row.category} · {row.status} · {row.priority}
            {row.pinned ? ' · 置頂' : ''} · 受眾：{audienceLabel}
          </p>
          <h1 className="page-title text-xl sm:text-2xl">{row.title}</h1>
        </header>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{row.body}</div>
        <AnnouncementFiles announcementId={id} files={files} canManage />
        <AnnouncementManageActions id={id} version={row.version} status={row.status} />
      </article>
    </main>
  );
}
