import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('purchase_orders + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let requestId: string;
  let employeeId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let supplierId: string;
  let orderId: string;

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
    budgetCodeId = bc!.id;
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
    requestId = pr!.id;
  });

  afterAll(async () => {
    if (orderId) await supabase.from('purchase_orders').delete().eq('id', orderId);
    if (requestId) await supabase.from('purchase_requests').delete().eq('id', requestId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts a purchase order with default status pending_approval', async () => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: requestId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '月結30天',
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    orderId = data!.id;
  });

  it('rejects a second purchase order for the same case', async () => {
    const { error } = await supabase.from('purchase_orders').insert({
      procurement_case_id: caseId,
      purchase_request_id: requestId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '月結30天',
    });
    expect(error).not.toBeNull();
  });

  it('rejects an invalid payment_terms value', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase2 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { error } = await supabase.from('purchase_orders').insert({
      procurement_case_id: pcase2!.id,
      purchase_request_id: requestId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '不是合法值',
    });
    expect(error).not.toBeNull();
    await supabase.from('procurement_cases').delete().eq('id', pcase2!.id);
  });

  it('inserts a line item and rejects unit_price <= 0', async () => {
    const { data, error } = await supabase
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
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
    expect(error).toBeNull();
    expect(data!.description).toBe('材料A');

    const { error: badPrice } = await supabase.from('purchase_order_items').insert({
      purchase_order_id: orderId,
      line_no: 2,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '壞單價',
      quantity: 1,
      unit_price: 0,
      total_price: 0,
    });
    expect(badPrice).not.toBeNull();
  });

  it('rejects a line item with quantity <= 0', async () => {
    const { error } = await supabase.from('purchase_order_items').insert({
      purchase_order_id: orderId,
      line_no: 3,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '零數量',
      quantity: 0,
      unit_price: 100,
      total_price: 100,
    });
    expect(error).not.toBeNull();
  });

  it('rejects a line item with unit_price <= 0', async () => {
    const { error } = await supabase.from('purchase_order_items').insert({
      purchase_order_id: orderId,
      line_no: 4,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '零單價',
      quantity: 1,
      unit_price: 0,
      total_price: 100,
    });
    expect(error).not.toBeNull();
  });

  it('rejects a line item with total_price <= 0', async () => {
    const { error } = await supabase.from('purchase_order_items').insert({
      purchase_order_id: orderId,
      line_no: 5,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '零總價',
      quantity: 1,
      unit_price: 100,
      total_price: 0,
    });
    expect(error).not.toBeNull();
  });
});
