import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));

describe('getFinanceCaseTracking', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;

  let employeeAId: string;
  let employeeAName: string;
  let departmentAId: string;
  let departmentACode: string;
  let supplierId: string;

  let departmentBId: string;
  let departmentBCode: string;
  let employeeBId: string;

  let caseCompletedId: string;
  let caseCompletedNumber: string;
  let caseInProgressId: string;
  let caseInProgressNumber: string;
  let caseReturnedOnlyId: string;
  let caseReturnedOnlyNumber: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();

    const { data: emp } = await admin
      .from('employees')
      .select('id, name, department_id, departments!employees_department_id_fkey(code)')
      .limit(1)
      .single();
    employeeAId = emp!.id;
    employeeAName = emp!.name;
    departmentAId = emp!.department_id;
    departmentACode = (emp!.departments as unknown as { code: string }).code;

    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

    departmentBCode = `CTQ-B-${Date.now()}`;
    const { data: deptB } = await admin
      .from('departments')
      .insert({ code: departmentBCode, name: '簽核追蹤測試部門B' })
      .select()
      .single();
    departmentBId = deptB!.id;

    const { data: empB } = await admin
      .from('employees')
      .insert({
        employee_code: `CTQ-EMP-B-${Date.now()}`,
        name: '簽核追蹤測試員工B',
        department_id: departmentBId,
      })
      .select()
      .single();
    employeeBId = empB!.id;

    // Case 1：四張表單全部存在且皆 approved -> completed
    const { data: cn1 } = await admin.rpc('next_case_number');
    const { data: case1 } = await admin
      .from('procurement_cases')
      .insert({ case_number: cn1!, created_by_employee_id: employeeAId })
      .select()
      .single();
    caseCompletedId = case1!.id;
    caseCompletedNumber = case1!.case_number;

    const { data: pr1 } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseCompletedId,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        status: 'approved',
      })
      .select()
      .single();

    const { data: po1 } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseCompletedId,
        purchase_request_id: pr1!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '預付款',
        status: 'approved',
      })
      .select()
      .single();

    const { data: acc1 } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: caseCompletedId,
        purchase_order_id: po1!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        contractor_supplier_id: supplierId,
        status: 'approved',
      })
      .select()
      .single();

    await admin.from('expense_requests').insert({
      procurement_case_id: caseCompletedId,
      purchase_order_id: po1!.id,
      acceptance_id: acc1!.id,
      applicant_employee_id: employeeAId,
      department_id: departmentAId,
      budget_owner_employee_id: employeeAId,
      payee_type: 'employee',
      payment_method: '匯款',
      status: 'approved',
    });

    // Case 2：請購已核准、採購還在 pending_approval -> in_progress，部門 B
    const { data: cn2 } = await admin.rpc('next_case_number');
    const { data: case2 } = await admin
      .from('procurement_cases')
      .insert({ case_number: cn2!, created_by_employee_id: employeeBId })
      .select()
      .single();
    caseInProgressId = case2!.id;
    caseInProgressNumber = case2!.case_number;

    const { data: pr2 } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseInProgressId,
        applicant_employee_id: employeeBId,
        department_id: departmentBId,
        budget_owner_employee_id: employeeBId,
        status: 'approved',
      })
      .select()
      .single();

    await admin.from('purchase_orders').insert({
      procurement_case_id: caseInProgressId,
      purchase_request_id: pr2!.id,
      applicant_employee_id: employeeBId,
      department_id: departmentBId,
      budget_owner_employee_id: employeeBId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '預付款',
      status: 'pending_approval',
    });

    // Case 3：只有請購單，且被退回，沒有任何表單 pending_approval -> in_progress
    const { data: cn3 } = await admin.rpc('next_case_number');
    const { data: case3 } = await admin
      .from('procurement_cases')
      .insert({ case_number: cn3!, created_by_employee_id: employeeAId })
      .select()
      .single();
    caseReturnedOnlyId = case3!.id;
    caseReturnedOnlyNumber = case3!.case_number;

    await admin.from('purchase_requests').insert({
      procurement_case_id: caseReturnedOnlyId,
      applicant_employee_id: employeeAId,
      department_id: departmentAId,
      budget_owner_employee_id: employeeAId,
      status: 'returned',
    });
  });

  afterAll(async () => {
    await admin.from('expense_requests').delete().eq('procurement_case_id', caseCompletedId);
    await admin.from('acceptances').delete().eq('procurement_case_id', caseCompletedId);
    await admin
      .from('purchase_orders')
      .delete()
      .in('procurement_case_id', [caseCompletedId, caseInProgressId]);
    await admin
      .from('purchase_requests')
      .delete()
      .in('procurement_case_id', [caseCompletedId, caseInProgressId, caseReturnedOnlyId]);
    await admin
      .from('procurement_cases')
      .delete()
      .in('id', [caseCompletedId, caseInProgressId, caseReturnedOnlyId]);
    await admin.from('employees').delete().eq('id', employeeBId);
    await admin.from('departments').delete().eq('id', departmentBId);
  });

  it('buckets a case with all four forms approved as completed', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseCompletedNumber);
    expect(row?.bucket).toBe('completed');
  });

  it('buckets a case with a pending_approval form as in_progress', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseInProgressNumber);
    expect(row?.bucket).toBe('in_progress');
  });

  it('buckets a case with only a returned form (no pending_approval) as in_progress', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseReturnedOnlyNumber);
    expect(row?.bucket).toBe('in_progress');
  });

  it('filters by department code to only that department’s cases', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ departmentCode: departmentBCode });
    expect(rows.some((r) => r.caseNumber === caseInProgressNumber)).toBe(true);
    expect(rows.some((r) => r.caseNumber === caseCompletedNumber)).toBe(false);
    expect(rows.some((r) => r.caseNumber === caseReturnedOnlyNumber)).toBe(false);
  });

  it('filters by keyword matching the case number', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ keyword: caseCompletedNumber });
    expect(rows).toHaveLength(1);
    expect(rows[0].caseNumber).toBe(caseCompletedNumber);
  });

  it('filters by keyword matching the applicant name', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ keyword: employeeAName });
    expect(rows.some((r) => r.caseNumber === caseCompletedNumber)).toBe(true);
    expect(rows.some((r) => r.caseNumber === caseInProgressNumber)).toBe(false);
  });

  it('excludes fixture cases when dateFrom is in the future', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ dateFrom: '9999-01-01' });
    const fixtureNumbers = [caseCompletedNumber, caseInProgressNumber, caseReturnedOnlyNumber];
    expect(rows.some((r) => fixtureNumbers.includes(r.caseNumber))).toBe(false);
  });

  it('ignores the date range filter entirely when dateFrom is after dateTo', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({ dateFrom: '2030-01-01', dateTo: '2020-01-01' });
    expect(rows.some((r) => r.caseNumber === caseCompletedNumber)).toBe(true);
  });

  it('reports the department name and code for a case', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseInProgressNumber);
    expect(row?.department).toEqual({ code: departmentBCode, name: '簽核追蹤測試部門B' });
  });

  it('getDepartmentFilterOptions includes the fixture departments', async () => {
    const { getDepartmentFilterOptions } = await import('@/lib/case-tracking/queries');
    const options = await getDepartmentFilterOptions();
    expect(options.some((d) => d.code === departmentACode)).toBe(true);
    expect(options.some((d) => d.code === departmentBCode)).toBe(true);
  });

  it('marks a standalone_expense case as completed once its sole expense_request is approved', async () => {
    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `CTQ-SAE-BC-${Date.now()}`,
        department_id: departmentAId,
        category: '雜項購置',
        fiscal_year: '115',
        annual_budget_amount: 50000,
        owner_employee_id: employeeAId,
      })
      .select()
      .single();

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeAId, case_type: 'standalone_expense' })
      .select()
      .single();

    const { data: expenseRequest } = await admin
      .from('expense_requests')
      .insert({
        procurement_case_id: pcase!.id,
        budget_code_id: budgetCode!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        payee_type: 'employee',
        payment_method: '匯款',
        total_amount: 500,
        status: 'approved',
      })
      .select()
      .single();

    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseNumber);
    expect(row?.bucket).toBe('completed');

    await admin.from('expense_requests').delete().eq('id', expenseRequest!.id);
    await admin.from('procurement_cases').delete().eq('id', pcase!.id);
    await admin.from('budget_codes').delete().eq('id', budgetCode!.id);
  });

  it('marks a case as withdrawn when any of its forms has been withdrawn, taking priority over completion status', async () => {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeAId })
      .select()
      .single();

    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: employeeAId,
        department_id: departmentAId,
        budget_owner_employee_id: employeeAId,
        total_amount: 1000,
        status: 'withdrawn',
      })
      .select()
      .single();

    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    const rows = await getFinanceCaseTracking({});
    const row = rows.find((r) => r.caseNumber === caseNumber);
    expect(row?.bucket).toBe('withdrawn');

    await admin.from('purchase_requests').delete().eq('id', pr!.id);
    await admin.from('procurement_cases').delete().eq('id', pcase!.id);
  });
});
