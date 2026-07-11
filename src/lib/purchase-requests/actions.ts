'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { generateApprovalChain, type ApprovalChainStep } from '@/lib/approval/chain';
import {
  validatePurchaseRequestInput,
  type PurchaseRequestItemInput,
} from '@/lib/purchase-requests/validate';

export type NewPurchaseRequestItem = {
  budgetCodeId: string;
  description: string;
  quantity: number;
  estimatedAmount: number;
};

export type NewPurchaseRequest = {
  neededWithinDays: number | null;
  items: NewPurchaseRequestItem[];
};

export type CreateResult =
  | { ok: true; requestId: string; caseNumber: string }
  | { ok: false; error: string };

export async function createPurchaseRequest(input: NewPurchaseRequest): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) {
    return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  }

  const db = createSupabaseServiceRoleClient();

  if (input.items.length === 0) {
    return { ok: false, error: '請購單至少需要一個明細項次' };
  }

  const budgetCodeIds = Array.from(new Set(input.items.map((i) => i.budgetCodeId)));
  const { data: budgetCodes, error: bcError } = await db
    .from('budget_codes')
    .select('id, category, owner_employee_id')
    .in('id', budgetCodeIds);
  if (bcError || !budgetCodes || budgetCodes.length !== budgetCodeIds.length) {
    return { ok: false, error: '選取的預算編號無效' };
  }
  const byId = new Map(budgetCodes.map((b) => [b.id, b]));

  const validationItems: PurchaseRequestItemInput[] = input.items.map((i) => {
    const bc = byId.get(i.budgetCodeId)!;
    return {
      budgetCodeId: i.budgetCodeId,
      budgetOwnerEmployeeId: bc.owner_employee_id ?? '',
      itemCategory: bc.category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: i.estimatedAmount,
    };
  });
  const validation = validatePurchaseRequestInput(validationItems);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const budgetOwnerId = validationItems[0].budgetOwnerEmployeeId;
  if (!budgetOwnerId) {
    return { ok: false, error: '選取的預算編號沒有指定預算負責人' };
  }

  const totalAmount = input.items.reduce((sum, i) => sum + i.estimatedAmount, 0);

  const { data: dept } = await db
    .from('departments')
    .select('manager_employee_id')
    .eq('id', employee.departmentId)
    .single();
  const { data: gm } = await db
    .from('employees')
    .select('id')
    .eq('is_general_manager', true)
    .limit(1)
    .single();
  const { data: chairman } = await db
    .from('employees')
    .select('id')
    .eq('is_chairman', true)
    .limit(1)
    .single();

  const chain = generateApprovalChain({
    applicantEmployeeId: employee.id,
    departmentManagerEmployeeId: dept?.manager_employee_id ?? employee.id,
    budgetOwnerEmployeeId: budgetOwnerId,
    generalManagerEmployeeId: gm?.id ?? employee.id,
    chairmanEmployeeId: chairman?.id ?? employee.id,
    totalAmount,
  });

  const { data: caseNumber, error: numError } = await db.rpc('next_case_number');
  if (numError || !caseNumber) {
    return { ok: false, error: '產生案件單號失敗' };
  }
  const { data: pcase, error: caseError } = await db
    .from('procurement_cases')
    .insert({ case_number: caseNumber, created_by_employee_id: employee.id })
    .select()
    .single();
  if (caseError || !pcase) {
    return { ok: false, error: '建立採購案失敗' };
  }

  // Not transactional across tables; on any later failure we delete what we made.
  const cleanup = async (requestId?: string) => {
    if (requestId) {
      await db.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', requestId);
      await db.from('notifications').delete().eq('form_type', 'purchase_request').eq('form_id', requestId);
      await db.from('purchase_requests').delete().eq('id', requestId);
    }
    await db.from('procurement_cases').delete().eq('id', pcase.id);
  };

  const isAutoApproved = chain.length === 0;
  const { data: pr, error: prError } = await db
    .from('purchase_requests')
    .insert({
      procurement_case_id: pcase.id,
      applicant_employee_id: employee.id,
      department_id: employee.departmentId,
      budget_owner_employee_id: budgetOwnerId,
      needed_within_days: input.neededWithinDays,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (prError || !pr) {
    await cleanup();
    return { ok: false, error: '建立請購單失敗' };
  }

  const itemRows = input.items.map((i, idx) => ({
    purchase_request_id: pr.id,
    line_no: idx + 1,
    budget_code_id: i.budgetCodeId,
    item_category: byId.get(i.budgetCodeId)!.category,
    description: i.description,
    quantity: i.quantity,
    estimated_amount: i.estimatedAmount,
  }));
  const { error: itemsError } = await db.from('purchase_request_items').insert(itemRows);
  if (itemsError) {
    await cleanup(pr.id);
    return { ok: false, error: '建立請購明細失敗' };
  }

  if (!isAutoApproved) {
    const stepRows = chain.map((step: ApprovalChainStep, idx) => ({
      form_type: 'purchase_request',
      form_id: pr.id,
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    }));
    const { error: stepsError } = await db.from('approval_steps').insert(stepRows);
    if (stepsError) {
      await cleanup(pr.id);
      return { ok: false, error: '建立簽核流程失敗' };
    }

    const first = chain[0];
    const { error: notifError } = await db.from('notifications').insert({
      recipient_employee_id: first.approverEmployeeId,
      type: 'approval_requested',
      form_type: 'purchase_request',
      form_id: pr.id,
      case_number: caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
    if (notifError) {
      await cleanup(pr.id);
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/requests');
  revalidatePath('/approvals');
  return { ok: true, requestId: pr.id, caseNumber };
}
