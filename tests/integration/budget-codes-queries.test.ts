import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));

describe.skipIf(!hasIntegrationTestCredentials())('getBudgetCodeList', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentId: string;
  let managerId: string;
  let projectId: string;
  let departmentScopedCodeId: string;
  let projectScopedCodeId: string;
  const departmentCode = `BCQ-${Date.now()}`;
  const managerEmployeeCode = `BCQ-MGR-${Date.now()}`;
  const projectCode = `BCQ-PROJECT-X-${Date.now()}`;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: managerEmployeeCode, name: '測試查詢主管', department_id: anyDept!.id })
      .select()
      .single();
    managerId = manager!.id;
    const { data: dept } = await admin
      .from('departments')
      .insert({ code: departmentCode, name: '測試查詢部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;

    const { data: project } = await admin
      .from('projects')
      .insert({ code: projectCode, name: '測試查詢專案' })
      .select()
      .single();
    projectId = project!.id;

    const { data: deptCode } = await admin
      .from('budget_codes')
      .insert({
        code: `BCQ-DEPT-${Date.now()}`,
        department_id: departmentId,
        category: '人事費',
        fiscal_year: '115',
        annual_budget_amount: 100000,
        owner_employee_id: managerId,
      })
      .select()
      .single();
    departmentScopedCodeId = deptCode!.id;

    const { data: projCode } = await admin
      .from('budget_codes')
      .insert({
        code: `BCQ-PROJ-${Date.now()}`,
        project_id: projectId,
        category: '專案費用',
        fiscal_year: '115',
        annual_budget_amount: 50000,
        owner_employee_id: null,
      })
      .select()
      .single();
    projectScopedCodeId = projCode!.id;
  });

  afterAll(async () => {
    await admin.from('budget_codes').delete().in('id', [departmentScopedCodeId, projectScopedCodeId]);
    await admin.from('projects').delete().eq('id', projectId);
    await admin.from('departments').update({ manager_employee_id: null }).eq('id', departmentId);
    await admin.from('employees').delete().eq('id', managerId);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  it('reports the department code/name and owner name for a department-scoped budget code', async () => {
    const { getBudgetCodeList } = await import('@/lib/budget-codes/queries');
    const list = await getBudgetCodeList();
    const item = list.find((b) => b.id === departmentScopedCodeId);
    expect(item).toEqual({
      id: departmentScopedCodeId,
      code: item!.code,
      departmentCode,
      departmentName: '測試查詢部門',
      projectCode: null,
      projectName: null,
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: 100000,
      ownerEmployeeCode: managerEmployeeCode,
      ownerName: '測試查詢主管',
    });
  });

  it('reports the project code/name and null owner for a project-scoped budget code with no owner', async () => {
    const { getBudgetCodeList } = await import('@/lib/budget-codes/queries');
    const list = await getBudgetCodeList();
    const item = list.find((b) => b.id === projectScopedCodeId);
    expect(item).toEqual({
      id: projectScopedCodeId,
      code: item!.code,
      departmentCode: null,
      departmentName: null,
      projectCode,
      projectName: '測試查詢專案',
      category: '專案費用',
      fiscalYear: '115',
      annualBudgetAmount: 50000,
      ownerEmployeeCode: null,
      ownerName: null,
    });
  });
});
