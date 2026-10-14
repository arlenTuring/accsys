import Link from 'next/link';
import { redirect } from 'next/navigation';
import { STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { ASSET_STATUS_LABELS } from '@/lib/asset-transfers/constants';
import { getMyAssetTransfers, getMyCustodyAssets } from '@/lib/asset-transfers/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

const day = (iso: string) => iso.replaceAll('-', '/');

export default async function AssetTransfersPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const [transfers, custody] = await Promise.all([getMyAssetTransfers(), getMyCustodyAssets()]);

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">資產管理</p>
          <h1 className="page-title">我的資產異動申請</h1>
          <p className="page-subtitle">保管人異動、借出、合併、出售、報廢等，請於異動發生後 7 個工作日內填單；核准後系統自動更新財產清冊。</p>
        </div>
        <Link href="/asset-transfers/new" className="btn-primary">
          + 資產異動申請單
        </Link>
      </section>

      {transfers.length === 0 ? (
        <div className="card text-sm text-td-muted">目前沒有資產異動申請單。</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {transfers.map((t) => (
            <li key={t.id}>
              <Link
                href={`/asset-transfers/${t.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-td-blue-light/40 sm:grid-cols-[9rem_1fr_auto] sm:items-center"
              >
                <span className="mono-case">{t.caseNumber}</span>
                <span className="text-sm text-td-blue-dark">
                  {t.firstAsset}
                  {t.lineCount > 1 && <span className="text-td-muted">（等 {t.lineCount} 項）</span>}
                  <span className="block text-xs text-td-muted">申請日期 {day(t.applicationDate)}</span>
                </span>
                <span className="flex items-center gap-2">
                  {t.appliedAt && <span className="text-xs text-emerald-700">已更新清冊</span>}
                  <span className={STATUS_BADGE[t.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[t.status] ?? t.status}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">我保管的財產（{custody.length}）</h2>
        {custody.length === 0 ? (
          <p className="text-sm text-td-muted">財產清冊中沒有登記在您名下的財產。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-td-border text-left text-xs text-td-muted">
                  <th className="py-2 pr-4">財產編號</th>
                  <th className="py-2 pr-4">財產名稱</th>
                  <th className="py-2 pr-4">數量</th>
                  <th className="py-2 pr-4">保管地點</th>
                  <th className="py-2">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-td-border">
                {custody.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 pr-4 font-mono">{a.tag}</td>
                    <td className="py-2 pr-4">{a.name}</td>
                    <td className="py-2 pr-4">{a.quantity}</td>
                    <td className="py-2 pr-4">{a.location || '—'}</td>
                    <td className="py-2">{ASSET_STATUS_LABELS[a.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
