import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getPurchaseRequestDetail } from '@/lib/purchase-requests/queries';
import { withdrawPurchaseRequest } from '@/lib/purchase-requests/actions';
import { ApprovalActions } from './approval-actions';
import { WithdrawButton } from './withdraw-button';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
  withdrawn: '已撤回',
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPurchaseRequestDetail(id);
  if (!detail) notFound();

  const [employee, orderReplaced] = await Promise.all([getCurrentEmployee(), replacementFor('purchase_order')]);

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
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-bold">請購申請單</h1>
      <p className="mb-4 font-mono text-gray-600">
        <Link href={`/cases/${detail.caseNumber}`} className="underline">
          {detail.caseNumber}
        </Link>
      </p>

      <section className="mb-4 rounded border p-4 text-sm">
        <p>申請單位：{detail.departmentName}</p>
        <p>申請人：{detail.applicantName}</p>
        <p>預計需求天數：{detail.neededWithinDays ?? '—'}</p>
        <p>狀態：{STATUS_LABELS[detail.status] ?? detail.status}</p>
        <p>總計：NT$ {detail.totalAmount.toLocaleString()}</p>
      </section>

      <table className="mb-4 w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">項次</th>
            <th className="border p-2">預算編號</th>
            <th className="border p-2">項目</th>
            <th className="border p-2">說明</th>
            <th className="border p-2">數量</th>
            <th className="border p-2">預估費用</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((i) => (
            <tr key={i.lineNo}>
              <td className="border p-2 text-center">{i.lineNo}</td>
              <td className="border p-2 font-mono">{i.budgetCode}</td>
              <td className="border p-2">{i.itemCategory}</td>
              <td className="border p-2">{i.description}</td>
              <td className="border p-2 text-right">{i.quantity}</td>
              <td className="border p-2 text-right">{i.estimatedAmount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-4">
        <ApprovalTimeline formType="purchase_request" formId={detail.id} />
      </div>

      {detail.status === 'approved' &&
        (orderReplaced ? (
          <p className="text-sm text-td-muted">採購單已改用新版表單，新版採購單只能接續新版請購單。</p>
        ) : (
          <p>
            <Link href={`/purchase-orders/new?requestId=${detail.id}`} className="text-blue-600 underline">
              建立採購單
            </Link>
          </p>
        ))}

      {canSelfEdit && (
        <section className="mb-4 flex gap-3">
          <Link href={`/requests/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
            編輯
          </Link>
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawPurchaseRequest} redirectTo="/requests" />
        </section>
      )}

      {isCurrentApprover && <ApprovalActions requestId={detail.id} version={detail.version} />}
    </main>
  );
}
