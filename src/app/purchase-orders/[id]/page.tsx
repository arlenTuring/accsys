import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseOrderDetail } from '@/lib/purchase-orders/queries';
import { getAttachments } from '@/lib/attachments/queries';
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
const ROLE_LABELS: Record<string, string> = {
  department_manager: '申請單位主管',
  budget_owner: '預算負責人',
  general_manager: '總經理',
  chairman: '董事長',
};
const STEP_STATUS_LABELS: Record<string, string> = {
  pending: '待簽核',
  approved: '已核准',
  returned: '已退回',
};

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPurchaseOrderDetail(id);
  if (!detail) notFound();

    const employee = await getCurrentEmployee();
  const attachments = await getAttachments('purchase_order', id);

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

      <section>
        <h2 className="mb-2 font-semibold">簽核流程</h2>
        <ol className="space-y-1 text-sm">
          {detail.steps.map((s) => (
            <li key={s.stepOrder} className="flex gap-2">
              <span className="text-gray-500">{s.stepOrder}.</span>
              <span>{ROLE_LABELS[s.approverRole] ?? s.approverRole}</span>
              <span>{s.approverName}</span>
              <span
                className={
                  s.status === 'approved'
                    ? 'text-green-600'
                    : s.status === 'returned'
                      ? 'text-red-600'
                      : 'text-gray-500'
                }
              >
                {STEP_STATUS_LABELS[s.status] ?? s.status}
              </span>
              {s.comment && <span className="text-gray-500">— {s.comment}</span>}
            </li>
          ))}
        </ol>
      </section>

      <AttachmentsPanel formType="purchase_order" formId={id} attachments={attachments} />

      {detail.status === 'approved' && (
        <p>
          <Link href={`/acceptances/new?orderId=${detail.id}`} className="text-blue-600 underline">
            建立驗收單
          </Link>
        </p>
      )}

      {detail.status === 'approved' && (
        <p>
          <Link href={`/expense-requests/new?orderId=${detail.id}`} className="text-blue-600 underline">
            建立費用申請單
          </Link>
        </p>
      )}

      {canSelfEdit && (
        <section className="flex gap-3">
          <Link href={`/purchase-orders/${detail.id}/edit`} className="rounded border px-4 py-2 text-sm">
            編輯
          </Link>
          <WithdrawButton requestId={detail.id} onWithdraw={withdrawPurchaseOrder} redirectTo="/purchase-orders" />
        </section>
      )}

      {isCurrentApprover && <ApprovalActions orderId={detail.id} />}
    </main>
  );
}
