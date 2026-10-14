import { and, asc, count, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { parseFlow } from '@/lib/approval/flow/parse';
import { flowReferences, type FlowReferences } from '@/lib/approval/flow/references';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import type { Db } from '@/lib/db';
import {
  approvalDelegations,
  departments,
  employeeGroupMembers,
  employeeGroups,
  employeeJobRoles,
  employees,
  formDefinitions,
  jobRoles,
  orgLevels,
} from '@/lib/db/schema';
import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { taipeiToday } from '@/lib/taipei-date';
import { abort, runInTransaction, type ErrorCode, type Tx } from '@/lib/workflow/tx';
import {
  delegationsOverlap,
  parseDelegation,
  parseDepartment,
  parseGroup,
  parseJobRole,
  parseLevel,
  parseMemberIds,
  subtreeOf,
  type Parsed,
} from './validate';

/**
 * Organisation settings behind the approval flows: levels, departments, job
 * roles, groups and delegations. Admin only, with a login in the last hour;
 * changes are serialised, re-check the actor inside the transaction and are
 * audited with before/after values. Nothing a live flow names can be removed
 * or switched off (published versions and versions of open submissions).
 */

export type OrgActor = { id: string; role: string; authenticatedAt: Date } | null;
export type OrgFailure = { ok: false; code: ErrorCode | 'reauth_required' | 'rate_limited'; error: string };
export type OrgResult<T extends object = object> = ({ ok: true } & T) | OrgFailure;

export const ORG_RECENT_AUTH_MS = 60 * 60_000;

async function guard(actor: OrgActor, requireRecentLogin = true): Promise<OrgFailure | null> {
  if (!actor || actor.role !== 'admin') return { ok: false, code: 'forbidden', error: '只有系統管理員可以修改組織設定' };
  if (requireRecentLogin && Date.now() - actor.authenticatedAt.getTime() > ORG_RECENT_AUTH_MS) {
    return { ok: false, code: 'reauth_required', error: '修改組織設定需要 1 小時內登入過，請重新登入後再試' };
  }
  const limit = await hitRateLimit(`org-admin:${actor.id}`, RATE_LIMITS.orgAdminActionPerEmployee);
  return limit.allowed ? null : { ok: false, code: 'rate_limited', error: '操作過於頻繁，請稍後再試' };
}

export { guard as orgGuard };

async function run<T extends object>(actor: OrgActor, label: string, work: (tx: Tx, actorId: string) => Promise<T>): Promise<OrgResult<T>> {
  const denied = await guard(actor);
  if (denied) return denied;
  return runInTransaction(`org.${label}`, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('accsys.org.admin'))`);
    const [me] = await tx.select({ role: employees.role, active: employees.accessEnabled }).from(employees).where(eq(employees.id, actor!.id));
    if (me?.role !== 'admin' || !me.active) abort('forbidden', '只有系統管理員可以修改組織設定');
    return { ok: true as const, ...(await work(tx, actor!.id)) };
  });
}

function need<T>(p: Parsed<T>): T {
  if (!p.ok) abort('validation', p.error);
  return (p as { ok: true; value: T }).value;
}

function needId(v: unknown): string {
  if (!isUuid(v)) abort('not_found', '找不到資料，請重新整理');
  return v as string;
}

const audit = (tx: Tx, actorId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) =>
  recordAudit(tx, { actorEmployeeId: actorId, action, entityType, entityId, details });

// ---------------------------------------------------------------------------
// What live flows use
// ---------------------------------------------------------------------------

export type InUse = Record<keyof FlowReferences, Map<string, string[]>>;

/** Form names by referenced id / code, over published versions and versions of open submissions. */
export async function referencesInUse(db: Pick<Db, 'execute'>): Promise<InUse> {
  const rows = await db.execute<{ name: string; flow: unknown }>(sql`
    select d.name, v.flow
      from form_definitions d join form_definition_versions v on v.id = d.published_version_id
     where d.status = 'published'
    union all
    select d.name, v.flow
      from form_definition_versions v join form_definitions d on d.id = v.definition_id
     where v.id in (select s.version_id from form_submissions s where s.status in ('pending_approval', 'returned'))`);
  const out: InUse = { employees: new Map(), departments: new Map(), groups: new Map(), roles: new Map(), levels: new Map() };
  for (const row of rows) {
    const parsed = parseFlow(row.flow);
    if (!parsed.ok) continue;
    const refs = flowReferences(parsed.flow);
    for (const kind of Object.keys(out) as (keyof InUse)[]) {
      for (const id of refs[kind]) {
        const names = out[kind].get(id) ?? [];
        if (!names.includes(row.name)) names.push(row.name);
        out[kind].set(id, names);
      }
    }
  }
  return out;
}

async function assertUnused(tx: Tx, kind: keyof InUse, id: string, what: string) {
  const forms = (await referencesInUse(tx))[kind].get(id);
  if (forms && forms.length > 0) {
    abort('conflict', `${what}正被「${forms.slice(0, 3).join('」「')}」${forms.length > 3 ? '等表單' : ''}的簽核流程使用，請先調整流程`);
  }
}

// ---------------------------------------------------------------------------
// Org levels
// ---------------------------------------------------------------------------

export function createLevel(actor: OrgActor, raw: unknown) {
  return run(actor, 'level.create', async (tx, actorId) => {
    const v = need(parseLevel(raw, true));
    const clash = await tx.select({ code: orgLevels.code }).from(orgLevels).where(or(eq(orgLevels.code, v.code), eq(orgLevels.rank, v.rank)));
    if (clash.some((c) => c.code === v.code)) abort('conflict', '層級代號已存在');
    if (clash.length > 0) abort('conflict', '已有相同高低數字的層級，請換一個數字');
    const [row] = await tx.insert(orgLevels).values(v).returning({ id: orgLevels.id });
    await audit(tx, actorId, 'org.level.created', 'org_level', row.id, v);
    return { id: row.id };
  });
}

export function updateLevel(actor: OrgActor, id: unknown, raw: unknown) {
  return run(actor, 'level.update', async (tx, actorId) => {
    const levelId = needId(id);
    const v = need(parseLevel(raw, false));
    const [before] = await tx.select().from(orgLevels).where(eq(orgLevels.id, levelId)).for('update');
    if (!before) abort('not_found', '找不到這個層級');
    const [clash] = await tx.select({ id: orgLevels.id }).from(orgLevels).where(and(eq(orgLevels.rank, v.rank), ne(orgLevels.id, levelId)));
    if (clash) abort('conflict', '已有相同高低數字的層級，請換一個數字');
    await tx.update(orgLevels).set({ name: v.name, rank: v.rank }).where(eq(orgLevels.id, levelId));
    await audit(tx, actorId, 'org.level.updated', 'org_level', levelId, {
      code: before.code,
      before: { name: before.name, rank: before.rank },
      after: { name: v.name, rank: v.rank },
    });
    return {};
  });
}

export function deleteLevel(actor: OrgActor, id: unknown) {
  return run(actor, 'level.delete', async (tx, actorId) => {
    const levelId = needId(id);
    const [level] = await tx.select().from(orgLevels).where(eq(orgLevels.id, levelId)).for('update');
    if (!level) abort('not_found', '找不到這個層級');
    const [{ n }] = await tx.select({ n: count() }).from(departments).where(eq(departments.orgLevelId, levelId));
    if (n > 0) abort('conflict', `還有 ${n} 個部門設定為此層級，請先調整部門`);
    await assertUnused(tx, 'levels', level.code, `層級「${level.name}」`);
    await tx.delete(orgLevels).where(eq(orgLevels.id, levelId));
    await audit(tx, actorId, 'org.level.deleted', 'org_level', levelId, { code: level.code, name: level.name, rank: level.rank });
    return {};
  });
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

async function activeEmployee(tx: Tx, id: string, what: string) {
  const [e] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), eq(employees.accessEnabled, true)));
  if (!e) abort('validation', `${what}不存在或已停用`);
}

export function saveDepartment(actor: OrgActor, id: unknown, raw: unknown) {
  const creating = id === null || id === undefined || id === '';
  return run(actor, creating ? 'department.create' : 'department.update', async (tx, actorId) => {
    const v = need(parseDepartment(raw, creating));
    const all = await tx.select({ id: departments.id, parentId: departments.parentDepartmentId, active: departments.active }).from(departments);
    let before: typeof departments.$inferSelect | undefined;
    if (!creating) {
      [before] = await tx.select().from(departments).where(eq(departments.id, needId(id))).for('update');
      if (!before) abort('not_found', '找不到這個部門');
    } else {
      const [dup] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.code, v.code));
      if (dup) abort('conflict', '部門代號已存在');
    }
    if (v.parentId) {
      const parent = all.find((d) => d.id === v.parentId);
      if (!parent || !parent.active) abort('validation', '上層部門不存在或已停用');
      if (before && subtreeOf(before.id, all).has(v.parentId)) abort('validation', '上層部門不能是自己或自己的下層部門');
    }
    if (v.orgLevelId) {
      const [level] = await tx.select({ id: orgLevels.id }).from(orgLevels).where(eq(orgLevels.id, v.orgLevelId));
      if (!level) abort('validation', '組織層級不存在');
    }
    if (v.managerId) await activeEmployee(tx, v.managerId, '部門主管');

    const values = {
      name: v.name,
      parentDepartmentId: v.parentId,
      orgLevelId: v.orgLevelId,
      managerEmployeeId: v.managerId,
      sortOrder: v.sortOrder,
    };
    if (before) {
      await tx.update(departments).set(values).where(eq(departments.id, before.id));
      await audit(tx, actorId, 'org.department.updated', 'department', before.id, {
        code: before.code,
        before: {
          name: before.name,
          parentDepartmentId: before.parentDepartmentId,
          orgLevelId: before.orgLevelId,
          managerEmployeeId: before.managerEmployeeId,
          sortOrder: before.sortOrder,
        },
        after: values,
      });
      return { id: before.id };
    }
    const [row] = await tx.insert(departments).values({ code: v.code, ...values }).returning({ id: departments.id });
    await audit(tx, actorId, 'org.department.created', 'department', row.id, { code: v.code, ...values });
    return { id: row.id };
  });
}

export function setDepartmentActive(actor: OrgActor, id: unknown, active: unknown) {
  return run(actor, 'department.active', async (tx, actorId) => {
    const deptId = needId(id);
    if (typeof active !== 'boolean') abort('validation', '操作不正確');
    const [dept] = await tx.select().from(departments).where(eq(departments.id, deptId)).for('update');
    if (!dept) abort('not_found', '找不到這個部門');
    if (dept.active === active) return {};
    if (!active) {
      const [{ people }] = await tx
        .select({ people: count() })
        .from(employees)
        .where(and(eq(employees.departmentId, deptId), eq(employees.accessEnabled, true)));
      if (people > 0) abort('conflict', `部門還有 ${people} 位在職員工，請先調整員工的部門`);
      const [{ children }] = await tx
        .select({ children: count() })
        .from(departments)
        .where(and(eq(departments.parentDepartmentId, deptId), eq(departments.active, true)));
      if (children > 0) abort('conflict', `部門還有 ${children} 個啟用中的下層部門，請先停用或移走`);
      await assertUnused(tx, 'departments', deptId, `部門「${dept.name}」`);
    } else if (dept.parentDepartmentId) {
      const [parent] = await tx.select({ active: departments.active }).from(departments).where(eq(departments.id, dept.parentDepartmentId));
      if (!parent?.active) abort('conflict', '上層部門已停用，請先啟用上層部門或改掛其他部門');
    }
    await tx.update(departments).set({ active }).where(eq(departments.id, deptId));
    await audit(tx, actorId, active ? 'org.department.activated' : 'org.department.deactivated', 'department', deptId, { code: dept.code, name: dept.name });
    return {};
  });
}

// ---------------------------------------------------------------------------
// Job roles and holders
// ---------------------------------------------------------------------------

const SYSTEM_FLAG = { general_manager: 'isGeneralManager', chairman: 'isChairman' } as const;
type SystemCode = keyof typeof SYSTEM_FLAG;
const isSystemCode = (code: string): code is SystemCode => code in SYSTEM_FLAG;

async function lockRole(tx: Tx, id: unknown) {
  const [role] = await tx.select().from(jobRoles).where(eq(jobRoles.id, needId(id))).for('update');
  if (!role) abort('not_found', '找不到這個職務類別');
  return role!;
}

export function saveJobRole(actor: OrgActor, id: unknown, raw: unknown) {
  const creating = id === null || id === undefined || id === '';
  return run(actor, creating ? 'job_role.create' : 'job_role.update', async (tx, actorId) => {
    const v = need(parseJobRole(raw, creating));
    if (creating) {
      const [dup] = await tx.select({ id: jobRoles.id }).from(jobRoles).where(eq(jobRoles.code, v.code));
      if (dup) abort('conflict', '職務代號已存在');
      const [row] = await tx.insert(jobRoles).values({ code: v.code, name: v.name, description: v.description || null }).returning({ id: jobRoles.id });
      await audit(tx, actorId, 'org.job_role.created', 'job_role', row.id, v);
      return { id: row.id };
    }
    const role = await lockRole(tx, id);
    if (role.isSystem) abort('forbidden', '系統內建的職務類別不能修改');
    await tx.update(jobRoles).set({ name: v.name, description: v.description || null }).where(eq(jobRoles.id, role.id));
    await audit(tx, actorId, 'org.job_role.updated', 'job_role', role.id, {
      code: role.code,
      before: { name: role.name, description: role.description },
      after: { name: v.name, description: v.description || null },
    });
    return { id: role.id };
  });
}

export function setJobRoleActive(actor: OrgActor, id: unknown, active: unknown) {
  return run(actor, 'job_role.active', async (tx, actorId) => {
    if (typeof active !== 'boolean') abort('validation', '操作不正確');
    const role = await lockRole(tx, id);
    if (role.isSystem) abort('forbidden', '系統內建的職務類別不能停用');
    if (role.active === active) return {};
    if (!active) await assertUnused(tx, 'roles', role.code, `職務類別「${role.name}」`);
    await tx.update(jobRoles).set({ active }).where(eq(jobRoles.id, role.id));
    await audit(tx, actorId, active ? 'org.job_role.activated' : 'org.job_role.deactivated', 'job_role', role.id, { code: role.code });
    return {};
  });
}

const sameScope = (departmentId: string | null) =>
  departmentId === null ? isNull(employeeJobRoles.departmentId) : eq(employeeJobRoles.departmentId, departmentId);

/**
 * Adds a holder. 總經理／董事長 are set through the employee flags (the legacy
 * approval chains read them; a trigger keeps the role bindings in step).
 * The first holder of a role in a scope becomes its primary holder.
 */
export function addRoleHolder(actor: OrgActor, raw: unknown) {
  return run(actor, 'job_role.holder_add', async (tx, actorId) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const role = await lockRole(tx, r.jobRoleId);
    if (!isUuid(r.employeeId)) abort('validation', '請選擇員工');
    const employeeId = r.employeeId as string;
    const departmentId = r.departmentId === null || r.departmentId === undefined || r.departmentId === '' ? null : needId(r.departmentId);
    await activeEmployee(tx, employeeId, '員工');

    if (isSystemCode(role.code)) {
      if (departmentId) abort('validation', `${role.name}只能設定為全公司`);
      const flag = SYSTEM_FLAG[role.code];
      const [emp] = await tx.select({ on: employees[flag] }).from(employees).where(eq(employees.id, employeeId)).for('update');
      if (emp.on) abort('conflict', `這位員工已經是${role.name}`);
      await tx.update(employees).set({ [flag]: true }).where(eq(employees.id, employeeId));
      await audit(tx, actorId, 'org.job_role.holder_added', 'job_role', role.id, { code: role.code, employeeId, departmentId: null });
      return {};
    }

    if (departmentId) {
      const [dept] = await tx.select({ active: departments.active }).from(departments).where(eq(departments.id, departmentId));
      if (!dept?.active) abort('validation', '部門不存在或已停用');
    }
    const holders = await tx
      .select({ employeeId: employeeJobRoles.employeeId })
      .from(employeeJobRoles)
      .where(and(eq(employeeJobRoles.jobRoleId, role.id), sameScope(departmentId)));
    if (holders.some((h) => h.employeeId === employeeId)) abort('conflict', '這位員工已經擔任此職務');
    const [row] = await tx
      .insert(employeeJobRoles)
      .values({ employeeId, jobRoleId: role.id, departmentId, isPrimary: holders.length === 0 })
      .returning({ id: employeeJobRoles.id });
    await audit(tx, actorId, 'org.job_role.holder_added', 'job_role', role.id, { code: role.code, bindingId: row.id, employeeId, departmentId });
    return {};
  });
}

async function lockBinding(tx: Tx, id: unknown) {
  const [b] = await tx
    .select({ binding: employeeJobRoles, role: jobRoles })
    .from(employeeJobRoles)
    .innerJoin(jobRoles, eq(jobRoles.id, employeeJobRoles.jobRoleId))
    .where(eq(employeeJobRoles.id, needId(id)))
    .for('update', { of: employeeJobRoles });
  if (!b) abort('not_found', '找不到這筆職務設定，請重新整理');
  return b!;
}

export function removeRoleHolder(actor: OrgActor, bindingId: unknown) {
  return run(actor, 'job_role.holder_remove', async (tx, actorId) => {
    const { binding, role } = await lockBinding(tx, bindingId);
    const holders = await tx
      .select({ id: employeeJobRoles.id, employeeId: employeeJobRoles.employeeId, active: employees.accessEnabled })
      .from(employeeJobRoles)
      .innerJoin(employees, eq(employees.id, employeeJobRoles.employeeId))
      .where(eq(employeeJobRoles.jobRoleId, role.id))
      .orderBy(asc(employeeJobRoles.createdAt), asc(employeeJobRoles.id));
    const othersActive = holders.filter((h) => h.id !== binding.id && h.active).length;

    if (isSystemCode(role.code)) {
      if (othersActive === 0) abort('conflict', `至少要保留一位在職的${role.name}（既有表單的簽核需要）`);
      await tx.update(employees).set({ [SYSTEM_FLAG[role.code]]: false }).where(eq(employees.id, binding.employeeId));
    } else {
      if (othersActive === 0 && (await referencesInUse(tx)).roles.has(role.code)) {
        abort('conflict', `「${role.name}」正被簽核流程使用，不能移除最後一位在職的擔任者`);
      }
      await tx.delete(employeeJobRoles).where(eq(employeeJobRoles.id, binding.id));
      if (binding.isPrimary) {
        const [next] = await tx
          .select({ id: employeeJobRoles.id })
          .from(employeeJobRoles)
          .where(and(eq(employeeJobRoles.jobRoleId, role.id), sameScope(binding.departmentId)))
          .orderBy(asc(employeeJobRoles.createdAt), asc(employeeJobRoles.id))
          .limit(1);
        if (next) await tx.update(employeeJobRoles).set({ isPrimary: true }).where(eq(employeeJobRoles.id, next.id));
      }
    }
    await audit(tx, actorId, 'org.job_role.holder_removed', 'job_role', role.id, {
      code: role.code,
      bindingId: binding.id,
      employeeId: binding.employeeId,
      departmentId: binding.departmentId,
    });
    return {};
  });
}

export function setPrimaryHolder(actor: OrgActor, bindingId: unknown) {
  return run(actor, 'job_role.primary', async (tx, actorId) => {
    const { binding, role } = await lockBinding(tx, bindingId);
    if (role.isSystem) abort('forbidden', `${role.name}的主要人員依建立順序決定，不能手動指定`);
    if (binding.isPrimary) return {};
    await tx
      .update(employeeJobRoles)
      .set({ isPrimary: false })
      .where(and(eq(employeeJobRoles.jobRoleId, role.id), sameScope(binding.departmentId), eq(employeeJobRoles.isPrimary, true)));
    await tx.update(employeeJobRoles).set({ isPrimary: true }).where(eq(employeeJobRoles.id, binding.id));
    await audit(tx, actorId, 'org.job_role.primary_set', 'job_role', role.id, {
      code: role.code,
      bindingId: binding.id,
      employeeId: binding.employeeId,
      departmentId: binding.departmentId,
    });
    return {};
  });
}

// ---------------------------------------------------------------------------
// Employee groups
// ---------------------------------------------------------------------------

async function lockGroup(tx: Tx, id: unknown) {
  const [g] = await tx.select().from(employeeGroups).where(eq(employeeGroups.id, needId(id))).for('update');
  if (!g) abort('not_found', '找不到這個群組');
  return g!;
}

export function saveGroup(actor: OrgActor, id: unknown, raw: unknown) {
  const creating = id === null || id === undefined || id === '';
  return run(actor, creating ? 'group.create' : 'group.update', async (tx, actorId) => {
    const v = need(parseGroup(raw));
    const group = creating ? null : await lockGroup(tx, id);
    const [dup] = await tx
      .select({ id: employeeGroups.id })
      .from(employeeGroups)
      .where(group ? and(eq(employeeGroups.name, v.name), ne(employeeGroups.id, group.id)) : eq(employeeGroups.name, v.name));
    if (dup) abort('conflict', '群組名稱已存在');
    if (!group) {
      const [row] = await tx.insert(employeeGroups).values({ name: v.name, description: v.description || null }).returning({ id: employeeGroups.id });
      await audit(tx, actorId, 'org.group.created', 'employee_group', row.id, v);
      return { id: row.id };
    }
    await tx.update(employeeGroups).set({ name: v.name, description: v.description || null }).where(eq(employeeGroups.id, group.id));
    await audit(tx, actorId, 'org.group.updated', 'employee_group', group.id, {
      before: { name: group.name, description: group.description },
      after: { name: v.name, description: v.description || null },
    });
    return { id: group.id };
  });
}

export function setGroupActive(actor: OrgActor, id: unknown, active: unknown) {
  return run(actor, 'group.active', async (tx, actorId) => {
    if (typeof active !== 'boolean') abort('validation', '操作不正確');
    const group = await lockGroup(tx, id);
    if (group.active === active) return {};
    if (!active) await assertUnused(tx, 'groups', group.id, `群組「${group.name}」`);
    await tx.update(employeeGroups).set({ active }).where(eq(employeeGroups.id, group.id));
    await audit(tx, actorId, active ? 'org.group.activated' : 'org.group.deactivated', 'employee_group', group.id, { name: group.name });
    return {};
  });
}

/** Replaces the members with `employeeIds`, in that signing order. */
export function setGroupMembers(actor: OrgActor, id: unknown, employeeIds: unknown) {
  return run(actor, 'group.members', async (tx, actorId) => {
    const group = await lockGroup(tx, id);
    const ids = need(parseMemberIds(employeeIds));
    if (ids.length > 0) {
      const found = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(inArray(employees.id, ids), eq(employees.accessEnabled, true)));
      if (found.length !== ids.length) abort('validation', '有成員不存在或已停用，請重新整理');
    } else if ((await referencesInUse(tx)).groups.has(group.id)) {
      abort('conflict', `群組「${group.name}」正被簽核流程使用，至少要保留一位成員`);
    }
    const before = await tx
      .select({ employeeId: employeeGroupMembers.employeeId })
      .from(employeeGroupMembers)
      .where(eq(employeeGroupMembers.groupId, group.id))
      .orderBy(asc(employeeGroupMembers.sortOrder), asc(employeeGroupMembers.employeeId));
    await tx.delete(employeeGroupMembers).where(eq(employeeGroupMembers.groupId, group.id));
    if (ids.length > 0) {
      await tx.insert(employeeGroupMembers).values(ids.map((employeeId, i) => ({ groupId: group.id, employeeId, sortOrder: (i + 1) * 10 })));
    }
    await audit(tx, actorId, 'org.group.members_set', 'employee_group', group.id, {
      before: before.map((m) => m.employeeId),
      after: ids,
    });
    return {};
  });
}

// ---------------------------------------------------------------------------
// Delegations
// ---------------------------------------------------------------------------

/**
 * One hop only: the delegate's own delegation is not followed, so a delegate
 * who is away at the same time is refused instead of silently receiving steps.
 */
export function createDelegation(actor: OrgActor, raw: unknown) {
  return run(actor, 'delegation.create', async (tx, actorId) => {
    const today = taipeiToday();
    const v = need(parseDelegation(raw, today));
    await activeEmployee(tx, v.delegatorId, '被代理人');
    await activeEmployee(tx, v.delegateId, '代理人');
    if (v.formKeys) {
      const found = await tx.select({ key: formDefinitions.key }).from(formDefinitions).where(inArray(formDefinitions.key, v.formKeys));
      if (found.length !== v.formKeys.length) abort('validation', '選擇的表單不存在，請重新整理');
    }
    const open = await tx
      .select({
        delegatorId: approvalDelegations.delegatorEmployeeId,
        delegateId: approvalDelegations.delegateEmployeeId,
        startsOn: approvalDelegations.startsOn,
        endsOn: approvalDelegations.endsOn,
        formKeys: approvalDelegations.formKeys,
      })
      .from(approvalDelegations)
      .where(
        and(
          isNull(approvalDelegations.revokedAt),
          gte(approvalDelegations.endsOn, today),
          or(
            inArray(approvalDelegations.delegatorEmployeeId, [v.delegatorId, v.delegateId]),
            eq(approvalDelegations.delegateEmployeeId, v.delegatorId)
          )
        )
      );
    for (const d of open) {
      if (!delegationsOverlap(d, v)) continue;
      if (d.delegatorId === v.delegatorId) abort('conflict', `與既有的代理設定重疊（${d.startsOn}～${d.endsOn}），請先撤銷該設定`);
      if (d.delegatorId === v.delegateId) abort('conflict', `代理人在這段期間（${d.startsOn}～${d.endsOn}）也設定了代理，請改選其他代理人`);
      if (d.delegateId === v.delegatorId) abort('conflict', `被代理人在這段期間（${d.startsOn}～${d.endsOn}）正在代理別人，請先調整該設定`);
    }
    const [row] = await tx
      .insert(approvalDelegations)
      .values({
        delegatorEmployeeId: v.delegatorId,
        delegateEmployeeId: v.delegateId,
        startsOn: v.startsOn,
        endsOn: v.endsOn,
        formKeys: v.formKeys,
        reason: v.reason || null,
        createdByEmployeeId: actorId,
      })
      .returning({ id: approvalDelegations.id });
    await audit(tx, actorId, 'org.delegation.created', 'approval_delegation', row.id, { ...v });
    return { id: row.id };
  });
}

export function revokeDelegation(actor: OrgActor, id: unknown) {
  return run(actor, 'delegation.revoke', async (tx, actorId) => {
    const [d] = await tx.select().from(approvalDelegations).where(eq(approvalDelegations.id, needId(id))).for('update');
    if (!d) abort('not_found', '找不到這筆代理設定');
    if (d.revokedAt) abort('conflict', '這筆代理設定已撤銷');
    await tx.update(approvalDelegations).set({ revokedAt: sql`now()` }).where(eq(approvalDelegations.id, d.id));
    await audit(tx, actorId, 'org.delegation.revoked', 'approval_delegation', d.id, {
      delegatorId: d.delegatorEmployeeId,
      delegateId: d.delegateEmployeeId,
      startsOn: d.startsOn,
      endsOn: d.endsOn,
    });
    return {};
  });
}
