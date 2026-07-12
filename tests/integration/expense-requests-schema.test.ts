import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('expense_requests + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let orderId: string;
  let orderItemId: string;
  let employeeId: string;
  let departmentId: string;
  let supplierId: string;
  let expenseId: string;

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

    // Create a purchase_request first (required for purchase_orders)
    const { data: preq } = await supabase
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
      })
      .select()
      .single();
    const purchaseRequestId = preq!.id;

    const { data: po } = await supabase
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: purchaseRequestId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '預付款',
        status: 'approved',
      })
      .select()
      .single();
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
    if (expenseId) await supabase.from('expense_requests').delete().eq('id', expenseId);
    if (orderId) await supabase.from('purchase_orders').delete().eq('id', orderId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts a prepayment-path expense request with a null acceptance_id', async () => {
    const { data, error } = await supabase
      .from('expense_requests')
      .insert({
        procurement_case_id: caseId,
        purchase_order_id: orderId,
        acceptance_id: null,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        payee_type: 'supplier',
        payee_supplier_id: supplierId,
        payment_method: '匯款',
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    expenseId = data!.id;
  });

  it('rejects payee_type supplier without payee_supplier_id', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase2 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { error } = await supabase.from('expense_requests').insert({
      procurement_case_id: pcase2!.id,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      payee_type: 'supplier',
      payee_supplier_id: null,
      payment_method: '匯款',
    });
    expect(error).not.toBeNull();
    await supabase.from('procurement_cases').delete().eq('id', pcase2!.id);
  });

  it('inserts a line item and rejects amount <= 0', async () => {
    const { data, error } = await supabase
      .from('expense_request_items')
      .insert({
        expense_request_id: expenseId,
        line_no: 1,
        purchase_order_item_id: orderItemId,
        description: '材料A',
        amount: 65000,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.description).toBe('材料A');

    const { error: badAmount } = await supabase.from('expense_request_items').insert({
      expense_request_id: expenseId,
      line_no: 2,
      purchase_order_item_id: orderItemId,
      description: '壞金額',
      amount: 0,
    });
    expect(badAmount).not.toBeNull();
  });

  it('rejects invalid status', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase3 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { error } = await supabase.from('expense_requests').insert({
      procurement_case_id: pcase3!.id,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      payee_type: 'employee',
      payment_method: '匯款',
      status: 'invalid_status',
    });
    expect(error).not.toBeNull();
    await supabase.from('procurement_cases').delete().eq('id', pcase3!.id);
  });

  it('rejects invalid payee_type', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase4 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { error } = await supabase.from('expense_requests').insert({
      procurement_case_id: pcase4!.id,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      payee_type: 'invalid_type',
      payment_method: '匯款',
    });
    expect(error).not.toBeNull();
    await supabase.from('procurement_cases').delete().eq('id', pcase4!.id);
  });

  it('rejects payee_type employee with payee_supplier_id', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase5 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { error } = await supabase.from('expense_requests').insert({
      procurement_case_id: pcase5!.id,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      payee_type: 'employee',
      payee_supplier_id: supplierId,
      payment_method: '匯款',
    });
    expect(error).not.toBeNull();
    await supabase.from('procurement_cases').delete().eq('id', pcase5!.id);
  });

  it('rejects duplicate procurement_case_id in expense_requests', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase6 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const caseId2 = pcase6!.id;

    // Insert first expense request
    const { data: exp1 } = await supabase
      .from('expense_requests')
      .insert({
        procurement_case_id: caseId2,
        purchase_order_id: orderId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        payee_type: 'employee',
        payment_method: '匯款',
      })
      .select()
      .single();

    // Try to insert second expense request with same case_id
    const { error } = await supabase.from('expense_requests').insert({
      procurement_case_id: caseId2,
      purchase_order_id: orderId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      payee_type: 'employee',
      payment_method: '匯款',
    });
    expect(error).not.toBeNull();

    // Cleanup
    await supabase.from('expense_requests').delete().eq('id', exp1!.id);
    await supabase.from('procurement_cases').delete().eq('id', caseId2);
  });

  it('rejects duplicate line_no in expense_request_items', async () => {
    // Create a second expense request for this test
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase7 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const caseId2 = pcase7!.id;

    const { data: exp2 } = await supabase
      .from('expense_requests')
      .insert({
        procurement_case_id: caseId2,
        purchase_order_id: orderId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        payee_type: 'employee',
        payment_method: '匯款',
      })
      .select()
      .single();
    const expenseId2 = exp2!.id;

    // Insert first line item with line_no 1
    const { data: item1 } = await supabase
      .from('expense_request_items')
      .insert({
        expense_request_id: expenseId2,
        line_no: 1,
        purchase_order_item_id: orderItemId,
        description: '商品1',
        amount: 1000,
      })
      .select()
      .single();
    expect(item1).not.toBeNull();

    // Try to insert second line item with same line_no
    const { error } = await supabase.from('expense_request_items').insert({
      expense_request_id: expenseId2,
      line_no: 1,
      purchase_order_item_id: orderItemId,
      description: '商品2',
      amount: 2000,
    });
    expect(error).not.toBeNull();

    // Cleanup
    await supabase.from('expense_request_items').delete().eq('expense_request_id', expenseId2);
    await supabase.from('expense_requests').delete().eq('id', expenseId2);
    await supabase.from('procurement_cases').delete().eq('id', caseId2);
  });

  it('rejects negative amount in expense_request_items', async () => {
    // Create a third expense request for this test
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase8 } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const caseId3 = pcase8!.id;

    const { data: exp3 } = await supabase
      .from('expense_requests')
      .insert({
        procurement_case_id: caseId3,
        purchase_order_id: orderId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        payee_type: 'employee',
        payment_method: '匯款',
      })
      .select()
      .single();
    const expenseId3 = exp3!.id;

    // Try to insert line item with negative amount
    const { error } = await supabase.from('expense_request_items').insert({
      expense_request_id: expenseId3,
      line_no: 1,
      purchase_order_item_id: orderItemId,
      description: '負金額',
      amount: -1000,
    });
    expect(error).not.toBeNull();

    // Cleanup
    await supabase.from('expense_requests').delete().eq('id', expenseId3);
    await supabase.from('procurement_cases').delete().eq('id', caseId3);
  });
});
