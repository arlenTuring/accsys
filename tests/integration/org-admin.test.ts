import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLOW_OPTIONS } from '@/lib/approval/flow/types';
import { PURCHASE_ADMIN_SAMPLE } from '@/lib/custom-forms/samples';
import { addDays } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';

vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const org = () => import('@/lib/admin/org/service');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('organisation admin (/admin/org)', () => {
  let sql: Sql;
  const tag = `oa${Date.now()}`;
  const today = taipeiToday();
  // Ranks are unique and the level a published flow names can never be deleted, so vary them per run.
  const r0 = 101 + (Date.now() % 850);
  const ids = {} as Record<'admin' | 'staff' | 'root' | 'm1' | 'm2' | 'x' | 'roleHolder', string>;
  const admin = () => ({ id: ids.admin, role: 'admin', authenticatedAt: new Date() });
  const ok = <T extends { ok: boolean }>(r: T) => {
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r as Extract<T, { ok: true }>;
  };

  beforeAll(async () => {
    sql = await loadSql();
    const [anyDept] = await sql`select id from departments where active limit 1`;
    ids.root = (await sql`insert into departments (code, name) values (${tag}, '組織測試部') returning id`)[0].id;
    const employee = async (name: string, role = 'staff', deptId = ids.root) =>
      (
        await sql`insert into employees (employee_code, name, department_id, role)
          values (${`${tag}-${name}`}, ${name}, ${deptId}, ${role}) returning id`
      )[0].id as string;
    ids.admin = await employee('admin', 'admin', anyDept.id);
    ids.staff = await employee('staff');
    ids.m1 = await employee('m1');
    ids.m2 = await employee('m2');
    ids.x = await employee('x');
    ids.roleHolder = await employee('holder');
  });

  afterAll(async () => {
    await sql`delete from approval_delegations where delegator_employee_id in (${ids.m1}, ${ids.m2}, ${ids.x}, ${ids.staff})`;
    await sql`delete from rate_limit_buckets where bucket_key = ${`org-admin:${ids.admin}`}`;
  });

  it('allows only a recently signed-in admin who is still an admin in the database', async () => {
    const { createLevel } = await org();
    const input = { code: `${tag}_a`, name: '甲', rank: 900 };
    expect(await createLevel(null, input)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await createLevel({ id: ids.staff, role: 'staff', authenticatedAt: new Date() }, input)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await createLevel({ ...admin(), authenticatedAt: new Date(Date.now() - 2 * 3600_000) }, input)).toMatchObject({
      ok: false,
      code: 'reauth_required',
    });
    // A session that still claims admin after the role was taken away.
    expect(await createLevel({ id: ids.staff, role: 'admin', authenticatedAt: new Date() }, input)).toMatchObject({ ok: false, code: 'forbidden' });
    const [{ n }] = await sql`select count(*)::int as n from org_levels where code = ${input.code}`;
    expect(n).toBe(0);
  });

  it('keeps level codes and ranks unique and records audits', async () => {
    const { createLevel, updateLevel, deleteLevel } = await org();
    const a = ok(await createLevel(admin(), { code: `${tag}_team`, name: '組', rank: r0 }));
    expect(await createLevel(admin(), { code: `${tag}_team`, name: '組2', rank: r0 + 1 })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await createLevel(admin(), { code: `${tag}_other`, name: '組2', rank: r0 })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await createLevel(admin(), { code: 'Bad Code', name: '組2', rank: r0 + 2 })).toMatchObject({ ok: false, code: 'validation' });
    ok(await updateLevel(admin(), a.id, { name: '小組', rank: r0 + 3 }));
    const [audit] = await sql`select details from audit_events where action = 'org.level.updated' and entity_id = ${a.id}`;
    expect(audit.details).toMatchObject({ before: { name: '組', rank: r0 }, after: { name: '小組', rank: r0 + 3 } });

    await sql`update departments set org_level_id = ${a.id} where id = ${ids.root}`;
    expect(await deleteLevel(admin(), a.id)).toMatchObject({ ok: false, code: 'conflict' });
    await sql`update departments set org_level_id = null where id = ${ids.root}`;
    ok(await deleteLevel(admin(), a.id));
  });

  it('refuses department cycles and deactivating departments still in use', async () => {
    const { saveDepartment, setDepartmentActive } = await org();
    const parent = ok(await saveDepartment(admin(), null, { code: `${tag}-P`, name: '上層', parentId: ids.root, managerId: ids.m1 }));
    const child = ok(await saveDepartment(admin(), null, { code: `${tag}-C`, name: '下層', parentId: parent.id }));
    expect(await saveDepartment(admin(), null, { code: `${tag}-P`, name: '重複' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await saveDepartment(admin(), parent.id, { name: '上層', parentId: child.id })).toMatchObject({ ok: false, code: 'validation' });
    expect(await saveDepartment(admin(), parent.id, { name: '上層', parentId: parent.id })).toMatchObject({ ok: false, code: 'validation' });
    expect(await saveDepartment(admin(), parent.id, { name: '上層', managerId: crypto.randomUUID() })).toMatchObject({ ok: false, code: 'validation' });

    expect(await setDepartmentActive(admin(), parent.id, false)).toMatchObject({ ok: false, code: 'conflict' });
    expect(await setDepartmentActive(admin(), ids.root, false)).toMatchObject({ ok: false, code: 'conflict' });
    ok(await setDepartmentActive(admin(), child.id, false));
    ok(await setDepartmentActive(admin(), parent.id, false));
    expect(await setDepartmentActive(admin(), child.id, true)).toMatchObject({ ok: false, code: 'conflict' });
    ok(await setDepartmentActive(admin(), parent.id, true));
    ok(await setDepartmentActive(admin(), child.id, true));
    const [row] = await sql`select parent_department_id, manager_employee_id from departments where id = ${parent.id}`;
    expect(row).toEqual({ parent_department_id: ids.root, manager_employee_id: ids.m1 });
  });

  it('moves departments in the tree: reparent and reorder in one audited step, never into a cycle', async () => {
    const { saveDepartment, setDepartmentActive, moveDepartment } = await org();
    const make = async (code: string, parentId: string | null) => ok(await saveDepartment(admin(), null, { code: `${tag}-${code}`, name: code, parentId })).id;
    const a = await make('MA', ids.root);
    const b = await make('MB', ids.root);
    const c = await make('MC', ids.root);
    const a1 = await make('MA1', a);
    const level = async () =>
      (await sql`select id from departments where parent_department_id = ${ids.root} and code like ${`${tag}-M%`} order by sort_order, name`).map((r) => r.id);

    ok(await moveDepartment(admin(), { id: c, parentId: ids.root, beforeId: a }));
    expect(await level()).toEqual([c, a, b]);
    const [audit] = await sql`select details from audit_events where action = 'org.department.moved' and entity_id = ${c}`;
    expect(audit.details).toMatchObject({ before: { parentDepartmentId: ids.root }, after: { parentDepartmentId: ids.root } });

    ok(await moveDepartment(admin(), { id: b, parentId: a, beforeId: null }));
    expect(await level()).toEqual([c, a]);
    const [moved] = await sql`select parent_department_id from departments where id = ${b}`;
    expect(moved.parent_department_id).toBe(a);

    // into itself, its own subtree, a position under another parent, or an inactive parent
    expect(await moveDepartment(admin(), { id: a, parentId: a1, beforeId: null })).toMatchObject({ ok: false, code: 'validation' });
    expect(await moveDepartment(admin(), { id: a, parentId: a, beforeId: null })).toMatchObject({ ok: false, code: 'validation' });
    expect(await moveDepartment(admin(), { id: c, parentId: ids.root, beforeId: a1 })).toMatchObject({ ok: false, code: 'validation' });
    ok(await setDepartmentActive(admin(), b, false));
    expect(await moveDepartment(admin(), { id: c, parentId: b, beforeId: null })).toMatchObject({ ok: false, code: 'validation' });
    expect(await moveDepartment(admin(), { id: 'nope', parentId: null, beforeId: null })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await moveDepartment({ id: ids.staff, role: 'staff', authenticatedAt: new Date() }, { id: c, parentId: null, beforeId: null })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(await level()).toEqual([c, a]);

    // dropping where it already is changes nothing and writes no audit
    const moves = async () => (await sql`select count(*)::int as n from audit_events where action = 'org.department.moved'`)[0].n as number;
    ok(await moveDepartment(admin(), { id: a, parentId: ids.root, beforeId: null }));
    const settled = await moves();
    ok(await moveDepartment(admin(), { id: a, parentId: ids.root, beforeId: null }));
    expect(await moves()).toBe(settled);
    expect(await level()).toEqual([c, a]);
  });

  it('keeps exactly one primary holder per scope', async () => {
    const { saveJobRole, addRoleHolder, removeRoleHolder, setPrimaryHolder } = await org();
    const role = ok(await saveJobRole(admin(), null, { code: `${tag}_it`, name: '資訊' }));
    const add = (employeeId: string, departmentId: string | null = null) => addRoleHolder(admin(), { jobRoleId: role.id, employeeId, departmentId });
    ok(await add(ids.m1));
    ok(await add(ids.m2));
    ok(await add(ids.m2, ids.root));
    expect(await add(ids.m1)).toMatchObject({ ok: false, code: 'conflict' });
    const holders = async () =>
      (
        await sql`select id, employee_id, department_id, is_primary from employee_job_roles where job_role_id = ${role.id} order by created_at, id`
      ).map((h) => ({ id: h.id as string, who: h.employee_id, dept: h.department_id, primary: h.is_primary }));
    let list = await holders();
    expect(list.map((h) => [h.who, h.dept, h.primary])).toEqual([
      [ids.m1, null, true],
      [ids.m2, null, false],
      [ids.m2, ids.root, true],
    ]);
    ok(await setPrimaryHolder(admin(), list[1].id));
    ok(await removeRoleHolder(admin(), list[1].id));
    list = await holders();
    expect(list.map((h) => [h.who, h.dept, h.primary])).toEqual([
      [ids.m1, null, true],
      [ids.m2, ids.root, true],
    ]);
  });

  it('manages 總經理 through the employee flag and keeps at least one', async () => {
    const { addRoleHolder, removeRoleHolder, saveJobRole, setJobRoleActive } = await org();
    const [gm] = await sql`select id from job_roles where code = 'general_manager'`;
    expect(await addRoleHolder(admin(), { jobRoleId: gm.id, employeeId: ids.roleHolder, departmentId: ids.root })).toMatchObject({
      ok: false,
      code: 'validation',
    });
    ok(await addRoleHolder(admin(), { jobRoleId: gm.id, employeeId: ids.roleHolder }));
    const [emp] = await sql`select is_general_manager from employees where id = ${ids.roleHolder}`;
    expect(emp.is_general_manager).toBe(true);
    const [binding] = await sql`select id from employee_job_roles where job_role_id = ${gm.id} and employee_id = ${ids.roleHolder}`;
    expect(binding).toBeDefined();
    expect(await saveJobRole(admin(), gm.id, { name: '改名' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await setJobRoleActive(admin(), gm.id, false)).toMatchObject({ ok: false, code: 'forbidden' });

    ok(await removeRoleHolder(admin(), binding.id));
    const [after] = await sql`select is_general_manager from employees where id = ${ids.roleHolder}`;
    expect(after.is_general_manager).toBe(false);

    const active = await sql`select r.id from employee_job_roles r join employees e on e.id = r.employee_id
      where r.job_role_id = ${gm.id} and e.access_enabled`;
    expect(active.length).toBeGreaterThan(0);
    if (active.length === 1) expect(await removeRoleHolder(admin(), active[0].id)).toMatchObject({ ok: false, code: 'conflict' });
  });

  describe('with a published flow that names them', () => {
    const formKey = `${tag}-org`;
    const refs = {} as Record<'level' | 'levelId' | 'role' | 'roleId' | 'group' | 'dept' | 'levelDept', string>;

    beforeAll(async () => {
      const s = await org();
      refs.level = `${tag}_lv`;
      refs.levelId = ok(await s.createLevel(admin(), { code: refs.level, name: '測試層級', rank: r0 + 4 })).id;
      refs.role = `${tag}_fin`;
      refs.roleId = ok(await s.saveJobRole(admin(), null, { code: refs.role, name: '財務覆核' })).id;
      ok(await s.addRoleHolder(admin(), { jobRoleId: refs.roleId, employeeId: ids.x }));
      refs.group = ok(await s.saveGroup(admin(), null, { name: `${tag} 群組` })).id;
      ok(await s.setGroupMembers(admin(), refs.group, [ids.m1, ids.m2]));
      refs.dept = ok(await s.saveDepartment(admin(), null, { code: `${tag}-D`, name: '成員部門', parentId: ids.root })).id;
      refs.levelDept = ok(await s.saveDepartment(admin(), null, { code: `${tag}-L`, name: '層級部門', orgLevelId: refs.levelId })).id;

      const flow = {
        version: 1,
        options: { ...DEFAULT_FLOW_OPTIONS, whenEmpty: 'auto_approve' },
        blocks: [
          {
            id: 'c',
            type: 'condition',
            label: '申請人層級',
            branches: [
              {
                id: 'b',
                label: '測試層級',
                when: { field: '$applicant.orgLevel', op: 'eq', value: refs.level },
                blocks: [{ id: 'g', type: 'approver', label: '群組', source: { kind: 'employee_group', groupId: refs.group }, onUnresolved: 'block' }],
              },
            ],
            otherwise: {
              label: '其他',
              blocks: [
                { id: 'r', type: 'approver', label: '財務', source: { kind: 'job_role', jobRole: refs.role, scope: 'company' }, onUnresolved: 'block' },
                { id: 'm', type: 'approver', label: '部門成員', source: { kind: 'department_members', departmentId: refs.dept, includeManager: false }, onUnresolved: 'skip' },
              ],
            },
          },
        ],
      };
      const { runInTransaction } = await import('@/lib/workflow/tx');
      const { publishDefinition } = await import('@/lib/custom-forms/publish');
      ok(
        await runInTransaction('test.publish', async (tx) => ({
          ok: true as const,
          ...(await publishDefinition(tx, { ...clone(PURCHASE_ADMIN_SAMPLE), key: formKey, numberPrefix: 'OA', flow, actorId: ids.admin } as never)),
        }))
      );
    });

    it('refuses to remove or switch off what the flow uses', async () => {
      const s = await org();
      expect(await s.setGroupActive(admin(), refs.group, false)).toMatchObject({ ok: false, code: 'conflict' });
      expect(await s.setGroupMembers(admin(), refs.group, [])).toMatchObject({ ok: false, code: 'conflict' });
      expect(await s.setJobRoleActive(admin(), refs.roleId, false)).toMatchObject({ ok: false, code: 'conflict' });
      expect(await s.deleteLevel(admin(), refs.levelId)).toMatchObject({ ok: false, code: 'conflict' });
      const deptResult = await s.setDepartmentActive(admin(), refs.dept, false);
      expect(deptResult).toMatchObject({ ok: false, code: 'conflict' });
      if (!deptResult.ok) expect(deptResult.error).toContain('簽核流程');
      const [holder] = await sql`select id from employee_job_roles where job_role_id = ${refs.roleId}`;
      expect(await s.removeRoleHolder(admin(), holder.id)).toMatchObject({ ok: false, code: 'conflict' });
      const inUse = await s.referencesInUse((await import('@/lib/db')).getDb());
      expect(inUse.groups.get(refs.group)).toEqual([PURCHASE_ADMIN_SAMPLE.name]);
      expect(inUse.levels.get(refs.level)).toEqual([PURCHASE_ADMIN_SAMPLE.name]);
    });

    it('simulates the flow against live data without writing', async () => {
      const { simulateForm } = await import('@/lib/admin/org/simulate');
      expect(await simulateForm({ id: ids.staff, role: 'staff', authenticatedAt: new Date() }, { key: formKey, applicantId: ids.staff })).toMatchObject({
        ok: false,
        code: 'forbidden',
      });
      expect(await simulateForm(admin(), { key: `${tag}-none`, applicantId: ids.staff })).toMatchObject({ ok: false, code: 'not_found' });

      const before = await sql`select count(*)::int as n from approval_steps`;
      const other = ok(await simulateForm(admin(), { key: formKey, applicantId: ids.staff, fields: { bogus: 1 } }));
      expect(other.simulation).toMatchObject({ ok: true, path: ['申請人層級：其他'] });
      if (other.simulation.ok) {
        expect(other.simulation.steps.map((st) => [st.label, st.approverName, st.status])).toEqual([
          ['財務', 'x', 'pending'],
          ['部門成員', null, 'skipped'],
        ]);
      }

      await sql`update employees set department_id = ${refs.levelDept} where id = ${ids.staff}`;
      try {
        const s = await org();
        ok(await s.createDelegation(admin(), { delegatorId: ids.m1, delegateId: ids.x, startsOn: today, endsOn: addDays(today, 2), formKeys: [formKey] }));
        const lv = ok(await simulateForm(admin(), { key: formKey, applicantId: ids.staff }));
        if (!lv.simulation.ok) throw new Error(lv.simulation.error);
        expect(lv.simulation.path).toEqual(['申請人層級：測試層級']);
        expect(lv.simulation.steps.map((st) => [st.approverName, st.delegatedFromName, st.status])).toEqual([
          ['x', 'm1', 'pending'],
          ['m2', null, 'pending'],
        ]);
        // Outside the delegation period the member signs again.
        const later = ok(await simulateForm(admin(), { key: formKey, applicantId: ids.staff, date: addDays(today, 10) }));
        if (later.simulation.ok) expect(later.simulation.steps[0]).toMatchObject({ approverName: 'm1', delegatedFromName: null });
      } finally {
        await sql`update employees set department_id = ${ids.root} where id = ${ids.staff}`;
        await sql`delete from approval_delegations where delegator_employee_id = ${ids.m1}`;
      }
      const after = await sql`select count(*)::int as n from approval_steps`;
      expect(after[0].n).toBe(before[0].n);
    });
  });

  it('validates delegations: dates, overlaps, chains and revocation', async () => {
    const { createDelegation, revokeDelegation } = await org();
    const d = (over: Record<string, unknown> = {}) => ({
      delegatorId: ids.m2,
      delegateId: ids.x,
      startsOn: today,
      endsOn: addDays(today, 5),
      formKeys: null,
      reason: '出差',
      ...over,
    });
    expect(await createDelegation(admin(), d({ startsOn: addDays(today, -10), endsOn: addDays(today, -1) }))).toMatchObject({ ok: false, code: 'validation' });
    expect(await createDelegation(admin(), d({ delegateId: ids.m2 }))).toMatchObject({ ok: false, code: 'validation' });
    expect(await createDelegation(admin(), d({ formKeys: [`${tag}-missing`] }))).toMatchObject({ ok: false, code: 'validation' });
    const first = ok(await createDelegation(admin(), d()));
    expect(await createDelegation(admin(), d({ startsOn: addDays(today, 3), endsOn: addDays(today, 8), delegateId: ids.m1 }))).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    // x is m2's delegate, so x cannot be away at the same time, and m2 cannot cover for someone else.
    expect(await createDelegation(admin(), d({ delegatorId: ids.x, delegateId: ids.m1 }))).toMatchObject({ ok: false, code: 'conflict' });
    expect(await createDelegation(admin(), d({ delegatorId: ids.staff, delegateId: ids.m2 }))).toMatchObject({ ok: false, code: 'conflict' });

    ok(await revokeDelegation(admin(), first.id));
    expect(await revokeDelegation(admin(), first.id)).toMatchObject({ ok: false, code: 'conflict' });
    ok(await createDelegation(admin(), d({ delegateId: ids.m1 })));
    const audits = await sql`select action from audit_events where entity_id = ${first.id} order by id`;
    expect(audits.map((a) => a.action)).toEqual(['org.delegation.created', 'org.delegation.revoked']);
  });
});
