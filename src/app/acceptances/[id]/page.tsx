import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getAcceptanceDetail } from '@/lib/acceptances/queries';
import { getAttachments } from '@/lib/attachments/queries';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { ApprovalActions } from './approval-actions';
import { PropertyTagForm } from './property-tag-form';
import { withdrawAcceptance } from '@/lib/acceptances/actions';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
  withdrawn: '已撤回',
};

export default async function AcceptanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAcceptanceDetail(id);
  if (!detail) notFound();

    const employee = await getCurrentEmployee();
  const attachments = await getAttachments('acceptance', id);
  const canEditPropertyTag = employee?.role === 'finance' || employee?.role === 'admin';

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover =
    !!employee && !!currentStep && currentStep.approverEmployeeId === employee.id;

  const isApplicant = !!employee && employee.id === detail.applicantEmployeeId;
  const canSelfEdit =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-8">
      <div>
        <h1 className="mb-1 text-2xl font-bold">驗收單</h1>
        <p className="font-mono text-gray-600">
          <Link href={`/cases/${detail.caseNumber}`} className="underline">
            {detail.caseNumber}
          </Link>
          （項次 C1）
        </p>
      </div>

      <section className="rounded border p-4 text-sm">
        <p>申請單位：{detail.departmentName}</p>
        <p>申請人：{detail.applicantName}</p>
        <p>承攬廠商：{detail.contractorSupplierName}</p>
        <p>驗收日期：{detail.acceptanceDate}</p>
        <p>狀態：{STATUS_LABELS[detail.status] ?? detail.status}</p>
        <p>總計：NT$ {detail.totalAmount.toLocaleString()}</p>
      </section>

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">項次</th>
            <th className="border p-2">說明</th>
            <th className="border p-2">數量</th>
            <th className="border p-2">金額</th>
            <th className="border p-2">結果</th>
            <th className="border p-2">財產編號（財會填）</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((i) => (
            <tr key={i.lineNo}>
              <td className="border p-2 text-center">{i.lineNo}</td>
              <td className="border p-2">{i.description}</td>
              <td className="border p-2 text-right">{i.quantity}</td>
              <td className="border p-2 text-right">{i.amount.toLocaleString()}</td>
              <td className={`border p-2 text-center ${i.passFail === 'fail' ? 'text-red-600' : 'text-green-600'}`}>
                {i.passFail === 'pass' ? 'Pass' : 'Fail'}
              </td>
              <td className="border p-2">
                {canEditPropertyTag ? (
                  <PropertyTagForm itemId={i.itemId} initialValue={i.propertyTag} />
                ) : (
                  (i.propertyTag ?? '—')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ApprovalTimeline formType="acceptance" formId={detail.id} />

      <AttachmentsPanel formType="acceptance" formId={id} attachments={attachments} />

      {canSelfEdit && (
        <section className="flex gap-3">
          <Link href={`/acceptances/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
            編輯
          </Link>
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawAcceptance} redirectTo="/acceptances" />
        </section>
      )}

      {isCurrentApprover && <ApprovalActions acceptanceId={detail.id} version={detail.version} />}
    </main>
  );
}
