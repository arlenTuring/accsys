import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { CurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { assets, departments, employees } from '@/lib/db/schema';
import { ASSET_STATUS_LABELS, type AssetStatus } from '@/lib/asset-transfers/constants';

export type SidebarCustodyAsset = {
  id: string;
  tag: string;
  name: string;
  itemKind: string | null;
  location: string;
  status: string;
  statusLabel: string;
};

export type SidebarEmployeeProfile = {
  id: string;
  name: string;
  email: string;
  employeeCode: string;
  title: string | null;
  departmentName: string;
  departmentCode: string;
  managerName: string | null;
  managerEmployeeCode: string | null;
  role: string;
  permissions: CurrentEmployee['permissions'];
  isGeneralManager: boolean;
  isChairman: boolean;
  custodyAssets: SidebarCustodyAsset[];
};

export async function getSidebarEmployeeProfile(
  employee: CurrentEmployee
): Promise<SidebarEmployeeProfile> {
  const db = getDb();
  const manager = alias(employees, 'dept_manager');
  const parentDept = alias(departments, 'parent_dept');
  const parentManager = alias(employees, 'parent_dept_manager');

  const [orgRow, assetRows] = await Promise.all([
    db
      .select({
        managerId: departments.managerEmployeeId,
        managerName: manager.name,
        managerCode: manager.employeeCode,
        parentManagerName: parentManager.name,
        parentManagerCode: parentManager.employeeCode,
      })
      .from(departments)
      .leftJoin(manager, eq(manager.id, departments.managerEmployeeId))
      .leftJoin(parentDept, eq(parentDept.id, departments.parentDepartmentId))
      .leftJoin(parentManager, eq(parentManager.id, parentDept.managerEmployeeId))
      .where(eq(departments.id, employee.departmentId))
      .limit(1),
    db
      .select({
        id: assets.id,
        tag: assets.tag,
        name: assets.name,
        itemKind: assets.itemKind,
        location: assets.location,
        status: assets.status,
      })
      .from(assets)
      .where(eq(assets.custodianEmployeeId, employee.id))
      .orderBy(asc(assets.tag))
      .limit(50),
  ]);

  const org = orgRow[0];
  let managerName: string | null = null;
  let managerEmployeeCode: string | null = null;

  if (org) {
    // If employee is the department manager themselves, show parent department manager if available
    if (org.managerId && org.managerId !== employee.id && org.managerName) {
      managerName = org.managerName;
      managerEmployeeCode = org.managerCode ?? null;
    } else if (org.parentManagerName) {
      managerName = org.parentManagerName;
      managerEmployeeCode = org.parentManagerCode ?? null;
    } else if (org.managerName) {
      managerName = org.managerName;
      managerEmployeeCode = org.managerCode ?? null;
    }
  }

  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    employeeCode: employee.employeeCode,
    title: employee.title,
    departmentName: employee.departmentName,
    departmentCode: employee.departmentCode,
    managerName,
    managerEmployeeCode,
    role: employee.role,
    permissions: employee.permissions,
    isGeneralManager: employee.isGeneralManager,
    isChairman: employee.isChairman,
    custodyAssets: assetRows.map((a) => ({
      id: a.id,
      tag: a.tag,
      name: a.name,
      itemKind: a.itemKind,
      location: a.location,
      status: a.status,
      statusLabel: ASSET_STATUS_LABELS[a.status as AssetStatus] ?? a.status,
    })),
  };
}
