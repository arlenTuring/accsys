import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  activateDueScheduled,
  canManageAnnouncements,
  getAnnouncementForViewer,
  getOrBuildSummary,
  getReadState,
} from '@/lib/announcements/service';
import { listAnnouncementAttachments } from '@/lib/announcements/attachments';
import { AnnouncementFiles } from '../announcement-files';
import { AnnouncementViewerActions } from './viewer-actions';

export default async function AnnouncementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  await activateDueScheduled();
  const { id } = await params;
  const manage = await canManageAnnouncements(employee);

  // Read-only audience view (company info). Drafts redirect managers to admin edit.
  const row = await getAnnouncementForViewer({
    id,
    employeeId: employee.id,
    departmentId: employee.departmentId,
    manage: false,
  });
  if (!row) {
    if (manage) {
      const asManager = await getAnnouncementForViewer({
        id,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        manage: true,
      });
      if (
        asManager &&
        (asManager.status === 'draft' || asManager.status === 'scheduled' || asManager.status === 'withdrawn')
      ) {
        redirect(`/admin/announcements/${id}/edit`);
      }
    }
    notFound();
  }

  const [read, summary, files] = await Promise.all([
    getReadState(employee.id, id),
    getOrBuildSummary(id),
    listAnnouncementAttachments(id),
  ]);

  const audienceLabel =
    row.audienceType === 'company'
      ? '全公司'
      : row.audienceType === 'department'
        ? `部門 ${row.audienceDepartmentIds?.length ?? 0} 個`
        : `員工 ${row.audienceEmployeeIds?.length ?? 0} 人`;

  return (
    <main className="page-shell space-y-6">
      <p className="text-sm">
        <Link href="/announcements" className="underline">
          ← 公告列表
        </Link>
      </p>
      <article className="card space-y-4 p-4 sm:p-6">
        <header className="space-y-1">
          <p className="text-xs text-td-muted">
            {row.category} · {row.status} · {row.priority}
            {row.pinned ? ' · 置頂' : ''} · 受眾：{audienceLabel}
          </p>
          <h1 className="page-title text-xl sm:text-2xl">{row.title}</h1>
          {summary && <p className="text-sm text-td-muted">摘要：{summary}</p>}
        </header>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{row.body}</div>
        <AnnouncementFiles announcementId={id} files={files} canManage={false} />
        <AnnouncementViewerActions
          id={id}
          readAt={read?.readAt?.toISOString() ?? null}
          acknowledgedAt={read?.acknowledgedAt?.toISOString() ?? null}
        />
      </article>
    </main>
  );
}
