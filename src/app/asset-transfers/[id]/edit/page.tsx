import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAssetOptions, getAssetTransferDetail, getEmployeeOptions, getUsageBudgetOptions } from '@/lib/asset-transfers/queries';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDepartmentOptions } from '@/lib/expense-claims/queries';
import { AssetTransferForm } from '../../asset-transfer-form';

export default async function EditAssetTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const detail = await getAssetTransferDetail(id);
  if (!detail) notFound();
  const base = `/asset-transfers/${id}`;

  const isApplicant = detail.applicantEmployeeId === employee.id;
  const kind =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1
      ? 'update'
      : isApplicant && detail.status === 'returned'
        ? 'resubmit'
        : null;
  if (!kind) redirect(base);

  const [departments, budgetOptions, employees, assets, attachments] = await Promise.all([
    getDepartmentOptions(),
    getUsageBudgetOptions(),
    getEmployeeOptions(),
    getAssetOptions(),
    getAttachments('asset_transfer', id),
  ]);
  const p = detail.parties;

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/asset-transfers" className="hover:text-td-blue">
          資產異動
        </Link>
        <span className="mx-2">/</span>
        <Link href={base} className="hover:text-td-blue">
          {detail.caseNumber}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{kind === 'update' ? '編輯' : '修改並重新送出'}</span>
      </nav>
      <AssetTransferForm
        applicantName={detail.applicantName}
        applicationDate={detail.applicationDate}
        departments={departments}
        budgetOptions={budgetOptions}
        employees={employees}
        assets={assets}
        mode={{ kind, transferId: id, version: detail.version, existingAttachmentCount: attachments.length }}
        initial={{
          departmentId: detail.departmentId,
          useDepartmentId: detail.useDepartmentId,
          useBudgetCodeId: detail.useBudgetCodeId,
          transferTypes: detail.transferTypes,
          remark: detail.remark ?? '',
          items: detail.items.map((i) => ({
            assetId: i.assetId,
            reason: i.reason,
            newCustodianEmployeeId: i.newCustodianEmployeeId,
            newLocation: i.newLocation,
          })),
          originalCustodianEmployeeId: p.originalCustodian.id,
          newCustodianEmployeeId: p.newCustodian.id,
          otherCustodianEmployeeId: p.otherCustodian?.id ?? '',
        }}
      />
    </main>
  );
}
