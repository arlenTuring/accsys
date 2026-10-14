import { notFound } from 'next/navigation';
import { ApprovalActions } from '@/app/components/approval-actions';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { approveInvoiceSealStep, returnInvoiceSealStep, withdrawInvoiceSealRequest } from '@/lib/invoice-seals/actions';
import { INVOICE_SEAL_LABELS, INVOICE_TYPE_LABELS } from '@/lib/invoice-seals/constants';
import { getInvoiceSealDetail } from '@/lib/invoice-seals/queries';
import { centsToNumber, toCents } from '@/lib/money';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { DetailItem as Item, SealDetailHeader, SealReminderNote, day, sealAccess } from '../../seal-detail-parts';

const money = (decimal: string) => centsToNumber(toCents(decimal)).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const thCls = 'border-b border-td-border px-3 py-2 text-left text-xs font-semibold text-td-muted';
const tdCls = 'border-b border-td-border px-3 py-2 text-sm text-td-blue-dark';

export default async function InvoiceSealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { id } = await params;
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getInvoiceSealDetail(id);
  if (!detail) notFound();
  const [employee, attachments] = await Promise.all([getCurrentEmployee(), getAttachments('invoice_seal_request', id)]);
  const { isCurrentApprover } = sealAccess(detail, employee?.id);

  return (
    <main className="page-shell space-y-5">
      <SealDetailHeader
        title="用印申請單(開立發票/Invoice)"
        detail={detail}
        viewerId={employee?.id}
        basePath="/seal-requests/invoices"
        onWithdraw={withdrawInvoiceSealRequest}
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
          <Item label="發票形式">{INVOICE_TYPE_LABELS[detail.invoiceType] ?? detail.invoiceType}</Item>
          <Item label="印鑑名稱">{INVOICE_SEAL_LABELS[detail.seal] ?? detail.seal}</Item>
          <Item label="客戶名稱">{detail.customerName}</Item>
          <Item label="客戶統編">{detail.customerTaxId === '0' ? '0（個人或國外客戶）' : detail.customerTaxId}</Item>
          <Item label="客戶電話">{detail.customerPhone}</Item>
          <Item label="客戶地址">{detail.customerAddress}</Item>
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">開立資訊</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={`${thCls} w-10`}>#</th>
                <th className={thCls}>品名</th>
                <th className={`${thCls} text-right`}>數量</th>
                <th className={thCls}>幣別</th>
                <th className={`${thCls} text-right`}>未稅單價</th>
                <th className={`${thCls} text-right`}>未稅金額</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.lineNo}>
                  <td className={`${tdCls} text-td-muted`}>{it.lineNo}</td>
                  <td className={tdCls}>{it.itemName}</td>
                  <td className={`${tdCls} text-right`}>{it.quantity.toLocaleString()}</td>
                  <td className={tdCls}>{it.currency}</td>
                  <td className={`${tdCls} text-right`}>{money(it.unitPrice)}</td>
                  <td className={`${tdCls} text-right font-medium`}>{money(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          <dt className="text-td-muted">未稅金額合計</dt>
          <dd className="text-right text-td-blue-dark">
            {detail.currency} {money(detail.untaxedTotal)}
          </dd>
          <dt className="font-semibold text-td-blue-dark">含稅總計</dt>
          <dd className="text-right font-semibold text-td-blue-dark">
            {detail.currency} {money(detail.totalAmount)}
          </dd>
        </dl>
      </section>

      <ApprovalTimeline formType="invoice_seal_request" formId={detail.id} />

      <div className="print:hidden">
        <AttachmentsPanel formType="invoice_seal_request" formId={id} attachments={attachments} />
      </div>

      <SealReminderNote text="完成線上簽核流程後，請印出核准之用印申請單，連同開立依據，提供給會計，謝謝。" />

      {isCurrentApprover && (
        <ApprovalActions
          formId={detail.id}
          version={detail.version}
          onApprove={approveInvoiceSealStep}
          onReturn={returnInvoiceSealStep}
        />
      )}
    </main>
  );
}
