import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';

// The overview is only shown to participants; act as the applicant created below.
const actor = vi.hoisted(() => ({ value: null as null | { id: string; role: string } }));
vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => actor.value }));

describe('getCaseOverview', () => {
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
      .limit(1)
      .single();
    employeeId = emp!.id;
    departmentId = emp!.department_id;
    actor.value = { id: employeeId, role: 'staff' };
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
      { formType: 'purchase_request', label: '請購單', itemCode: 'A1', exists: true, restricted: false, id: requestId, status: 'approved', hasAttachments: false },
      { formType: 'purchase_order', label: '採購單', itemCode: 'B1', exists: false, restricted: false, id: null, status: null, hasAttachments: false },
      { formType: 'acceptance', label: '驗收單', itemCode: 'C1', exists: false, restricted: false, id: null, status: null, hasAttachments: false },
      { formType: 'expense_request', label: '費用申請單', itemCode: 'D1', exists: false, restricted: false, id: null, status: null, hasAttachments: false },
    ]);
  });

  it('reports hasAttachments false for a form with no attachments', async () => {
    const { getCaseOverview } = await import('@/lib/cases/queries');
    const overview = await getCaseOverview(caseNumber);
    const requestEntry = overview!.forms.find((f) => f.formType === 'purchase_request');
    expect(requestEntry!.hasAttachments).toBe(false);
  });

  it('reports hasAttachments true once a form has at least one attachment', async () => {
    await admin.from('attachments').insert({
      form_type: 'purchase_request',
      form_id: requestId,
      uploaded_by_employee_id: employeeId,
      storage_path: `purchase_request/${requestId}/test-${Date.now()}.pdf`,
      file_name: 'test.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 100,
    });
    const { getCaseOverview } = await import('@/lib/cases/queries');
    const overview = await getCaseOverview(caseNumber);
    const requestEntry = overview!.forms.find((f) => f.formType === 'purchase_request');
    expect(requestEntry!.hasAttachments).toBe(true);
    await admin.from('attachments').delete().eq('form_id', requestId);
  });
});
