import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApprovalActions } from '@/app/components/approval-actions';
import { ApprovalTimeline } from '@/app/components/approval-timeline';
import { AttachmentsPanel } from '@/app/components/attachments-panel';
import { DetailQueueNav } from '@/app/components/detail-queue-nav';
import { getDetailQueueNavigation } from '@/lib/applications/my-applications';
import { loadAttachmentPanelExtras } from '@/lib/attachments/analysis-queries';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { PrintButton } from '@/app/components/print-button';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
import { ASSET_TRANSFER_TYPE_LABELS, type AssetTransferType } from '@/lib/asset-transfers/constants';
import { parseUploadFailed } from '@/lib/attachments/batch';
import { getAttachments } from '@/lib/attachments/queries';
import { approveCustomFormStep, returnCustomFormStep, withdrawCustomForm } from '@/lib/custom-forms/actions';
import { getSubmissionDetail, type CaseChainNode, type SubmissionAssetLine } from '@/lib/custom-forms/queries';
import {
  ACCEPTANCE_KEY,
  PROCUREMENT_PAYMENT_KEY,
  PURCHASE_ORDER_KEY,
  PURCHASE_REQUEST_KEY,
} from '@/lib/custom-forms/migrated/procurement';
import { allFields, isDisplayOnly } from '@/lib/custom-forms/schema';
import { amountText, fieldText, SubmissionFields } from '../../submission-fields';

const time = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Register snapshot taken at submit (原保管人／地點) next to what approval will write into the register. */
function AssetRegisterLines({ lines, appliedAt }: { lines: SubmissionAssetLine[]; appliedAt: Date | null }) {
  const th = 'border border-td-border px-2 py-1.5 text-left font-semibold';
  const td = 'border border-td-border px-2 py-1.5';
  return (
    <section className="card">
      <h2 className="font-semibold text-td-blue-dark">財產清冊異動</h2>
      <p className="mb-3 mt-1 text-xs text-td-muted">
        {appliedAt ? `已於 ${time.format(appliedAt)} 寫入財產清冊。` : '送出時的財產清冊資料；全部簽核完成後才會寫入財產清冊。'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs text-td-muted">
              <th className={`${th} w-10 text-center`}>#</th>
              <th className={th}>財產編號</th>
              <th className={th}>財產名稱</th>
              <th className={th}>數量</th>
              <th className={th}>原保管人</th>
              <th className={th}>原保管地點</th>
              <th className={th}>異動原因</th>
              <th className={th}>新保管人員</th>
              <th className={th}>新保管地點</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineNo}>
                <td className={`${td} text-center text-td-muted`}>{l.lineNo}</td>
                <td className={`${td} mono-case`}>{l.assetTag}</td>
                <td className={td}>{l.assetName}</td>
                <td className={`${td} text-right tabular-nums`}>{l.quantity}</td>
                <td className={td}>{l.originalCustodianName}</td>
                <td className={td}>{l.originalLocation || '—'}</td>
                <td className={td}>{ASSET_TRANSFER_TYPE_LABELS[l.reason as AssetTransferType] ?? l.reason}</td>
                <td className={td}>{l.newCustodianName}</td>
                <td className={td}>{l.newLocation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const PROCUREMENT_CHAIN_KEYS = new Set([
  PURCHASE_REQUEST_KEY,
  PURCHASE_ORDER_KEY,
  ACCEPTANCE_KEY,
  PROCUREMENT_PAYMENT_KEY,
]);

function ProcurementCaseChainPanel({
  currentId,
  caseNumber,
  chain,
}: {
  currentId: string;
  caseNumber: string;
  chain: CaseChainNode[];
}) {
  const activeChain = chain.filter((c) => c.status !== 'withdrawn');
  const hasPrepaidPo = activeChain.some((c) => c.key === PURCHASE_ORDER_KEY && c.paymentTerms === '預付款');
  const sumByKey = (k: string) =>
    activeChain.filter((c) => c.key === k).reduce((sum, c) => sum + (c.totalAmount ?? 0), 0);
  const countByKey = (k: string) => activeChain.filter((c) => c.key === k).length;
  const prTotal = sumByKey(PURCHASE_REQUEST_KEY);
  const poTotal = sumByKey(PURCHASE_ORDER_KEY);
  const acTotal = sumByKey(ACCEPTANCE_KEY);
  const ppTotal = sumByKey(PROCUREMENT_PAYMENT_KEY);
  const byId = new Map(chain.map((c) => [c.id, c]));

  const steps = hasPrepaidPo
    ? [
        { key: PURCHASE_REQUEST_KEY, stepNo: '1', title: '1. 請購單', sub: '申請請購單號', count: countByKey(PURCHASE_REQUEST_KEY), sum: prTotal },
        { key: PURCHASE_ORDER_KEY, stepNo: '2', title: '2. 採購單（需預付）', sub: '合約／報價單 & 客供資料卡', count: countByKey(PURCHASE_ORDER_KEY), sum: poTotal },
        { key: PROCUREMENT_PAYMENT_KEY, stepNo: '4', title: '4. 費用申請單', sub: '預付款項先行請款', count: countByKey(PROCUREMENT_PAYMENT_KEY), sum: ppTotal },
        { key: ACCEPTANCE_KEY, stepNo: '3', title: '3. 驗收單', sub: '到貨入庫、貼財編', count: countByKey(ACCEPTANCE_KEY), sum: acTotal },
      ]
    : [
        { key: PURCHASE_REQUEST_KEY, stepNo: '1', title: '1. 請購單', sub: '申請請購單號', count: countByKey(PURCHASE_REQUEST_KEY), sum: prTotal },
        { key: PURCHASE_ORDER_KEY, stepNo: '2', title: '2. 採購單', sub: '合約／報價單 & 客供資料卡', count: countByKey(PURCHASE_ORDER_KEY), sum: poTotal },
        { key: ACCEPTANCE_KEY, stepNo: '3', title: '3. 驗收單', sub: '到貨入庫、貼財編', count: countByKey(ACCEPTANCE_KEY), sum: acTotal },
        { key: PROCUREMENT_PAYMENT_KEY, stepNo: '4', title: '4. 費用申請單', sub: '驗收後申請付款', count: countByKey(PROCUREMENT_PAYMENT_KEY), sum: ppTotal },
      ];

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-td-blue-dark">採購流程進度與 1 對多關聯單據追蹤（案號：{caseNumber}）</h2>
          <p className="mt-0.5 text-xs text-td-muted">
            {hasPrepaidPo
              ? '目前案件包含「預付款」採購單，適用預付流程順序：1.請購單 → 2.採購單(預付款) → 4.費用申請單(先請款) → 3.驗收單(入庫、貼財編)'
              : '適用一般採購流程順序：1.請購單 → 2.採購單 → 3.驗收單(入庫、貼財編) → 4.費用申請單'}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            hasPrepaidPo ? 'bg-amber-100 text-amber-900' : 'bg-blue-50 text-td-blue'
          }`}
        >
          {hasPrepaidPo ? '預付款出貨流程（先請款後驗收）' : '一般非預付流程（先驗收後請款）'}
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-4">
        {steps.map((st, idx) => (
          <div
            key={st.key}
            className={`rounded-lg border p-3 ${
              st.count > 0 ? 'border-td-blue/40 bg-blue-50/40' : 'border-td-border bg-slate-50/60'
            }`}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-td-blue-dark">{st.title}</span>
              <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-td-muted shadow-sm">
                已開 {st.count} 張
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-td-muted">{st.sub}</p>
            <p className="mt-2 text-sm font-bold tabular-nums text-td-blue-dark">
              {st.count > 0 ? `NT$ ${amountText(st.sum)}` : '尚未建立'}
            </p>
            {idx > 0 && prTotal > 0 && st.count > 0 && (
              <p className="mt-0.5 text-[11px] text-td-muted">
                佔請購總額 {Math.round((st.sum / prTotal) * 100)}%
                {st.sum > prTotal + 0.005 ? '（⚠️ 超過原請購預估）' : `（餘額 NT$ ${amountText(Math.max(0, prTotal - st.sum))}）`}
              </p>
            )}
          </div>
        ))}
      </div>

      {chain.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-td-muted">
                <th className="border border-td-border px-2.5 py-1.5 text-left font-semibold">單據號碼</th>
                <th className="border border-td-border px-2.5 py-1.5 text-left font-semibold">單據類型</th>
                <th className="border border-td-border px-2.5 py-1.5 text-left font-semibold">上層來源單據</th>
                <th className="border border-td-border px-2.5 py-1.5 text-left font-semibold">付款條件</th>
                <th className="border border-td-border px-2.5 py-1.5 text-right font-semibold">金額 (NT$)</th>
                <th className="border border-td-border px-2.5 py-1.5 text-center font-semibold">簽核狀態</th>
              </tr>
            </thead>
            <tbody>
              {chain.map((node) => {
                const parent = node.sourceSubmissionId ? byId.get(node.sourceSubmissionId) : undefined;
                const isCurrent = node.id === currentId;
                return (
                  <tr key={node.id} className={isCurrent ? 'bg-blue-50/70 font-semibold' : ''}>
                    <td className="border border-td-border px-2.5 py-1.5 mono-case">
                      <Link href={`/f/${node.key}/${node.id}`} className="text-td-blue hover:underline">
                        {node.formNumber}
                      </Link>
                      {isCurrent && <span className="ml-1.5 rounded bg-td-blue px-1.5 py-0.5 text-[10px] text-white">目前檢視</span>}
                    </td>
                    <td className="border border-td-border px-2.5 py-1.5 text-td-blue-dark">{node.name}</td>
                    <td className="border border-td-border px-2.5 py-1.5 text-td-muted">
                      {parent ? `${parent.formNumber}（${parent.name}）` : '—（起點單據）'}
                    </td>
                    <td className="border border-td-border px-2.5 py-1.5 text-td-muted">
                      {node.paymentTerms ?? '—'}
                    </td>
                    <td className="border border-td-border px-2.5 py-1.5 text-right tabular-nums text-td-blue-dark">
                      {node.totalAmount !== null ? amountText(node.totalAmount) : '—'}
                    </td>
                    <td className="border border-td-border px-2.5 py-1.5 text-center">
                      <span className={STATUS_BADGE[node.status] ?? 'badge-withdrawn'}>
                        {STATUS_LABELS[node.status] ?? node.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-td-muted">{label}</dt>
      <dd className="mt-1 text-sm text-td-blue-dark">{children}</dd>
    </div>
  );
}

export default async function DesignerFormDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; id: string }>;
  searchParams: Promise<{ uploadFailed?: string }>;
}) {
  const { key, id } = await params;
  const uploadFailed = parseUploadFailed((await searchParams).uploadFailed);
  const detail = await getSubmissionDetail(id);
  if (!detail) notFound();
  // Notifications and approval lists link to /f/_/<id>.
  if (detail.key !== key) redirect(`/f/${detail.key}/${id}`);
  const [attachments, queueNav] = await Promise.all([
    getAttachments('custom', id),
    getDetailQueueNavigation(id),
  ]);
  const attachmentExtras = await loadAttachmentPanelExtras(attachments.map((a) => a.id));
  const headerFields = allFields(detail.schema).filter((f) => f.showInHeader && !isDisplayOnly(f) && f.id in detail.data);
  const hasAttachmentField = allFields(detail.schema).some((f) => f.type === 'attachments');

  const isBudgetForm = detail.key === 'budget-request' || detail.key === 'budget-change';
  const isAssetForm = detail.key === 'asset-transfer';

  return (
    <main className="page-shell space-y-5">
      <DetailQueueNav
        currentId={detail.id}
        currentCaseNumber={detail.formNumber}
        currentFormLabel={detail.name}
        preloadedNav={queueNav}
        secondaryBackHref={
          isBudgetForm
            ? '/my-tasks/budget'
            : isAssetForm
              ? '/assets/mine'
              : undefined
        }
        secondaryBackLabel={
          isBudgetForm
            ? '返回年度預算表填報'
            : isAssetForm
              ? '返回我的資產管理'
              : undefined
        }
      />

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{detail.name}</h1>
          <p className="mt-1 flex items-center gap-3">
            <span className="mono-case">{detail.formNumber}</span>
            <span className={STATUS_BADGE[detail.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[detail.status] ?? detail.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {detail.followUps.map((f) => (
            <Link key={`${f.key}-${f.sourceId ?? detail.id}`} href={`/f/${f.key}/new?source=${f.sourceId ?? detail.id}`} className="btn-primary">
              接續建立{f.name}
            </Link>
          ))}
          <Link href={`/f/${detail.key}/new?copyFrom=${detail.id}`} className="btn-secondary">
            複製此單據
          </Link>
          <PrintButton label="列印 / 存成 PDF" />
          {detail.canEdit && (
            <Link href={`/f/${detail.key}/${detail.id}/edit`} className="btn-secondary">
              編輯
            </Link>
          )}
          {detail.canResubmit && (
            <Link href={`/f/${detail.key}/${detail.id}/edit`} className="btn-primary">
              修改並重新送出
            </Link>
          )}
          {detail.canEdit && <WithdrawButton requestId={detail.id} onWithdraw={withdrawCustomForm} redirectTo={`/f/${detail.key}`} />}
        </div>
      </section>

      {uploadFailed && (
        <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          表單已送出，但有 {uploadFailed} 個附件上傳失敗，請在下方「附件」區補傳。
        </p>
      )}

      <section className="card">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="申請人">
            <span className="font-semibold">{detail.applicantName}</span>
            <span className="block text-xs text-td-muted">{detail.applicantEmail ?? ''}</span>
            {detail.applicantPhone && <span className="block text-xs text-td-muted">{detail.applicantPhone}</span>}
          </Item>
          {detail.filerName && <Item label="經辦人（代為申請）">{detail.filerName}</Item>}
          <Item label="申請部門">{detail.departmentName}</Item>
          <Item label="申請時間">{time.format(detail.submittedAt)}</Item>
          <Item label="案號">
            <span className="mono-case">{detail.caseNumber}</span>
          </Item>
          {headerFields.map((f) => (
            <Item key={f.id} label={f.label}>
              {fieldText(f, detail.data[f.id], detail.labels, detail.data)}
            </Item>
          ))}
          {detail.paymentBatch && (
            <Item label="預計撥款批次日">{detail.paymentBatch.batchDate.replaceAll('-', '/')}</Item>
          )}
        </dl>
        {detail.paymentTerms && !detail.paymentTerms.consistent && (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            提醒：期望付款日與採購單付款條件「{detail.paymentTerms.terms}」不一致，請確認。
          </p>
        )}
      </section>

      {(PROCUREMENT_CHAIN_KEYS.has(detail.key) || detail.caseChain.length > 1) && (
        <ProcurementCaseChainPanel currentId={detail.id} caseNumber={detail.caseNumber} chain={detail.caseChain} />
      )}

      <SubmissionFields schema={detail.schema} data={detail.data} labels={detail.labels} financeEdit={detail.canFinanceFill ? detail.id : undefined} />

      {detail.assetRegister && detail.assetRegister.lines.length > 0 && (
        <AssetRegisterLines lines={detail.assetRegister.lines} appliedAt={detail.assetRegister.appliedAt} />
      )}

      {((hasAttachmentField && detail.canAttach) || attachments.length > 0) && (
        <div className="print:hidden">
          <AttachmentsPanel
            formType="custom"
            formId={detail.id}
            attachments={attachments}
            extras={attachmentExtras}
            canUpload={hasAttachmentField && detail.canAttach}
          />
        </div>
      )}

      <ApprovalTimeline formType="custom" formId={detail.id} />

      {detail.isCurrentApprover && (
        <ApprovalActions
          formId={detail.id}
          version={detail.version}
          onApprove={approveCustomFormStep}
          onReturn={returnCustomFormStep}
          nextHref={queueNav.nextItem?.href ?? null}
          nextLabel={
            queueNav.nextItem
              ? `${queueNav.nextItem.formLabel} ${queueNav.nextItem.caseNumber}`
              : null
          }
        />
      )}
    </main>
  );
}
