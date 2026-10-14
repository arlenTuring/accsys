import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { approveTravelExpenseStep, returnTravelExpenseStep, withdrawTravelExpense } from '@/lib/travel-expenses/actions';
import { CURRENCY_LABELS } from '@/lib/travel-expenses/constants';
import { getTravelExpenseDetail } from '@/lib/travel-expenses/queries';
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

export default async function TravelExpenseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { id } = await params;
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getTravelExpenseDetail(id);
  if (!detail) notFound();
  const [employee, attachments] = await Promise.all([getCurrentEmployee(), getAttachments('travel_expense', id)]);

  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isCurrentApprover = !!employee && currentStep?.approverEmployeeId === employee.id;
  const isApplicant = employee?.id === detail.applicantEmployeeId;
  const canSelfEdit = isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1;
  const canResubmit = isApplicant && detail.status === 'returned';
  const balance = Number(detail.totalAmount) - Number(detail.advanceAmount);
  const returnedStep = detail.status === 'returned' ? detail.steps.find((s) => s.status === 'returned') : undefined;

  return (
    <main className="page-shell space-y-5">
      <nav className="text-sm text-td-muted print:hidden">
        <Link href="/travel-expenses" className="hover:text-td-blue">
          出差報支
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{detail.caseNumber}</span>
      </nav>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">出差報告暨旅費報支單</h1>
          <p className="mt-1 flex items-center gap-3">
            <span className="mono-case">{detail.caseNumber}</span>
            <span className={STATUS_BADGE[detail.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[detail.status] ?? detail.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {detail.status === 'approved' && <PrintButton label="列印報支單" />}
          {canSelfEdit && (
            <Link href={`/travel-expenses/${detail.id}/edit`} className="btn-secondary">
              編輯
            </Link>
          )}
          {canResubmit && (
            <Link href={`/travel-expenses/${detail.id}/edit`} className="btn-primary">
              修改並重新送出
            </Link>
          )}
          {canSelfEdit && <WithdrawButton requestId={detail.id} onWithdraw={withdrawTravelExpense} redirectTo="/travel-expenses" />}
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
          <Item label="申請人">{detail.applicantName}</Item>
          <Item label="部門">{detail.departmentName}</Item>
          <Item label="填表日期">{day(detail.formDate)}</Item>
          <Item label="預算來源">{detail.budgetLabel}</Item>
          <Item label="預支金額">NT$ {money(detail.advanceAmount)}</Item>
          <Item label="出差期間">
            {day(detail.tripStartDate)} ~ {day(detail.tripEndDate)}
          </Item>
          <Item label="出差事由" wide>
            {detail.purpose}
          </Item>
          <Item label="本人核准之公出差旅單編號">{detail.tripOrderNo}</Item>
          <Item label="同行者名字及核准之公出差旅單編號" wide>
            {detail.companions}
          </Item>
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">出差報告</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-10`}>#</th>
                <th className={`${th} w-32`}>日期</th>
                <th className={th}>出差地</th>
                <th className={th}>行程說明</th>
                <th className={`${th} w-40`}>出差時間區段</th>
              </tr>
            </thead>
            <tbody>
              {detail.reportItems.map((r) => (
                <tr key={r.lineNo}>
                  <td className={`${td} text-center text-td-muted`}>{r.lineNo}</td>
                  <td className={`${td} text-center`}>{day(r.tripDate)}</td>
                  <td className={td}>{r.location}</td>
                  <td className={`${td} whitespace-pre-wrap`}>{r.itinerary}</td>
                  <td className={td}>{r.timeSlot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">出差旅費結算</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr>
                <th className={`${th} w-10`}>#</th>
                <th className={`${th} w-28`}>日期</th>
                <th className={`${th} w-20`}>類別</th>
                <th className={th}>起站</th>
                <th className={th}>迄站</th>
                <th className={`${th} w-16`}>里程</th>
                <th className={th}>摘要</th>
                <th className={`${th} w-20`}>幣別</th>
                <th className={`${th} w-24`}>金額</th>
                <th className={`${th} w-20`}>匯率</th>
                <th className={`${th} w-28`}>新臺幣金額</th>
              </tr>
            </thead>
            <tbody>
              {detail.costItems.map((c) => (
                <tr key={c.lineNo}>
                  <td className={`${td} text-center text-td-muted`}>{c.lineNo}</td>
                  <td className={`${td} text-center`}>{day(c.expenseDate)}</td>
                  <td className={`${td} text-center`}>{c.category}</td>
                  <td className={td}>{c.fromStation ?? '—'}</td>
                  <td className={td}>{c.toStation ?? '—'}</td>
                  <td className={`${td} text-right`}>{c.mileage ?? '—'}</td>
                  <td className={td}>{c.summary}</td>
                  <td className={`${td} text-center`}>{CURRENCY_LABELS[c.currency] ?? c.currency}</td>
                  <td className={`${td} text-right`}>{money(c.amount)}</td>
                  <td className={`${td} text-right`}>{c.currency === 'TWD' ? '—' : Number(c.exchangeRate)}</td>
                  <td className={`${td} text-right font-medium`}>{money(c.twdAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={10} className={`${td} text-right font-semibold`}>
                  合計
                </td>
                <td className={`${td} text-right font-bold text-td-blue-dark`}>NT$ {money(detail.totalAmount)}</td>
              </tr>
              {Number(detail.advanceAmount) > 0 && (
                <tr>
                  <td colSpan={10} className={`${td} text-right text-td-muted`}>
                    {balance >= 0 ? '扣除預支後，公司應補發' : '扣除預支後，應退還公司'}
                  </td>
                  <td className={`${td} text-right font-semibold`}>NT$ {money(Math.abs(balance))}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </section>

      <ApprovalTimeline formType="travel_expense" formId={detail.id} />

      <div className="print:hidden">
        <AttachmentsPanel formType="travel_expense" formId={id} attachments={attachments} />
      </div>

      <p className="rounded-card border border-td-border bg-white/80 px-5 py-4 text-sm text-td-blue-dark">
        <span className="font-semibold">提醒：</span>
        完成線上簽核流程後，請印出核准之出差報告暨旅費報支單，連同原始附件繳交給會計做帳，謝謝。
      </p>

      {isCurrentApprover && (
        <ApprovalActions
          formId={detail.id}
          version={detail.version}
          onApprove={approveTravelExpenseStep}
          onReturn={returnTravelExpenseStep}
        />
      )}
    </main>
  );
}
