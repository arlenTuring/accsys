import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));

describe.skipIf(!hasIntegrationTestCredentials())('getCaseOverview', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let employeeId: string;
  let departmentId: string;
  let caseId: string;
  let caseNumber: string;
  let requestId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(1)
      .single();
    employeeId = emp!.id;
    departmentId = emp!.department_id;
    const { data: cn } = await admin.rpc('next_case_number');
    caseNumber = cn!;
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: pr } = await admin
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
    await admin.from('purchase_requests').delete().eq('id', requestId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
  });

  it('returns null for an unknown case number', async () => {
    const { getCaseOverview } = await import('@/lib/cases/queries');
    expect(await getCaseOverview('CP000000000')).toBeNull();
  });

  it('reports the existing 請購單 as approved and the other three forms as not yet created', async () => {
    const { getCaseOverview } = await import('@/lib/cases/queries');
    const overview = await getCaseOverview(caseNumber);
    expect(overview).not.toBeNull();
    expect(overview!.forms).toEqual([
      { formType: 'purchase_request', label: '請購單', itemCode: 'A1', exists: true, id: requestId, status: 'approved' },
      { formType: 'purchase_order', label: '採購單', itemCode: 'B1', exists: false, id: null, status: null },
      { formType: 'acceptance', label: '驗收單', itemCode: 'C1', exists: false, id: null, status: null },
      { formType: 'expense_request', label: '費用申請單', itemCode: 'D1', exists: false, id: null, status: null },
    ]);
  });
});
