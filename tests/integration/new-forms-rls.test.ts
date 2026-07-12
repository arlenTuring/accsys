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
  const approverEmail = `rls-po-approver-${Date.now()}@turing-drive.com`;
  const financeEmail = `rls-po-finance-${Date.now()}@turing-drive.com`;
  let deptId: string;
  let applicantEmpId: string;
  let approverEmpId: string;
  let applicantAuthId: string;
  let outsiderAuthId: string;
  let approverAuthId: string;
  let financeAuthId: string;
  let supplierId: string;
  let budgetCodeId: string;
  let caseId: string;
  let requestId: string;
  let orderId: string;
  let orderItemId: string;
  let acceptanceId: string;
  let acceptanceItemId: string;
  let expenseRequestId: string;
  let expenseRequestItemId: string;
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
    const { data: bc } = await admin.from('budget_codes').select('id').limit(1).single();
    budgetCodeId = bc!.id;

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
    const { data: ap } = await admin.auth.admin.createUser({
      email: approverEmail,
      password,
      email_confirm: true,
    });
    approverAuthId = ap!.user.id;
    const { data: f } = await admin.auth.admin.createUser({
      email: financeEmail,
      password,
      email_confirm: true,
    });
    financeAuthId = f!.user.id;

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
        {
          employee_code: `RLS-PO-AP-${Date.now()}`,
          name: 'RLS 採購簽核人',
          department_id: deptId,
          google_email: approverEmail,
          role: 'staff',
        },
        {
          employee_code: `RLS-PO-F-${Date.now()}`,
          name: 'RLS 財務人員',
          department_id: deptId,
          google_email: financeEmail,
          role: 'finance',
        },
      ])
      .select();
    applicantEmpId = emps!.find((e) => e.google_email === applicantEmail)!.id;
    approverEmpId = emps!.find((e) => e.google_email === approverEmail)!.id;

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

    await admin.from('approval_steps').insert({
      form_type: 'purchase_order',
      form_id: orderId,
      step_order: 1,
      approver_employee_id: approverEmpId,
      approver_role: 'department_manager',
    });

    const { data: item } = await admin
      .from('purchase_order_items')
      .insert({
        purchase_order_id: orderId,
        line_no: 1,
        budget_code_id: budgetCodeId,
        item_category: '材料',
        description: 'RLS 測試品項',
        quantity: 1,
        unit_price: 1000,
        total_price: 1000,
      })
      .select()
      .single();
    orderItemId = item!.id;

    const { data: acc } = await admin
      .from('acceptances')
      .insert({
        procurement_case_id: caseId,
        purchase_order_id: orderId,
        applicant_employee_id: applicantEmpId,
        department_id: deptId,
        budget_owner_employee_id: applicantEmpId,
        contractor_supplier_id: supplierId,
        total_amount: 1000,
        current_step_order: 1,
      })
      .select()
      .single();
    acceptanceId = acc!.id;
    const { data: accItem } = await admin
      .from('acceptance_items')
      .insert({
        acceptance_id: acceptanceId,
        line_no: 1,
        purchase_order_item_id: orderItemId,
        description: 'RLS 測試品項',
        quantity: 1,
        amount: 1000,
      })
      .select()
      .single();
    acceptanceItemId = accItem!.id;

    const { data: exp } = await admin
      .from('expense_requests')
      .insert({
        procurement_case_id: caseId,
        purchase_order_id: orderId,
        acceptance_id: acceptanceId,
        applicant_employee_id: applicantEmpId,
        department_id: deptId,
        budget_owner_employee_id: applicantEmpId,
        payee_type: 'supplier',
        payee_supplier_id: supplierId,
        payment_method: '匯款',
        total_amount: 1000,
        current_step_order: 1,
      })
      .select()
      .single();
    expenseRequestId = exp!.id;
    const { data: expItem } = await admin
      .from('expense_request_items')
      .insert({
        expense_request_id: expenseRequestId,
        line_no: 1,
        purchase_order_item_id: orderItemId,
        description: 'RLS 測試品項',
        amount: 1000,
      })
      .select()
      .single();
    expenseRequestItemId = expItem!.id;

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
    await admin.from('expense_request_items').delete().eq('id', expenseRequestItemId);
    await admin.from('expense_requests').delete().eq('id', expenseRequestId);
    await admin.from('acceptance_items').delete().eq('id', acceptanceItemId);
    await admin.from('acceptances').delete().eq('id', acceptanceId);
    await admin.from('purchase_order_items').delete().eq('id', orderItemId);
    await admin.from('approval_steps').delete().eq('form_id', orderId);
    await admin.from('purchase_orders').delete().eq('id', orderId);
    await admin.from('purchase_requests').delete().eq('id', requestId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
    await admin.from('employees').delete().eq('department_id', deptId);
    await admin.from('departments').delete().eq('id', deptId);
    await admin.auth.admin.deleteUser(applicantAuthId);
    await admin.auth.admin.deleteUser(outsiderAuthId);
    await admin.auth.admin.deleteUser(approverAuthId);
    await admin.auth.admin.deleteUser(financeAuthId);
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

  it('lets an assigned approver (not the applicant) read the purchase order', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: approverEmail, password });
    const { data } = await client.from('purchase_orders').select('id').eq('id', orderId);
    expect(data).toHaveLength(1);
  });

  it('lets the applicant read their own acceptance and hides it from an unrelated employee', async () => {
    const applicantClient = createAnonTestClient();
    await applicantClient.auth.signInWithPassword({ email: applicantEmail, password });
    const { data: mine } = await applicantClient
      .from('acceptances')
      .select('id')
      .eq('id', acceptanceId);
    expect(mine).toHaveLength(1);

    const outsiderClient = createAnonTestClient();
    await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });
    const { data: theirs } = await outsiderClient
      .from('acceptances')
      .select('id')
      .eq('id', acceptanceId);
    expect(theirs).toEqual([]);
  });

  it('lets the applicant read their own expense request and hides it from an unrelated employee', async () => {
    const applicantClient = createAnonTestClient();
    await applicantClient.auth.signInWithPassword({ email: applicantEmail, password });
    const { data: mine } = await applicantClient
      .from('expense_requests')
      .select('id')
      .eq('id', expenseRequestId);
    expect(mine).toHaveLength(1);

    const outsiderClient = createAnonTestClient();
    await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });
    const { data: theirs } = await outsiderClient
      .from('expense_requests')
      .select('id')
      .eq('id', expenseRequestId);
    expect(theirs).toEqual([]);
  });

  it('scopes purchase_order_items/acceptance_items/expense_request_items by their parent form, not independently', async () => {
    const applicantClient = createAnonTestClient();
    await applicantClient.auth.signInWithPassword({ email: applicantEmail, password });
    const { data: poItems } = await applicantClient
      .from('purchase_order_items')
      .select('id')
      .eq('id', orderItemId);
    expect(poItems).toHaveLength(1);
    const { data: accItems } = await applicantClient
      .from('acceptance_items')
      .select('id')
      .eq('id', acceptanceItemId);
    expect(accItems).toHaveLength(1);
    const { data: expItems } = await applicantClient
      .from('expense_request_items')
      .select('id')
      .eq('id', expenseRequestItemId);
    expect(expItems).toHaveLength(1);

    const outsiderClient = createAnonTestClient();
    await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });
    const { data: outsiderPoItems } = await outsiderClient
      .from('purchase_order_items')
      .select('id')
      .eq('id', orderItemId);
    expect(outsiderPoItems).toEqual([]);
    const { data: outsiderAccItems } = await outsiderClient
      .from('acceptance_items')
      .select('id')
      .eq('id', acceptanceItemId);
    expect(outsiderAccItems).toEqual([]);
    const { data: outsiderExpItems } = await outsiderClient
      .from('expense_request_items')
      .select('id')
      .eq('id', expenseRequestItemId);
    expect(outsiderExpItems).toEqual([]);
  });

  it('lets a finance employee read a purchase order they are neither the applicant of nor an approver on', async () => {
    const client = createAnonTestClient();
    await client.auth.signInWithPassword({ email: financeEmail, password });
    const { data } = await client.from('purchase_orders').select('id').eq('id', orderId);
    expect(data).toHaveLength(1);
  });
});
