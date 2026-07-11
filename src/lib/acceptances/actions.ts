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
