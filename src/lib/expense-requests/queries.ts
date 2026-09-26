import { createAppDb } from '@/lib/db/app-client';
import { canReadForm, isFinanceOrAdmin, maskAccount } from '@/lib/authz/forms';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { checkPaymentTermsConsistency } from '@/lib/procurement/payment-terms';

export type ExpenseRequestSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
};

export type ExpenseRequestDetailItem = {
  lineNo: number;
  sourceItemId: string;
  description: string;
  amount: number;
};

export type ExpenseRequestDetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

export type ExpenseRequestDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  payeeType: 'employee' | 'supplier';
  payeeName: string;
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
  paymentBatchDate: string | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  purchaseOrderPaymentTerms: string;
  paymentTermsConsistent: boolean;
  items: ExpenseRequestDetailItem[];
  steps: ExpenseRequestDetailStep[];
};

export type EligibleSourceItem = { id: string; description: string; amount: number };

export type EligiblePurchaseOrderForExpense = {
  id: string;
  caseNumber: string;
  paymentTerms: string;
  sourceItems: EligibleSourceItem[];
};

export type ExpenseRequestQueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
};

export async function getMyExpenseRequests(): Promise<ExpenseRequestSummary[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { data } = await supabase
    .from('expense_requests')
    .select('id, total_amount, status, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((e) => ({
    id: e.id,
    caseNumber: (e.procurement_cases as unknown as { case_number: string }).case_number,
    status: e.status,
    totalAmount: Number(e.total_amount),
  }));
}

export async function getExpenseRequestDetail(
  expenseRequestId: string
): Promise<ExpenseRequestDetail | null> {
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, 'expense_request', expenseRequestId))) return null;
  const supabase = createAppDb();
  const { data: expenseRequest } = await supabase
    .from('expense_requests')
    .select(
      'id, total_amount, status, payee_type, payee_supplier_id, payment_method, bank_name, bank_account, account_name, invoice_month, expected_payment_date, payment_batch_date, current_step_order, applicant_employee_id, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), payee_supplier:suppliers!payee_supplier_id(name), purchase_orders(payment_terms, updated_at)'
    )
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return null;

  const { data: items } = await supabase
    .from('expense_request_items')
    .select('line_no, purchase_order_item_id, description, amount')
    .eq('expense_request_id', expenseRequestId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'expense_request')
    .eq('form_id', expenseRequestId)
    .order('step_order');

  const applicantName = (expenseRequest.applicant as unknown as { name: string }).name;
  const payeeSupplier = expenseRequest.payee_supplier as unknown as { name: string } | null;
  const order = expenseRequest.purchase_orders as unknown as {
    payment_terms: string;
    updated_at: string;
  } | null;

  const consistency = order
    ? checkPaymentTermsConsistency({
        paymentTerms: order.payment_terms,
        orderApprovedDate: order.updated_at.slice(0, 10),
        expectedPaymentDate: expenseRequest.expected_payment_date,
      })
    : { consistent: true };

  return {
    id: expenseRequest.id,
    caseNumber: (expenseRequest.procurement_cases as unknown as { case_number: string })
      .case_number,
    status: expenseRequest.status,
    totalAmount: Number(expenseRequest.total_amount),
    payeeType: expenseRequest.payee_type as 'employee' | 'supplier',
    payeeName: payeeSupplier?.name ?? applicantName,
    payeeSupplierId: expenseRequest.payee_supplier_id,
    paymentMethod: expenseRequest.payment_method,
    bankName: expenseRequest.bank_name,
    // Approvers see only the last 4 digits; the applicant and finance/admin need the full number.
    bankAccount:
      actor!.id === expenseRequest.applicant_employee_id || isFinanceOrAdmin(actor)
        ? expenseRequest.bank_account
        : maskAccount(expenseRequest.bank_account),
    accountName: expenseRequest.account_name,
    invoiceMonth: expenseRequest.invoice_month,
    expectedPaymentDate: expenseRequest.expected_payment_date,
    paymentBatchDate: expenseRequest.payment_batch_date,
    applicantEmployeeId: expenseRequest.applicant_employee_id,
    applicantName,
    departmentName: (expenseRequest.departments as unknown as { name: string }).name,
    currentStepOrder: expenseRequest.current_step_order,
    purchaseOrderPaymentTerms: order?.payment_terms ?? '（免走採購流程）',
    paymentTermsConsistent: consistency.consistent,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      sourceItemId: i.purchase_order_item_id,
      description: i.description,
      amount: Number(i.amount),
    })),
    steps: (steps ?? []).map((s) => ({
      stepOrder: s.step_order,
      approverEmployeeId: s.approver_employee_id,
      approverName: (s.approver as unknown as { name: string }).name,
      approverRole: s.approver_role,
      status: s.status,
      comment: s.comment,
    })),
  };
}

export async function getEligiblePurchaseOrdersForExpenseRequest(): Promise<
  EligiblePurchaseOrderForExpense[]
> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];

  const { data: orders } = await supabase
    .from('purchase_orders')
    .select('id, payment_terms, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .eq('status', 'approved');
  if (!orders || orders.length === 0) return [];

  const { data: existingExpenseRequests } = await supabase
    .from('expense_requests')
    .select('purchase_order_id')
    .in(
      'purchase_order_id',
      orders.map((o) => o.id)
    );
  const takenIds = new Set((existingExpenseRequests ?? []).map((e) => e.purchase_order_id));
  const remaining = orders.filter((o) => !takenIds.has(o.id));

  const result: EligiblePurchaseOrderForExpense[] = [];
  for (const o of remaining) {
    const { data: acceptance } = await supabase
      .from('acceptances')
      .select('id')
      .eq('purchase_order_id', o.id)
      .eq('status', 'approved')
      .maybeSingle();

    let sourceItems: EligibleSourceItem[] = [];
    if (acceptance) {
      const { data: items } = await supabase
        .from('acceptance_items')
        .select('id, description, amount')
        .eq('acceptance_id', acceptance.id);
      sourceItems = (items ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        amount: Number(i.amount),
      }));
    } else if (o.payment_terms === '預付款') {
      const { data: items } = await supabase
        .from('purchase_order_items')
        .select('id, description, total_price')
        .eq('purchase_order_id', o.id);
      sourceItems = (items ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        amount: Number(i.total_price),
      }));
    } else {
      continue;
    }

    result.push({
      id: o.id,
      caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
      paymentTerms: o.payment_terms,
      sourceItems,
    });
  }
  return result;
}

export async function getMyExpenseRequestApprovalQueue(): Promise<ExpenseRequestQueueItem[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'expense_request')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: expenseRequests } = await supabase
    .from('expense_requests')
    .select(
      'id, total_amount, current_step_order, status, procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (expenseRequests ?? [])
    .filter((e) => e.current_step_order === stepOrderByForm.get(e.id))
    .map((e) => ({
      id: e.id,
      caseNumber: (e.procurement_cases as unknown as { case_number: string }).case_number,
      applicantName: (e.applicant as unknown as { name: string }).name,
      totalAmount: Number(e.total_amount),
    }));
}

export type ExpenseRequestSourceItem = {
  id: string;
  description: string;
  amount: number;
  // The underlying purchase_order_items.id this source item resolves to.
  // For the acceptance-derived branch this differs from `id` (which is the
  // acceptance_item's own id — the id space that createExpenseRequest /
  // resubmitExpenseRequest / updateExpenseRequest all key
  // `includedSourceItemIds` on). expense_request_items only stores
  // `purchase_order_item_id` (see 20260711164720_expense_requests.sql), which
  // is the same id space as `ExpenseRequestDetailItem.sourceItemId`. The edit
  // page needs this field to correctly pre-check which source items are
  // already included — matching on `id` alone would silently show every
  // acceptance-derived item as unchecked.
  purchaseOrderItemId: string;
};

export async function getExpenseRequestSourceItems(
  expenseRequestId: string
): Promise<ExpenseRequestSourceItem[]> {
  if (!(await canReadForm(await getCurrentEmployee(), 'expense_request', expenseRequestId))) return [];
  const supabase = createAppDb();
  const { data: expenseRequest } = await supabase
    .from('expense_requests')
    .select('acceptance_id, purchase_order_id')
    .eq('id', expenseRequestId)
    .maybeSingle();
  if (!expenseRequest) return [];

  if (expenseRequest.acceptance_id) {
    const { data: items } = await supabase
      .from('acceptance_items')
      .select('id, purchase_order_item_id, description, amount')
      .eq('acceptance_id', expenseRequest.acceptance_id);
    return (items ?? []).map((i) => ({
      id: i.id,
      purchaseOrderItemId: i.purchase_order_item_id,
      description: i.description,
      amount: Number(i.amount),
    }));
  }
  if (expenseRequest.purchase_order_id) {
    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('id, description, total_price')
      .eq('purchase_order_id', expenseRequest.purchase_order_id);
    return (items ?? []).map((i) => ({
      id: i.id,
      purchaseOrderItemId: i.id,
      description: i.description,
      amount: Number(i.total_price),
    }));
  }
  return [];
}
