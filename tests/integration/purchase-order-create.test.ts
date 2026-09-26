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

describe('createPurchaseOrder', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdOrderIds: string[] = [];
  const createdCaseIds: string[] = [];
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .limit(1)
      .single();
    applicantId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await admin
      .from('budget_codes')
      .select('id')
      .eq('owner_employee_id', applicantId)
      .limit(1)
      .maybeSingle();
    budgetCodeId = bc?.id ?? (await admin.from('budget_codes').select('id').limit(1).single()).data!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
  });

  async function makeApprovedRequest() {
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
    await admin.from('purchase_request_items').insert({
      purchase_request_id: pr!.id,
      line_no: 1,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '材料A',
      quantity: 2,
      estimated_amount: 65000,
    });
    return { caseId: pcase!.id, requestId: pr!.id };
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

  it('rejects when the source purchase request is not approved', async () => {
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
        status: 'pending_approval',
      })
      .select()
      .single();
    createdRequestIds.push(pr!.id);

    currentEmployee.value = { id: applicantId };
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
      purchaseRequestId: pr!.id,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: null,
      items: [],
    });
    expect(result).toMatchObject({ ok: false, error: '來源請購單尚未核准，無法建立採購單' });
  });

  it('creates a purchase order copying items from the source request', async () => {
    const { requestId } = await makeApprovedRequest();
    const { data: prItem } = await admin
      .from('purchase_request_items')
      .select('id')
      .eq('purchase_request_id', requestId)
      .single();

    currentEmployee.value = { id: applicantId };
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 32500 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.orderId);

    const { data: order } = await admin
      .from('purchase_orders')
      .select('total_amount, status, current_step_order')
      .eq('id', result.orderId)
      .single();
    expect(Number(order!.total_amount)).toBe(65000);

    const { data: items } = await admin
      .from('purchase_order_items')
      .select('description, quantity, unit_price, total_price')
      .eq('purchase_order_id', result.orderId);
    expect(items).toHaveLength(1);
    expect(items![0].description).toBe('材料A');
    expect(items![0].quantity).toBe(2);
    expect(Number(items![0].unit_price)).toBe(32500);
    expect(Number(items![0].total_price)).toBe(65000);
  });

  it('rejects a second purchase order for the same case', async () => {
    const { requestId } = await makeApprovedRequest();
    const { data: prItem } = await admin
      .from('purchase_request_items')
      .select('id')
      .eq('purchase_request_id', requestId)
      .single();

    currentEmployee.value = { id: applicantId };
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const first = await createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 32500 }],
    });
    expect(first.ok).toBe(true);
    if (first.ok) createdOrderIds.push(first.orderId);

    const second = await createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
      purchaseRequestId: requestId,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 2,
      quoteCountReason: null,
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 32500 }],
    });
    expect(second).toMatchObject({ ok: false, error: '此案件已建立過採購單' });
  });
});
