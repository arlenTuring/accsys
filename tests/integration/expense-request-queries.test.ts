import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('expense request queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let orderId: string;
  let purchaseRequestId: string;
  let expenseRequestId: string;

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
    purchaseRequestId = pr!.id;
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: purchaseRequestId,
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
    orderId = po!.id;
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '查詢測試',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();

    currentEmployee.value = { id: applicantId };
    const actions = await import('@/lib/expense-requests/actions');
    const created = await actions.createExpenseRequest({
      purchaseOrderId: orderId,
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
    if (!created.ok) throw new Error(created.error);
    expenseRequestId = created.expenseRequestId;
  });

  afterAll(async () => {
    await admin.from('approval_steps').delete().eq('form_id', expenseRequestId);
    await admin.from('notifications').delete().eq('form_id', expenseRequestId);
    await admin.from('expense_requests').delete().eq('id', expenseRequestId);
    const { data: po } = await admin
      .from('purchase_orders')
      .select('procurement_case_id')
      .eq('id', orderId)
      .maybeSingle();
    await admin.from('purchase_orders').delete().eq('id', orderId);
    await admin.from('purchase_requests').delete().eq('id', purchaseRequestId);
    if (po?.procurement_case_id) {
      await admin.from('procurement_cases').delete().eq('id', po.procurement_case_id);
    }
    currentEmployee.value = null;
  });

  it('getMyExpenseRequests returns the applicant’s expense request', async () => {
    currentEmployee.value = { id: applicantId };
    const { getMyExpenseRequests } = await import('@/lib/expense-requests/queries');
    const rows = await getMyExpenseRequests();
    expect(rows.some((r) => r.id === expenseRequestId)).toBe(true);
  });

  it('getExpenseRequestDetail returns the payee name, batch date, and items', async () => {
    const { getExpenseRequestDetail } = await import('@/lib/expense-requests/queries');
    const detail = await getExpenseRequestDetail(expenseRequestId);
    expect(detail).not.toBeNull();
    expect(detail!.payeeName).toBeTruthy();
    expect(detail!.paymentBatchDate).toBe('2026-08-25');
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].description).toBe('查詢測試');
  });

  it('getEligiblePurchaseOrdersForExpenseRequest excludes an order that already has an expense request', async () => {
    const { getEligiblePurchaseOrdersForExpenseRequest } = await import(
      '@/lib/expense-requests/queries'
    );
    const eligible = await getEligiblePurchaseOrdersForExpenseRequest();
    expect(eligible.some((o) => o.id === orderId)).toBe(false);
  });
});
