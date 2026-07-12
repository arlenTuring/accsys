import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('budget-codes actions', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentCode: string;
  let departmentId: string;
  let managerId: string;
  let customOwnerId: string;
  let customOwnerCode: string;
  let financeEmployeeId: string;
  let staffEmployeeId: string;
  const createdBudgetCodeIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    departmentCode = `BCT-${Date.now()}`;

    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();

    const { data: manager } = await admin
      .from('employees')
      .insert({
        employee_code: `BCT-MGR-${Date.now()}`,
        name: '測試部門主管',
        department_id: anyDept!.id,
      })
      .select()
      .single();
    managerId = manager!.id;

    const { data: dept } = await admin
      .from('departments')
      .insert({ code: departmentCode, name: '測試預算部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;

    customOwnerCode = `BCT-OWNER-${Date.now()}`;
    const { data: customOwner } = await admin
      .from('employees')
      .insert({ employee_code: customOwnerCode, name: '測試自訂負責人', department_id: departmentId })
      .select()
      .single();
    customOwnerId = customOwner!.id;

    const { data: financeEmp } = await admin
      .from('employees')
      .insert({
        employee_code: `BCT-FIN-${Date.now()}`,
        name: '測試財會人員',
        department_id: departmentId,
        role: 'finance',
      })
      .select()
      .single();
    financeEmployeeId = financeEmp!.id;

    const { data: staffEmp } = await admin
      .from('employees')
      .insert({
        employee_code: `BCT-STAFF-${Date.now()}`,
        name: '測試一般員工',
        department_id: departmentId,
        role: 'staff',
      })
      .select()
      .single();
    staffEmployeeId = staffEmp!.id;
  });

  afterAll(async () => {
    if (createdBudgetCodeIds.length > 0) {
      await admin.from('budget_codes').delete().in('id', createdBudgetCodeIds);
    }
    await admin
      .from('employees')
      .delete()
      .in('id', [managerId, customOwnerId, financeEmployeeId, staffEmployeeId]);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  it('rejects a non-finance employee', async () => {
    currentEmployee.value = { id: staffEmployeeId, role: 'staff' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-CODE-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '只有財會人員可以維護預算編號' });
  });

  it('creates a department-scoped budget code, defaulting owner to the department manager when left blank', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const code = `BCT-CODE-${Date.now()}`;
    const result = await upsertBudgetCode({
      code,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 500000,
      ownerEmployeeCode: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) createdBudgetCodeIds.push(result.budgetCodeId);

    const { data: row } = await admin
      .from('budget_codes')
      .select('department_id, project_code, owner_employee_id, annual_budget_amount')
      .eq('code', code)
      .single();
    expect(row).toEqual({
      department_id: departmentId,
      project_code: null,
      owner_employee_id: managerId,
      annual_budget_amount: 500000,
    });
  });

  it('creates a project-scoped budget code with an explicit owner', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const code = `BCT-PROJ-${Date.now()}`;
    const result = await upsertBudgetCode({
      code,
      departmentCode: null,
      projectCode: '115BD999',
      category: '專案費用',
      fiscalYear: '115',
      annualBudgetAmount: 200000,
      ownerEmployeeCode: customOwnerCode,
    });
    expect(result.ok).toBe(true);
    if (result.ok) createdBudgetCodeIds.push(result.budgetCodeId);

    const { data: row } = await admin
      .from('budget_codes')
      .select('department_id, project_code, owner_employee_id')
      .eq('code', code)
      .single();
    expect(row).toEqual({
      department_id: null,
      project_code: '115BD999',
      owner_employee_id: customOwnerId,
    });
  });

  it('rejects when both department code and project code are provided', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-BOTH-${Date.now()}`,
      departmentCode,
      projectCode: '115BD999',
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '部門代碼與專案代碼必須恰填一項' });
  });

  it('rejects when neither department code nor project code are provided', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-NEITHER-${Date.now()}`,
      departmentCode: null,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '部門代碼與專案代碼必須恰填一項' });
  });

  it('rejects a non-positive annual budget amount', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-NEG-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 0,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '年度預算金額必須為正數' });
  });

  it('rejects an unknown department code', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-BADDEPT-${Date.now()}`,
      departmentCode: 'NOPE-DEPT',
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(result).toEqual({ ok: false, error: '部門代碼「NOPE-DEPT」查無此部門' });
  });

  it('rejects an unknown owner employee code', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const result = await upsertBudgetCode({
      code: `BCT-BADOWNER-${Date.now()}`,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: 'NOPE-0000',
    });
    expect(result).toEqual({ ok: false, error: '負責人工號「NOPE-0000」查無此員工' });
  });

  it('updates an existing budget code on repeated upsert rather than creating a duplicate', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertBudgetCode } = await import('@/lib/budget-codes/actions');
    const code = `BCT-UPDATE-${Date.now()}`;
    const first = await upsertBudgetCode({
      code,
      departmentCode,
      projectCode: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 1000,
      ownerEmployeeCode: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdBudgetCodeIds.push(first.budgetCodeId);

    const second = await upsertBudgetCode({
      code,
      departmentCode,
      projectCode: null,
      category: '租金支出',
      fiscalYear: '115',
      annualBudgetAmount: 2000,
      ownerEmployeeCode: null,
    });
    expect(second).toEqual({ ok: true, budgetCodeId: first.budgetCodeId });

    const { count } = await admin
      .from('budget_codes')
      .select('id', { count: 'exact', head: true })
      .eq('code', code);
    expect(count).toBe(1);

    const { data: row } = await admin
      .from('budget_codes')
      .select('category, annual_budget_amount')
      .eq('code', code)
      .single();
    expect(row).toEqual({ category: '租金支出', annual_budget_amount: 2000 });
  });
});
