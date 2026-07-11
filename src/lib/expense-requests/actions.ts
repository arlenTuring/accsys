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
