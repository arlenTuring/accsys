import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('expense request approve/return', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let supplierId: string;
  let budgetCodeId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdExpenseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(2);
    applicantId = emps![0].id;
    managerId = emps![1].id;
    departmentId = emps![0].department_id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
  });

  async function makeExpenseRequestWithOneStep() {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);

    // Create a purchase request first
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        status: 'approved',
      })
      .select()
      .single();

    // Create a purchase order (required for expense requests)
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: pr!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '預付款',
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);

    // Create a purchase order item
    await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: po!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();

    const { data: expenseRequest, error } = await admin
      .from('expense_requests')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_order_id: po!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        payee_type: 'supplier',
        payee_supplier_id: supplierId,
        payment_method: '匯款',
        total_amount: 65000,
        status: 'pending_approval',
        current_step_order: 1,
      })
      .select()
      .single();
    if (error) {
      throw new Error(`Failed to insert expense request: ${JSON.stringify(error)}`);
    }
    createdExpenseIds.push(expenseRequest!.id);
    await admin.from('approval_steps').insert({
      form_type: 'expense_request',
      form_id: expenseRequest!.id,
      step_order: 1,
      approver_employee_id: managerId,
      approver_role: 'department_manager',
    });
    return expenseRequest!.id;
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdExpenseIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('expense_requests').delete().eq('id', id);
    }
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_order_items').delete().eq('purchase_order_id', id);
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('purchase_requests').delete().eq('procurement_case_id', id);
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('marks the expense request approved and notifies the applicant on the final approve', async () => {
    const expenseRequestId = await makeExpenseRequestWithOneStep();
    currentEmployee.value = { id: managerId };
    const { approveExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    const result = await approveExpenseRequestStep(expenseRequestId);
    expect(result).toEqual({ ok: true });

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('status, current_step_order')
      .eq('id', expenseRequestId)
      .single();
    expect(expenseRequest).toEqual({ status: 'approved', current_step_order: null });

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type')
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequestId);
    expect(notifs).toEqual([{ recipient_employee_id: applicantId, type: 'request_approved' }]);
  });

  it('marks the expense request returned with a reason', async () => {
    const expenseRequestId = await makeExpenseRequestWithOneStep();
    currentEmployee.value = { id: managerId };
    const { returnExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    const result = await returnExpenseRequestStep(expenseRequestId, '銀行帳號填寫錯誤');
    expect(result).toEqual({ ok: true });

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('status')
      .eq('id', expenseRequestId)
      .single();
    expect(expenseRequest!.status).toBe('returned');
  });

  it('rejects an approve call from someone who is not the current approver', async () => {
    const expenseRequestId = await makeExpenseRequestWithOneStep();
    currentEmployee.value = { id: applicantId };
    const { approveExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    const result = await approveExpenseRequestStep(expenseRequestId);
    expect(result).toEqual({ ok: false, error: '您不是這張費用申請單目前的簽核人' });
  });

  it('only finalizes the approval once when approve is called twice concurrently for the same step', async () => {
    const expenseRequestId = await makeExpenseRequestWithOneStep();
    currentEmployee.value = { id: managerId };
    const { approveExpenseRequestStep } = await import('@/lib/expense-requests/actions');

    const [first, second] = await Promise.all([
      approveExpenseRequestStep(expenseRequestId),
      approveExpenseRequestStep(expenseRequestId),
    ]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    // This fixture is a one-step chain, so both concurrent calls race for the
    // FINAL approval and the notification fired is 'request_approved', not
    // 'approval_requested'.
    const { data: notifs } = await admin
      .from('notifications')
      .select('id')
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequestId)
      .eq('type', 'request_approved');
    expect(notifs).toHaveLength(1);
  });
});
