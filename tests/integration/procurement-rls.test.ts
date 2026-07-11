import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonTestClient,
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('procurement RLS', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  const password = 'Test-password-123!';
  const applicantEmail = `rls-pr-applicant-${Date.now()}@turing-drive.com`;
  const outsiderEmail = `rls-pr-outsider-${Date.now()}@turing-drive.com`;
  const approverEmail = `rls-pr-approver-${Date.now()}@turing-drive.com`;
  const secondApproverEmail = `rls-pr-approver2-${Date.now()}@turing-drive.com`;
  let deptId: string;
  let applicantEmpId: string;
  let outsiderEmpId: string;
  let approverEmpId: string;
  let secondApproverEmpId: string;
  let applicantAuthId: string;
  let outsiderAuthId: string;
  let approverAuthId: string;
  let secondApproverAuthId: string;
  let caseId: string;
  let requestId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: dept } = await admin
      .from('departments')
      .insert({ code: `RLS-PR-${Date.now()}`, name: 'RLS 請購測試部門' })
      .select()
      .single();
    deptId = dept!.id;

    const { data: a } = await admin.auth.admin.createUser({
      email: applicantEmail,
      password,
      email_confirm: true,
    });
    applicantAuthId = a!.user!.id;
    const { data: o } = await admin.auth.admin.createUser({
      email: outsiderEmail,
      password,
      email_confirm: true,
    });
    outsiderAuthId = o!.user!.id;
    const { data: ap } = await admin.auth.admin.createUser({
      email: approverEmail,
      password,
      email_confirm: true,
    });
    approverAuthId = ap!.user!.id;
    const { data: ap2 } = await admin.auth.admin.createUser({
      email: secondApproverEmail,
      password,
      email_confirm: true,
    });
    secondApproverAuthId = ap2!.user!.id;

    const { data: emps } = await admin
      .from('employees')
      .insert([
        {
          employee_code: `RLS-PR-A-${Date.now()}`,
          name: 'RLS 申請人',
          department_id: deptId,
          google_email: applicantEmail,
          role: 'staff',
        },
        {
          employee_code: `RLS-PR-O-${Date.now()}`,
          name: 'RLS 外人',
          department_id: deptId,
          google_email: outsiderEmail,
          role: 'staff',
        },
        {
          employee_code: `RLS-PR-AP-${Date.now()}`,
          name: 'RLS 簽核人',
          department_id: deptId,
          google_email: approverEmail,
          role: 'staff',
        },
        {
          employee_code: `RLS-PR-AP2-${Date.now()}`,
          name: 'RLS 簽核人二',
          department_id: deptId,
          google_email: secondApproverEmail,
          role: 'staff',
        },
      ])
      .select();
    applicantEmpId = emps!.find((e) => e.google_email === applicantEmail)!.id;
    outsiderEmpId = emps!.find((e) => e.google_email === outsiderEmail)!.id;
    approverEmpId = emps!.find((e) => e.google_email === approverEmail)!.id;
    secondApproverEmpId = emps!.find((e) => e.google_email === secondApproverEmail)!.id;

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

    await admin.from('approval_steps').insert({
      form_type: 'purchase_request',
      form_id: requestId,
      step_order: 1,
      approver_employee_id: approverEmpId,
      approver_role: 'department_manager',
    });
    await admin.from('approval_steps').insert({
      form_type: 'purchase_request',
      form_id: requestId,
      step_order: 2,
      approver_employee_id: secondApproverEmpId,
      approver_role: 'budget_owner',
    });
  });

  afterAll(async () => {
    await admin.from('approval_steps').delete().eq('form_id', requestId);
    await admin.from('purchase_requests').delete().eq('id', requestId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
    await admin.from('employees').delete().eq('department_id', deptId);
    await admin.from('departments').delete().eq('id', deptId);
    await admin.auth.admin.deleteUser(applicantAuthId);
    await admin.auth.admin.deleteUser(outsiderAuthId);
    await admin.auth.admin.deleteUser(approverAuthId);
    await admin.auth.admin.deleteUser(secondApproverAuthId);
  });

  it('lets the applicant read their own request', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data } = await client.from('purchase_requests').select('id').eq('id', requestId);
    expect(data).toHaveLength(1);
  });

  it('hides the request from an unrelated employee', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: outsiderEmail, password });
    const { data } = await client.from('purchase_requests').select('id').eq('id', requestId);
    expect(data).toEqual([]);
  });

  it('lets an assigned approver read the request', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: approverEmail, password });
    const { data } = await client.from('purchase_requests').select('id').eq('id', requestId);
    expect(data).toHaveLength(1);
  });

  it('lets any approver of the request read ALL its approval steps', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: secondApproverEmail, password });
    const { data } = await client.from('approval_steps').select('id').eq('form_id', requestId);
    expect(data).toHaveLength(2);
  });

  it('blocks a direct client insert into purchase_requests (writes are service-role only)', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { error } = await client.from('purchase_requests').insert({
      procurement_case_id: caseId,
      applicant_employee_id: applicantEmpId,
      department_id: deptId,
      budget_owner_employee_id: applicantEmpId,
    });
    expect(error).not.toBeNull();
  });

  it('lets a recipient read and mark their own notification read', async () => {
    const { data: notif } = await admin
      .from('notifications')
      .insert({
        recipient_employee_id: applicantEmpId,
        type: 'approval_requested',
        form_type: 'purchase_request',
        form_id: requestId,
        case_number: 'CP115070001',
        message: '待簽核',
      })
      .select()
      .single();
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: applicantEmail, password });
    const { data: read } = await client.from('notifications').select('id').eq('id', notif!.id);
    expect(read).toHaveLength(1);
    const { error: updErr } = await client
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notif!.id);
    expect(updErr).toBeNull();
    await admin.from('notifications').delete().eq('id', notif!.id);
  });
});
