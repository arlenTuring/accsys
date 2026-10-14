import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  approvalDelegations,
  assets,
  budgetCodes,
  departments,
  employeeGroupMembers,
  employeeGroups,
  employeeJobRoles,
  employees,
  jobRoles,
  orgLevels,
} from '@/lib/db/schema';
import { abort, type Tx } from '@/lib/workflow/tx';
import { resolveFlow } from './resolve';
import type { FlowBlock, FlowContext, FlowDef, OrgSnapshot, ResolvedStep } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsIn(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is string => typeof v === 'string' && UUID.test(v));
}

/** Budget code and asset ids the flow will look up, taken from the form fields it references. */
export function referencedRecords(flow: FlowDef, fields: Record<string, unknown>) {
  const budgetCodeIds = new Set<string>();
  const assetIds = new Set<string>();
  const visit = (blocks: FlowBlock[]) => {
    for (const b of blocks) {
      if (b.type === 'condition') {
        b.branches.forEach((br) => visit(br.blocks));
        visit(b.otherwise.blocks);
      } else if (b.source.kind === 'form_party' && b.source.fieldId) {
        const target = b.source.party === 'budget_owner' ? budgetCodeIds : b.source.party === 'asset_custodian' ? assetIds : null;
        idsIn(fields[b.source.fieldId]).forEach((id) => target?.add(id));
      }
    }
  };
  visit(flow.blocks);
  return { budgetCodeIds: [...budgetCodeIds], assetIds: [...assetIds] };
}

/**
 * Reads the organisation data a flow needs, inside the caller's transaction so
 * the steps are built from the same snapshot the submission commits against.
 * The company is small (hundreds of employees), so the whole directory is read.
 */
export async function loadOrgSnapshot(
  tx: Tx,
  refs: { budgetCodeIds: string[]; assetIds: string[] },
  today: string
): Promise<OrgSnapshot> {
  const [emps, depts, levels, roles, bindings, groups, members, delegations, owners, custodians] = await Promise.all([
    tx
      .select({ id: employees.id, name: employees.name, departmentId: employees.departmentId, active: employees.accessEnabled })
      .from(employees),
    tx
      .select({
        id: departments.id,
        name: departments.name,
        parentId: departments.parentDepartmentId,
        managerId: departments.managerEmployeeId,
        levelCode: orgLevels.code,
        active: departments.active,
      })
      .from(departments)
      .leftJoin(orgLevels, eq(orgLevels.id, departments.orgLevelId)),
    tx.select({ code: orgLevels.code, name: orgLevels.name, rank: orgLevels.rank }).from(orgLevels),
    tx.select({ code: jobRoles.code, name: jobRoles.name, active: jobRoles.active }).from(jobRoles),
    tx
      .select({
        jobRole: jobRoles.code,
        departmentId: employeeJobRoles.departmentId,
        employeeId: employeeJobRoles.employeeId,
        isPrimary: employeeJobRoles.isPrimary,
      })
      .from(employeeJobRoles)
      .innerJoin(jobRoles, eq(jobRoles.id, employeeJobRoles.jobRoleId)),
    tx.select({ id: employeeGroups.id, name: employeeGroups.name, active: employeeGroups.active }).from(employeeGroups),
    tx
      .select({ groupId: employeeGroupMembers.groupId, employeeId: employeeGroupMembers.employeeId })
      .from(employeeGroupMembers)
      .orderBy(asc(employeeGroupMembers.sortOrder), asc(employeeGroupMembers.employeeId)),
    tx
      .select({
        delegatorId: approvalDelegations.delegatorEmployeeId,
        delegateId: approvalDelegations.delegateEmployeeId,
        startsOn: approvalDelegations.startsOn,
        endsOn: approvalDelegations.endsOn,
        formKeys: approvalDelegations.formKeys,
      })
      .from(approvalDelegations)
      .where(and(isNull(approvalDelegations.revokedAt), lte(approvalDelegations.startsOn, today), gte(approvalDelegations.endsOn, today)))
      .orderBy(asc(approvalDelegations.createdAt)),
    refs.budgetCodeIds.length
      ? tx.select({ id: budgetCodes.id, owner: budgetCodes.ownerEmployeeId }).from(budgetCodes).where(inArray(budgetCodes.id, refs.budgetCodeIds))
      : Promise.resolve([]),
    refs.assetIds.length
      ? tx.select({ id: assets.id, custodian: assets.custodianEmployeeId }).from(assets).where(inArray(assets.id, refs.assetIds))
      : Promise.resolve([]),
  ]);

  const memberIds = new Map<string, string[]>();
  for (const m of members) memberIds.set(m.groupId, [...(memberIds.get(m.groupId) ?? []), m.employeeId]);

  return {
    employees: new Map(emps.map((e) => [e.id, e])),
    departments: new Map(depts.map((d) => [d.id, d])),
    levels: new Map(levels.map((l) => [l.code, { name: l.name, rank: l.rank }])),
    jobRoles: new Map(roles.map((r) => [r.code, { name: r.name, active: r.active }])),
    jobRoleBindings: bindings,
    groups: new Map(groups.map((g) => [g.id, { name: g.name, active: g.active, memberIds: memberIds.get(g.id) ?? [] }])),
    delegations,
    budgetOwners: new Map(owners.map((o) => [o.id, o.owner])),
    assetCustodians: new Map(custodians.map((c) => [c.id, c.custodian])),
  };
}

/** Resolves a flow inside a submission transaction; an unresolvable flow aborts with the reason. */
export async function resolveFlowInTx(tx: Tx, flow: FlowDef, ctx: FlowContext): Promise<ResolvedStep[]> {
  const org = await loadOrgSnapshot(tx, referencedRecords(flow, ctx.fields), ctx.today);
  const result = resolveFlow(flow, ctx, org);
  if (!result.ok) abort('validation', result.error);
  return result.steps;
}
