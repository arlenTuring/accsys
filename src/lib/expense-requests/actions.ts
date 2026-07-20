'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
import { notifyAndEmail } from '@/lib/notifications/notify';
import { validateExpenseRequestInput } from '@/lib/expense-requests/validate';
import {
  computeDefaultExpectedPaymentDate,
  computePaymentBatchDate,
} from '@/lib/procurement/payment-batch';

export type NewExpenseRequest = {
  purchaseOrderId: string;
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  includedSourceItemIds: string[];
};

export const STANDALONE_EXPENSE_REQUEST_LIMIT = 10000;

export type NewStandaloneExpenseRequestItem = {
  description: string;
  amount: number;
};

export type NewStandaloneExpenseRequest = {
  budgetCodeId: string;
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  items: NewStandaloneExpenseRequestItem[];
};

export type CreateResult =
  | { ok: true; expenseRequestId: string; caseNumber: string; paymentBatchDate: string }
  | { ok: false; error: string };

type SourceItem = {
  id: string;
  purchase_order_item_id: string;
  description: string;
  amount: number;
};

export async function createExpenseRequest(input: NewExpenseRequest): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createSupabaseServiceRoleClient();

  const { data: po } = await db
    .from('purchase_orders')
    .select('id, procurement_case_id, department_id, budget_owner_employee_id, status, payment_terms')
    .eq('id', input.purchaseOrderId)
    .maybeSingle();
  if (!po) return { ok: false, error: '找不到來源採購單' };
  if (po.status !== 'approved') {
    return { ok: false, error: '來源採購單尚未核准，無法建立費用申請單' };
  }

  const { data: existing } = await db
    .from('expense_requests')
    .select('id')
    .eq('procurement_case_id', po.procurement_case_id)
    .maybeSingle();
  if (existing) return { ok: false, error: '此案件已建立過費用申請單' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', po.procurement_case_id)
    .single();
  if (!caseRow) return { ok: false, error: '找不到案件資料' };
  const caseNumber = caseRow.case_number;

  const { data: acceptance } = await db
    .from('acceptances')
    .select('id')
    .eq('purchase_order_id', po.id)
    .eq('status', 'approved')
    .maybeSingle();

  let acceptanceId: string | null = null;
  let sourceItems: SourceItem[] = [];

  if (acceptance) {
    acceptanceId = acceptance.id;
    const { data: items } = await db
      .from('acceptance_items')
      .select('id, purchase_order_item_id, description, amount')
      .eq('acceptance_id', acceptance.id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: Number(i.amount),
    }));
  } else if (po.payment_terms === '預付款') {
    const { data: items } = await db
      .from('purchase_order_items')
      .select('id, description, total_price')
      .eq('purchase_order_id', po.id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.id,
      description: i.description,
      amount: Number(i.total_price),
    }));
  } else {
    return {
      ok: false,
      error: '此採購單尚未完成驗收，且付款條件非預付款，無法建立費用申請單',
    };
  }

  const includedSet = new Set(input.includedSourceItemIds);
  const includedItems = sourceItems.filter((i) => includedSet.has(i.id));

  const validation = validateExpenseRequestInput({
    payeeType: input.payeeType,
    payeeSupplierId: input.payeeSupplierId,
    bankAccount: input.bankAccount,
    includedItemCount: includedItems.length,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const totalAmount = includedItems.reduce((sum, i) => sum + i.amount, 0);

  const referenceDate = new Date().toISOString().slice(0, 10);
  const expectedPaymentDate =
    input.expectedPaymentDate ??
    (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : null);
  const batch = computePaymentBatchDate({
    payeeType: input.payeeType,
    referenceDate,
    expectedPaymentDate,
    invoiceMonth: input.invoiceMonth,
  });

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: po.department_id,
    budgetOwnerEmployeeId: po.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const isAutoApproved = chain.length === 0;
  const { data: expenseRequest, error: expenseError } = await db
    .from('expense_requests')
    .insert({
      procurement_case_id: po.procurement_case_id,
      purchase_order_id: po.id,
      acceptance_id: acceptanceId,
      applicant_employee_id: employee.id,
      department_id: po.department_id,
      budget_owner_employee_id: po.budget_owner_employee_id,
      payee_type: input.payeeType,
      payee_supplier_id: input.payeeType === 'supplier' ? input.payeeSupplierId : null,
      payment_method: input.paymentMethod,
      bank_name: input.payeeType === 'employee' ? input.bankName : null,
      bank_account: input.payeeType === 'employee' ? input.bankAccount : null,
      account_name: input.payeeType === 'employee' ? input.accountName : null,
      invoice_month: input.invoiceMonth,
      expected_payment_date: expectedPaymentDate,
      payment_batch_date: batch.batchDate,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (expenseError || !expenseRequest) return { ok: false, error: '建立費用申請單失敗' };

  const cleanup = async () => {
    await db
      .from('approval_steps')
      .delete()
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequest.id);
    await db
      .from('notifications')
      .delete()
      .eq('form_type', 'expense_request')
      .eq('form_id', expenseRequest.id);
    await db.from('expense_requests').delete().eq('id', expenseRequest.id);
  };

  const { error: itemsError } = await db.from('expense_request_items').insert(
    includedItems.map((i, idx) => ({
      expense_request_id: expenseRequest.id,
      line_no: idx + 1,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: i.amount,
    }))
  );
  if (itemsError) {
    await cleanup();
    return { ok: false, error: '建立費用明細失敗' };
  }

  if (!isAutoApproved) {
    const { error: stepsError } = await db.from('approval_steps').insert(
      chain.map((step, idx) => ({
        form_type: 'expense_request',
        form_id: expenseRequest.id,
        step_order: idx + 1,
        approver_employee_id: step.approverEmployeeId,
        approver_role: step.approverRole,
      }))
    );
    if (stepsError) {
      await cleanup();
      return { ok: false, error: '建立簽核流程失敗' };
    }

    const notifyResult = await notifyAndEmail(db, {
      recipientEmployeeId: chain[0].approverEmployeeId,
      type: 'approval_requested',
      formType: 'expense_request',
      formId: expenseRequest.id,
      caseNumber,
      message: `費用申請單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup();
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/expense-requests');
  revalidatePath('/approvals');
  return {
    ok: true,
    expenseRequestId: expenseRequest.id,
    caseNumber,
    paymentBatchDate: batch.batchDate,
  };
}

export async function createStandaloneExpenseRequest(
  input: NewStandaloneExpenseRequest
): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createSupabaseServiceRoleClient();

  if (input.items.length === 0) {
    return { ok: false, error: '費用申請單至少需要一個明細項次' };
  }
  const totalAmount = input.items.reduce((sum, i) => sum + i.amount, 0);
  if (totalAmount >= STANDALONE_EXPENSE_REQUEST_LIMIT) {
    return {
      ok: false,
      error: `免走採購流程的費用申請單總金額須低於 NT$ ${STANDALONE_EXPENSE_REQUEST_LIMIT.toLocaleString()}，請改用一般採購流程建立`,
    };
  }

  const { data: budgetCode } = await db
    .from('budget_codes')
    .select('id, owner_employee_id')
    .eq('id', input.budgetCodeId)
    .maybeSingle();
  if (!budgetCode) return { ok: false, error: '選取的預算編號無效' };
  if (!budgetCode.owner_employee_id) {
    return { ok: false, error: '選取的預算編號沒有指定預算負責人' };
  }

  const validation = validateExpenseRequestInput({
    payeeType: input.payeeType,
    payeeSupplierId: input.payeeSupplierId,
    bankAccount: input.bankAccount,
    includedItemCount: input.items.length,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const referenceDate = new Date().toISOString().slice(0, 10);
  const expectedPaymentDate =
    input.expectedPaymentDate ??
    (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : null);
  const batch = computePaymentBatchDate({
    payeeType: input.payeeType,
    referenceDate,
    expectedPaymentDate,
    invoiceMonth: input.invoiceMonth,
  });

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: employee.departmentId,
    budgetOwnerEmployeeId: budgetCode.owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const { data: caseNumber, error: numError } = await db.rpc('next_case_number');
  if (numError || !caseNumber) return { ok: false, error: '產生案件單號失敗' };
  const { data: pcase, error: caseError } = await db
    .from('procurement_cases')
    .insert({
      case_number: caseNumber,
      created_by_employee_id: employee.id,
      case_type: 'standalone_expense',
    })
    .select()
    .single();
  if (caseError || !pcase) return { ok: false, error: '建立案件失敗' };

  const cleanup = async (expenseRequestId?: string) => {
    if (expenseRequestId) {
      await db
        .from('approval_steps')
        .delete()
        .eq('form_type', 'expense_request')
        .eq('form_id', expenseRequestId);
      await db
        .from('notifications')
        .delete()
        .eq('form_type', 'expense_request')
        .eq('form_id', expenseRequestId);
      await db.from('expense_requests').delete().eq('id', expenseRequestId);
    }
    await db.from('procurement_cases').delete().eq('id', pcase.id);
  };

  const isAutoApproved = chain.length === 0;
  const { data: expenseRequest, error: expenseError } = await db
    .from('expense_requests')
    .insert({
      procurement_case_id: pcase.id,
      purchase_order_id: null,
      budget_code_id: input.budgetCodeId,
      applicant_employee_id: employee.id,
      department_id: employee.departmentId,
      budget_owner_employee_id: budgetCode.owner_employee_id,
      payee_type: input.payeeType,
      payee_supplier_id: input.payeeType === 'supplier' ? input.payeeSupplierId : null,
      payment_method: input.paymentMethod,
      bank_name: input.payeeType === 'employee' ? input.bankName : null,
      bank_account: input.payeeType === 'employee' ? input.bankAccount : null,
      account_name: input.payeeType === 'employee' ? input.accountName : null,
      invoice_month: input.invoiceMonth,
      expected_payment_date: expectedPaymentDate,
      payment_batch_date: batch.batchDate,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (expenseError || !expenseRequest) {
    await cleanup();
    return { ok: false, error: '建立費用申請單失敗' };
  }

  const { error: itemsError } = await db.from('expense_request_items').insert(
    input.items.map((i, idx) => ({
      expense_request_id: expenseRequest.id,
      line_no: idx + 1,
      purchase_order_item_id: null,
      description: i.description,
      amount: i.amount,
    }))
  );
  if (itemsError) {
    await cleanup(expenseRequest.id);
    return { ok: false, error: '建立費用明細失敗' };
  }

  if (!isAutoApproved) {
    const { error: stepsError } = await db.from('approval_steps').insert(
      chain.map((step, idx) => ({
        form_type: 'expense_request',
        form_id: expenseRequest.id,
        step_order: idx + 1,
        approver_employee_id: step.approverEmployeeId,
        approver_role: step.approverRole,
      }))
    );
    if (stepsError) {
      await cleanup(expenseRequest.id);
      return { ok: false, error: '建立簽核流程失敗' };
    }

    const notifyResult = await notifyAndEmail(db, {
      recipientEmployeeId: chain[0].approverEmployeeId,
      type: 'approval_requested',
      formType: 'expense_request',
      formId: expenseRequest.id,
      caseNumber,
      message: `費用申請單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup(expenseRequest.id);
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/expense-requests');
  revalidatePath('/approvals');
  return {
    ok: true,
    expenseRequestId: expenseRequest.id,
    caseNumber,
    paymentBatchDate: batch.batchDate,
  };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

type LoadStepResult =
  | { error: string }
  | {
      expenseRequest: { id: string; applicant_employee_id: string; procurement_case_id: string };
      step: { id: string; step_order: number; approver_employee_id: string };
    };

async function loadCurrentStep(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  expenseRequestId: string,
  callerId: string
): Promise<LoadStepResult> {
  const { data: expenseRequest } = await db
    .from('expense_requests')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (
    !expenseRequest ||
    expenseRequest.status !== 'pending_approval' ||
    expenseRequest.current_step_order === null
  ) {
    return { error: '這張費用申請單目前不在簽核中' };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('step_order', expenseRequest.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張費用申請單目前的簽核人' };
  }
  return { expenseRequest, step };
}

export async function approveExpenseRequestStep(expenseRequestId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, expenseRequestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { expenseRequest, step } = loaded;

  const { data: updatedSteps } = await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id)
    .eq('status', 'pending')
    .select('id');
  if (!updatedSteps || updatedSteps.length === 0) {
    return { ok: false, error: '此表單已被處理，請重新整理頁面' };
  }

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', expenseRequest.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('expense_requests')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', expenseRequestId);
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'expense_request',
      formId: expenseRequestId,
      caseNumber,
      message: `費用申請單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('expense_requests')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', expenseRequestId);
    await notifyAndEmail(db, {
      recipientEmployeeId: expenseRequest.applicant_employee_id,
      type: 'request_approved',
      formType: 'expense_request',
      formId: expenseRequestId,
      caseNumber,
      message: `費用申請單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}

export async function returnExpenseRequestStep(
  expenseRequestId: string,
  reason: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, expenseRequestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { expenseRequest, step } = loaded;

  const { data: updatedSteps } = await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id)
    .eq('status', 'pending')
    .select('id');
  if (!updatedSteps || updatedSteps.length === 0) {
    return { ok: false, error: '此表單已被處理，請重新整理頁面' };
  }

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  await db
    .from('expense_requests')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', expenseRequestId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', expenseRequest.procurement_case_id)
    .single();

  await notifyAndEmail(db, {
    recipientEmployeeId: expenseRequest.applicant_employee_id,
    type: 'request_returned',
    formType: 'expense_request',
    formId: expenseRequestId,
    caseNumber: caseRow!.case_number,
    message: `費用申請單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}

export type ResubmitExpenseRequestInput = {
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  includedSourceItemIds: string[];
};

export async function resubmitExpenseRequest(
  expenseRequestId: string,
  input: ResubmitExpenseRequestInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: expenseRequest } = await db
    .from('expense_requests')
    .select(
      'id, applicant_employee_id, status, department_id, budget_owner_employee_id, procurement_case_id, purchase_order_id, acceptance_id'
    )
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return { ok: false, error: '找不到這張費用申請單' };
  if (expenseRequest.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張費用申請單' };
  }
  if (expenseRequest.status !== 'returned') {
    return { ok: false, error: '只有被退回的費用申請單可以重新送出' };
  }

  let sourceItems: SourceItem[] = [];
  if (expenseRequest.acceptance_id) {
    const { data: items } = await db
      .from('acceptance_items')
      .select('id, purchase_order_item_id, description, amount')
      .eq('acceptance_id', expenseRequest.acceptance_id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: Number(i.amount),
    }));
  } else {
    const { data: items } = await db
      .from('purchase_order_items')
      .select('id, description, total_price')
      .eq('purchase_order_id', expenseRequest.purchase_order_id);
    sourceItems = (items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.id,
      description: i.description,
      amount: Number(i.total_price),
    }));
  }

  const includedSet = new Set(input.includedSourceItemIds);
  const includedItems = sourceItems.filter((i) => includedSet.has(i.id));

  const validation = validateExpenseRequestInput({
    payeeType: input.payeeType,
    payeeSupplierId: input.payeeSupplierId,
    bankAccount: input.bankAccount,
    includedItemCount: includedItems.length,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const totalAmount = includedItems.reduce((sum, i) => sum + i.amount, 0);

  const referenceDate = new Date().toISOString().slice(0, 10);
  const expectedPaymentDate =
    input.expectedPaymentDate ??
    (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : null);
  const batch = computePaymentBatchDate({
    payeeType: input.payeeType,
    referenceDate,
    expectedPaymentDate,
    invoiceMonth: input.invoiceMonth,
  });

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: expenseRequest.department_id,
    budgetOwnerEmployeeId: expenseRequest.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_expense_request', {
    p_expense_request_id: expenseRequestId,
    p_payee_type: input.payeeType,
    p_payee_supplier: input.payeeType === 'supplier' ? input.payeeSupplierId : null,
    p_payment_method: input.paymentMethod,
    p_bank_name: input.payeeType === 'employee' ? input.bankName : null,
    p_bank_account: input.payeeType === 'employee' ? input.bankAccount : null,
    p_account_name: input.payeeType === 'employee' ? input.accountName : null,
    p_invoice_month: input.invoiceMonth,
    p_expected_payment_date: expectedPaymentDate,
    p_payment_batch_date: batch.batchDate,
    p_total: totalAmount,
    p_items: includedItems.map((i, idx) => ({
      line_no: idx + 1,
      purchase_order_item_id: i.purchase_order_item_id,
      description: i.description,
      amount: i.amount,
    })),
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) return { ok: false, error: '重新送出失敗，請稍後再試' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', expenseRequest.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'expense_request',
    formId: expenseRequestId,
    caseNumber: caseRow!.case_number,
    message: `費用申請單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${expenseRequestId}`);
  return { ok: true };
}
