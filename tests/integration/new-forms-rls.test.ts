import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonTestClient,
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('new forms RLS', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  const password = 'Test-password-123!';
  const applicantEmail = `rls-po-applicant-${Date.now()}@turing-drive.com`;
  const outsiderEmail = `rls-po-outsider-${Date.now()}@turing-drive.com`;
  let deptId: string;
  let applicantEmpId: string;
  let outsiderEmpId: string;
  let applicantAuthId: string;
  let outsiderAuthId: string;
  let supplierId: string;
  let caseId: string;
  let requestId: string;
  let orderId: string;
  let attachmentId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: dept } = await admin
      .from('departments')
      .insert({ code: `RLS-PO-${Date.now()}`, name: 'RLS 採購測試部門' })
      .select()
      .single();
    deptId = dept!.id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    supplierId = sup!.id;

    const { data: a } = await admin.auth.admin.createUser({
      email: applicantEmail,
      password,
      email_confirm: true,
    });
    applicantAuthId = a!.user.id;
    const { data: o } = await admin.auth.admin.createUser({
      email: outsiderEmail,
      password,
      email_confirm: true,
    });
    outsiderAuthId = o!.user.id;

    const { data: emps } = await admin
      .from('employees')
      .insert([
        {
          employee_code: `RLS-PO-A-${Date.now()}`,
          name: 'RLS 採購申請人',
          department_id: deptId,
          google_email: applicantEmail,
          role: 'staff',
        },
        {
          employee_code: `RLS-PO-O-${Date.now()}`,
          name: 'RLS 採購外人',
          department_id: deptId,
          google_email: outsiderEmail,
          role: 'staff',
        },
      ])
      .select();
    applicantEmpId = emps!.find((e) => e.google_email === applicantEmail)!.id;
    outsiderEmpId = emps!.find((e) => e.google_email === outsiderEmail)!.id;

    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantEmpId })
      .select()
      .single();
    caseId = pcase!.id;
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: applicantEmpId,
        department_id: deptId,
        budget_owner_employee_id: applicantEmpId,
        total_amount: 1000,
        current_step_order: 1,
      })
      .select()
      .single();
    requestId = pr!.id;
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: requestId,
        applicant_employee_id: applicantEmpId,
        department_id: deptId,
        budget_owner_employee_id: applicantEmpId,
        supplier_id: supplierId,
        payment_method: '匯款',
        payment_terms: '貨到付款',
        total_amount: 1000,
        current_step_order: 1,
      })
      .select()
      .single();
    orderId = po!.id;
    const { data: att } = await admin
      .from('attachments')
      .insert({
        form_type: 'purchase_order',
        form_id: orderId,
        uploaded_by_employee_id: applicantEmpId,
        storage_path: `purchase_order/${orderId}/quote.pdf`,
        file_name: 'quote.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 10,
      })
      .select()
      .single();
    attachmentId = att!.id;
  });

  afterAll(async () => {
    await admin.from('attachments').delete().eq('id', attachmentId);
    await admin.from('purchase_orders').delete().eq('id', orderId);
    await admin.from('purchase_requests').delete().eq('id', requestId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
    await admin.from('employees').delete().eq('department_id', deptId);
    await admin.from('departments').delete().eq('id', deptId);
    await admin.auth.admin.deleteUser(applicantAuthId);
    await admin.auth.admin.deleteUser(outsiderAuthId);
  });

  it('lets the applicant read their own purchase order and its attachment', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data: po } = await client.from('purchase_orders').select('id').eq('id', orderId);
    expect(po).toHaveLength(1);
    const { data: att } = await client
      .from('attachments')
      .select('id')
      .eq('id', attachmentId);
    expect(att).toHaveLength(1);
  });

  it('hides the purchase order and attachment from an unrelated employee', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: outsiderEmail, password });
    const { data: po } = await client.from('purchase_orders').select('id').eq('id', orderId);
    expect(po).toEqual([]);
    const { data: att } = await client
      .from('attachments')
      .select('id')
      .eq('id', attachmentId);
    expect(att).toEqual([]);
  });

  it('blocks a direct client insert into purchase_orders (writes are service-role only)', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { error } = await client.from('purchase_orders').insert({
      procurement_case_id: caseId,
      applicant_employee_id: applicantEmpId,
      department_id: deptId,
      budget_owner_employee_id: applicantEmpId,
      supplier_id: supplierId,
      payment_method: '匯款',
      payment_terms: '貨到付款',
    });
    expect(error).not.toBeNull();
  });

  it('blocks anonymous Storage download of the attachment bytes (service-role only)', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data, error } = await client.storage
      .from('attachments')
      .download(`purchase_order/${orderId}/quote.pdf`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});
