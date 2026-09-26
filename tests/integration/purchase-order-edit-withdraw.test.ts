import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, versionOf } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

describe('purchase order edit/withdraw', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentId: string;
  let managerId: string;
  let generalManagerId: string;
  let applicantId: string;
  let otherEmployeeId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const code = `POW-DEPT-${Date.now()}`;
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: `POW-MGR-${Date.now()}`, name: '測試主管', department_id: anyDept!.id })
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
      .insert({ employee_code: `POW-GM-${Date.now()}`, name: '測試總經理', department_id: departmentId, is_general_manager: true })
      .select()
      .single();
    generalManagerId = gm!.id;
    const { data: applicant } = await admin
      .from('employees')
      .insert({ employee_code: `POW-APP-${Date.now()}`, name: '測試申請人', department_id: departmentId })
      .select()
      .single();
    applicantId = applicant!.id;
    const { data: other } = await admin
      .from('employees')
      .insert({ employee_code: `POW-OTHER-${Date.now()}`, name: '測試其他人', department_id: departmentId })
      .select()
      .single();
    otherEmployeeId = other!.id;
    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `POW-BC-${Date.now()}`,
        department_id: departmentId,
        category: '雜項購置',
        fiscal_year: '115',
        annual_budget_amount: 1000000,
        owner_employee_id: managerId,
      })
      .select()
      .single();
    budgetCodeId = budgetCode!.id;
    const { data: supplier } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = supplier!.id;
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdOrderIds.splice(0)) {
      await admin.from('purchase_order_items').delete().eq('purchase_order_id', id);
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_order').eq('form_id', id);
      await admin.from('purchase_orders').delete().eq('id', id);
    }
    for (const id of createdRequestIds.splice(0)) {
      await admin.from('purchase_request_items').delete().eq('purchase_request_id', id);
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('purchase_requests').delete().eq('id', id);
    }
    for (const id of createdCaseIds.splice(0)) {
      await admin.from('procurement_cases').delete().eq('id', id);
    }
  });

  afterAll(async () => {
    await admin.from('budget_codes').delete().eq('id', budgetCodeId);
    await admin.from('departments').update({ manager_employee_id: null }).eq('id', departmentId);
    await admin.from('employees').delete().in('id', [applicantId, otherEmployeeId, generalManagerId, managerId]);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  async function createTestOrder() {
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
        budget_owner_employee_id: managerId,
        status: 'approved',
      })
      .select()
      .single();
    createdRequestIds.push(pr!.id);
    const { data: prItem } = await admin
      .from('purchase_request_items')
      .insert({
        purchase_request_id: pr!.id,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '測試項目',
        quantity: 1,
        estimated_amount: 5000,
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
      purchaseRequestId: pr!.id,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 5000 }],
    });
    if (!result.ok) throw new Error(result.error);
    createdOrderIds.push(result.orderId);
    return result.orderId;
  }

  it('rejects update from a non-applicant', async () => {
    const orderId = await createTestOrder();
    const { data: item } = await admin
      .from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', orderId)
      .single();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { updatePurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await updatePurchaseOrder(orderId, { expectedVersion: await versionOf('purchase_orders', orderId),
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [{ purchaseOrderItemId: item!.id, unitPrice: 6000 }],
    });
    expect(result).toMatchObject({ ok: false, error: '只有申請人可以修改這張採購單' });
  });

  it('allows the applicant to edit before any approval, rebuilding the chain', async () => {
    const orderId = await createTestOrder();
    const { data: item } = await admin
      .from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', orderId)
      .single();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updatePurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await updatePurchaseOrder(orderId, { expectedVersion: await versionOf('purchase_orders', orderId),
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '月結30天',
      expectedDeliveryDays: 21,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [{ purchaseOrderItemId: item!.id, unitPrice: 8000 }],
    });
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('total_amount, payment_terms, current_step_order, status')
      .eq('id', orderId)
      .single();
    expect(Number(order!.total_amount)).toBe(8000);
    expect(order!.payment_terms).toBe('月結30天');
    expect(order!.current_step_order).toBe(1);
    expect(order!.status).toBe('pending_approval');
  });

  it('rejects edit once the first step has already been approved', async () => {
    const orderId = await createTestOrder();
    currentEmployee.value = { id: managerId, role: 'staff', departmentId };
    const { approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    await approvePurchaseOrderStep(orderId, await versionOf('purchase_orders', orderId));

    const { data: item } = await admin
      .from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', orderId)
      .single();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updatePurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await updatePurchaseOrder(orderId, { expectedVersion: await versionOf('purchase_orders', orderId),
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [{ purchaseOrderItemId: item!.id, unitPrice: 9000 }],
    });
    expect(result).toMatchObject({ ok: false, error: '只有尚未有人簽核的採購單可以修改' });
  });

  it('rejects withdraw from a non-applicant', async () => {
    const orderId = await createTestOrder();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { withdrawPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await withdrawPurchaseOrder(orderId);
    expect(result).toMatchObject({ ok: false, error: '只有申請人可以撤回這張採購單' });
  });

  it('allows the applicant to withdraw before any approval, without deleting the row', async () => {
    const orderId = await createTestOrder();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { withdrawPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    const result = await withdrawPurchaseOrder(orderId);
    expect(result).toEqual({ ok: true });

    const { data: order } = await admin
      .from('purchase_orders')
      .select('status, current_step_order')
      .eq('id', orderId)
      .single();
    expect(order).toEqual({ status: 'withdrawn', current_step_order: null });
  });
});
