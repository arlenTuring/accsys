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

describe('createExpenseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdExpenseIds: string[] = [];

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
  });

  async function makePurchaseRequest(pcaseId: string) {
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcaseId,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        status: 'approved',
      })
      .select()
      .single();
    createdRequestIds.push(pr!.id);
    return pr!.id;
  }

  async function makeApprovedOrder(paymentTerms: string) {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    const purchaseRequestId = await makePurchaseRequest(pcase!.id);
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
        payment_terms: paymentTerms,
        total_amount: 65000,
        status: 'approved',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);
    const { data: item } = await admin
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
    return { orderId: po!.id, itemId: item!.id };
  }

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdExpenseIds.splice(0)) {
      await admin.from('approval_steps').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'expense_request').eq('form_id', id);
      await admin.from('expense_requests').delete().eq('id', id);
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

  it('rejects when there is no approved acceptance and payment terms are not 預付款', async () => {
    const { orderId, itemId } = await makeApprovedOrder('貨到付款');
    currentEmployee.value = { id: applicantId };
    const { createExpenseRequest } = await import('@/lib/expense-requests/actions');
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
      includedSourceItemIds: [itemId],
    });
    expect(result).toEqual({
      ok: false,
      error: '此採購單尚未完成驗收，且付款條件非預付款，無法建立費用申請單',
    });
  });

  it('creates an expense request via the 預付款 exception path (no acceptance needed)', async () => {
    const { orderId, itemId } = await makeApprovedOrder('預付款');
    currentEmployee.value = { id: applicantId };
    const { createExpenseRequest } = await import('@/lib/expense-requests/actions');
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
      includedSourceItemIds: [itemId],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdExpenseIds.push(result.expenseRequestId);
    expect(result.paymentBatchDate).toBe('2026-08-25');

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('acceptance_id, total_amount, payment_batch_date, status')
      .eq('id', result.expenseRequestId)
      .single();
    expect(expenseRequest!.acceptance_id).toBeNull();
    expect(Number(expenseRequest!.total_amount)).toBe(65000);
    expect(expenseRequest!.payment_batch_date).toBe('2026-08-25');
  });

  it('creates an expense request from an approved acceptance, excluding a Fail item', async () => {
    const { orderId } = await makeApprovedOrder('貨到付款');
    await admin.from('purchase_order_items').insert({
      purchase_order_id: orderId,
      line_no: 2,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '材料B',
      quantity: 1,
      unit_price: 5000,
      total_price: 5000,
    });
    const { data: allPoItems } = await admin
      .from('purchase_order_items')
      .select('id, description')
      .eq('purchase_order_id', orderId)
      .order('line_no');
    const { data: acceptance } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: (
          await admin.from('purchase_orders').select('procurement_case_id').eq('id', orderId).single()
        ).data!.procurement_case_id,
        purchase_order_id: orderId,
        applicant_employee_id: applicantId,
        department_id: departmentId,
        budget_owner_employee_id: applicantId,
        contractor_supplier_id: supplierId,
        total_amount: 70000,
        status: 'approved',
      })
      .select()
      .single();
    const { data: acceptanceItems } = await admin
      .from('acceptance_items')
      .insert([
        {
          acceptance_id: acceptance!.id,
          line_no: 1,
          purchase_order_item_id: allPoItems![0].id,
          description: '材料A',
          quantity: 1,
          amount: 65000,
          pass_fail: 'pass',
        },
        {
          acceptance_id: acceptance!.id,
          line_no: 2,
          purchase_order_item_id: allPoItems![1].id,
          description: '材料B',
          quantity: 1,
          amount: 5000,
          pass_fail: 'fail',
        },
      ])
      .select();
    const passItem = acceptanceItems!.find((i) => i.pass_fail === 'pass')!;

    currentEmployee.value = { id: applicantId };
    const { createExpenseRequest } = await import('@/lib/expense-requests/actions');
    const result = await createExpenseRequest({
      purchaseOrderId: orderId,
      payeeType: 'supplier',
      payeeSupplierId: supplierId,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: null,
      expectedPaymentDate: '2026-07-25',
      includedSourceItemIds: [passItem.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdExpenseIds.push(result.expenseRequestId);

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .select('acceptance_id, total_amount')
      .eq('id', result.expenseRequestId)
      .single();
    expect(expenseRequest!.acceptance_id).toBe(acceptance!.id);
    expect(Number(expenseRequest!.total_amount)).toBe(65000);

    const { data: items } = await admin
      .from('expense_request_items')
      .select('description, amount')
      .eq('expense_request_id', result.expenseRequestId);
    expect(items).toEqual([{ description: '材料A', amount: 65000 }]);

    await admin.from('acceptance_items').delete().eq('acceptance_id', acceptance!.id);
    await admin.from('acceptances').delete().eq('id', acceptance!.id);
  });
});
