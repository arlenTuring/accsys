import { and, asc, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { getPickerOptions, type PickerOptions } from '@/lib/custom-forms/queries';
import type { FormSchema } from '@/lib/custom-forms/schema';
import { getDb } from '@/lib/db';
import {
  approvalDelegations,
  departments,
  employeeGroupMembers,
  employeeGroups,
  employeeJobRoles,
  employees,
  formDefinitions,
  formDefinitionVersions,
  jobRoles,
  orgLevels,
} from '@/lib/db/schema';
import { addDays } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';
import { referencesInUse } from './service';
import { simulationInputs, type SimInput } from './simulate';

export type OrgLevelRow = { id: string; code: string; name: string; rank: number; departmentCount: number };
export type OrgDepartmentRow = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  orgLevelId: string | null;
  managerId: string | null;
  sortOrder: number;
  active: boolean;
  employeeCount: number;
};
export type OrgEmployeeRow = { id: string; code: string; name: string; departmentId: string; active: boolean };
export type OrgRoleHolder = { bindingId: string; employeeId: string; departmentId: string | null; isPrimary: boolean };
export type OrgJobRoleRow = { id: string; code: string; name: string; description: string; isSystem: boolean; active: boolean; holders: OrgRoleHolder[] };
export type OrgGroupRow = { id: string; name: string; description: string; active: boolean; memberIds: string[] };
export type DelegationStatus = 'active' | 'scheduled' | 'ended' | 'revoked';
export type OrgDelegationRow = {
  id: string;
  delegatorId: string;
  delegateId: string;
  startsOn: string;
  endsOn: string;
  formKeys: string[] | null;
  reason: string;
  createdByName: string;
  createdAt: Date;
  status: DelegationStatus;
};

/** Forms whose live flows name each level code / department / role code / group id. */
export type OrgInUse = Record<'levels' | 'departments' | 'roles' | 'groups', Record<string, string[]>>;

export type OrgDirectory = {
  today: string;
  levels: OrgLevelRow[];
  departments: OrgDepartmentRow[];
  employees: OrgEmployeeRow[];
  jobRoles: OrgJobRoleRow[];
  groups: OrgGroupRow[];
  delegations: OrgDelegationRow[];
  forms: { key: string; name: string }[];
  inUse: OrgInUse;
};

async function requireAdmin() {
  const me = await getCurrentEmployee();
  return me?.role === 'admin' ? me : null;
}

/** Everything the organisation screens show, or null for non-admins. */
export async function getOrgDirectory(): Promise<OrgDirectory | null> {
  if (!(await requireAdmin())) return null;
  const db = getDb();
  const today = taipeiToday();
  const creator = alias(employees, 'creator');
  const [levels, depts, emps, roles, bindings, groups, members, delegations, forms, inUse] = await Promise.all([
    db.select({ id: orgLevels.id, code: orgLevels.code, name: orgLevels.name, rank: orgLevels.rank }).from(orgLevels).orderBy(desc(orgLevels.rank)),
    db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        parentId: departments.parentDepartmentId,
        orgLevelId: departments.orgLevelId,
        managerId: departments.managerEmployeeId,
        sortOrder: departments.sortOrder,
        active: departments.active,
      })
      .from(departments)
      .orderBy(asc(departments.sortOrder), asc(departments.name)),
    db
      .select({ id: employees.id, code: employees.employeeCode, name: employees.name, departmentId: employees.departmentId, active: employees.accessEnabled })
      .from(employees)
      .orderBy(asc(employees.name)),
    db.select().from(jobRoles).orderBy(desc(jobRoles.isSystem), asc(jobRoles.name)),
    db
      .select({
        bindingId: employeeJobRoles.id,
        jobRoleId: employeeJobRoles.jobRoleId,
        employeeId: employeeJobRoles.employeeId,
        departmentId: employeeJobRoles.departmentId,
        isPrimary: employeeJobRoles.isPrimary,
      })
      .from(employeeJobRoles)
      .orderBy(asc(employeeJobRoles.createdAt), asc(employeeJobRoles.id)),
    db.select().from(employeeGroups).orderBy(asc(employeeGroups.name)),
    db
      .select({ groupId: employeeGroupMembers.groupId, employeeId: employeeGroupMembers.employeeId })
      .from(employeeGroupMembers)
      .orderBy(asc(employeeGroupMembers.sortOrder), asc(employeeGroupMembers.employeeId)),
    db
      .select({ d: approvalDelegations, createdByName: creator.name })
      .from(approvalDelegations)
      .innerJoin(creator, eq(creator.id, approvalDelegations.createdByEmployeeId))
      .where(
        or(
          and(isNull(approvalDelegations.revokedAt), gte(approvalDelegations.endsOn, addDays(today, -90))),
          gte(approvalDelegations.revokedAt, sql`now() - interval '90 days'`)
        )
      )
      .orderBy(desc(approvalDelegations.createdAt))
      .limit(200),
    db.select({ key: formDefinitions.key, name: formDefinitions.name }).from(formDefinitions).orderBy(asc(formDefinitions.name)),
    referencesInUse(db),
  ]);

  const toRecord = (m: Map<string, string[]>) => Object.fromEntries(m);
  return {
    today,
    levels: levels.map((l) => ({ ...l, departmentCount: depts.filter((d) => d.orgLevelId === l.id).length })),
    departments: depts.map((d) => ({ ...d, employeeCount: emps.filter((e) => e.active && e.departmentId === d.id).length })),
    employees: emps,
    jobRoles: roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description ?? '',
      isSystem: r.isSystem,
      active: r.active,
      holders: bindings
        .filter((b) => b.jobRoleId === r.id)
        .map((b) => ({ bindingId: b.bindingId, employeeId: b.employeeId, departmentId: b.departmentId, isPrimary: b.isPrimary })),
    })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description ?? '',
      active: g.active,
      memberIds: members.filter((m) => m.groupId === g.id).map((m) => m.employeeId),
    })),
    delegations: delegations.map(({ d, createdByName }) => ({
      id: d.id,
      delegatorId: d.delegatorEmployeeId,
      delegateId: d.delegateEmployeeId,
      startsOn: d.startsOn,
      endsOn: d.endsOn,
      formKeys: d.formKeys,
      reason: d.reason ?? '',
      createdByName,
      createdAt: d.createdAt,
      status: d.revokedAt ? 'revoked' : d.endsOn < today ? 'ended' : d.startsOn > today ? 'scheduled' : 'active',
    })),
    forms,
    inUse: {
      levels: toRecord(inUse.levels),
      departments: toRecord(inUse.departments),
      roles: toRecord(inUse.roles),
      groups: toRecord(inUse.groups),
    },
  };
}

export type SimulatorForm = { key: string; name: string; inputs: SimInput[] };
export type SimulatorData = { today: string; forms: SimulatorForm[]; options: PickerOptions };

/** Published forms with the inputs their flows look at, for the flow simulator. */
export async function getSimulatorData(): Promise<SimulatorData | null> {
  if (!(await requireAdmin())) return null;
  const rows = await getDb()
    .select({ key: formDefinitions.key, name: formDefinitions.name, schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
    .from(formDefinitions)
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
    .where(eq(formDefinitions.status, 'published'))
    .orderBy(asc(formDefinitions.name));
  const forms: SimulatorForm[] = [];
  const sections: FormSchema['sections'] = [];
  for (const row of rows) {
    const def = parseDefinition(row.schema, row.flow);
    if (!def.ok) continue;
    forms.push({ key: row.key, name: row.name, inputs: simulationInputs(def.schema, def.flow) });
    sections.push(...def.schema.sections);
  }
  const options = await getPickerOptions({ version: 1, sections });
  if (options.employees.length === 0) {
    const emps = await getDb()
      .select({ id: employees.id, name: employees.name, dept: departments.name })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.accessEnabled, true))
      .orderBy(asc(departments.name), asc(employees.name));
    options.employees = emps.map((e) => ({ id: e.id, label: `${e.name}（${e.dept}）` }));
  }
  return { today: taipeiToday(), forms, options };
}
