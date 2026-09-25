import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';

describe('acceptances + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let orderId: string;
  let orderItemId: string;
  let employeeId: string;
  let departmentId: string;
  let supplierId: string;
  let acceptanceId: string;

  let purchaseRequestId: string;

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data: emp } = await supabase
      .from('employees')
      .select('id, department_id')
      .limit(1)
      .single();
    employeeId = emp!.id;
    departmentId = emp!.department_id;
    const { data: bc } = await supabase.from('budget_codes').select('id').limit(1).single();
    const { data: sup } = await supabase.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: pr } = await supabase
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        status: 'approved',
      })
      .select()
      .single();
    purchaseRequestId = pr!.id;
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: purchaseRequestId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
      })
      .select()
      .single();
    if (poError) throw new Error(`Failed to create purchase order: ${poError.message}`);
    orderId = po!.id;
    const { data: item } = await supabase
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: bc!.id,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        unit_price: 65000,
        total_price: 65000,
      })
      .select()
      .single();
    orderItemId = item!.id;
  });

  afterAll(async () => {
    if (acceptanceId) await supabase.from('acceptances').delete().eq('id', acceptanceId);
    if (orderId) await supabase.from('purchase_orders').delete().eq('id', orderId);
    if (purchaseRequestId) await supabase.from('purchase_requests').delete().eq('id', purchaseRequestId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts an acceptance with default status pending_approval', async () => {
    const { data, error } = await supabase
      .from('acceptances')
      .insert({
        procurement_case_id: caseId,
        purchase_order_id: orderId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        contractor_supplier_id: supplierId,
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    acceptanceId = data!.id;
  });

  it('rejects a second acceptance for the same case', async () => {
    const { error } = await supabase.from('acceptances').insert({
      procurement_case_id: caseId,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      contractor_supplier_id: supplierId,
    });
    expect(error).not.toBeNull();
  });

  it('inserts an item defaulting pass_fail to pass and rejects an invalid pass_fail', async () => {
    const { data, error } = await supabase
      .from('acceptance_items')
      .insert({
        acceptance_id: acceptanceId,
        line_no: 1,
        purchase_order_item_id: orderItemId,
        description: '材料A',
        quantity: 1,
        amount: 65000,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.pass_fail).toBe('pass');

    const { error: badPassFail } = await supabase.from('acceptance_items').insert({
      acceptance_id: acceptanceId,
      line_no: 2,
      purchase_order_item_id: orderItemId,
      description: '壞值',
      quantity: 1,
      amount: 1,
      pass_fail: 'maybe',
    });
    expect(badPassFail).not.toBeNull();
  });

  it('rejects acceptance_items with quantity <= 0', async () => {
    const { error } = await supabase.from('acceptance_items').insert({
      acceptance_id: acceptanceId,
      line_no: 3,
      purchase_order_item_id: orderItemId,
      description: 'Zero quantity',
      quantity: 0,
      amount: 100,
    });
    expect(error).not.toBeNull();
  });

  it('rejects acceptance_items with amount <= 0', async () => {
    const { error } = await supabase.from('acceptance_items').insert({
      acceptance_id: acceptanceId,
      line_no: 4,
      purchase_order_item_id: orderItemId,
      description: 'Zero amount',
      quantity: 1,
      amount: 0,
    });
    expect(error).not.toBeNull();
  });
});
