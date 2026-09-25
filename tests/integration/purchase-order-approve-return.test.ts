import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('purchase order approve/return', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let managerId: string;
  let gmId: string;
  let departmentId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .limit(3);
    [applicantId, managerId, gmId] = emps!.map((e) => e.id);
    departmentId = emps![0].department_id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeOrderWithTwoSteps() {
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
    const { data: order, error: orderError } = await admin
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
        current_step_order: 1,
      })
      .select()
      .single();
    if (orderError) throw new Error(`Failed to create order: ${JSON.stringify(orderError)}`);
    createdOrderIds.push(order!.id);
    await admin.from('approval_steps').insert([
      {
        form_type: 'purchase_order',
        form_id: order!.id,
        step_order: 1,
        approver_employee_id: managerId,
        approver_role: 'department_manager',
      },
      {
        form_type: 'purchase_order',
        form_id: order!.id,
        step_order: 2,
        approver_employee_id: gmId,
        approver_role: 'general_manager',
      },
    ]);
    return order!.id;
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdRequestIds.splice(0)) {
      await admin.from('purchase_requests').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  it('rejects an approve call from someone who is not the current approver', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: applicantId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await approvePurchaseOrderStep(orderId);
    expect(result).toEqual({ ok: false, error: '您不是這張採購單目前的簽核人' });
  });

  it('advances to the next step and notifies the next approver on approve', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await approvePurchaseOrderStep(orderId);
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('status, current_step_order')
      .eq('id', orderId)
      .single();
    expect(order).toEqual({ status: 'pending_approval', current_step_order: 2 });

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type')
      .eq('form_type', 'purchase_order')
      .eq('form_id', orderId);
    expect(notifs).toEqual([{ recipient_employee_id: gmId, type: 'approval_requested' }]);
  });

  it('marks the order approved and notifies the applicant on the final approve', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    await approvePurchaseOrderStep(orderId);
    currentEmployee.value = { id: gmId };
    const result = await approvePurchaseOrderStep(orderId);
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('status, current_step_order')
      .eq('id', orderId)
      .single();
    expect(order).toEqual({ status: 'approved', current_step_order: null });
  });

  it('marks the order returned and notifies the applicant with the reason', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { returnPurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await returnPurchaseOrderStep(orderId, '報價單付款條件與費用申請單不一致');
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('status, current_step_order')
      .eq('id', orderId)
      .single();
    expect(order).toEqual({ status: 'returned', current_step_order: null });

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type, message')
      .eq('form_type', 'purchase_order')
      .eq('form_id', orderId);
    expect(notifs).toEqual([
      {
        recipient_employee_id: applicantId,
        type: 'request_returned',
        message: expect.stringContaining('報價單付款條件與費用申請單不一致'),
      },
    ]);
  });

  it('rejects a return with a blank reason', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { returnPurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const result = await returnPurchaseOrderStep(orderId, '   ');
    expect(result).toEqual({ ok: false, error: '請填寫退回原因' });
  });

  it('only advances the chain once when approve is called twice concurrently for the same step', async () => {
    const orderId = await makeOrderWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');

    const [first, second] = await Promise.all([
      approvePurchaseOrderStep(orderId),
      approvePurchaseOrderStep(orderId),
    ]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const { data: notifs } = await admin
      .from('notifications')
      .select('id')
      .eq('form_type', 'purchase_order')
      .eq('form_id', orderId)
      .eq('type', 'approval_requested');
    expect(notifs).toHaveLength(1);
  });
});
