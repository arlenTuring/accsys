import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TRAVEL_EXPENSE_FORM } from '@/lib/custom-forms/migrated/travel';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';

const currentEmployee: { value: unknown } = { value: null };
vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => currentEmployee.value }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Batch 2 switch-over: 出差報告暨旅費報支單 as a designer definition. The key
// is tagged per run (definitions are immutable) and the legacy link is cleared
// afterwards so later test files still reach the hard-coded form.
describe('batch 2: travel expenses moved to the designer runtime', () => {
  let sql: Sql;
  const tag = `lt${Date.now()}`;
  const ids = {} as Record<'dept' | 'mgr' | 'applicant' | 'owner' | 'budget' | 'gm' | 'chairman', string>;
  const submissionIds: string[] = [];
  const legacyIds: string[] = [];
  const travel: MigratedForm = { ...clone(TRAVEL_EXPENSE_FORM), key: `${tag}-te`, numberPrefix: 'TT' };

  const cost = (o: Record<string, unknown> = {}) => ({
    expenseDate: '2026-10-05',
    category: '交通費',
    fromStation: '台北',
    toStation: '左營',
    summary: '高鐵',
    currency: 'TWD',
    amount: '1490',
    ...o,
  });
  const data = (costs: Record<string, unknown>[] = [cost()]) => ({
    budgetCodeId: ids.budget,
    advanceAmount: '',
    tripStartDate: '2026-10-05',
    tripEndDate: '2026-10-06',
    purpose: '高雄場域測試',
    tripOrderNo: 'BT-001',
    companions: '無',
    reportItems: { rows: [{ tripDate: '2026-10-05', location: '高雄', itinerary: '場域測試', timeSlot: '09:00-18:00' }] },
    costItems: { rows: costs },
  });
  const legacyInput = () => ({
    idempotencyKey: crypto.randomUUID(),
    budgetCodeId: ids.budget,
    advanceAmount: '',
    tripStartDate: '2026-10-05',
    tripEndDate: '2026-10-06',
    purpose: '高雄場域測試',
    tripOrderNo: 'BT-001',
    companions: '無',
    reportItems: [{ tripDate: '2026-10-05', location: '高雄', itinerary: '場域測試', timeSlot: '09:00-18:00' }],
    costItems: [{ ...cost(), mileage: '', exchangeRate: '' }],
  });
  const install = async (form: MigratedForm, mode: 'draft' | 'publish') => {
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { installMigratedForm } = await import('@/lib/custom-forms/migrated/install');
    return runInTransaction('test.migrate', async (tx) => ({ ok: true as const, ...(await installMigratedForm(tx, form, ids.mgr, mode)) }));
  };
  const create = async (costs?: Record<string, unknown>[]) => {
    const service = await import('@/lib/custom-forms/service');
    const r = await service.createSubmission({ id: ids.applicant }, travel.key, { data: data(costs), idempotencyKey: crypto.randomUUID(), fileCount: 1 });
    if (r.ok) submissionIds.push(r.submissionId);
    return r;
  };
  const approvers = async (id: string) =>
    (
      await sql`select approver_employee_id from approval_steps
        where form_type = 'custom' and form_id = ${id} and status = 'pending' order by step_order`
    ).map((s) => s.approver_employee_id);

  beforeAll(async () => {
    sql = await loadSql();
    await sql`update form_definitions set legacy_form_type = null where legacy_form_type = 'travel_expense'`;
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '旅費轉換測試部', ${ids.mgr}) returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    ids.applicant = await employee('applicant', ids.dept);
    ids.owner = await employee('owner', ids.dept);
    ids.budget = (
      await sql`insert into budget_codes (code, department_id, category, fiscal_year, annual_budget_amount, owner_employee_id)
        values (${`${tag}-BC`}, ${ids.dept}, '差旅費', '115', 100000, ${ids.owner}) returning id`
    )[0].id;
    const primary = (code: string) => sql`select r.employee_id from employee_job_roles r join job_roles j on j.id = r.job_role_id
      where j.code = ${code} and r.department_id is null and r.is_primary`;
    ids.gm = (await primary('general_manager'))[0].employee_id;
    ids.chairman = (await primary('chairman'))[0].employee_id;
  });

  afterAll(async () => {
    await sql`update form_definitions set legacy_form_type = null where key like ${`${tag}-%`}`;
    if (submissionIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      const cases = await sql`delete from form_submissions where id = any(${submissionIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    if (legacyIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'travel_expense' and form_id = any(${legacyIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'travel_expense' and form_id = any(${legacyIds}::uuid[])`;
      await sql`delete from travel_expense_report_items where travel_expense_id = any(${legacyIds}::uuid[])`;
      await sql`delete from travel_expense_cost_items where travel_expense_id = any(${legacyIds}::uuid[])`;
      const cases = await sql`delete from travel_expenses where id = any(${legacyIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
  });

  it('a draft changes nothing; publishing retires the old create, existing records stay; archiving reopens it', async () => {
    const legacy = await import('@/lib/travel-expenses/service');
    const { replacementFor } = await import('@/lib/custom-forms/legacy');
    const legacyActor = { id: ids.applicant, departmentId: ids.dept };

    expect(await install(travel, 'draft')).toMatchObject({ ok: true, outcome: 'drafted' });
    expect(await replacementFor('travel_expense')).toBeNull();
    const before = await legacy.createTravelExpense(legacyActor, legacyInput());
    expect(before.ok).toBe(true);
    if (before.ok) legacyIds.push(before.travelExpenseId);

    // Publishing the existing draft (what the designer's 發佈 does).
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { publishDefinition } = await import('@/lib/custom-forms/publish');
    await runInTransaction('test.publish', async (tx) => ({ ok: true as const, ...(await publishDefinition(tx, { ...travel, actorId: ids.mgr })) }));
    expect(await replacementFor('travel_expense')).toBe(travel.key);

    expect(await legacy.createTravelExpense(legacyActor, legacyInput())).toMatchObject({ ok: false, code: 'conflict' });
    if (before.ok) {
      const [row] = await sql`select status from travel_expenses where id = ${before.travelExpenseId}`;
      expect(row.status).toBe('pending_approval');
    }

    await sql`update form_definitions set status = 'archived' where key = ${travel.key}`;
    expect(await replacementFor('travel_expense')).toBeNull();
    await sql`update form_definitions set status = 'published' where key = ${travel.key}`;
  });

  it('routes 主管 → 預算負責人 → 總經理, promotes the budget code and the NT$ total', async () => {
    const created = await create([cost(), cost({ category: '住宿費', currency: 'USD', amount: '100', exchangeRate: '32.15', summary: '飯店' })]);
    if (!created.ok) throw new Error(created.error);
    expect(await approvers(created.submissionId)).toEqual([ids.mgr, ids.owner, ids.gm]);
    const [row] = await sql`select budget_code_id, total_amount, data from form_submissions where id = ${created.submissionId}`;
    expect(row.budget_code_id).toBe(ids.budget);
    expect(row.total_amount).toBe('4705.00');
    expect(row.data.costItems.rows.map((r: Record<string, unknown>) => [r.exchangeRate, r.twdAmount])).toEqual([
      [1, '1490.00'],
      [32.15, '3215.00'],
    ]);
  });

  it('adds the chairman only above NT$100,000 after conversion', async () => {
    // 3125 × 32.000004 = 100000.0125 → NT$100,000.01; the fixture chairman may also be the GM (then marked 由系統代簽).
    const roles = async (id: string) =>
      (await sql`select approver_role from approval_steps where form_type = 'custom' and form_id = ${id} order by step_order`).map((s) => s.approver_role);
    const over = await create([cost({ currency: 'USD', amount: '3125', exchangeRate: '32.000004' })]);
    if (!over.ok) throw new Error(over.error);
    expect(await roles(over.submissionId)).toEqual(['step:dept_manager', 'step:budget_owner', 'step:general_manager', 'step:chairman']);
    const [row] = await sql`select total_amount from form_submissions where id = ${over.submissionId}`;
    expect(row.total_amount).toBe('100000.01');
    const at = await create([cost({ currency: 'USD', amount: '3125', exchangeRate: '32' })]);
    if (!at.ok) throw new Error(at.error);
    expect(await roles(at.submissionId)).toEqual(['step:dept_manager', 'step:budget_owner', 'step:general_manager']);
    expect(await approvers(at.submissionId)).toEqual([ids.mgr, ids.owner, ids.gm]);
  });

  it('refuses implausible rates and budget codes without an owner', async () => {
    expect(await create([cost({ currency: 'USD', amount: '5000', exchangeRate: '1' })])).toMatchObject({ ok: false, code: 'validation' });
    await sql`update budget_codes set owner_employee_id = null where id = ${ids.budget}`;
    expect(await create()).toMatchObject({ ok: false });
    await sql`update budget_codes set owner_employee_id = ${ids.owner} where id = ${ids.budget}`;
  });
});
