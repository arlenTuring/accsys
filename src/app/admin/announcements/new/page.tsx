import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canManageAnnouncements, listAudiencePickerOptions } from '@/lib/announcements/service';
import { AnnouncementCreateForm } from '@/app/announcements/announcement-create-form';

export default async function AdminAnnouncementNewPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageAnnouncements(employee))) redirect('/announcements');

  const audience = await listAudiencePickerOptions(employee);

  return (
    <main className="page-shell space-y-6">
      <p className="text-sm">
        <Link href="/admin/announcements" className="underline">
          ← 公告管理
        </Link>
      </p>
      <section>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">新增公告</h1>
      </section>
      <AnnouncementCreateForm
        departments={audience?.departments ?? []}
        employees={audience?.employees ?? []}
      />
    </main>
  );
}
