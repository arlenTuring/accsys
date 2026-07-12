'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
import { notifyAndEmail } from '@/lib/notifications/notify';
import { validateAcceptanceInput } from '@/lib/acceptances/validate';

export type NewAcceptanceItem = {
  purchaseOrderItemId: string;
  passFail: 'pass' | 'fail';
};

export type NewAcceptance = {
  purchaseOrderId: string;
  contractorSupplierId: string;
  acceptanceDate: string;
  items: NewAcceptanceItem[];
};

export type CreateResult =
  | { ok: true; acceptanceId: string; caseNumber: string }
  | { ok: false; error: string };

export async function createAcceptance(input: NewAcceptance): Promise<CreateResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createSupabaseServiceRoleClient();

  const { data: po } = await db
    .from('purchase_orders')
    .select('id, procurement_case_id, department_id, budget_owner_employee_id, status, total_amount')
    .eq('id', input.purchaseOrderId)
    .maybeSingle();
  if (!po) return { ok: false, error: '找不到來源採購單' };
  if (po.status !== 'approved') {
    return { ok: false, error: '來源採購單尚未核准，無法建立驗收單' };
  }

  const { data: existing } = await db
    .from('acceptances')
    .select('id')
    .eq('procurement_case_id', po.procurement_case_id)
    .maybeSingle();
  if (existing) return { ok: false, error: '此案件已建立過驗收單' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', po.procurement_case_id)
    .single();
  if (!caseRow) return { ok: false, error: '找不到案件資料' };
  const caseNumber = caseRow.case_number;

  const { data: poItems } = await db
    .from('purchase_order_items')
    .select('id, line_no, description, quantity, total_price')
    .eq('purchase_order_id', po.id)
    .order('line_no');
  if (!poItems || poItems.length === 0) {
    return { ok: false, error: '來源採購單沒有明細項次' };
  }

  const passFailByItemId = new Map(input.items.map((i) => [i.purchaseOrderItemId, i.passFail]));
  if (
    input.items.length !== poItems.length ||
    passFailByItemId.size !== poItems.length ||
    poItems.some((i) => !passFailByItemId.has(i.id))
  ) {
    return { ok: false, error: '請為每一項採購明細填寫驗收結果' };
  }

  const validation = validateAcceptanceInput({
    items: poItems.map((i) => ({ passFail: passFailByItemId.get(i.id)! })),
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const acceptanceItems = poItems.map((i) => ({
    purchase_order_item_id: i.id,
    line_no: i.line_no,
    description: i.description,
    quantity: i.quantity,
    amount: Number(i.total_price),
    pass_fail: passFailByItemId.get(i.id)!,
  }));
  const totalAmount = Number(po.total_amount);

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: po.department_id,
    budgetOwnerEmployeeId: po.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const isAutoApproved = chain.length === 0;
  const { data: acceptance, error: acceptanceError } = await db
    .from('acceptances')
    .insert({
      procurement_case_id: po.procurement_case_id,
      purchase_order_id: po.id,
      applicant_employee_id: employee.id,
      department_id: po.department_id,
      budget_owner_employee_id: po.budget_owner_employee_id,
      contractor_supplier_id: input.contractorSupplierId,
      acceptance_date: input.acceptanceDate,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (acceptanceError || !acceptance) return { ok: false, error: '建立驗收單失敗' };

  const cleanup = async () => {
    await db
      .from('approval_steps')
      .delete()
      .eq('form_type', 'acceptance')
      .eq('form_id', acceptance.id);
    await db
      .from('notifications')
      .delete()
      .eq('form_type', 'acceptance')
      .eq('form_id', acceptance.id);
    await db.from('acceptances').delete().eq('id', acceptance.id);
  };

  const { error: itemsError } = await db
    .from('acceptance_items')
    .insert(acceptanceItems.map((i) => ({ ...i, acceptance_id: acceptance.id })));
  if (itemsError) {
    await cleanup();
    return { ok: false, error: '建立驗收明細失敗' };
  }

  if (!isAutoApproved) {
    const { error: stepsError } = await db.from('approval_steps').insert(
      chain.map((step, idx) => ({
        form_type: 'acceptance',
        form_id: acceptance.id,
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
      formType: 'acceptance',
      formId: acceptance.id,
      caseNumber,
      message: `驗收單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup();
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/acceptances');
  revalidatePath('/approvals');
  return { ok: true, acceptanceId: acceptance.id, caseNumber };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

type LoadStepResult =
  | { error: string }
  | {
      acceptance: { id: string; applicant_employee_id: string; procurement_case_id: string };
      step: { id: string; step_order: number; approver_employee_id: string };
    };

async function loadCurrentStep(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  acceptanceId: string,
  callerId: string
): Promise<LoadStepResult> {
  const { data: acceptance } = await db
    .from('acceptances')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance || acceptance.status !== 'pending_approval' || acceptance.current_step_order === null) {
    return { error: '這張驗收單目前不在簽核中' };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('step_order', acceptance.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張驗收單目前的簽核人' };
  }
  return { acceptance, step };
}

export async function approveAcceptanceStep(acceptanceId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, acceptanceId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { acceptance, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'approved', acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', acceptance.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('acceptances')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', acceptanceId);
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'acceptance',
      formId: acceptanceId,
      caseNumber,
      message: `驗收單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('acceptances')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', acceptanceId);
    await notifyAndEmail(db, {
      recipientEmployeeId: acceptance.applicant_employee_id,
      type: 'request_approved',
      formType: 'acceptance',
      formId: acceptanceId,
      caseNumber,
      message: `驗收單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}

export async function returnAcceptanceStep(
  acceptanceId: string,
  reason: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createSupabaseServiceRoleClient();

  const loaded = await loadCurrentStep(db, acceptanceId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { acceptance, step } = loaded;

  await db
    .from('approval_steps')
    .update({ status: 'returned', comment: reason, acted_at: new Date().toISOString() })
    .eq('id', step.id);

  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_employee_id', employee.id)
    .eq('form_type', 'acceptance')
    .eq('form_id', acceptanceId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  await db
    .from('acceptances')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', acceptanceId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', acceptance.procurement_case_id)
    .single();

  await notifyAndEmail(db, {
    recipientEmployeeId: acceptance.applicant_employee_id,
    type: 'request_returned',
    formType: 'acceptance',
    formId: acceptanceId,
    caseNumber: caseRow!.case_number,
    message: `驗收單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}

export async function updateAcceptanceItemPropertyTag(
  itemId: string,
  propertyTag: string
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以填寫財產編號' };
  }
  const db = createSupabaseServiceRoleClient();

  const { data: item } = await db
    .from('acceptance_items')
    .select('acceptance_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { ok: false, error: '找不到驗收明細' };

  const { error } = await db
    .from('acceptance_items')
    .update({ property_tag: propertyTag })
    .eq('id', itemId);
  if (error) return { ok: false, error: '更新財產編號失敗' };

  revalidatePath(`/acceptances/${item.acceptance_id}`);
  return { ok: true };
}

export type ResubmitAcceptanceInput = {
  contractorSupplierId: string;
  acceptanceDate: string;
  items: { acceptanceItemId: string; passFail: 'pass' | 'fail' }[];
};

export async function resubmitAcceptance(
  acceptanceId: string,
  input: ResubmitAcceptanceInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createSupabaseServiceRoleClient();

  const { data: acceptance } = await db
    .from('acceptances')
    .select(
      'id, applicant_employee_id, status, department_id, budget_owner_employee_id, total_amount, procurement_case_id'
    )
    .eq('id', acceptanceId)
    .maybeSingle();
  if (!acceptance) return { ok: false, error: '找不到這張驗收單' };
  if (acceptance.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張驗收單' };
  }
  if (acceptance.status !== 'returned') {
    return { ok: false, error: '只有被退回的驗收單可以重新送出' };
  }

  const { data: existingItems } = await db
    .from('acceptance_items')
    .select('id, line_no, purchase_order_item_id, description, quantity, amount')
    .eq('acceptance_id', acceptanceId)
    .order('line_no');
  if (!existingItems || existingItems.length === 0) {
    return { ok: false, error: '找不到驗收明細' };
  }

  const passFailByItemId = new Map(input.items.map((i) => [i.acceptanceItemId, i.passFail]));
  if (
    passFailByItemId.size !== existingItems.length ||
    existingItems.some((i) => !passFailByItemId.has(i.id))
  ) {
    return { ok: false, error: '請為每一項明細填寫驗收結果' };
  }

  const validation = validateAcceptanceInput({
    items: existingItems.map((i) => ({ passFail: passFailByItemId.get(i.id)! })),
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: acceptance.department_id,
    budgetOwnerEmployeeId: acceptance.budget_owner_employee_id,
    totalAmount: Number(acceptance.total_amount),
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const items = existingItems.map((i) => ({
    line_no: i.line_no,
    purchase_order_item_id: i.purchase_order_item_id,
    description: i.description,
    quantity: i.quantity,
    amount: Number(i.amount),
    pass_fail: passFailByItemId.get(i.id)!,
  }));

  const { error: txError } = await db.rpc('resubmit_acceptance', {
    p_acceptance_id: acceptanceId,
    p_contractor_supplier: input.contractorSupplierId,
    p_acceptance_date: input.acceptanceDate,
    p_items: items,
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
    .eq('id', acceptance.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'acceptance',
    formId: acceptanceId,
    caseNumber: caseRow!.case_number,
    message: `驗收單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return { ok: true };
}
