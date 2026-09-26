import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, versionOf } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('resubmitAcceptance', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let secondSupplierId: string;
  const createdCaseIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAcceptanceIds: string[] = [];

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
    const { data: sups } = await admin.from('suppliers').select('id').limit(2);
    supplierId = sups![0].id;
    secondSupplierId = sups![1]?.id ?? sups![0].id;
    await admin.from('departments').update({ manager_employee_id: managerId }).eq('id', departmentId);
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdAcceptanceIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('acceptances').delete().eq('id', id);
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

  it('replaces items and approval steps and resets to pending_approval on resubmit', async () => {
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
        payment_terms: '貨到付款',
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
    const { data: acceptance } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_order_id: po!.id,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        contractor_supplier_id: supplierId,
        total_amount: 65000,
        status: 'returned',
      })
      .select()
      .single();
    createdAcceptanceIds.push(acceptance!.id);
    const { data: item } = await admin
      .from('acceptance_items')
      .insert({
        acceptance_id: acceptance!.id,
        line_no: 1,
        purchase_order_item_id: poItem!.id,
        description: '材料A',
        quantity: 1,
        amount: 65000,
        pass_fail: 'fail',
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId };
    const { resubmitAcceptance } = await import('@/lib/acceptances/actions');
    const result = await resubmitAcceptance(acceptance!.id, {
      expectedVersion: await versionOf('acceptances', acceptance!.id),
      contractorSupplierId: secondSupplierId,
      acceptanceDate: '2026-07-20',
      items: [{ acceptanceItemId: item!.id, passFail: 'pass' }],
    });
    expect(result).toEqual({ ok: true });

    const { data: updated } = await admin
      .from('acceptances')
      .select('status, current_step_order, contractor_supplier_id, acceptance_date')
      .eq('id', acceptance!.id)
      .single();
    expect(updated!.status).toBe('pending_approval');
    expect(updated!.current_step_order).toBe(1);
    expect(updated!.contractor_supplier_id).toBe(secondSupplierId);
    expect(updated!.acceptance_date).toBe('2026-07-20');

    const { data: items } = await admin
      .from('acceptance_items')
      .select('pass_fail')
      .eq('acceptance_id', acceptance!.id);
    expect(items).toEqual([{ pass_fail: 'pass' }]);
  });
});
