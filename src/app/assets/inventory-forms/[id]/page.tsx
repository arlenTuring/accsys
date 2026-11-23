import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getInventoryHandoverFormDetail } from '@/lib/assets/inventory-forms';
import { HandoverFormClient } from './handover-form-client';

export default async function AssetInventoryFormDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const employee = await getCurrentEmployee();
  if (!employee) {
    return (
      <main className="page-shell space-y-5">
        <p className="card text-sm text-td-muted">請先登入系統以檢視財產清點／點交確認表單。</p>
      </main>
    );
  }

  const detail = await getInventoryHandoverFormDetail(employee, id);
  if (!detail) notFound();

  return (
    <main className="page-shell space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">財會管理 · 財產盤點點交確認單</p>
          <h1 className="page-title">
            財產清點點交單 <span className="mono-case text-indigo-700">{detail.formNumber}</span>
          </h1>
          <p className="mt-1 text-sm text-td-muted">
            於點交時，清點人與財產擁有者雙方各自針對每一條財產點選確認「現在位置（同意或需要更改異動）」、「此物品之存在事實」及「其他說明」。<strong>雙方每一條都確認後，這張單才可以結束</strong>。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/assets/inventory-forms" className="btn-secondary text-xs">
            ← 返回財產盤點
          </Link>
        </div>
      </div>

      <HandoverFormClient detail={detail} currentEmployeeName={employee.name} />
    </main>
  );
}
