import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getPurchaseOrderDetail } from '@/lib/purchase-orders/queries';
import { getAttachments } from '@/lib/attachments/queries';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { withdrawPurchaseOrder } from '@/lib/purchase-orders/actions';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
import { ApprovalActions } from './approval-actions';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
  withdrawn: '已撤回',
};

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPurchaseOrderDetail(id);
  if (!detail) notFound();

  const [employee, attachments, acceptanceReplaced, paymentReplaced] = await Promise.all([
    getCurrentEmployee(),
    getAttachments('purchase_order', id),
    replacementFor('acceptance'),
    replacementFor('expense_request'),
  ]);

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
        <h1 className="mb-1 text-2xl font-bold">採購單</h1>
        <p className="font-mono text-gray-600">
          <Link href={`/cases/${detail.caseNumber}`} className="underline">
            {detail.caseNumber}
          </Link>
          （項次 B1）
        </p>
      </div>

      <section className="rounded border p-4 text-sm">
        <p>申請單位：{detail.departmentName}</p>
        <p>申請人：{detail.applicantName}</p>
        <p>預計採購廠商：{detail.supplierName}</p>
        <p>
          付款方式：{detail.paymentMethod}｜付款條件：{detail.paymentTerms}
        </p>
        <p>預計交貨天數：{detail.expectedDeliveryDays ?? '—'}</p>
        <p>
          報價單家數：{detail.quoteCount}
          {detail.quoteCountReason ? `（${detail.quoteCountReason}）` : ''}
        </p>
        <p>狀態：{STATUS_LABELS[detail.status] ?? detail.status}</p>
        <p>總計：NT$ {detail.totalAmount.toLocaleString()}</p>
      </section>

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">項次</th>
            <th className="border p-2">預算編號</th>
            <th className="border p-2">項目</th>
            <th className="border p-2">說明</th>
            <th className="border p-2">數量</th>
            <th className="border p-2">單價</th>
            <th className="border p-2">總價</th>
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
              <td className="border p-2 text-right">{i.unitPrice.toLocaleString()}</td>
              <td className="border p-2 text-right">{i.totalPrice.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ApprovalTimeline formType="purchase_order" formId={detail.id} />

      <AttachmentsPanel formType="purchase_order" formId={id} attachments={attachments} />

      {detail.status === 'approved' &&
        (acceptanceReplaced ? (
          <p className="text-sm text-td-muted">驗收單已改用新版表單，新版驗收單只能接續新版採購單。</p>
        ) : (
          <p>
            <Link href={`/acceptances/new?orderId=${detail.id}`} className="text-blue-600 underline">
              建立驗收單
            </Link>
          </p>
        ))}

      {detail.status === 'approved' &&
        (paymentReplaced ? (
          <p className="text-sm text-td-muted">費用申請單(採購付款)已改用新版表單，新版只能接續新版驗收單或採購單。</p>
        ) : (
          <p>
            <Link href={`/expense-requests/new?orderId=${detail.id}`} className="text-blue-600 underline">
              建立費用申請單
            </Link>
          </p>
        ))}

      {canSelfEdit && (
        <section className="flex gap-3">
          <Link href={`/purchase-orders/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
            編輯
          </Link>
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawPurchaseOrder} redirectTo="/purchase-orders" />
        </section>
      )}

      {isCurrentApprover && <ApprovalActions orderId={detail.id} version={detail.version} />}
    </main>
  );
}
