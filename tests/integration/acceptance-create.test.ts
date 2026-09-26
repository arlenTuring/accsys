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

describe('createAcceptance', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  const createdCaseIds: string[] = [];
  const createdRequestIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAcceptanceIds: string[] = [];

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

  async function makeApprovedOrder() {
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
        payment_terms: '貨到付款',
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
        quantity: 2,
        unit_price: 32500,
        total_price: 65000,
      })
      .select()
      .single();
    return { orderId: po!.id, itemId: item!.id };
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

  it('rejects when the source purchase order is not approved', async () => {
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
        payment_terms: '貨到付款',
        status: 'pending_approval',
      })
      .select()
      .single();
    createdOrderIds.push(po!.id);

    currentEmployee.value = { id: applicantId };
    const { createAcceptance } = await import('@/lib/acceptances/actions');
    const result = await createAcceptance({
      purchaseOrderId: po!.id,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [],
    });
    expect(result).toMatchObject({ ok: false, error: '來源採購單尚未核准，無法建立驗收單' });
  });

  it('creates an acceptance copying items and pass/fail from the caller', async () => {
    const { orderId, itemId } = await makeApprovedOrder();
    currentEmployee.value = { id: applicantId };
    const { createAcceptance } = await import('@/lib/acceptances/actions');
    const result = await createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [{ purchaseOrderItemId: itemId, passFail: 'pass' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdAcceptanceIds.push(result.acceptanceId);

    const { data: acceptance } = await admin
      .from('acceptances')
      .select('total_amount, status')
      .eq('id', result.acceptanceId)
      .single();
    expect(Number(acceptance!.total_amount)).toBe(65000);

    const { data: items } = await admin
      .from('acceptance_items')
      .select('description, quantity, pass_fail')
      .eq('acceptance_id', result.acceptanceId);
    expect(items).toEqual([{ description: '材料A', quantity: 2, pass_fail: 'pass' }]);
  });

  it('rejects a second acceptance for the same case', async () => {
    const { orderId, itemId } = await makeApprovedOrder();
    currentEmployee.value = { id: applicantId };
    const { createAcceptance } = await import('@/lib/acceptances/actions');
    const first = await createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [{ purchaseOrderItemId: itemId, passFail: 'pass' }],
    });
    if (first.ok) createdAcceptanceIds.push(first.acceptanceId);

    const second = await createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-15',
      items: [{ purchaseOrderItemId: itemId, passFail: 'pass' }],
    });
    expect(second).toMatchObject({ ok: false, error: '此案件已建立過驗收單' });
  });
});
