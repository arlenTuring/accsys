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

describe.skipIf(!hasIntegrationTestCredentials())('resubmitPurchaseOrder', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let managerId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdRequestIds: string[] = [];

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
    const { data: order } = await admin
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
        quote_count: 1,
        total_amount: 65000,
        status: 'returned',
      })
      .select()
      .single();
    createdOrderIds.push(order!.id);
    const { data: item } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: order!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 2,
        unit_price: 32500,
        total_price: 65000,
      })
      .select()
      .single();
    await admin.from('departments').update({ manager_employee_id: managerId }).eq('id', departmentId);

    currentEmployee.value = { id: applicantId };
    const { resubmitPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await resubmitPurchaseOrder(order!.id, {
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '月結30天',
      expectedDeliveryDays: 21,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseOrderItemId: item!.id, unitPrice: 40000 }],
    });
    expect(result).toEqual({ ok: true });

    const { data: updated } = await admin
      .from('purchase_orders')
      .select('status, current_step_order, payment_terms, total_amount')
      .eq('id', order!.id)
      .single();
    expect(updated!.status).toBe('pending_approval');
    expect(updated!.current_step_order).toBe(1);
    expect(updated!.payment_terms).toBe('月結30天');
    expect(Number(updated!.total_amount)).toBe(80000);

    const { data: items } = await admin
      .from('purchase_order_items')
      .select('unit_price, total_price')
      .eq('purchase_order_id', order!.id);
    expect(items).toHaveLength(1);
    expect(Number(items![0].unit_price)).toBe(40000);
  });

  it('rejects a resubmit from someone who is not the applicant', async () => {
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
    const { data: order } = await admin
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
        status: 'returned',
      })
      .select()
      .single();
    createdOrderIds.push(order!.id);

    currentEmployee.value = { id: managerId };
    const { resubmitPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await resubmitPurchaseOrder(order!.id, {
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: null,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [],
    });
    expect(result).toEqual({ ok: false, error: '只有申請人可以重新送出這張採購單' });
  });
});
