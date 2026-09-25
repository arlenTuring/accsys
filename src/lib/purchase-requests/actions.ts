'use server';

import { revalidatePath } from 'next/cache';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { type ApprovalChainStep } from '@/lib/approval/chain';
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
import { notifyAndEmail } from '@/lib/notifications/notify';
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
  const employee = await getCurrentEmployee();
  if (!employee) {
    return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  }

  const db = createAppDb();

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

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: employee.departmentId,
    budgetOwnerEmployeeId: budgetOwnerId,
    totalAmount,
  });
  if (!chainResult.ok) {
    return { ok: false, error: chainResult.error };
  }
  const chain = chainResult.chain;

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
    const notifyResult = await notifyAndEmail(db, {
      recipientEmployeeId: first.approverEmployeeId,
      type: 'approval_requested',
      formType: 'purchase_request',
      formId: pr.id,
      caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup(pr.id);
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/requests');
  revalidatePath('/approvals');
  return { ok: true, requestId: pr.id, caseNumber };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

type LoadStepResult =
  | { error: string }
  | {
      pr: { id: string; applicant_employee_id: string; procurement_case_id: string };
      step: { id: string; step_order: number; approver_employee_id: string };
    };

async function loadCurrentStep(
  db: ReturnType<typeof createAppDb>,
  requestId: string,
  callerId: string
): Promise<LoadStepResult> {
  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr || pr.status !== 'pending_approval' || pr.current_step_order === null) {
    return { error: '這張請購單目前不在簽核中' as const };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .eq('step_order', pr.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張請購單目前的簽核人' as const };
  }
  return { pr, step } as never;
}

export async function approvePurchaseRequestStep(requestId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const loaded = await loadCurrentStep(db, requestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { pr, step } = loaded;

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
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('purchase_requests')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', requestId);
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'purchase_request',
      formId: requestId,
      caseNumber,
      message: `請購單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('purchase_requests')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', requestId);
    await notifyAndEmail(db, {
      recipientEmployeeId: pr.applicant_employee_id,
      type: 'request_approved',
      formType: 'purchase_request',
      formId: requestId,
      caseNumber,
      message: `請購單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

export async function resubmitPurchaseRequest(
  requestId: string,
  input: NewPurchaseRequest
): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, department_id, procurement_case_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到這張請購單' };
  if (pr.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張請購單' };
  }
  if (pr.status !== 'returned') {
    return { ok: false, error: '只有被退回的請購單可以重新送出' };
  }
  if (input.items.length === 0) {
    return { ok: false, error: '請購單至少需要一個明細項次' };
  }

  const budgetCodeIds = Array.from(new Set(input.items.map((i) => i.budgetCodeId)));
  const { data: budgetCodes } = await db
    .from('budget_codes')
    .select('id, category, owner_employee_id')
    .in('id', budgetCodeIds);
  if (!budgetCodes || budgetCodes.length !== budgetCodeIds.length) {
    return { ok: false, error: '選取的預算編號無效' };
  }
  const byId = new Map(budgetCodes.map((b) => [b.id, b]));
  const validation = validatePurchaseRequestInput(
    input.items.map((i) => ({
      budgetCodeId: i.budgetCodeId,
      budgetOwnerEmployeeId: byId.get(i.budgetCodeId)!.owner_employee_id ?? '',
      itemCategory: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: i.estimatedAmount,
    }))
  );
  if (!validation.ok) return { ok: false, error: validation.error };
  const budgetOwnerId = byId.get(input.items[0].budgetCodeId)!.owner_employee_id;
  if (!budgetOwnerId) return { ok: false, error: '選取的預算編號沒有指定預算負責人' };

  const totalAmount = input.items.reduce((sum, i) => sum + i.estimatedAmount, 0);

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: pr.department_id,
    budgetOwnerEmployeeId: budgetOwnerId,
    totalAmount,
  });
  if (!chainResult.ok) {
    return { ok: false, error: chainResult.error };
  }
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_purchase_request', {
    p_request_id: requestId,
    p_budget_owner: budgetOwnerId,
    p_needed_days: input.neededWithinDays,
    p_total: totalAmount,
    p_items: input.items.map((i, idx) => ({
      line_no: idx + 1,
      budget_code_id: i.budgetCodeId,
      item_category: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimated_amount: i.estimatedAmount,
    })),
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) {
    return { ok: false, error: '重新送出失敗，請稍後再試' };
  }

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'purchase_request',
    formId: requestId,
    caseNumber: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

export async function updatePurchaseRequest(
  requestId: string,
  input: NewPurchaseRequest
): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, current_step_order, department_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到這張請購單' };
  if (pr.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以修改這張請購單' };
  }
  if (pr.status !== 'pending_approval' || pr.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的請購單可以修改' };
  }
  if (input.items.length === 0) {
    return { ok: false, error: '請購單至少需要一個明細項次' };
  }

  const budgetCodeIds = Array.from(new Set(input.items.map((i) => i.budgetCodeId)));
  const { data: budgetCodes } = await db
    .from('budget_codes')
    .select('id, category, owner_employee_id')
    .in('id', budgetCodeIds);
  if (!budgetCodes || budgetCodes.length !== budgetCodeIds.length) {
    return { ok: false, error: '選取的預算編號無效' };
  }
  const byId = new Map(budgetCodes.map((b) => [b.id, b]));
  const validation = validatePurchaseRequestInput(
    input.items.map((i) => ({
      budgetCodeId: i.budgetCodeId,
      budgetOwnerEmployeeId: byId.get(i.budgetCodeId)!.owner_employee_id ?? '',
      itemCategory: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: i.estimatedAmount,
    }))
  );
  if (!validation.ok) return { ok: false, error: validation.error };
  const budgetOwnerId = byId.get(input.items[0].budgetCodeId)!.owner_employee_id;
  if (!budgetOwnerId) return { ok: false, error: '選取的預算編號沒有指定預算負責人' };

  const totalAmount = input.items.reduce((sum, i) => sum + i.estimatedAmount, 0);

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: pr.department_id,
    budgetOwnerEmployeeId: budgetOwnerId,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '修改後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_purchase_request', {
    p_request_id: requestId,
    p_budget_owner: budgetOwnerId,
    p_needed_days: input.neededWithinDays,
    p_total: totalAmount,
    p_items: input.items.map((i, idx) => ({
      line_no: idx + 1,
      budget_code_id: i.budgetCodeId,
      item_category: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimated_amount: i.estimatedAmount,
    })),
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) return { ok: false, error: '修改失敗，請稍後再試' };

  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

export async function withdrawPurchaseRequest(requestId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, applicant_employee_id, status, current_step_order')
    .eq('id', requestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到這張請購單' };
  if (pr.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以撤回這張請購單' };
  }
  if (pr.status !== 'pending_approval' || pr.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的請購單可以撤回' };
  }

  const { data: updated, error } = await db
    .from('purchase_requests')
    .update({ status: 'withdrawn', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'pending_approval')
    .eq('current_step_order', 1)
    .select('id');
  if (error) return { ok: false, error: '撤回失敗，請稍後再試' };
  if (!updated || updated.length === 0) {
    return { ok: false, error: '此表單已被處理，請重新整理頁面' };
  }

  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

export async function returnPurchaseRequestStep(
  requestId: string,
  reason: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createAppDb();

  const loaded = await loadCurrentStep(db, requestId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { pr, step } = loaded;

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
    .eq('form_type', 'purchase_request')
    .eq('form_id', requestId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  await db
    .from('purchase_requests')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', requestId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: pr.applicant_employee_id,
    type: 'request_returned',
    formType: 'purchase_request',
    formId: requestId,
    caseNumber: caseRow!.case_number,
    message: `請購單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}
