import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, versionOf } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({
  value: null as null | { id: string; role: string; departmentId: string },
}));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

describe('expense request edit/withdraw', () => {
  // Fixture chain (approved PR -> approved PO -> approved acceptance ->
  // expense request) makes more round trips than sibling edit/withdraw
  // suites, so the default 5s per-test timeout is too tight.
  vi.setConfig({ testTimeout: 20000 });

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
  const createdExpenseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const code = `ERW-DEPT-${Date.now()}`;
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: `ERW-MGR-${Date.now()}`, name: '測試主管', department_id: anyDept!.id })
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
      .insert({
        employee_code: `ERW-GM-${Date.now()}`,
        name: '測試總經理',
        department_id: departmentId,
        is_general_manager: true,
      })
      .select()
      .single();
    generalManagerId = gm!.id;
    const { data: applicant } = await admin
      .from('employees')
      .insert({ employee_code: `ERW-APP-${Date.now()}`, name: '測試申請人', department_id: departmentId })
      .select()
      .single();
    applicantId = applicant!.id;
    const { data: other } = await admin
      .from('employees')
      .insert({ employee_code: `ERW-OTHER-${Date.now()}`, name: '測試其他人', department_id: departmentId })
      .select()
      .single();
    otherEmployeeId = other!.id;
    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `ERW-BC-${Date.now()}`,
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
    for (const id of createdExpenseIds.splice(0)) {
      await admin.from('expense_request_items').delete().eq('expense_request_id', id);
      await admin.from('approval_steps').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('expense_requests').delete().eq('id', id);
    }
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
    await admin
      .from('employees')
      .delete()
      .in('id', [applicantId, otherEmployeeId, generalManagerId, managerId]);
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
    const { createPurchaseOrder, approvePurchaseOrderStep } = await import(
      '@/lib/purchase-orders/actions'
    );
    const orderResult = await createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
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
      const result = await approvePurchaseOrderStep(orderResult.orderId, await versionOf('purchase_orders', orderResult.orderId));
      if (!result.ok) throw new Error(result.error);
    }

    return orderResult.orderId;
  }

  async function createApprovedAcceptance() {
    const orderId = await createApprovedPurchaseOrder();
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', orderId)
      .single();

    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createAcceptance, approveAcceptanceStep } = await import('@/lib/acceptances/actions');
    const result = await createAcceptance({ idempotencyKey: crypto.randomUUID(),
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-20',
      items: [{ purchaseOrderItemId: poItem!.id, passFail: 'pass' }],
    });
    if (!result.ok) throw new Error(result.error);
    createdAcceptanceIds.push(result.acceptanceId);

    // Same non-determinism caveat as the PO loop above: drive approval by the
    // DB's recorded current-step approver, not an assumed fixture employee.
    for (;;) {
      const { data: acceptance } = await admin
        .from('acceptances')
        .select('status, current_step_order')
        .eq('id', result.acceptanceId)
        .single();
      if (acceptance!.status === 'approved') break;
      const { data: step } = await admin
        .from('approval_steps')
        .select('approver_employee_id')
        .eq('form_type', 'acceptance')
        .eq('form_id', result.acceptanceId)
        .eq('step_order', acceptance!.current_step_order)
        .single();
      currentEmployee.value = { id: step!.approver_employee_id, role: 'staff', departmentId };
      const stepResult = await approveAcceptanceStep(result.acceptanceId, await versionOf('acceptances', result.acceptanceId));
      if (!stepResult.ok) throw new Error(stepResult.error);
    }

    return { acceptanceId: result.acceptanceId, orderId };
  }

  async function createTestExpenseRequest() {
    const { orderId } = await createApprovedAcceptance();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createExpenseRequest } = await import('@/lib/expense-requests/actions');
    const { data: acceptanceItem } = await admin
      .from('acceptance_items')
      .select('id')
      .eq('acceptance_id', createdAcceptanceIds[createdAcceptanceIds.length - 1])
      .single();
    const result = await createExpenseRequest({
      purchaseOrderId: orderId,
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-07',
      expectedPaymentDate: null,
      includedSourceItemIds: [acceptanceItem!.id],
    });
    if (!result.ok) throw new Error(result.error);
    createdExpenseIds.push(result.expenseRequestId);
    return result.expenseRequestId;
  }

  async function createTestStandaloneExpenseRequest() {
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createStandaloneExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createStandaloneExpenseRequest({
      budgetCodeId,
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-07',
      expectedPaymentDate: null,
      items: [{ description: '免走採購流程項目', amount: 3000 }],
    });
    if (!result.ok) throw new Error(result.error);
    createdExpenseIds.push(result.expenseRequestId);

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('status, current_step_order')
      .eq('id', result.expenseRequestId)
      .single();
    if (expenseRequest!.status !== 'pending_approval' || expenseRequest!.current_step_order !== 1) {
      throw new Error(
        `expected standalone fixture to auto-generate a pending first step, got status=${expenseRequest!.status} step=${expenseRequest!.current_step_order}`
      );
    }
    return result.expenseRequestId;
  }

  it('rejects update from a non-applicant', async () => {
    const expenseRequestId = await createTestExpenseRequest();
    const { data: item } = await admin
      .from('expense_request_items')
      .select('purchase_order_item_id')
      .eq('expense_request_id', expenseRequestId)
      .single();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { updateExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await updateExpenseRequest(expenseRequestId, {
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-08',
      expectedPaymentDate: null,
      includedSourceItemIds: [item!.purchase_order_item_id],
    });
    expect(result).toMatchObject({ ok: false, error: '只有申請人可以修改這張費用申請單' });
  });

  it('allows the applicant to edit before any approval, rebuilding the chain', async () => {
    const expenseRequestId = await createTestExpenseRequest();
    const { data: acceptanceItem } = await admin
      .from('acceptance_items')
      .select('id')
      .eq('acceptance_id', createdAcceptanceIds[createdAcceptanceIds.length - 1])
      .single();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updateExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await updateExpenseRequest(expenseRequestId, {
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '電匯',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-08',
      expectedPaymentDate: null,
      includedSourceItemIds: [acceptanceItem!.id],
    });
    expect(result).toEqual({ ok: true });

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('payment_method, invoice_month, current_step_order, status')
      .eq('id', expenseRequestId)
      .single();
    expect(expenseRequest!.payment_method).toBe('電匯');
    expect(expenseRequest!.invoice_month).toBe('2026-08');
    expect(expenseRequest!.current_step_order).toBe(1);
    expect(expenseRequest!.status).toBe('pending_approval');
  });

  it('rejects edit once the first step has already been approved', async () => {
    const expenseRequestId = await createTestExpenseRequest();
    currentEmployee.value = { id: managerId, role: 'staff', departmentId };
    const { approveExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    await approveExpenseRequestStep(expenseRequestId);

    const { data: acceptanceItem } = await admin
      .from('acceptance_items')
      .select('id')
      .eq('acceptance_id', createdAcceptanceIds[createdAcceptanceIds.length - 1])
      .single();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updateExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await updateExpenseRequest(expenseRequestId, {
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '電匯',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-08',
      expectedPaymentDate: null,
      includedSourceItemIds: [acceptanceItem!.id],
    });
    expect(result).toMatchObject({ ok: false, error: '只有尚未有人簽核的費用申請單可以修改' });
  });

  it('rejects withdraw from a non-applicant', async () => {
    const expenseRequestId = await createTestExpenseRequest();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { withdrawExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await withdrawExpenseRequest(expenseRequestId);
    expect(result).toMatchObject({ ok: false, error: '只有申請人可以撤回這張費用申請單' });
  });

  it('allows the applicant to withdraw before any approval, without deleting the row', async () => {
    const expenseRequestId = await createTestExpenseRequest();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { withdrawExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await withdrawExpenseRequest(expenseRequestId);
    expect(result).toEqual({ ok: true });

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('status, current_step_order')
      .eq('id', expenseRequestId)
      .single();
    expect(expenseRequest).toEqual({ status: 'withdrawn', current_step_order: null });
  });

  it('rejects update on a standalone (no-PO) expense request', async () => {
    const expenseRequestId = await createTestStandaloneExpenseRequest();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updateExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await updateExpenseRequest(expenseRequestId, {
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: '2026-08',
      expectedPaymentDate: null,
      includedSourceItemIds: [],
    });
    expect(result).toEqual({
      ok: false,
      error: '免走採購流程的費用申請單目前不支援編輯，請改用撤回後重新建立',
    });
  });

  it('allows withdrawing a standalone (no-PO) expense request', async () => {
    const expenseRequestId = await createTestStandaloneExpenseRequest();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { withdrawExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await withdrawExpenseRequest(expenseRequestId);
    expect(result).toEqual({ ok: true });

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('status, current_step_order')
      .eq('id', expenseRequestId)
      .single();
    expect(expenseRequest).toEqual({ status: 'withdrawn', current_step_order: null });
  });
});
