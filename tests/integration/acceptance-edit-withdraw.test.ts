import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

describe('acceptance edit/withdraw', () => {
  // Fixture chain (approved PR -> approved PO with a 2-step approval loop ->
  // acceptance) makes more round trips than sibling edit/withdraw suites, so
  // the default 5s per-test timeout is too tight.
  vi.setConfig({ testTimeout: 15000 });

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
  const createdAcceptanceIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const code = `ACW-DEPT-${Date.now()}`;
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: `ACW-MGR-${Date.now()}`, name: '測試主管', department_id: anyDept!.id })
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
      .insert({ employee_code: `ACW-GM-${Date.now()}`, name: '測試總經理', department_id: departmentId, is_general_manager: true })
      .select()
      .single();
    generalManagerId = gm!.id;
    const { data: applicant } = await admin
      .from('employees')
      .insert({ employee_code: `ACW-APP-${Date.now()}`, name: '測試申請人', department_id: departmentId })
      .select()
      .single();
    applicantId = applicant!.id;
    const { data: other } = await admin
      .from('employees')
      .insert({ employee_code: `ACW-OTHER-${Date.now()}`, name: '測試其他人', department_id: departmentId })
      .select()
      .single();
    otherEmployeeId = other!.id;
    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `ACW-BC-${Date.now()}`,
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
    for (const id of createdAcceptanceIds.splice(0)) {
      await admin.from('acceptance_items').delete().eq('acceptance_id', id);
      await admin.from('approval_steps').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'acceptance').eq('form_id', id);
      await admin.from('acceptances').delete().eq('id', id);
    }
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

  async function createApprovedPurchaseOrder() {
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
    const { createPurchaseOrder, approvePurchaseOrderStep } = await import('@/lib/purchase-orders/actions');
    const orderResult = await createPurchaseOrder({
      purchaseRequestId: pr!.id,
      supplierId,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 14,
      quoteCount: 1,
      quoteCountReason: '僅一家廠商',
      items: [{ purchaseRequestItemId: prItem!.id, unitPrice: 5000 }],
    });
    if (!orderResult.ok) throw new Error(orderResult.error);
    createdOrderIds.push(orderResult.orderId);

    // Drive approval by whoever the DB actually names as the current step's
    // approver (rather than assuming it's generalManagerId): the shared
    // `is_general_manager` lookup in buildApprovalChainForForm can resolve to
    // any employee flagged that way, not necessarily this fixture's GM.
    for (;;) {
      const { data: order } = await admin
        .from('purchase_orders')
        .select('status, current_step_order')
        .eq('id', orderResult.orderId)
        .single();
      if (order!.status === 'approved') break;
      const { data: step } = await admin
        .from('approval_steps')
        .select('approver_employee_id')
        .eq('form_type', 'purchase_order')
        .eq('form_id', orderResult.orderId)
        .eq('step_order', order!.current_step_order)
        .single();
      currentEmployee.value = { id: step!.approver_employee_id, role: 'staff', departmentId };
      const result = await approvePurchaseOrderStep(orderResult.orderId);
      if (!result.ok) throw new Error(result.error);
    }

    return orderResult.orderId;
  }

  async function createTestAcceptance() {
    const orderId = await createApprovedPurchaseOrder();
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', orderId)
      .single();

    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createAcceptance } = await import('@/lib/acceptances/actions');
    const result = await createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-20',
      items: [{ purchaseOrderItemId: poItem!.id, passFail: 'pass' }],
    });
    if (!result.ok) throw new Error(result.error);
    createdAcceptanceIds.push(result.acceptanceId);
    return result.acceptanceId;
  }

  it('rejects update from a non-applicant', async () => {
    const acceptanceId = await createTestAcceptance();
    const { data: item } = await admin
      .from('acceptance_items')
      .select('id')
      .eq('acceptance_id', acceptanceId)
      .single();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { updateAcceptance } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptance(acceptanceId, {
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-21',
      items: [{ acceptanceItemId: item!.id, passFail: 'fail' }],
    });
    expect(result).toEqual({ ok: false, error: '只有申請人可以修改這張驗收單' });
  });

  it('allows the applicant to edit before any approval, rebuilding the chain', async () => {
    const acceptanceId = await createTestAcceptance();
    const { data: item } = await admin
      .from('acceptance_items')
      .select('id')
      .eq('acceptance_id', acceptanceId)
      .single();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updateAcceptance } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptance(acceptanceId, {
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-21',
      items: [{ acceptanceItemId: item!.id, passFail: 'fail' }],
    });
    expect(result).toEqual({ ok: true });

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('acceptance_date, current_step_order, status')
      .eq('id', acceptanceId)
      .single();
    expect(acceptance!.acceptance_date).toBe('2026-07-21');
    expect(acceptance!.current_step_order).toBe(1);
    expect(acceptance!.status).toBe('pending_approval');

    const { data: updatedItem } = await admin
      .from('acceptance_items')
      .select('pass_fail')
      .eq('acceptance_id', acceptanceId)
      .single();
    expect(updatedItem!.pass_fail).toBe('fail');
  });

  it('rejects edit once the first step has already been approved', async () => {
    const acceptanceId = await createTestAcceptance();
    currentEmployee.value = { id: managerId, role: 'staff', departmentId };
    const { approveAcceptanceStep } = await import('@/lib/acceptances/actions');
    await approveAcceptanceStep(acceptanceId);

    const { data: item } = await admin
      .from('acceptance_items')
      .select('id')
      .eq('acceptance_id', acceptanceId)
      .single();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updateAcceptance } = await import('@/lib/acceptances/actions');
    const result = await updateAcceptance(acceptanceId, {
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-22',
      items: [{ acceptanceItemId: item!.id, passFail: 'fail' }],
    });
    expect(result).toEqual({ ok: false, error: '只有尚未有人簽核的驗收單可以修改' });
  });

  it('rejects withdraw from a non-applicant', async () => {
    const acceptanceId = await createTestAcceptance();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { withdrawAcceptance } = await import('@/lib/acceptances/actions');
    const result = await withdrawAcceptance(acceptanceId);
    expect(result).toEqual({ ok: false, error: '只有申請人可以撤回這張驗收單' });
  });

  it('allows the applicant to withdraw before any approval, without deleting the row', async () => {
    const acceptanceId = await createTestAcceptance();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { withdrawAcceptance } = await import('@/lib/acceptances/actions');
    const result = await withdrawAcceptance(acceptanceId);
    expect(result).toEqual({ ok: true });

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('status, current_step_order')
      .eq('id', acceptanceId)
      .single();
    expect(acceptance).toEqual({ status: 'withdrawn', current_step_order: null });
  });
});
