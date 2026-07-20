import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

describe.skipIf(!hasIntegrationTestCredentials())('createStandaloneExpenseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentId: string;
  let managerId: string;
  let generalManagerId: string;
  let applicantId: string;
  let budgetCodeId: string;
  const createdCaseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const code = `SAE-DEPT-${Date.now()}`;

    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();

    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: `SAE-MGR-${Date.now()}`, name: '測試主管', department_id: anyDept!.id })
      .select()
      .single();
    managerId = manager!.id;

    const { data: dept } = await admin
      .from('departments')
      .insert({ code, name: '測試部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;
    await admin.from('employees').update({ department_id: departmentId }).eq('id', managerId);

    const { data: gm } = await admin
      .from('employees')
      .insert({
        employee_code: `SAE-GM-${Date.now()}`,
        name: '測試總經理',
        department_id: departmentId,
        is_general_manager: true,
      })
      .select()
      .single();
    generalManagerId = gm!.id;

    const { data: applicant } = await admin
      .from('employees')
      .insert({ employee_code: `SAE-APP-${Date.now()}`, name: '測試申請人', department_id: departmentId })
      .select()
      .single();
    applicantId = applicant!.id;

    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `SAE-BC-${Date.now()}`,
        department_id: departmentId,
        category: '雜項購置',
        fiscal_year: '115',
        annual_budget_amount: 100000,
        owner_employee_id: managerId,
      })
      .select()
      .single();
    budgetCodeId = budgetCode!.id;
  });

  afterAll(async () => {
    if (createdCaseIds.length > 0) {
      for (const caseId of createdCaseIds) {
        await admin.from('expense_request_items').delete().in(
          'expense_request_id',
          (await admin.from('expense_requests').select('id').eq('procurement_case_id', caseId)).data?.map((r) => r.id) ?? []
        );
        await admin.from('approval_steps').delete().eq('form_id', caseId);
        await admin.from('expense_requests').delete().eq('procurement_case_id', caseId);
        await admin.from('procurement_cases').delete().eq('id', caseId);
      }
    }
    await admin.from('budget_codes').delete().eq('id', budgetCodeId);
    await admin.from('departments').update({ manager_employee_id: null }).eq('id', departmentId);
    await admin.from('employees').delete().in('id', [applicantId, generalManagerId, managerId]);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  it('rejects a total amount at or above the 10000 threshold', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createStandaloneExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createStandaloneExpenseRequest({
      budgetCodeId,
      payeeType: 'employee',
      payeeSupplierId: null,
      paymentMethod: '匯款',
      bankName: '測試銀行',
      bankAccount: '1234567',
      accountName: '測試申請人',
      invoiceMonth: null,
      expectedPaymentDate: '2026-08-01',
      items: [{ description: '測試項目', amount: 10000 }],
    });
    expect(result).toEqual({
      ok: false,
      error: '免走採購流程的費用申請單總金額須低於 NT$ 10,000，請改用一般採購流程建立',
    });
  });

  it('creates a standalone expense request under the threshold with its own new case', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createStandaloneExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createStandaloneExpenseRequest({
      budgetCodeId,
      payeeType: 'employee',
      payeeSupplierId: null,
      paymentMethod: '匯款',
      bankName: '測試銀行',
      bankAccount: '1234567',
      accountName: '測試申請人',
      invoiceMonth: null,
      expectedPaymentDate: '2026-08-01',
      items: [{ description: '計程車資', amount: 500 }, { description: '文具用品', amount: 300 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('purchase_order_id, budget_code_id, total_amount, procurement_case_id')
      .eq('id', result.expenseRequestId)
      .single();
    createdCaseIds.push(expenseRequest!.procurement_case_id);
    expect(expenseRequest!.purchase_order_id).toBeNull();
    expect(expenseRequest!.budget_code_id).toBe(budgetCodeId);
    expect(Number(expenseRequest!.total_amount)).toBe(800);

    const { data: pcase } = await admin
      .from('procurement_cases')
      .select('case_type')
      .eq('id', expenseRequest!.procurement_case_id)
      .single();
    expect(pcase!.case_type).toBe('standalone_expense');
  });
});
