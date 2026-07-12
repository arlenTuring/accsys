import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

describe.skipIf(!hasIntegrationTestCredentials())('acceptance approve/return + property tag', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let departmentId: string;
  let supplierId: string;
  let budgetCodeId: string;
  const createdCaseIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAcceptanceIds: string[] = [];

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
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeAcceptanceWithOneStep() {
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
        current_step_order: 1,
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
        pass_fail: 'pass',
      })
      .select()
      .single();
    await admin.from('approval_steps').insert({
      form_type: 'acceptance',
      form_id: acceptance!.id,
      step_order: 1,
      approver_employee_id: managerId,
      approver_role: 'department_manager',
    });
    return { acceptanceId: acceptance!.id, itemId: item!.id };
  }

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

  it('marks the acceptance approved and notifies the applicant on the final approve', async () => {
    const { acceptanceId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: managerId, role: 'staff' };
    const { approveAcceptanceStep } = await import('@/lib/acceptances/actions');
    const result = await approveAcceptanceStep(acceptanceId);
    expect(result).toEqual({ ok: true });

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('status, current_step_order')
      .eq('id', acceptanceId)
      .single();
    expect(acceptance).toEqual({ status: 'approved', current_step_order: null });
  });

  it('marks the acceptance returned with a reason', async () => {
    const { acceptanceId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: managerId, role: 'staff' };
    const { returnAcceptanceStep } = await import('@/lib/acceptances/actions');
    const result = await returnAcceptanceStep(acceptanceId, '財產編號待補');
    expect(result).toEqual({ ok: true });

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('status')
      .eq('id', acceptanceId)
      .single();
    expect(acceptance!.status).toBe('returned');
  });

  it('rejects a property-tag update from a non-finance, non-admin employee', async () => {
    const { itemId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { updateAcceptanceItemPropertyTag } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptanceItemPropertyTag(itemId, 'PROP-0001');
    expect(result).toEqual({ ok: false, error: '只有財會人員可以填寫財產編號' });
  });

  it('lets finance update the property tag', async () => {
    const { acceptanceId, itemId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: managerId, role: 'staff' };
    const { approveAcceptanceStep, updateAcceptanceItemPropertyTag } = await import(
      '@/lib/acceptances/actions'
    );
    const approveResult = await approveAcceptanceStep(acceptanceId);
    expect(approveResult).toEqual({ ok: true });

    currentEmployee.value = { id: applicantId, role: 'finance' };
    const result = await updateAcceptanceItemPropertyTag(itemId, 'PROP-0001');
    expect(result).toEqual({ ok: true });

    const { data: item } = await admin
      .from('acceptance_items')
      .select('property_tag')
      .eq('id', itemId)
      .single();
    expect(item!.property_tag).toBe('PROP-0001');
  });

  it('rejects a property-tag update while the acceptance is still pending_approval', async () => {
    const { itemId } = await makeAcceptanceWithOneStep();
    currentEmployee.value = { id: applicantId, role: 'finance' };
    const { updateAcceptanceItemPropertyTag } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptanceItemPropertyTag(itemId, 'PROP-0002');
    expect(result).toEqual({ ok: false, error: '只能在驗收單已核准後填寫財產編號' });
  });
});
