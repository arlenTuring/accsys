import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { listAnnouncementAttachments } from '@/lib/announcements/attachments';
import { activateDueScheduled, listVisibleAnnouncements } from '@/lib/announcements/service';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { companyAnnouncementReads } from '@/lib/db/schema';
import { taipeiToday } from '@/lib/taipei-date';
import {
  AnnouncementsExpandableGrid,
  type ExpandableAnnouncementItem,
} from './announcements-expandable-grid';

export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/announcements');
  await activateDueScheduled();

  const sp = await searchParams;

  const [readable, readRows] = await Promise.all([
    listVisibleAnnouncements({
      employeeId: employee.id,
      departmentId: employee.departmentId,
      manage: false,
    }),
    getDb()
      .select()
      .from(companyAnnouncementReads)
      .where(eq(companyAnnouncementReads.employeeId, employee.id)),
  ]);

  const readMap = new Map(readRows.map((r) => [r.announcementId, r]));

  const items: ExpandableAnnouncementItem[] = await Promise.all(
    readable.map(async (a) => {
      const files = await listAnnouncementAttachments(a.id);
      const readState = readMap.get(a.id);
      const audienceLabel =
        a.audienceType === 'company'
          ? '全公司'
          : a.audienceType === 'department'
            ? `指定部門（${a.audienceDepartmentIds?.length ?? 0}）`
            : `指定同仁（${a.audienceEmployeeIds?.length ?? 0}）`;
      const dateSource = a.publishedAt ?? a.publishAt ?? a.createdAt;

      return {
        id: a.id,
        title: a.title,
        body: a.body,
        category: a.category,
        status: a.status,
        priority: a.priority,
        pinned: a.pinned,
        audienceLabel,
        dateLabel: dateSource ? taipeiToday(dateSource) : '',
        readAt: readState?.readAt ? readState.readAt.toISOString() : null,
        acknowledgedAt: readState?.acknowledgedAt
          ? readState.acknowledgedAt.toISOString()
          : null,
        files: files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          mimeType: f.mimeType,
          fileSizeBytes: f.fileSizeBytes,
          scanStatus: f.scanStatus,
        })),
      };
    })
  );

  const initialExpandedId =
    typeof sp.open === 'string' && items.some((i) => i.id === sp.open)
      ? sp.open
      : null;

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">公司資訊</p>
        <h1 className="page-title">公司公告</h1>
        <p className="page-subtitle">
          瀏覽公司最新公告與重要通知；直接點擊任一公告卡片即可原地展開閱讀全文與下載附件。
        </p>
      </section>

      <AnnouncementsExpandableGrid items={items} initialExpandedId={initialExpandedId} />
    </main>
  );
}
