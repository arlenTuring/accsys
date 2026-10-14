import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, versionOf } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('resubmitExpenseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdExpenseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .limit(2);
    applicantId = emps![0].id;
    managerId = emps![1].id;
    departmentId = emps![0].department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
    await admin.from('departments').update({ manager_employee_id: managerId }).eq('id', departmentId);
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdExpenseIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('expense_requests').delete().eq('id', id);
    }
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdRequestIds.splice(0)) {
      await admin.from('purchase_requests').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('replaces items and approval steps, recomputes totals, and resets to pending_approval', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
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
    createdRequestIds.push(pr!.id);
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
    const { data: poItem } = await admin
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
    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_order_id: po!.id,
        acceptance_id: null,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        payee_type: 'supplier',
        payee_supplier_id: supplierId,
        payment_method: '匯款',
        total_amount: 65000,
        status: 'returned',
      })
      .select()
      .single();
    createdExpenseIds.push(expenseRequest!.id);

    currentEmployee.value = { id: applicantId };
    const { resubmitExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await resubmitExpenseRequest(expenseRequest!.id, {
      expectedVersion: await versionOf('expense_requests', expenseRequest!.id),
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-07',
      expectedPaymentDate: null,
      includedSourceItemIds: [poItem!.id],
    });
    expect(result).toEqual({ ok: true });

    const { data: updated } = await admin
      .from('expense_requests')
      .select('status, current_step_order, payment_batch_date, total_amount')
      .eq('id', expenseRequest!.id)
      .single();
    expect(updated!.status).toBe('pending_approval');
    expect(updated!.current_step_order).toBe(1);
    expect(updated!.payment_batch_date).toBe('2026-08-25');
    expect(Number(updated!.total_amount)).toBe(65000);

    const { data: steps } = await admin
      .from('approval_steps')
      .select('step_order, approver_employee_id')
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequest!.id)
      .order('step_order');
    expect(steps!.length).toBeGreaterThanOrEqual(1);
    expect(steps![0].approver_employee_id).toBe(managerId);
  });
});
