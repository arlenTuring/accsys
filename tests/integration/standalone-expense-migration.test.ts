import { afterEach, describe, expect, it } from 'vitest';
import { createServiceRoleTestClient } from './supabase-test-client';

describe('standalone expense requests migration', () => {
  const admin = createServiceRoleTestClient();
  const createdCaseIds: string[] = [];

  afterEach(async () => {
    if (createdCaseIds.length > 0) {
      await admin.from('procurement_cases').delete().in('id', createdCaseIds);
      createdCaseIds.length = 0;
    }
  });

  it('defaults case_type to standard on existing insert path', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: (await admin.from('employees').select('id').limit(1).single()).data!.id })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);
    expect(pcase!.case_type).toBe('standard');
  });

  it('rejects an expense_requests row with neither purchase_order_id nor budget_code_id', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: anyEmployee } = await admin.from('employees').select('id, department_id').limit(1).single();
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: anyEmployee!.id, case_type: 'standalone_expense' })
      .select()
      .single();
    createdCaseIds.push(pcase!.id);

    const { error } = await admin.from('expense_requests').insert({
      procurement_case_id: pcase!.id,
      applicant_employee_id: anyEmployee!.id,
      department_id: anyEmployee!.department_id,
      budget_owner_employee_id: anyEmployee!.id,
      payee_type: 'employee',
      payment_method: '匯款',
      total_amount: 1000,
    });
    expect(error).not.toBeNull();
  });
});
