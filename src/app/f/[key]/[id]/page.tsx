import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApprovalActions } from '@/app/components/approval-actions';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { PrintButton } from '@/app/components/print-button';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { approveCustomFormStep, returnCustomFormStep, withdrawCustomForm } from '@/lib/custom-forms/actions';
import { getSubmissionDetail } from '@/lib/custom-forms/queries';
import { allFields, isDisplayOnly } from '@/lib/custom-forms/schema';
import { fieldText, SubmissionFields } from '../../submission-fields';

const time = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-td-muted">{label}</dt>
      <dd className="mt-1 text-sm text-td-blue-dark">{children}</dd>
    </div>
  );
}

export default async function DesignerFormDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { key, id } = await params;
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getSubmissionDetail(id);
  if (!detail) notFound();
  // Notifications and approval lists link to /f/_/<id>.
  if (detail.key !== key) redirect(`/f/${detail.key}/${id}`);
  const attachments = await getAttachments('custom', id);
  const headerFields = allFields(detail.schema).filter((f) => f.showInHeader && !isDisplayOnly(f) && f.id in detail.data);
  const hasAttachmentField = allFields(detail.schema).some((f) => f.type === 'attachments');

  return (
    <main className="page-shell space-y-5">
      <nav className="text-sm text-td-muted print:hidden">
        {detail.isOwner ? (
          <Link href={`/f/${detail.key}`} className="hover:text-td-blue">
            我的{detail.name}
          </Link>
        ) : (
          <Link href="/approvals" className="hover:text-td-blue">
            待簽核
          </Link>
        )}
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{detail.formNumber}</span>
      </nav>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{detail.name}</h1>
          <p className="mt-1 flex items-center gap-3">
            <span className="mono-case">{detail.formNumber}</span>
            <span className={STATUS_BADGE[detail.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[detail.status] ?? detail.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {detail.status === 'approved' && <PrintButton label="列印申請單" />}
          {detail.canEdit && (
            <Link href={`/f/${detail.key}/${detail.id}/edit`} className="btn-secondary">
              編輯
            </Link>
          )}
          {detail.canResubmit && (
            <Link href={`/f/${detail.key}/${detail.id}/edit`} className="btn-primary">
              修改並重新送出
            </Link>
          )}
          {detail.canEdit && <WithdrawButton requestId={detail.id} onWithdraw={withdrawCustomForm} redirectTo={`/f/${detail.key}`} />}
        </div>
      </section>

      {uploadFailed && (
        <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          表單已送出，但有 {uploadFailed} 個附件上傳失敗，請在下方「附件」區補傳。
        </p>
      )}

      <section className="card">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="申請人">
            <span className="font-semibold">{detail.applicantName}</span>
            <span className="block text-xs text-td-muted">{detail.applicantEmail ?? ''}</span>
            {detail.applicantPhone && <span className="block text-xs text-td-muted">{detail.applicantPhone}</span>}
          </Item>
          {detail.filerName && <Item label="經辦人（代為申請）">{detail.filerName}</Item>}
          <Item label="申請部門">{detail.departmentName}</Item>
          <Item label="申請時間">{time.format(detail.submittedAt)}</Item>
          <Item label="案號">
            <span className="mono-case">{detail.caseNumber}</span>
          </Item>
          {headerFields.map((f) => (
            <Item key={f.id} label={f.label}>
              {fieldText(f, detail.data[f.id], detail.labels, detail.data)}
            </Item>
          ))}
        </dl>
      </section>

      <SubmissionFields schema={detail.schema} data={detail.data} labels={detail.labels} />

      {((hasAttachmentField && detail.canAttach) || attachments.length > 0) && (
        <div className="print:hidden">
          <AttachmentsPanel formType="custom" formId={detail.id} attachments={attachments} canUpload={hasAttachmentField && detail.canAttach} />
        </div>
      )}

      <ApprovalTimeline formType="custom" formId={detail.id} />

      {detail.isCurrentApprover && (
        <ApprovalActions formId={detail.id} version={detail.version} onApprove={approveCustomFormStep} onReturn={returnCustomFormStep} />
      )}
    </main>
  );
}
