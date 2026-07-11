import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type OrderSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
};

export type OrderDetailItem = {
  lineNo: number;
  budgetCode: string;
  itemCategory: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type OrderDetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

export type OrderDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  supplierName: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  purchaseRequestId: string;
  items: OrderDetailItem[];
  steps: OrderDetailStep[];
};

export type EligiblePurchaseRequestItem = {
  id: string;
  description: string;
  quantity: number;
  budgetCode: string;
};

export type EligiblePurchaseRequest = {
  id: string;
  caseNumber: string;
  items: EligiblePurchaseRequestItem[];
};

export type OrderQueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
};

export async function getMyPurchaseOrders(): Promise<OrderSummary[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, total_amount, status, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((o) => ({
    id: o.id,
    caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
    status: o.status,
    totalAmount: Number(o.total_amount),
  }));
}

export async function getPurchaseOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('purchase_orders')
    .select(
      'id, purchase_request_id, total_amount, status, payment_method, payment_terms, expected_delivery_days, quote_count, quote_count_reason, current_step_order, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), suppliers(name)'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return null;

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('line_no, item_category, description, quantity, unit_price, total_price, budget_codes(code)')
    .eq('purchase_order_id', orderId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .order('step_order');

  return {
    id: order.id,
    caseNumber: (order.procurement_cases as unknown as { case_number: string }).case_number,
    status: order.status,
    totalAmount: Number(order.total_amount),
    supplierName: (order.suppliers as unknown as { name: string }).name,
    paymentMethod: order.payment_method,
    paymentTerms: order.payment_terms,
    expectedDeliveryDays: order.expected_delivery_days,
    quoteCount: order.quote_count,
    quoteCountReason: order.quote_count_reason,
    applicantName: (order.applicant as unknown as { name: string }).name,
    departmentName: (order.departments as unknown as { name: string }).name,
    currentStepOrder: order.current_step_order,
    purchaseRequestId: order.purchase_request_id,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      budgetCode: (i.budget_codes as unknown as { code: string }).code,
      itemCategory: i.item_category,
      description: i.description,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price),
      totalPrice: Number(i.total_price),
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

export async function getEligiblePurchaseRequestsForOrder(): Promise<EligiblePurchaseRequest[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];

  const { data: requests } = await supabase
    .from('purchase_requests')
    .select('id, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .eq('status', 'approved');
  if (!requests || requests.length === 0) return [];

  const { data: existingOrders } = await supabase
    .from('purchase_orders')
    .select('purchase_request_id')
    .in(
      'purchase_request_id',
      requests.map((r) => r.id)
    );
  const takenIds = new Set((existingOrders ?? []).map((o) => o.purchase_request_id));
  const remaining = requests.filter((r) => !takenIds.has(r.id));

  const result: EligiblePurchaseRequest[] = [];
  for (const r of remaining) {
    const { data: items } = await supabase
      .from('purchase_request_items')
      .select('id, description, quantity, budget_codes(code)')
      .eq('purchase_request_id', r.id)
      .order('line_no');
    result.push({
      id: r.id,
      caseNumber: (r.procurement_cases as unknown as { case_number: string }).case_number,
      items: (items ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        quantity: i.quantity,
        budgetCode: (i.budget_codes as unknown as { code: string }).code,
      })),
    });
  }
  return result;
}

export async function getMyPurchaseOrderApprovalQueue(): Promise<OrderQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'purchase_order')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: orders } = await supabase
    .from('purchase_orders')
    .select(
      'id, total_amount, current_step_order, status, procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (orders ?? [])
    .filter((o) => o.current_step_order === stepOrderByForm.get(o.id))
    .map((o) => ({
      id: o.id,
      caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
      applicantName: (o.applicant as unknown as { name: string }).name,
      totalAmount: Number(o.total_amount),
    }));
}
