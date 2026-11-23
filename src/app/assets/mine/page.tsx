import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  getInventoryHandoverFormDetail,
  listInventoryHandoverForms,
  type HandoverFormDetail,
} from '@/lib/assets/inventory-forms';
import { getScopedAssetRegister } from '@/lib/assets/queries';
import { InventoryConfirmClient } from './inventory-confirm-client';

export default async function MyAssetsManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; handoverId?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const params = await searchParams;
  const rawScope = params.scope;
  const wantScope: 'mine' | 'department' =
    rawScope === 'department' ? 'department' : 'mine';
  const requestedHandoverId = params.handoverId ?? null;

  const [{ rows, scope, canReviewInventory, canViewDepartment }, handoverForms] =
    await Promise.all([
      getScopedAssetRegister({ scope: wantScope }),
      listInventoryHandoverForms(employee),
    ]);

  const rowCustodianIds = new Set(rows.map((r) => r.custodianEmployeeId));
  // 僅顯示尚未完成保管人盤點確認的清點單（全部項目完成後即封存至「財產清單紀錄」）
  const openSummaries = handoverForms.filter(
    (f) =>
      f.status === 'open' &&
      (f.custodianConfirmedLines < f.totalLines || f.id === requestedHandoverId) &&
      (f.custodianEmployeeId === employee.id ||
        (wantScope === 'department' && rowCustodianIds.has(f.custodianEmployeeId)))
  );
  const openDetailsRaw = await Promise.all(
    openSummaries.map((f) => getInventoryHandoverFormDetail(employee, f.id))
  );
  const openForms = openDetailsRaw.filter((d): d is HandoverFormDetail => d !== null);

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-title">資產管理</p>
          <h1 className="page-title">我的資產管理</h1>
          <p className="page-subtitle">
            檢視您名下的資產清單與物品存放位置；如需移轉保管人或辦理異動，點擊「轉移」即可將資產資料自動帶入《資產異動申請單》。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/asset-transfers" className="btn-secondary text-xs">
            財產清單紀錄
          </Link>
        </div>
      </section>

      <InventoryConfirmClient
        rows={rows}
        currentScope={scope === 'department' ? 'department' : 'mine'}
        canReviewInventory={canReviewInventory}
        canViewDepartment={canViewDepartment}
        openForms={openForms}
        initialHandoverId={requestedHandoverId}
      />
    </main>
  );
}
