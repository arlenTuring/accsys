import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();

describe('seal requests filed on behalf of someone else', () => {
  let sql: Sql;
  const tag = `SP${Date.now()}`;
  const ids = {} as Record<'dept' | 'otherDept' | 'mgr' | 'otherMgr' | 'staff', string>;
  const formIds: string[] = [];

  const actor = (id: string, departmentId = ids.dept) => ({ id, departmentId });
  const input = (applicantEmployeeId: string, departmentId: string) => ({
    idempotencyKey: crypto.randomUUID(),
    applicantEmployeeId,
    departmentId,
    urgency: 'normal',
    expectedCompletionDate: addDays(taipeiToday(), 10),
    remark: '無',
    documentType: 'quotation',
    documentDescription: '測試報價單 1 份',
    seals: ['invoice_seal'],
    lendSeal: 'no',
    lendSealNote: '無',
  });
  const stepsOf = async (formId: string) =>
    sql`select approver_employee_id, approver_role from approval_steps
      where form_type = 'general_seal_request' and form_id = ${formId} order by step_order`;

  beforeAll(async () => {
    sql = await loadSql();
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.otherMgr = await employee('otherMgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '用印測試部', ${ids.mgr}) returning id`)[0].id;
    ids.otherDept = (
      await sql`insert into departments (code, name, manager_employee_id) values (${`${tag}-O`}, '用印他部', ${ids.otherMgr}) returning id`
    )[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    await sql`update employees set department_id = ${ids.otherDept} where id = ${ids.otherMgr}`;
    ids.staff = await employee('staff', ids.dept);
  });

  afterAll(async () => {
    if (formIds.length === 0) return;
    await sql`delete from approval_steps where form_type = 'general_seal_request' and form_id = any(${formIds}::uuid[])`;
    const cases = await sql`delete from general_seal_requests where id = any(${formIds}::uuid[]) returning procurement_case_id`;
    await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
  });

  it("uses the applicant's department, not the one sent by the form", async () => {
    const service = await import('@/lib/general-seals/service');
    const created = await service.createGeneralSealRequest(actor(ids.staff), input(ids.staff, ids.otherDept));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    formIds.push(created.sealRequestId);
    const [form] = await sql`select department_id from general_seal_requests where id = ${created.sealRequestId}`;
    expect(form.department_id).toBe(ids.dept);
    const steps = await stepsOf(created.sealRequestId);
    expect(steps[0]).toMatchObject({ approver_employee_id: ids.mgr, approver_role: 'department_manager' });
    expect(steps.map((s) => s.approver_employee_id)).not.toContain(ids.otherMgr);
  });

  it('leaves the filer out of the chain when a manager files for a subordinate', async () => {
    const service = await import('@/lib/general-seals/service');
    const created = await service.createGeneralSealRequest(actor(ids.mgr), input(ids.staff, ids.dept));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    formIds.push(created.sealRequestId);
    const steps = await stepsOf(created.sealRequestId);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((s) => s.approver_employee_id)).not.toContain(ids.mgr);
    const [form] = await sql`select status from general_seal_requests where id = ${created.sealRequestId}`;
    expect(form.status).toBe('pending_approval');
    expect(steps[0]).toMatchObject({ approver_employee_id: ids.staff, approver_role: 'applicant_confirmation' });
  });

  it('makes the named applicant confirm first when someone files in their name', async () => {
    const service = await import('@/lib/general-seals/service');
    // Staff names their own manager as applicant: the manager's chain skips the
    // department-manager step, so without confirmation this would bypass it.
    const created = await service.createGeneralSealRequest(actor(ids.staff), input(ids.mgr, ids.dept));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    formIds.push(created.sealRequestId);
    const steps = await stepsOf(created.sealRequestId);
    expect(steps[0]).toMatchObject({ approver_employee_id: ids.mgr, approver_role: 'applicant_confirmation' });
    expect(steps.map((s) => s.approver_employee_id)).not.toContain(ids.staff);

    const [{ version }] = await sql`select version from general_seal_requests where id = ${created.sealRequestId}`;
    const byFiler = await service.approveGeneralSealStep(actor(ids.staff), created.sealRequestId, version);
    expect(byFiler).toMatchObject({ ok: false, code: 'forbidden' });

    const refused = await service.returnGeneralSealStep(actor(ids.mgr), created.sealRequestId, '不是我申請的', version);
    expect(refused.ok).toBe(true);
    const [form] = await sql`select status from general_seal_requests where id = ${created.sealRequestId}`;
    expect(form.status).toBe('returned');
  });

  it('needs no confirmation when the applicant files for themselves', async () => {
    const service = await import('@/lib/general-seals/service');
    const created = await service.createGeneralSealRequest(actor(ids.staff), input(ids.staff, ids.dept));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    formIds.push(created.sealRequestId);
    const steps = await stepsOf(created.sealRequestId);
    expect(steps.map((s) => s.approver_role)).not.toContain('applicant_confirmation');
  });
});
