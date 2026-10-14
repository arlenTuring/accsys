import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FlowDef } from '@/lib/approval/flow/types';
import { addDays } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();

describe('approval flow engine (migration 0018 + workflow helpers)', () => {
  let sql: Sql;
  const tag = `FE${Date.now()}`;
  const ids = {} as Record<'team' | 'dept' | 'mgr' | 'deptMgr' | 'staff' | 'reviewer' | 'gm1' | 'gm2' | 'group', string>;
  const formIds: string[] = [];

  const employee = async (name: string, deptId: string) =>
    (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
      .id as string;
  const versionOf = async (id: string) => Number((await sql`select version from general_seal_requests where id = ${id}`)[0].version);

  beforeAll(async () => {
    sql = await loadSql();
    const [anyDept] = await sql`select id from departments limit 1`;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.deptMgr = await employee('deptMgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${`${tag}-D`}, '流程測試部', ${ids.deptMgr}) returning id`)[0].id;
    ids.team = (
      await sql`insert into departments (code, name, manager_employee_id, parent_department_id)
        values (${`${tag}-T`}, '流程測試組', ${ids.mgr}, ${ids.dept}) returning id`
    )[0].id;
    await sql`update employees set department_id = ${ids.team} where id = ${ids.mgr}`;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.deptMgr}`;
    ids.staff = await employee('staff', ids.team);
    ids.reviewer = await employee('reviewer', ids.team);
    ids.group = (await sql`insert into employee_groups (name) values (${`${tag}-群組`}) returning id`)[0].id;
    await sql`insert into employee_group_members (group_id, employee_id, sort_order) values
      (${ids.group}, ${ids.mgr}, 1), (${ids.group}, ${ids.reviewer}, 2)`;
  });

  afterAll(async () => {
    if (formIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'general_seal_request' and form_id = any(${formIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'general_seal_request' and form_id = any(${formIds}::uuid[])`;
      const cases = await sql`delete from general_seal_requests where id = any(${formIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    await sql`delete from employee_groups where id = ${ids.group}`;
    for (const id of [ids.gm1, ids.gm2].filter(Boolean)) {
      await sql`update employees set is_general_manager = false, is_chairman = false where id = ${id}`;
    }
  });

  it('created the system job roles and mirrors the GM / chairman flags as bindings', async () => {
    const roles = await sql`select code, is_system from job_roles where code in ('general_manager', 'chairman') order by code`;
    expect(roles).toEqual([
      { code: 'chairman', is_system: true },
      { code: 'general_manager', is_system: true },
    ]);
    const [{ dept }] = await sql`select ${ids.dept}::uuid as dept`;
    ids.gm1 = await employee('gm1', dept);
    ids.gm2 = await employee('gm2', dept);
    const binding = (id: string) => sql`select r.is_primary from employee_job_roles r join job_roles j on j.id = r.job_role_id
      where j.code = 'chairman' and r.department_id is null and r.employee_id = ${id}`;

    // Fixture chairmen (base.sql) are older, so neither test employee is primary.
    await sql`update employees set is_chairman = true where id in (${ids.gm1}, ${ids.gm2})`;
    expect(await binding(ids.gm1)).toHaveLength(1);
    const primaries = await sql`select count(*)::int as n from employee_job_roles r join job_roles j on j.id = r.job_role_id
      where j.code = 'chairman' and r.department_id is null and r.is_primary`;
    expect(primaries[0].n).toBe(1);

    await sql`update employees set is_chairman = false where id = ${ids.gm1}`;
    expect(await binding(ids.gm1)).toHaveLength(0);
    expect(await binding(ids.gm2)).toHaveLength(1);
  });

  it('rejects a department hierarchy cycle', async () => {
    await expect(sql`update departments set parent_department_id = ${ids.team} where id = ${ids.dept}`).rejects.toMatchObject({
      code: '23514',
    });
    await expect(sql`update departments set parent_department_id = id where id = ${ids.team}`).rejects.toMatchObject({ code: '23514' });
    const [row] = await sql`select parent_department_id from departments where id = ${ids.dept}`;
    expect(row.parent_department_id).toBeNull();
  });

  it('only accepts system statuses and configured step roles in approval_steps', async () => {
    const formId = crypto.randomUUID();
    await expect(
      sql`insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status)
        values ('general_seal_request', ${formId}, 1, null, 'step:x', 'pending')`
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role)
        values ('general_seal_request', ${formId}, 1, ${ids.mgr}, 'step:bad role')`
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('writes resolved steps and passes over the ones the system signed', async () => {
    const service = await import('@/lib/general-seals/service');
    const { runInTransaction, lockForm, replaceSteps } = await import('@/lib/workflow/tx');
    const { resolveFlowInTx } = await import('@/lib/approval/flow/load');

    const created = await service.createGeneralSealRequest(
      { id: ids.staff, departmentId: ids.team },
      {
        idempotencyKey: crypto.randomUUID(),
        applicantEmployeeId: ids.staff,
        departmentId: ids.team,
        urgency: 'normal',
        expectedCompletionDate: addDays(taipeiToday(), 10),
        remark: '無',
        documentType: 'quotation',
        documentDescription: '流程引擎測試',
        seals: ['invoice_seal'],
        lendSeal: 'no',
        lendSealNote: '無',
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    formIds.push(created.sealRequestId);

    const flow: FlowDef = {
      version: 1,
      options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'block' },
      blocks: [
        { id: 'self', type: 'approver', label: '申請人自己', source: { kind: 'employee', employeeId: ids.staff }, onUnresolved: 'block' },
        { id: 'chain', type: 'approver', label: '組織主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 }, onUnresolved: 'block' },
        { id: 'grp', type: 'approver', label: '審閱群組', source: { kind: 'employee_group', groupId: ids.group }, onUnresolved: 'block' },
        { id: 'up', type: 'approver', label: '上層主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 1 }, onUnresolved: 'block' },
        { id: 'nobody', type: 'approver', label: '法務', source: { kind: 'job_role', jobRole: 'no_such_role', scope: 'company' }, onUnresolved: 'skip' },
      ],
    };

    const replaced = await runInTransaction('test.replace', async (tx, outbox) => {
      const form = (await lockForm(tx, 'general_seal_request', created.sealRequestId))!;
      const steps = await resolveFlowInTx(tx, flow, {
        applicantEmployeeId: ids.staff,
        filerEmployeeId: ids.staff,
        departmentId: ids.team,
        formKey: 'general-seal',
        today: taipeiToday(),
        fields: {},
      });
      await replaceSteps(tx, outbox, {
        formType: 'general_seal_request',
        form,
        chain: { resolved: steps },
        actorId: ids.staff,
        action: 'general_seal_request.test_flow',
        previousItems: [],
        message: 'test',
      });
      return { ok: true as const };
    });
    expect(replaced.ok).toBe(true);

    const rows = await sql`select step_order, approver_employee_id, approver_role, status, step_label, source_kind, system_note, acted_at
      from approval_steps where form_type = 'general_seal_request' and form_id = ${created.sealRequestId} order by step_order`;
    expect(rows.map((r) => [r.approver_employee_id, r.status, r.approver_role])).toEqual([
      [ids.staff, 'auto_approved', 'step:self'],
      [ids.mgr, 'pending', 'step:chain'],
      [ids.mgr, 'auto_approved', 'step:grp'],
      [ids.reviewer, 'pending', 'step:grp'],
      [ids.deptMgr, 'pending', 'step:up'],
      [null, 'skipped', 'step:nobody'],
    ]);
    expect(rows[0].acted_at).not.toBeNull();
    expect(rows[1].acted_at).toBeNull();
    expect(rows[5].system_note).toContain('已略過');

    let [form] = await sql`select status, current_step_order from general_seal_requests where id = ${created.sealRequestId}`;
    expect(form).toMatchObject({ status: 'pending_approval', current_step_order: 2 });

    // Step 2 is the first a person signs: the applicant may still withdraw/edit. Approving moves to step 4.
    expect((await service.approveGeneralSealStep({ id: ids.mgr, departmentId: ids.team }, created.sealRequestId, await versionOf(created.sealRequestId))).ok).toBe(true);
    [form] = await sql`select status, current_step_order from general_seal_requests where id = ${created.sealRequestId}`;
    expect(form.current_step_order).toBe(4);
    const [note] = await sql`select recipient_employee_id from notifications
      where form_type = 'general_seal_request' and form_id = ${created.sealRequestId} and type = 'approval_requested' and is_read = false`;
    expect(note.recipient_employee_id).toBe(ids.reviewer);

    const withdraw = await service.withdrawGeneralSealRequest({ id: ids.staff, departmentId: ids.team }, created.sealRequestId);
    expect(withdraw).toMatchObject({ ok: false, code: 'conflict' });

    for (const approver of [ids.reviewer, ids.deptMgr]) {
      expect((await service.approveGeneralSealStep({ id: approver, departmentId: ids.team }, created.sealRequestId, await versionOf(created.sealRequestId))).ok).toBe(true);
    }
    [form] = await sql`select status, current_step_order from general_seal_requests where id = ${created.sealRequestId}`;
    expect(form).toMatchObject({ status: 'approved', current_step_order: null });
  });

  it('refuses to submit when a required approver cannot be resolved', async () => {
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { resolveFlowInTx } = await import('@/lib/approval/flow/load');
    const result = await runInTransaction('test.unresolved', async (tx) => {
      await resolveFlowInTx(
        tx,
        {
          version: 1,
          options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'block' },
          blocks: [{ id: 'x', type: 'approver', label: '上上層', source: { kind: 'department_manager', of: 'applicant', levelsUp: 5 }, onUnresolved: 'block' }],
        },
        { applicantEmployeeId: ids.staff, filerEmployeeId: ids.staff, departmentId: ids.team, formKey: null, today: taipeiToday(), fields: {} }
      );
      return { ok: true as const };
    });
    expect(result).toMatchObject({ ok: false, code: 'validation' });
    if (!result.ok) expect(result.error).toContain('上上層');
  });
});
