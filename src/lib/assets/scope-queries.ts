import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AssetStatus } from '@/lib/asset-transfers/constants';
import { actorHas } from '@/lib/authz/access';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { assets, departments, employees } from '@/lib/db/schema';
import { canMaintainRegister } from '@/lib/assets/service';

export type ScopedAssetRow = {
  id: string;
  tag: string;
  name: string;
  quantity: number;
  itemKind: string | null;
  location: string;
  status: AssetStatus;
  remark: string | null;
  custodianEmployeeId: string;
  custodianName: string;
  custodyDepartmentId: string | null;
  custodyDepartmentName: string | null;
  custodianJobDepartmentName: string;
};

async function managedDepartmentIds(employeeId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.managerEmployeeId, employeeId), eq(departments.active, true)));
  return rows.map((r) => r.id);
}

/**
 * Assets visible to the current user. Scope is enforced in SQL — never fetch all then filter in the model.
 * - staff: custody only
 * - department manager: custody OR custody_department they manage OR custodian's job dept they manage
 * - finance.assets / assets.company_view / admin: company
 */
export async function listAssetsForCurrentUser(opts?: {
  scope?: 'mine' | 'department' | 'company';
  q?: string;
}): Promise<{ rows: ScopedAssetRow[]; scope: 'mine' | 'department' | 'company'; error?: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) return { rows: [], scope: 'mine', error: 'unauthenticated' };

  const want = opts?.scope ?? 'mine';
  const canCompany =
    canMaintainRegister(employee) ||
    (await actorHas(employee, 'assets.company_view')) ||
    (await actorHas(employee, 'finance.assets'));

  let scope: 'mine' | 'department' | 'company' = 'mine';
  if (want === 'company') {
    if (!canCompany) return { rows: [], scope: 'mine', error: 'forbidden_company' };
    scope = 'company';
  } else if (want === 'department') {
    const managed = await managedDepartmentIds(employee.id);
    if (managed.length === 0 && !canCompany) {
      // Non-managers fall back to mine rather than leaking company data.
      scope = 'mine';
    } else if (canCompany && managed.length === 0) {
      scope = 'company';
    } else {
      scope = 'department';
    }
  }

  const db = getDb();
  const custodian = alias(employees, 'scope_custodian');
  const jobDepartment = alias(departments, 'job_dept');
  const custodyDepartment = alias(departments, 'custody_dept');

  const conditions = [];
  if (scope === 'mine') {
    conditions.push(eq(assets.custodianEmployeeId, employee.id));
  } else if (scope === 'department') {
    const managed = await managedDepartmentIds(employee.id);
    conditions.push(
      or(
        eq(assets.custodianEmployeeId, employee.id),
        inArray(assets.custodyDepartmentId, managed),
        inArray(custodian.departmentId, managed)
      )!
    );
  }

  const q = opts?.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    conditions.push(
      or(
        sql`${assets.tag} ilike ${like}`,
        sql`${assets.name} ilike ${like}`,
        sql`${assets.itemKind} ilike ${like}`,
        sql`${assets.location} ilike ${like}`
      )!
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: assets.id,
      tag: assets.tag,
      name: assets.name,
      quantity: assets.quantity,
      itemKind: assets.itemKind,
      location: assets.location,
      status: assets.status,
      remark: assets.remark,
      custodianEmployeeId: assets.custodianEmployeeId,
      custodianName: custodian.name,
      custodyDepartmentId: assets.custodyDepartmentId,
      custodyDepartmentName: custodyDepartment.name,
      custodianJobDepartmentName: jobDepartment.name,
    })
    .from(assets)
    .innerJoin(custodian, eq(custodian.id, assets.custodianEmployeeId))
    .innerJoin(jobDepartment, eq(jobDepartment.id, custodian.departmentId))
    .leftJoin(custodyDepartment, eq(custodyDepartment.id, assets.custodyDepartmentId))
    .where(where)
    .orderBy(asc(assets.tag))
    .limit(2000);

  return {
    scope,
    rows: rows.map((r) => ({ ...r, status: r.status as AssetStatus })),
  };
}

/** Server-side lookup for AI tools — always scoped. */
export async function searchAssetsForAi(input: {
  employeeId: string;
  role: string;
  q?: string;
  scope?: 'mine' | 'department' | 'company';
  limit?: number;
}): Promise<Array<{ tag: string; name: string; itemKind: string | null; location: string; status: string; custodianName: string }>> {
  // Temporarily set context via direct query mirroring listAssetsForCurrentUser rules.
  const actor = { id: input.employeeId, role: input.role };
  const canCompany =
    canMaintainRegister(actor) ||
    (await actorHas(actor, 'assets.company_view')) ||
    (await actorHas(actor, 'finance.assets'));

  const db = getDb();
  const custodian = alias(employees, 'ai_custodian');
  const managed = await managedDepartmentIds(input.employeeId);

  let scope = input.scope ?? 'mine';
  if (scope === 'company' && !canCompany) scope = 'mine';
  if (scope === 'department' && managed.length === 0) scope = canCompany ? 'company' : 'mine';

  const conditions = [];
  if (scope === 'mine') conditions.push(eq(assets.custodianEmployeeId, input.employeeId));
  else if (scope === 'department') {
    conditions.push(
      or(
        eq(assets.custodianEmployeeId, input.employeeId),
        inArray(assets.custodyDepartmentId, managed),
        inArray(custodian.departmentId, managed)
      )!
    );
  }

  const q = input.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    conditions.push(
      or(
        sql`${assets.tag} ilike ${like}`,
        sql`${assets.name} ilike ${like}`,
        sql`${assets.itemKind} ilike ${like}`,
        sql`${assets.location} ilike ${like}`
      )!
    );
  }

  const rows = await db
    .select({
      tag: assets.tag,
      name: assets.name,
      itemKind: assets.itemKind,
      location: assets.location,
      status: assets.status,
      custodianName: custodian.name,
    })
    .from(assets)
    .innerJoin(custodian, eq(custodian.id, assets.custodianEmployeeId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(assets.tag))
    .limit(Math.min(input.limit ?? 30, 50));

  return rows;
}
