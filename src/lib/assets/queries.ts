import { asc, eq } from 'drizzle-orm';
import type { AssetStatus } from '@/lib/asset-transfers/constants';
import { canMaintainRegister } from '@/lib/assets/service';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { assets, departments, employees } from '@/lib/db/schema';

export type RegisterRow = {
  id: string;
  tag: string;
  name: string;
  quantity: number;
  custodianEmployeeId: string;
  custodianName: string;
  custodianDepartment: string;
  location: string;
  status: AssetStatus;
  remark: string | null;
  updatedAt: Date;
};

/** The whole register, including assets that have left it (finance / admin only). */
export async function getAssetRegister(): Promise<RegisterRow[]> {
  if (!canMaintainRegister(await getCurrentEmployee())) return [];
  const rows = await getDb()
    .select({
      id: assets.id,
      tag: assets.tag,
      name: assets.name,
      quantity: assets.quantity,
      custodianEmployeeId: assets.custodianEmployeeId,
      custodianName: employees.name,
      custodianDepartment: departments.name,
      location: assets.location,
      status: assets.status,
      remark: assets.remark,
      updatedAt: assets.updatedAt,
    })
    .from(assets)
    .innerJoin(employees, eq(employees.id, assets.custodianEmployeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .orderBy(asc(assets.tag));
  return rows.map((r) => ({ ...r, status: r.status as AssetStatus }));
}
