import Link from 'next/link';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { SubmissionList } from '@/app/f/submission-list';
import { NDA_MOU_NOTES_URL } from '@/lib/contract-seals/constants';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { getFormCatalog } from '@/lib/forms/catalog-server';
import { sealAmountLabel } from '@/lib/seal-requests/constants';
import { getMySealRequests } from '@/lib/seal-requests/lists';
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';

const KIND_LABELS = {
  contract_seal_request: '合約類',
  general_seal_request: '非合約類',
  invoice_seal_request: '開立發票',
} as const;

const day = (iso: string) => iso.replaceAll('-', '/');

function Flow({ title, start, steps }: { title: string; start: string[]; steps: string[] }) {
  const chip = 'rounded border border-td-border bg-white px-2.5 py-1.5 text-center text-xs text-td-blue-dark';
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-td-muted">{title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-1.5">
          {start.map((s) => (
            <span key={s} className={chip}>
              {s}
            </span>
          ))}
        </div>
        {steps.map((s) => (
          <span key={s} className="flex items-center gap-2">
            <span className="text-td-muted">→</span>
            <span className={s === '用印申請' ? `${chip} border-td-apex bg-td-apex-light font-semibold` : chip}>{s}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function SealRequestsPage() {
  const [items, newItems, catalog] = await Promise.all([getMySealRequests(), getMySubmissions({ categoryKey: 'seal' }), getFormCatalog()]);
  const entries = catalog.find((c) => c.id === 'seal')?.forms ?? [];
  return (
    <main className="page-shell">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">行政申請</p>
          <h1 className="page-title">用印申請</h1>
          <p className="page-subtitle">
            合約類：合約、協議書、NDA、LOI、MOU；非合約類：報價單、公文、工商登記、銀行往來、報關等文件；開立發票：開給客戶的發票或
            Invoice。核准後印出申請單，連同文件交相關單位用印。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {entries.map((f, i) => (
            <Link key={f.href} href={f.href} className={i === 0 ? 'btn-primary' : 'btn-secondary'}>
              + 新增{f.title}
            </Link>
          ))}
        </div>
      </section>

      <section className="card-muted mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-td-blue-dark">合約類送出用印申請前，請先完成審約</p>
          <a href={NDA_MOU_NOTES_URL} target="_blank" rel="noreferrer" className="text-xs font-semibold text-td-blue hover:underline">
            NDA_MOU審閱注意事項（PDF）→
          </a>
        </div>
        <Flow
          title="NDA & MOU"
          start={['使用公司公版 → 客戶審約', '使用外部版本 → 承辦人審約']}
          steps={['承辦人確認最終版本符合審約注意事項', '用印申請']}
        />
        <Flow
          title="其他合約（合約、協議書、意向書）"
          start={['承辦人撰寫初稿', '使用外部版本']}
          steps={['經管理部窗口轉法律顧問審約', '客戶審約（協商/修改）', '法律顧問確認最終版本', '用印申請']}
        />
      </section>

      {newItems.length > 0 && (
        <section className="mb-6 space-y-2">
          <h2 className="text-sm font-semibold text-td-blue-dark">新版用印申請</h2>
          <SubmissionList items={newItems} showName />
        </section>
      )}

      {newItems.length > 0 && items.length > 0 && <h2 className="mb-2 text-sm font-semibold text-td-blue-dark">舊版用印申請</h2>}
      {items.length === 0 ? (
        newItems.length === 0 && <div className="card text-sm text-td-muted">尚無用印申請，請由右上角選擇申請類別新增。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {items.map((s) => (
            <li key={`${s.formType}-${s.id}`}>
              <Link
                href={`${FORM_ROUTE_PREFIX[s.formType]}/${s.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-td-blue-light/40 sm:grid-cols-[9rem_1fr_auto_7rem] sm:items-center sm:gap-4"
              >
                <span className="mono-case">{s.caseNumber}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-td-blue-dark">{s.title}</span>
                  <span className="text-xs text-td-muted">
                    {KIND_LABELS[s.formType]}・{s.documentLabel} · 申請人 {s.applicantName}
                    {s.expectedCompletionDate && ` · 期望完成 ${day(s.expectedCompletionDate)}`}
                    {s.urgency === 'urgent' && <span className="ml-1 font-semibold text-status-returned">急件</span>}
                  </span>
                </span>
                <span className={STATUS_BADGE[s.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[s.status] ?? s.status}</span>
                <span className="text-right text-sm font-medium text-td-blue-dark">{sealAmountLabel(s.totalAmount, s.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
