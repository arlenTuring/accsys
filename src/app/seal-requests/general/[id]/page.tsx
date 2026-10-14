import { notFound } from 'next/navigation';
import { ApprovalActions } from '@/app/components/approval-actions';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { approveGeneralSealStep, returnGeneralSealStep, withdrawGeneralSealRequest } from '@/lib/general-seals/actions';
import { GENERAL_DOCUMENT_TYPE_LABELS } from '@/lib/general-seals/constants';
import { getGeneralSealDetail } from '@/lib/general-seals/queries';
import { SEAL_TYPE_LABELS, URGENCY_LABELS } from '@/lib/seal-requests/constants';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { DetailItem as Item, SealDetailHeader, SealReminderNote, day, sealAccess } from '../../seal-detail-parts';

export default async function GeneralSealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { id } = await params;
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getGeneralSealDetail(id);
  if (!detail) notFound();
  const [employee, attachments] = await Promise.all([getCurrentEmployee(), getAttachments('general_seal_request', id)]);
  const { isCurrentApprover } = sealAccess(detail, employee?.id);

  return (
    <main className="page-shell space-y-5">
      <SealDetailHeader
        title="用印申請單(非合約類)"
        detail={detail}
        viewerId={employee?.id}
        basePath="/seal-requests/general"
        onWithdraw={withdrawGeneralSealRequest}
        uploadFailed={uploadFailed}
      />

      <section className="card">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="申請人">
            {detail.applicantName}
            {detail.filerEmployeeId !== detail.applicantEmployeeId && (
              <span className="ml-2 text-xs text-td-muted">（經辦：{detail.filerName}）</span>
            )}
          </Item>
          <Item label="部門">{detail.departmentName}</Item>
          <Item label="申請日期">{day(detail.applicationDate)}</Item>
          <Item label="文件用印時效性">{URGENCY_LABELS[detail.urgency] ?? detail.urgency}</Item>
          <Item label="期望用印完成日">{day(detail.expectedCompletionDate)}</Item>
          <Item label="文件類別">{GENERAL_DOCUMENT_TYPE_LABELS[detail.documentType] ?? detail.documentType}</Item>
          <Item label="備註" wide>
            {detail.remark}
          </Item>
          <Item label="文件說明" wide>
            {detail.documentDescription}
          </Item>
          <Item label="印鑑名稱" wide>
            {detail.seals.map((s) => SEAL_TYPE_LABELS[s] ?? s).join('、')}
          </Item>
          <Item label="出借印鑑">{detail.lendSeal ? '是' : '否'}</Item>
          <Item label="出借印鑑說明" wide>
            {detail.lendSealNote}
          </Item>
        </dl>
      </section>

      <ApprovalTimeline formType="general_seal_request" formId={detail.id} />

      <div className="print:hidden">
        <AttachmentsPanel formType="general_seal_request" formId={id} attachments={attachments} />
      </div>

      <SealReminderNote text="完成線上簽核流程後，請印出核准之用印申請單，連同原始附件提供給相關單位用印/簽名，謝謝。" />

      {isCurrentApprover && (
        <ApprovalActions
          formId={detail.id}
          version={detail.version}
          onApprove={approveGeneralSealStep}
          onReturn={returnGeneralSealStep}
        />
      )}
    </main>
  );
}
