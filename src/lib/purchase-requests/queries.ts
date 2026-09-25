import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type RequestSummary = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  requestDate: string;
};

export type DetailItem = {
  lineNo: number;
  budgetCode: string;
  itemCategory: string;
  description: string;
  quantity: number;
  estimatedAmount: number;
};

export type DetailStep = {
  stepOrder: number;
  approverEmployeeId: string;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

export type RequestDetail = {
  id: string;
  caseNumber: string;
  status: string;
  totalAmount: number;
  neededWithinDays: number | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  currentStepOrder: number | null;
  items: DetailItem[];
  steps: DetailStep[];
};

export type QueueItem = {
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
  requestDate: string;
};

export async function getMyRequests(): Promise<RequestSummary[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { data } = await supabase
    .from('purchase_requests')
    .select('id, total_amount, status, request_date, procurement_cases(case_number)')
    .eq('applicant_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    caseNumber: (r.procurement_cases as unknown as { case_number: string }).case_number,
    status: r.status,
    totalAmount: Number(r.total_amount),
    requestDate: r.request_date,
  }));
}

export async function getPurchaseRequestDetail(requestId: string): Promise<RequestDetail | null> {
  const supabase = createAppDb();
  const { data: pr } = await supabase
    .from('purchase_requests')
    .select(
      'id, total_amount, status, needed_within_days, current_step_order, applicant_employee_id, procurement_cases(case_number), applicant:employees!applicant_employee_id(name), departments(name)'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return null;

  const { data: items } = await supabase
    .from('purchase_request_items')
    .select('line_no, item_category, description, quantity, estimated_amount, budget_codes(code)')
    .eq('purchase_request_id', requestId)
    .order('line_no');

  const { data: steps } = await supabase
    .from('approval_steps')
    .select(
      'step_order, approver_role, status, comment, approver_employee_id, approver:employees!approver_employee_id(name)'
    )
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .order('step_order');

  return {
    id: pr.id,
    caseNumber: (pr.procurement_cases as unknown as { case_number: string }).case_number,
    status: pr.status,
    totalAmount: Number(pr.total_amount),
    neededWithinDays: pr.needed_within_days,
    applicantEmployeeId: pr.applicant_employee_id,
    applicantName: (pr.applicant as unknown as { name: string }).name,
    departmentName: (pr.departments as unknown as { name: string }).name,
    currentStepOrder: pr.current_step_order,
    items: (items ?? []).map((i) => ({
      lineNo: i.line_no,
      budgetCode: (i.budget_codes as unknown as { code: string }).code,
      itemCategory: i.item_category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: Number(i.estimated_amount),
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

export async function getMyApprovalQueue(): Promise<QueueItem[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { data: steps } = await supabase
    .from('approval_steps')
    .select('form_id, step_order')
    .eq('form_type', 'purchase_request')
    .eq('approver_employee_id', employee.id)
    .eq('status', 'pending');
  const formIds = (steps ?? []).map((s) => s.form_id);
  if (formIds.length === 0) return [];
  const { data: requests } = await supabase
    .from('purchase_requests')
    .select(
      'id, total_amount, request_date, current_step_order, status, procurement_cases(case_number), applicant:employees!applicant_employee_id(name)'
    )
    .in('id', formIds)
    .eq('status', 'pending_approval');
  const stepOrderByForm = new Map((steps ?? []).map((s) => [s.form_id, s.step_order]));
  return (requests ?? [])
    .filter((r) => r.current_step_order === stepOrderByForm.get(r.id))
    .map((r) => ({
      id: r.id,
      caseNumber: (r.procurement_cases as unknown as { case_number: string }).case_number,
      applicantName: (r.applicant as unknown as { name: string }).name,
      totalAmount: Number(r.total_amount),
      requestDate: r.request_date,
    }));
}
