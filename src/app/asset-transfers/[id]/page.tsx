import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApprovalActions } from '@/app/components/approval-actions';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { ROLE_LABELS, STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { PrintButton } from '@/app/components/print-button';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
import { approveAssetTransferStep, returnAssetTransferStep, withdrawAssetTransfer } from '@/lib/asset-transfers/actions';
import { ASSET_TRANSFER_TYPE_LABELS, type AssetTransferType } from '@/lib/asset-transfers/constants';
import { getAssetTransferDetail } from '@/lib/asset-transfers/queries';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

const day = (iso: string) => iso.replaceAll('-', '/');
const stamp = (d: Date) => d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const typeLabel = (t: string) => ASSET_TRANSFER_TYPE_LABELS[t as AssetTransferType] ?? t;

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-xs font-semibold text-td-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm text-td-blue-dark">{children}</dd>
    </div>
  );
}

const th = 'border border-td-border bg-slate-50 px-2 py-2 text-center text-xs font-semibold text-td-blue-dark';
const td = 'border border-td-border px-2 py-2 text-sm';

export default async function AssetTransferDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { id } = await params;
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getAssetTransferDetail(id);
  if (!detail) notFound();
  const base = `/asset-transfers/${id}`;
  const [employee, attachments] = await Promise.all([getCurrentEmployee(), getAttachments('asset_transfer', id)]);

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover = !!employee && currentStep?.approverEmployeeId === employee.id;
  const isApplicant = employee?.id === detail.applicantEmployeeId;
  const canSelfEdit = isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;
  const canResubmit = isApplicant && detail.status === 'returned';
  const returnedStep = detail.status === 'returned' ? detail.steps.find((s) => s.status === 'returned') : undefined;
  const p = detail.parties;

  return (
    <main className="page-shell space-y-5">
      <nav className="text-sm text-td-muted print:hidden">
        <Link href="/asset-transfers" className="hover:text-td-blue">
          資產異動
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{detail.caseNumber}</span>
      </nav>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">資產異動申請單</h1>
          <p className="mt-1 flex items-center gap-3">
            <span className="mono-case">{detail.caseNumber}</span>
            <span className={STATUS_BADGE[detail.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[detail.status] ?? detail.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {detail.status === 'approved' && <PrintButton label="列印資產異動申請單" />}
          {canSelfEdit && (
            <Link href={`${base}/edit`} className="btn-secondary">
              編輯
            </Link>
          )}
          {canResubmit && (
            <Link href={`${base}/edit`} className="btn-primary">
              修改並重新送出
            </Link>
          )}
          {canSelfEdit && <WithdrawButton requestId={detail.id} onWithdraw={withdrawAssetTransfer} redirectTo="/asset-transfers" />}
        </div>
      </section>

      {uploadFailed && (
        <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          表單已送出，但有 {uploadFailed} 個附件上傳失敗，請在下方「附件」區補傳。
        </p>
      )}
      {returnedStep && (
        <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ROLE_LABELS[returnedStep.approverRole] ?? returnedStep.approverRole} {returnedStep.approverName} 退回：
          {returnedStep.comment ?? '—'}
        </p>
      )}
      {detail.appliedAt && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          已於 {stamp(detail.appliedAt)} 依本單更新財產清冊（保管人、保管地點與保管狀態）。
        </p>
      )}

      <section className="card">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="申請日期">{day(detail.applicationDate)}</Item>
          <Item label="申請人">{detail.applicantName}</Item>
          <Item label="申請人部門">{detail.departmentName}</Item>
          <Item label="使用部門">{detail.useDepartmentName}</Item>
          <Item label="使用專案/客戶名稱">{detail.useBudgetLabel}</Item>
          <Item label="異動說明">{detail.transferTypes.map(typeLabel).join('、')}</Item>
          {detail.remark && (
            <Item label="備註" wide>
              {detail.remark}
            </Item>
          )}
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">申請資料</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-10`}>#</th>
                <th className={`${th} w-24`}>財產編號</th>
                <th className={th}>財產名稱</th>
                <th className={`${th} w-14`}>數量</th>
                <th className={`${th} w-24`}>原保管人</th>
                <th className={`${th} w-32`}>原保管地點</th>
                <th className={`${th} w-24`}>異動原因</th>
                <th className={`${th} w-24`}>新保管人員</th>
                <th className={`${th} w-32`}>新保管地點</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((i) => (
                <tr key={i.lineNo}>
                  <td className={`${td} text-center text-td-muted`}>{i.lineNo}</td>
                  <td className={`${td} text-center font-mono`}>{i.assetTag}</td>
                  <td className={td}>{i.assetName}</td>
                  <td className={`${td} text-center`}>{i.quantity}</td>
                  <td className={`${td} text-center`}>{i.originalCustodianName}</td>
                  <td className={td}>{i.originalLocation || '—'}</td>
                  <td className={`${td} text-center`}>{typeLabel(i.reason)}</td>
                  <td className={`${td} text-center`}>{i.newCustodianName}</td>
                  <td className={td}>{i.newLocation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          <Item label="原保管人">{p.originalCustodian.name}</Item>
          <Item label="新保管人">{p.newCustodian.name}</Item>
          <Item label="其他保管人">{p.otherCustodian?.name ?? '—'}</Item>
          <Item label="原保管單位主管">{p.originalManager.name}</Item>
          <Item label="新保管單位主管">{p.newManager.name}</Item>
          <Item label="其他保管單位主管">{p.otherManager?.name ?? '—'}</Item>
        </dl>
      </section>

      <ApprovalTimeline formType="asset_transfer" formId={detail.id} />

      <div className="print:hidden">
        <AttachmentsPanel formType="asset_transfer" formId={id} attachments={attachments} />
      </div>

      {isCurrentApprover && (
        <ApprovalActions formId={detail.id} version={detail.version} onApprove={approveAssetTransferStep} onReturn={returnAssetTransferStep} />
      )}
    </main>
  );
}
