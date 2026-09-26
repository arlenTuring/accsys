import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
// Route the user-session client used by the queries to the service-role client for
// the test (RLS scoping itself is covered by new-forms-rls.test.ts).
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('purchase order queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let requestId: string;
  let orderId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .limit(1)
      .single();
    applicantId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
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
    requestId = pr!.id;
    const { data: prItem } = await admin
      .from('purchase_request_items')
      .insert({
        purchase_request_id: requestId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '查詢測試',
        quantity: 1,
        estimated_amount: 5000,
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId };
    const actions = await import('@/lib/purchase-orders/actions');
    const created = await actions.createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    orderId = created.orderId;
  });

  afterAll(async () => {
    await admin.from('approval_steps').delete().eq('form_id', orderId);
    await admin.from('notifications').delete().eq('form_id', orderId);
    await admin.from('purchase_orders').delete().eq('id', orderId);
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('procurement_case_id')
      .eq('id', requestId)
      .maybeSingle();
    await admin.from('purchase_requests').delete().eq('id', requestId);
    if (pr?.procurement_case_id) {
      await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
    }
    currentEmployee.value = null;
  });

  it('getMyPurchaseOrders returns the applicant’s order', async () => {
    currentEmployee.value = { id: applicantId };
    const { getMyPurchaseOrders } = await import('@/lib/purchase-orders/queries');
    const rows = await getMyPurchaseOrders();
    expect(rows.some((r) => r.id === orderId)).toBe(true);
  });

  it('getPurchaseOrderDetail returns items and steps', async () => {
    const { getPurchaseOrderDetail } = await import('@/lib/purchase-orders/queries');
    const detail = await getPurchaseOrderDetail(orderId);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].description).toBe('查詢測試');
    expect(detail!.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('getEligiblePurchaseRequestsForOrder excludes a request that already has an order', async () => {
    const { getEligiblePurchaseRequestsForOrder } = await import('@/lib/purchase-orders/queries');
    const eligible = await getEligiblePurchaseRequestsForOrder();
    expect(eligible.some((r) => r.id === requestId)).toBe(false);
  });

  it('getMyPurchaseOrderApprovalQueue returns orders pending the caller', async () => {
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_type', 'purchase_order')
      .eq('form_id', orderId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    const { getMyPurchaseOrderApprovalQueue } = await import('@/lib/purchase-orders/queries');
    const queue = await getMyPurchaseOrderApprovalQueue();
    expect(queue.some((q) => q.id === orderId)).toBe(true);
  });
});
