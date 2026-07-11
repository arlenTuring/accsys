import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('purchase_requests + items schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let caseId: string;
  let employeeId: string;
  let departmentId: string;
  let budgetCodeId: string;
  let requestId: string;

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
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
  });

  afterAll(async () => {
    if (requestId) await supabase.from('purchase_requests').delete().eq('id', requestId);
    if (caseId) await supabase.from('procurement_cases').delete().eq('id', caseId);
  });

  it('inserts a purchase request with default status pending_approval', async () => {
    const { data, error } = await supabase
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
        needed_within_days: 30,
        total_amount: 65000,
        current_step_order: 1,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending_approval');
    requestId = data!.id;
  });

  it('rejects an invalid status', async () => {
    const { error } = await supabase.from('purchase_requests').insert({
      procurement_case_id: caseId,
      applicant_employee_id: employeeId,
      department_id: departmentId,
      budget_owner_employee_id: employeeId,
      status: 'not_a_status',
    });
    expect(error).not.toBeNull();
  });

  it('inserts a line item and rejects quantity <= 0 and estimated_amount <= 0', async () => {
    const { data, error } = await supabase
      .from('purchase_request_items')
      .insert({
        purchase_request_id: requestId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: '材料A',
        quantity: 1,
        estimated_amount: 65000,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.description).toBe('材料A');

    const { error: badQty } = await supabase.from('purchase_request_items').insert({
      purchase_request_id: requestId,
      line_no: 2,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '壞數量',
      quantity: 0,
      estimated_amount: 100,
    });
    expect(badQty).not.toBeNull();

    const { error: badAmount } = await supabase.from('purchase_request_items').insert({
      purchase_request_id: requestId,
      line_no: 3,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '壞金額',
      quantity: 1,
      estimated_amount: 0,
    });
    expect(badAmount).not.toBeNull();
  });

  it('rejects a duplicate (purchase_request_id, line_no)', async () => {
    const { error: dupLine } = await supabase.from('purchase_request_items').insert({
      purchase_request_id: requestId,
      line_no: 1,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: '重複項次',
      quantity: 1,
      estimated_amount: 100,
    });
    expect(dupLine).not.toBeNull();
  });

  it('cascades item deletion when the request is deleted', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data: pcase } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    const { data: pr } = await supabase
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: employeeId,
        department_id: departmentId,
        budget_owner_employee_id: employeeId,
      })
      .select()
      .single();
    await supabase.from('purchase_request_items').insert({
      purchase_request_id: pr!.id,
      line_no: 1,
      budget_code_id: budgetCodeId,
      item_category: '材料',
      description: 'cascade 測試',
      quantity: 1,
      estimated_amount: 1,
    });
    await supabase.from('purchase_requests').delete().eq('id', pr!.id);
    const { data: leftover } = await supabase
      .from('purchase_request_items')
      .select('id')
      .eq('purchase_request_id', pr!.id);
    expect(leftover).toEqual([]);
    await supabase.from('procurement_cases').delete().eq('id', pcase!.id);
  });
});
