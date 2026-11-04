import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { RegulationEditorForm } from '@/app/admin/regulations/regulation-editor-form';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { listRegulationAttachments } from '@/lib/regulations/attachments';
import { canManageRegulations, getRegulationById } from '@/lib/regulations/service';

export const dynamic = 'force-dynamic';

export default async function EditRegulationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageRegulations(employee))) redirect('/regulations');

  const { id } = await params;
  const reg = await getRegulationById({ id, manage: true });
  if (!reg) notFound();

  const attachments = await listRegulationAttachments(reg.id);

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">編輯公司規章：{reg.title}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href={`/regulations/${reg.id}`} className="font-medium text-td-blue hover:underline">
            查看同仁閱覽頁 ↗
          </Link>
          <Link href="/admin/regulations" className="font-medium text-slate-600 hover:underline">
            ← 返回規章管理列表
          </Link>
        </div>
      </section>

      <RegulationEditorForm
        mode="edit"
        initial={{
          id: reg.id,
          code: reg.code,
          title: reg.title,
          category: reg.category,
          versionLabel: reg.versionLabel,
          effectiveDate: reg.effectiveDate,
          ownerDepartment: reg.ownerDepartment,
          approverTitle: reg.approverTitle,
          summary: reg.summary,
          body: reg.body,
          relatedForms: reg.relatedForms ?? [],
          driveFileId: reg.driveFileId,
          driveUrl: reg.driveUrl,
          driveFileName: reg.driveFileName,
          status: (reg.status as 'draft' | 'published' | 'archived') || 'published',
          pinned: reg.pinned,
          sortOrder: reg.sortOrder,
        }}
        attachments={attachments}
      />
    </main>
  );
}
