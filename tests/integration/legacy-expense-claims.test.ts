import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EXPENSE_CLAIM_FORMS } from '@/lib/custom-forms/migrated/expense-claims';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';

const currentEmployee: { value: unknown } = { value: null };
vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => currentEmployee.value }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const FIXTURE_SUPPLIER = '50000000-0000-0000-0000-000000000001';
const FIXTURE_FINANCE = '20000000-0000-0000-0000-000000000003';
const BANK = '台灣銀行 信義分行 王小明 012345678901';
const MATERIAL = '材料 (單筆新臺幣10,000元以下)';

// Batch 3 switch-over, exercised on 費用申請單(產品專案版): the other three
// editions share the same builder and differ only in scope / categories /
// default payee (covered by the unit parity tests). The key is tagged per run
// and the legacy link is cleared afterwards so later files reach the old form.
describe('batch 3: expense claims moved to the designer runtime', () => {
  let sql: Sql;
  const tag = `le${Date.now()}`;
  const ids = {} as Record<'dept' | 'mgr' | 'applicant' | 'owner' | 'product' | 'revenue' | 'budget' | 'revenueBudget' | 'deptBudget' | 'gm', string>;
  const submissionIds: string[] = [];
  const legacyIds: string[] = [];
  const base = EXPENSE_CLAIM_FORMS.find((f) => f.legacyFormType === 'project_expense')!;
  const form: MigratedForm = { ...clone(base), key: `${tag}-pe`, numberPrefix: 'TP' };

  const item = (o: Record<string, unknown> = {}) => ({ category: MATERIAL, description: '感測器支架', currency: 'TWD', amount: '1200', ...o });
  const data = (o: { items?: Record<string, unknown>[]; header?: Record<string, unknown> } = {}) => ({
    budgetCodeId: ids.budget,
    items: { rows: o.items ?? [item()] },
    remark: '',
    payeeType: 'supplier',
    payeeSupplierId: FIXTURE_SUPPLIER,
    expectedPaymentDate: '2099-01-25',
    paymentMethod: 'transfer',
    remittanceInfo: BANK,
    ...o.header,
  });
  const legacyInput = () => ({
    idempotencyKey: crypto.randomUUID(),
    departmentId: ids.dept,
    budgetCodeId: ids.budget,
    items: [{ ...item(), exchangeRate: '' }],
    remark: '',
    payeeType: 'supplier',
    payeeSupplierId: FIXTURE_SUPPLIER,
    expectedPaymentDate: '2099-01-25',
    paymentMethod: 'transfer',
    remittanceInfo: BANK,
  });
  const install = async (f: MigratedForm, mode: 'draft' | 'publish') => {
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { installMigratedForm } = await import('@/lib/custom-forms/migrated/install');
    return runInTransaction('test.migrate', async (tx) => ({ ok: true as const, ...(await installMigratedForm(tx, f, ids.mgr, mode)) }));
  };
  const create = async (o?: Parameters<typeof data>[0]) => {
    const service = await import('@/lib/custom-forms/service');
    const r = await service.createSubmission({ id: ids.applicant }, form.key, { data: data(o), idempotencyKey: crypto.randomUUID(), fileCount: 1 });
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
    await sql`update form_definitions set legacy_form_type = null where legacy_form_type = 'project_expense'`;
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '費用轉換測試部', ${ids.mgr}) returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    ids.applicant = await employee('applicant', ids.dept);
    ids.owner = await employee('owner', ids.dept);
    ids.product = (await sql`insert into projects (code, name, kind) values (${`${tag}-P`}, '產品測試專案', 'product') returning id`)[0].id;
    ids.revenue = (await sql`insert into projects (code, name, kind) values (${`${tag}-R`}, '營收測試專案', 'revenue') returning id`)[0].id;
    const code = async (suffix: string, column: { departmentId?: string; projectId?: string }) =>
      (
        await sql`insert into budget_codes (code, department_id, project_id, category, fiscal_year, annual_budget_amount, owner_employee_id)
          values (${`${tag}-${suffix}`}, ${column.departmentId ?? null}, ${column.projectId ?? null}, '材料費', '115', 100000, ${ids.owner}) returning id`
      )[0].id as string;
    ids.budget = await code('P', { projectId: ids.product });
    ids.revenueBudget = await code('R', { projectId: ids.revenue });
    ids.deptBudget = await code('D', { departmentId: ids.dept });
    ids.gm = (
      await sql`select r.employee_id from employee_job_roles r join job_roles j on j.id = r.job_role_id
        where j.code = 'general_manager' and r.department_id is null and r.is_primary`
    )[0].employee_id;
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
      await sql`delete from approval_steps where form_type = 'project_expense' and form_id = any(${legacyIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'project_expense' and form_id = any(${legacyIds}::uuid[])`;
      await sql`delete from project_expense_items where project_expense_id = any(${legacyIds}::uuid[])`;
      const cases = await sql`delete from project_expenses where id = any(${legacyIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
  });

  it('a draft changes nothing; publishing retires the old create, existing records stay; archiving reopens it', async () => {
    const legacy = await import('@/lib/expense-claims/service');
    const { replacementFor } = await import('@/lib/custom-forms/legacy');
    const legacyActor = { id: ids.applicant, departmentId: ids.dept };

    expect(await install(form, 'draft')).toMatchObject({ ok: true, outcome: 'drafted' });
    expect(await replacementFor('project_expense')).toBeNull();
    const before = await legacy.createExpenseClaim('project', legacyActor, legacyInput());
    if (!before.ok) throw new Error(before.error);
    legacyIds.push(before.claimId);

    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { publishDefinition } = await import('@/lib/custom-forms/publish');
    await runInTransaction('test.publish', async (tx) => ({ ok: true as const, ...(await publishDefinition(tx, { ...form, actorId: ids.mgr })) }));
    expect(await replacementFor('project_expense')).toBe(form.key);
    expect(await replacementFor('department_expense')).not.toBe(form.key);

    expect(await legacy.createExpenseClaim('project', legacyActor, legacyInput())).toMatchObject({ ok: false, code: 'conflict' });
    const [row] = await sql`select status from project_expenses where id = ${before.claimId}`;
    expect(row.status).toBe('pending_approval');

    await sql`update form_definitions set status = 'archived' where key = ${form.key}`;
    expect(await replacementFor('project_expense')).toBeNull();
    await sql`update form_definitions set status = 'published' where key = ${form.key}`;
  });

  it('routes 主管 → 預算負責人 → 總經理 and promotes the budget code and NT$ total', async () => {
    const created = await create({ items: [item(), item({ category: '加工費', currency: 'USD', amount: '100', exchangeRate: '32.15' })] });
    if (!created.ok) throw new Error(created.error);
    expect(await approvers(created.submissionId)).toEqual([ids.mgr, ids.owner, ids.gm]);
    const [row] = await sql`select budget_code_id, total_amount, data from form_submissions where id = ${created.submissionId}`;
    expect(row.budget_code_id).toBe(ids.budget);
    expect(row.total_amount).toBe('4415.00');
    expect(row.data.remittanceInfo).toBe(BANK);
    expect(row.data.payeeSupplierId).toBe(FIXTURE_SUPPLIER);
  });

  it('only takes 產品專案 budget codes, existing suppliers and capped 材料 rows up to NT$10,000', async () => {
    expect(await create({ header: { budgetCodeId: ids.deptBudget } })).toMatchObject({ ok: false, code: 'validation', error: expect.stringContaining('需為產品專案預算') });
    expect(await create({ header: { budgetCodeId: ids.revenueBudget } })).toMatchObject({ ok: false, error: expect.stringContaining('需為產品專案預算') });
    expect(await create({ header: { payeeSupplierId: crypto.randomUUID() } })).toMatchObject({ ok: false, error: expect.stringContaining('廠商不存在') });
    expect(await create({ items: [item({ amount: '10000.01' })] })).toMatchObject({ ok: false, code: 'validation' });
    expect(await create({ items: [item({ amount: '10000' })] })).toMatchObject({ ok: true });
    const applicantPaid = await create({ header: { payeeType: 'applicant', payeeSupplierId: crypto.randomUUID() } });
    if (!applicantPaid.ok) throw new Error(applicantPaid.error);
    const [row] = await sql`select data from form_submissions where id = ${applicantPaid.submissionId}`;
    expect('payeeSupplierId' in row.data).toBe(false);
  });

  it('shows the bank account in full to applicant and finance, masked to approvers; pickers carry no bank data', async () => {
    const created = await create();
    if (!created.ok) throw new Error(created.error);
    const queries = await import('@/lib/custom-forms/queries');
    const as = async (id: string, role: string) => {
      currentEmployee.value = { id, role, departmentId: ids.dept };
      return queries.getSubmissionDetail(created.submissionId, { withOptions: true });
    };

    const own = await as(ids.applicant, 'staff');
    expect(own?.data.remittanceInfo).toBe(BANK);
    expect(own?.labels[FIXTURE_SUPPLIER]).toBe('測試供應商股份有限公司');
    expect(own?.options?.suppliers.every((s) => Object.keys(s).sort().join() === 'id,label')).toBe(true);
    expect(own?.options?.budgetCodes.find((c) => c.id === ids.budget)?.scope).toBe('product');
    expect(own?.options?.budgetCodes.find((c) => c.id === ids.revenueBudget)?.scope).toBe('revenue');

    const approver = await as(ids.mgr, 'staff');
    expect(approver?.data.remittanceInfo).toBe('台灣銀行 信義分行 王小明 ＊＊＊＊＊＊＊＊8901');
    expect(approver?.options).toBeNull();

    expect((await as(FIXTURE_FINANCE, 'finance'))?.data.remittanceInfo).toBe(BANK);
    expect(await as(ids.owner, 'staff').then((d) => d?.data.remittanceInfo)).toBe('台灣銀行 信義分行 王小明 ＊＊＊＊＊＊＊＊8901');
    currentEmployee.value = null;

    const [row] = await sql`select data from form_submissions where id = ${created.submissionId}`;
    expect(row.data.remittanceInfo).toBe(BANK);
  });
});
