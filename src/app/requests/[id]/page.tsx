import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseRequestDetail } from '@/lib/purchase-requests/queries';
import { ApprovalActions } from './approval-actions';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
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

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPurchaseRequestDetail(id);
  if (!detail) notFound();

  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover =
    !!employee && !!currentStep && currentStep.approverEmployeeId === employee.id;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-bold">請購申請單</h1>
      <p className="mb-4 font-mono text-gray-600">{detail.caseNumber}</p>

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

      <section className="mb-4">
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

      {detail.status === 'approved' && (
        <p>
          <Link href={`/purchase-orders/new?requestId=${detail.id}`} className="text-blue-600 underline">
            建立採購單
          </Link>
        </p>
      )}

      {isCurrentApprover && <ApprovalActions requestId={detail.id} />}
    </main>
  );
}
