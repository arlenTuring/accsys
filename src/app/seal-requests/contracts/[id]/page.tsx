import { notFound } from 'next/navigation';
import { ApprovalActions } from '@/app/components/approval-actions';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  approveContractSealStep,
  returnContractSealStep,
  withdrawContractSealRequest,
} from '@/lib/contract-seals/actions';
import {
  DOCUMENT_TYPE_LABELS,
  LEGAL_REVIEW_DOCUMENT_TYPES,
  MOU_CHECK_LABELS,
  NDA_CHECK_LABELS,
  type ContractDocumentType,
} from '@/lib/contract-seals/constants';
import { getContractSealDetail } from '@/lib/contract-seals/queries';
import { SEAL_TYPE_LABELS, URGENCY_LABELS } from '@/lib/seal-requests/constants';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { DetailItem as Item, SealDetailHeader, SealReminderNote, day, sealAccess } from '../../seal-detail-parts';

const money = (v: string | number) => Number(v).toLocaleString('zh-TW', { maximumFractionDigits: 2 });

function CheckList({ codes, labels }: { codes: string[]; labels: Record<string, string> }) {
  return (
    <ul className="space-y-1">
      {codes.map((c) => (
        <li key={c} className="flex items-start gap-2">
          <span className="text-status-approved">✓</span>
          <span>{labels[c] ?? c}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ContractSealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { id } = await params;
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getContractSealDetail(id);
  if (!detail) notFound();
  const [employee, attachments] = await Promise.all([getCurrentEmployee(), getAttachments('contract_seal_request', id)]);
  const { isCurrentApprover } = sealAccess(detail, employee?.id);
  const needsLegal = LEGAL_REVIEW_DOCUMENT_TYPES.includes(detail.documentType as ContractDocumentType);

  return (
    <main className="page-shell space-y-5">
      <SealDetailHeader
        title="用印申請單(合約類)"
        detail={detail}
        viewerId={employee?.id}
        basePath="/seal-requests/contracts"
        onWithdraw={withdrawContractSealRequest}
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
          <Item label="文件類別">{DOCUMENT_TYPE_LABELS[detail.documentType] ?? detail.documentType}</Item>
          <Item label="備註" wide>
            {detail.remark}
          </Item>
          <Item label="印鑑名稱">{detail.seals.map((s) => SEAL_TYPE_LABELS[s] ?? s).join('、')}</Item>
          <Item label="起訖日">
            {day(detail.periodStart)} - {day(detail.periodEnd)}
          </Item>
          <Item label="總價">NT$ {money(detail.totalAmount)}</Item>
          <Item label="客戶/廠商名稱">{detail.counterparty}</Item>
          <Item label="標的" wide>
            {detail.subject}
          </Item>
          <Item label="出借印鑑">{detail.lendSeal ? '是' : '否'}</Item>
          <Item label="出借印鑑說明" wide>
            {detail.lendSealNote}
          </Item>
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">審約確認</h2>
        <div className="grid gap-6 text-sm text-td-blue-dark md:grid-cols-3">
          <div>
            <p className="mb-2 text-xs font-semibold text-td-muted">法律顧問審閱</p>
            {needsLegal ? (
              <CheckList codes={['confirmed']} labels={{ confirmed: '已附上法律顧問確認完成信件' }} />
            ) : (
              <p className="text-td-muted">NDA / MOU 無需經法律顧問</p>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-td-muted">保密協議/NDA須備事項</p>
            <CheckList codes={detail.ndaChecks} labels={NDA_CHECK_LABELS} />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-td-muted">合作備忘錄/MOU須備事項</p>
            <CheckList codes={detail.mouChecks} labels={MOU_CHECK_LABELS} />
          </div>
        </div>
      </section>

      <ApprovalTimeline formType="contract_seal_request" formId={detail.id} />

      <div className="print:hidden">
        <AttachmentsPanel formType="contract_seal_request" formId={id} attachments={attachments} />
      </div>

      <SealReminderNote text="完成線上簽核流程後，請印出核准之用印申請單，連同原始附件提供給相關單位用印/簽名，用印/簽名完成之文件，請交至管理部歸檔，謝謝。" />

      {isCurrentApprover && (
        <ApprovalActions
          formId={detail.id}
          version={detail.version}
          onApprove={approveContractSealStep}
          onReturn={returnContractSealStep}
        />
      )}
    </main>
  );
}
