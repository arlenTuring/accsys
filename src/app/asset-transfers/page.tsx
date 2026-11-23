import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMyAssetListRecords } from '@/lib/asset-transfers/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { replacementFor } from '@/lib/custom-forms/legacy';
import { AssetRecordsClient } from './asset-records-client';

export default async function AssetTransfersPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const [records, replacement] = await Promise.all([
    getMyAssetListRecords(),
    replacementFor('asset_transfer'),
  ]);

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">資產管理</p>
          <h1 className="page-title">財產清單紀錄</h1>
          <p className="page-subtitle">
            包含財產盤點的單子、別人轉移給您的單子，以及您轉移出去的單子；區分為「執行中／審核中」與「歷史封存紀錄」。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/assets/mine" className="btn-secondary text-xs">
            ← 返回我的資產管理
          </Link>
          <Link
            href={
              replacement ? `/f/${replacement}/new` : '/asset-transfers/new'
            }
            className="btn-primary text-xs"
          >
            + 資產異動申請單
          </Link>
        </div>
      </section>

      <AssetRecordsClient records={records} />
    </main>
  );
}
