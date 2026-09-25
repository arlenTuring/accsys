import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type AcceptanceSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
};

export type AcceptanceDetailItem = {
  lineNo: number;
  itemId: string;
  description: string;
  quantity: number;
  amount: number;
  passFail: 'pass' | 'fail';
  propertyTag: string | null;
};

export type AcceptanceDetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

export type AcceptanceDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  contractorSupplierId: string;
  contractorSupplierName: string;
  acceptanceDate: string;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  items: AcceptanceDetailItem[];
  steps: AcceptanceDetailStep[];
};

export type EligiblePurchaseOrderItem = { id: string; description: string; quantity: number };

export type EligiblePurchaseOrder = {
  id: string;
  caseNumber: string;
  items: EligiblePurchaseOrderItem[];
};

export type AcceptanceQueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
};

export async function getMyAcceptances(): Promise<AcceptanceSummary[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { data } = await supabase
    .from('acceptances')
    .select('id, total_amount, status, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((a) => ({
    id: a.id,
    caseNumber: (a.procurement_cases as unknown as { case_number: string }).case_number,
    status: a.status,
    totalAmount: Number(a.total_amount),
  }));
}

export async function getAcceptanceDetail(acceptanceId: string): Promise<AcceptanceDetail | null> {
  const supabase = createAppDb();
  const { data: acceptance } = await supabase
    .from('acceptances')
    .select(
      'id, total_amount, status, acceptance_date, current_step_order, applicant_employee_id, contractor_supplier_id, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name), suppliers:suppliers!contractor_supplier_id(name)'
    )
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance) return null;

  const { data: items } = await supabase
    .from('acceptance_items')
    .select('line_no, id, description, quantity, amount, pass_fail, property_tag')
    .eq('acceptance_id', acceptanceId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .order('step_order');

  return {
    id: acceptance.id,
    caseNumber: (acceptance.procurement_cases as unknown as { case_number: string }).case_number,
    status: acceptance.status,
    totalAmount: Number(acceptance.total_amount),
    contractorSupplierId: acceptance.contractor_supplier_id,
    contractorSupplierName: (acceptance.suppliers as unknown as { name: string }).name,
    acceptanceDate: acceptance.acceptance_date,
    applicantEmployeeId: acceptance.applicant_employee_id,
    applicantName: (acceptance.applicant as unknown as { name: string }).name,
    departmentName: (acceptance.departments as unknown as { name: string }).name,
    currentStepOrder: acceptance.current_step_order,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      itemId: i.id,
      description: i.description,
      quantity: i.quantity,
      amount: Number(i.amount),
      passFail: i.pass_fail as 'pass' | 'fail',
      propertyTag: i.property_tag,
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

export async function getEligiblePurchaseOrdersForAcceptance(): Promise<EligiblePurchaseOrder[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];

  const { data: orders } = await supabase
    .from('purchase_orders')
    .select('id, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .eq('status', 'approved');
  if (!orders || orders.length === 0) return [];

  const { data: existingAcceptances } = await supabase
    .from('acceptances')
    .select('purchase_order_id')
    .in(
      'purchase_order_id',
      orders.map((o) => o.id)
    );
  const takenIds = new Set((existingAcceptances ?? []).map((a) => a.purchase_order_id));
  const remaining = orders.filter((o) => !takenIds.has(o.id));

  const result: EligiblePurchaseOrder[] = [];
  for (const o of remaining) {
    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('id, description, quantity')
      .eq('purchase_order_id', o.id)
      .order('line_no');
    result.push({
      id: o.id,
      caseNumber: (o.procurement_cases as unknown as { case_number: string }).case_number,
      items: (items ?? []).map((i) => ({ id: i.id, description: i.description, quantity: i.quantity })),
    });
  }
  return result;
}

export async function getMyAcceptanceApprovalQueue(): Promise<AcceptanceQueueItem[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'acceptance')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: acceptances } = await supabase
    .from('acceptances')
    .select(
      'id, total_amount, current_step_order, status, procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (acceptances ?? [])
    .filter((a) => a.current_step_order === stepOrderByForm.get(a.id))
    .map((a) => ({
      id: a.id,
      caseNumber: (a.procurement_cases as unknown as { case_number: string }).case_number,
      applicantName: (a.applicant as unknown as { name: string }).name,
      totalAmount: Number(a.total_amount),
    }));
}
