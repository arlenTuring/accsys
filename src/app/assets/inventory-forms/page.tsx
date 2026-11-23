import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { listInventoryHandoverForms } from '@/lib/assets/inventory-forms';
import { getScopedAssetRegister } from '@/lib/assets/queries';
import { canMaintainRegister } from '@/lib/assets/service';
import { getDb } from '@/lib/db';
import { employees } from '@/lib/db/schema';
import { InventoryFormsDispatchClient } from './dispatch-client';

export default async function AssetInventoryFormsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const canDispatch = canMaintainRegister(employee);
  // 一般使用者沒有財產盤點管理權限時，自動導向「我的資產管理 (/assets/mine)」
  if (!canDispatch) redirect('/assets/mine');

  const db = getDb();
  const [forms, registerData, empRows] = await Promise.all([
    listInventoryHandoverForms(employee),
    getScopedAssetRegister({ scope: 'company' }),
    db.select({ id: employees.id, employeeCode: employees.employeeCode }).from(employees),
  ]);

  const codeById = new Map(empRows.map((e) => [e.id, e.employeeCode]));

  // Group active assets by custodian so the inspector can pick one or more custodians
  const byCustodian = new Map<
    string,
    { employeeId: string; employeeCode: string; name: string; departmentName: string; assetCount: number }
  >();
  for (const row of registerData.rows) {
    if (row.status === 'sold' || row.status === 'scrapped') continue;
    const existing = byCustodian.get(row.custodianEmployeeId);
    if (existing) {
      existing.assetCount += 1;
    } else {
      byCustodian.set(row.custodianEmployeeId, {
        employeeId: row.custodianEmployeeId,
        employeeCode: codeById.get(row.custodianEmployeeId) ?? '',
        name: row.custodianName,
        departmentName: row.custodyDepartmentName || row.custodianDepartment,
        assetCount: 1,
      });
    }
  }
  const custodianCandidates = [...byCustodian.values()].sort(
    (a, b) =>
      a.departmentName.localeCompare(b.departmentName, 'zh-Hant') ||
      a.name.localeCompare(b.name, 'zh-Hant')
  );

  return (
    <main className="page-shell space-y-6">
      <div>
        <p className="section-title">財會管理 · 財產盤點與點交確認</p>
        <h1 className="page-title">財產盤點</h1>
        <p className="mt-1 text-sm text-td-muted">
          財產清點人發送財產盤點單給保管人後，保管人會在「我的資產管理」收到該張盤點單並點選「確認」或「修改」；清點人則於此執行「確認」或「異常」複核與結案。
        </p>
      </div>

      <InventoryFormsDispatchClient
        canDispatch={canDispatch}
        currentEmployeeId={employee.id}
        currentEmployeeName={employee.name}
        custodianCandidates={custodianCandidates}
        forms={forms}
      />
    </main>
  );
}
