import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAssetOptions, getEmployeeOptions, getUsageBudgetOptions } from '@/lib/asset-transfers/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { getDepartmentOptions } from '@/lib/expense-claims/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { AssetTransferForm } from '../asset-transfer-form';

export default async function NewAssetTransferPage({
  searchParams,
}: {
  searchParams: Promise<{
    assetId?: string;
    assetIds?: string;
    newLocation?: string;
    remark?: string;
    newCustodianId?: string;
  }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const sp = await searchParams;

  const replacement = await replacementFor('asset_transfer');
  if (replacement) {
    const qs = new URLSearchParams();
    if (sp.assetId) qs.set('assetId', sp.assetId);
    if (sp.assetIds) qs.set('assetIds', sp.assetIds);
    if (sp.newLocation) qs.set('newLocation', sp.newLocation);
    if (sp.remark) qs.set('remark', sp.remark);
    if (sp.newCustodianId) qs.set('newCustodianId', sp.newCustodianId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    redirect(`/f/${replacement}/new${suffix}`);
  }

  const [departments, budgetOptions, employees, assets] = await Promise.all([
    getDepartmentOptions(),
    getUsageBudgetOptions(),
    getEmployeeOptions(),
    getAssetOptions(),
  ]);

  const requestedIds = [
    ...(sp.assetId ? [sp.assetId] : []),
    ...(sp.assetIds ? sp.assetIds.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  const uniqueIds = [...new Set(requestedIds)];
  const matchedAssets = uniqueIds
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  const prefilledInitial =
    matchedAssets.length > 0
      ? {
          departmentId: employee.departmentId,
          useDepartmentId: employee.departmentId,
          transferTypes: ['custodian' as const],
          remark: sp.remark ?? '',
          originalCustodianEmployeeId: matchedAssets[0]?.custodianId ?? employee.id,
          newCustodianEmployeeId: sp.newCustodianId ?? '',
          items: matchedAssets.map((a) => ({
            assetId: a.id,
            reason: 'custodian',
            newCustodianEmployeeId: sp.newCustodianId ?? '',
            newLocation: sp.newLocation ?? a.location ?? '',
          })),
        }
      : { departmentId: employee.departmentId };

  return (
    <main className="page-shell space-y-4">
      <nav className="flex flex-wrap items-center justify-between gap-2 text-sm text-td-muted">
        <div>
          <Link href="/assets/mine" className="hover:text-td-blue">
            我的資產管理
          </Link>
          <span className="mx-2">/</span>
          <Link href="/asset-transfers" className="hover:text-td-blue">
            資產異動
          </Link>
          <span className="mx-2">/</span>
          <span className="text-td-blue-dark">新增資產轉移申請單</span>
        </div>
        <Link href="/assets/mine" className="btn-secondary text-xs">
          ← 返回我的資產管理
        </Link>
      </nav>
      {matchedAssets.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950">
          ✅ 已從「<strong>我的資產管理</strong>」自動帶入{' '}
          <strong>
            {matchedAssets.map((a) => `${a.tag}（${a.name}）`).join('、')}
          </strong>{' '}
          之保管資料與目前位置，請選擇「新保管人」與「使用專案/客戶名稱」並上傳照片後即可送出。
        </div>
      )}
      <AssetTransferForm
        applicantName={employee.name}
        applicationDate={taipeiToday()}
        departments={departments}
        budgetOptions={budgetOptions}
        employees={employees}
        assets={assets}
        mode={{ kind: 'create' }}
        initial={prefilledInitial}
      />
    </main>
  );
}
