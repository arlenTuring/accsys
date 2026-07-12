import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
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

describe.skipIf(!hasIntegrationTestCredentials())('acceptance queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let requestId: string;
  let orderId: string;
  let acceptanceId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
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
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: pcase!.id,
        purchase_request_id: requestId,
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
    const actions = await import('@/lib/acceptances/actions');
    const created = await actions.createAcceptance({
      purchaseOrderId: orderId,
      contractorSupplierId: supplierId,
      acceptanceDate: '2026-07-20',
      items: [{ purchaseOrderItemId: poItem!.id, passFail: 'pass' }],
    });
    if (!created.ok) throw new Error(created.error);
    acceptanceId = created.acceptanceId;
  });

  afterAll(async () => {
    await admin.from('approval_steps').delete().eq('form_id', acceptanceId);
    await admin.from('notifications').delete().eq('form_id', acceptanceId);
    await admin.from('acceptances').delete().eq('id', acceptanceId);
    const { data: po } = await admin
      .from('purchase_orders')
      .select('procurement_case_id')
      .eq('id', orderId)
      .maybeSingle();
    await admin.from('purchase_orders').delete().eq('id', orderId);
    await admin.from('purchase_requests').delete().eq('id', requestId);
    if (po?.procurement_case_id) {
      await admin.from('procurement_cases').delete().eq('id', po.procurement_case_id);
    }
    currentEmployee.value = null;
  });

  it('getMyAcceptances returns the applicant’s acceptance', async () => {
    currentEmployee.value = { id: applicantId };
    const { getMyAcceptances } = await import('@/lib/acceptances/queries');
    const rows = await getMyAcceptances();
    expect(rows.some((r) => r.id === acceptanceId)).toBe(true);
  });

  it('getAcceptanceDetail returns items with pass/fail and null property tag', async () => {
    const { getAcceptanceDetail } = await import('@/lib/acceptances/queries');
    const detail = await getAcceptanceDetail(acceptanceId);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].passFail).toBe('pass');
    expect(detail!.items[0].propertyTag).toBeNull();
  });

  it('getEligiblePurchaseOrdersForAcceptance excludes an order that already has an acceptance', async () => {
    const { getEligiblePurchaseOrdersForAcceptance } = await import('@/lib/acceptances/queries');
    const eligible = await getEligiblePurchaseOrdersForAcceptance();
    expect(eligible.some((o) => o.id === orderId)).toBe(false);
  });
});
