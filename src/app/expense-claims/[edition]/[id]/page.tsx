import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { approveExpenseClaimStep, returnExpenseClaimStep, withdrawExpenseClaim } from '@/lib/expense-claims/actions';
import { PAYEE_TYPE_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/expense-claims/constants';
import { EDITIONS, isExpenseEdition } from '@/lib/expense-claims/editions';
import { getExpenseClaimDetail } from '@/lib/expense-claims/queries';
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';
import { CURRENCY_LABELS } from '@/lib/travel-expenses/constants';
import { ROLE_LABELS, STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { ApprovalActions } from '@/app/components/approval-actions';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { PrintButton } from '@/app/components/print-button';

const money = (v: string | number) => Number(v).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const day = (iso: string) => iso.replaceAll('-', '/');

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-semibold text-td-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm text-td-blue-dark">{children}</dd>
    </div>
  );
}

const th = 'border border-td-border bg-slate-50 px-2 py-2 text-center text-xs font-semibold text-td-blue-dark';
const td = 'border border-td-border px-2 py-2 text-sm';

export default async function ExpenseClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ edition: string; id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { edition, id } = await params;
  if (!isExpenseEdition(edition)) notFound();
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getExpenseClaimDetail(edition, id);
  if (!detail) notFound();
  const config = EDITIONS[edition];
  const base = `${FORM_ROUTE_PREFIX[config.formType]}/${id}`;
  const [employee, attachments] = await Promise.all([getCurrentEmployee(), getAttachments(config.formType, id)]);

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover = !!employee && currentStep?.approverEmployeeId === employee.id;
  const isApplicant = employee?.id === detail.applicantEmployeeId;
  const canSelfEdit = isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;
  const canResubmit = isApplicant && detail.status === 'returned';
  const returnedStep = detail.status === 'returned' ? detail.steps.find((s) => s.status === 'returned') : undefined;
  const payee =
    detail.payeeType === 'supplier'
      ? `${PAYEE_TYPE_LABELS.supplier}：${detail.payeeSupplierName ?? '—'}`
      : `${PAYEE_TYPE_LABELS.applicant}（${detail.applicantName}）`;

  return (
    <main className="page-shell space-y-5">
      <nav className="text-sm text-td-muted print:hidden">
        <Link href="/expense-claims" className="hover:text-td-blue">
          費用申請
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{detail.caseNumber}</span>
      </nav>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{config.label}</h1>
          <p className="mt-1 flex items-center gap-3">
            <span className="mono-case">{detail.caseNumber}</span>
            <span className={STATUS_BADGE[detail.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[detail.status] ?? detail.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {detail.status === 'approved' && <PrintButton label="列印費用申請單" />}
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
          {canSelfEdit && (
            <WithdrawButton requestId={detail.id} onWithdraw={withdrawExpenseClaim.bind(null, edition)} redirectTo="/expense-claims" />
          )}
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

      <section className="card">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="申請日期">{day(detail.applicationDate)}</Item>
          <Item label="申請人">{detail.applicantName}</Item>
          <Item label="申請部門">{detail.departmentName}</Item>
          <Item label="預算來源">{detail.budgetLabel}</Item>
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">請款內容</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-10`}>#</th>
                <th className={`${th} w-40`}>項目</th>
                <th className={th}>內容或說明</th>
                <th className={`${th} w-20`}>幣別</th>
                <th className={`${th} w-20`}>匯率</th>
                <th className={`${th} w-28`}>金額</th>
                <th className={`${th} w-28`}>小計</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((i) => (
                <tr key={i.lineNo}>
                  <td className={`${td} text-center text-td-muted`}>{i.lineNo}</td>
                  <td className={`${td} text-center`}>{i.category}</td>
                  <td className={`${td} whitespace-pre-wrap`}>{i.description}</td>
                  <td className={`${td} text-center`}>{CURRENCY_LABELS[i.currency] ?? i.currency}</td>
                  <td className={`${td} text-right`}>{Number(i.exchangeRate)}</td>
                  <td className={`${td} text-right`}>{money(i.amount)}</td>
                  <td className={`${td} text-right font-medium`}>{money(i.twdAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className={`${td} text-right font-semibold`}>
                  總金額
                </td>
                <td className={`${td} text-right font-bold text-td-blue-dark`}>NT$ {money(detail.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {detail.remark && (
          <dl className="mt-4">
            <Item label="備註">{detail.remark}</Item>
          </dl>
        )}
      </section>

      <section className="card">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Item label="付款對象">{payee}</Item>
          <Item label="期望付款日">{day(detail.expectedPaymentDate)}</Item>
          <Item label="付款方式">{PAYMENT_METHOD_LABELS[detail.paymentMethod] ?? detail.paymentMethod}</Item>
          <Item label="匯款資訊">{detail.remittanceInfo}</Item>
        </dl>
      </section>

      <ApprovalTimeline formType={config.formType} formId={id} />

      <div className="print:hidden">
        <AttachmentsPanel formType={config.formType} formId={id} attachments={attachments} />
      </div>

      <p className="rounded-card border border-td-border bg-white/80 px-5 py-4 text-sm text-td-blue-dark">
        <span className="font-semibold">提醒：</span>
        完成線上簽核流程後，請印出核准之費用申請單，連同原始附件繳交給會計做帳，謝謝。
      </p>

      {isCurrentApprover && (
        <ApprovalActions
          formId={detail.id}
          version={detail.version}
          onApprove={approveExpenseClaimStep.bind(null, edition)}
          onReturn={returnExpenseClaimStep.bind(null, edition)}
        />
      )}
    </main>
  );
}
