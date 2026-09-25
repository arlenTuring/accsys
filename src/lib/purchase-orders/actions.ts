'use server';

import { revalidatePath } from 'next/cache';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { buildApprovalChainForForm } from '@/lib/approval/build-chain';
import { notifyAndEmail } from '@/lib/notifications/notify';
import { validatePurchaseOrderInput } from '@/lib/purchase-orders/validate';

export type NewPurchaseOrderItem = {
  purchaseRequestItemId: string;
  unitPrice: number;
};

export type NewPurchaseOrder = {
  purchaseRequestId: string;
  supplierId: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
  items: NewPurchaseOrderItem[];
};

export type CreateResult =
  | { ok: true; orderId: string; caseNumber: string }
  | { ok: false; error: string };

export async function createPurchaseOrder(input: NewPurchaseOrder): Promise<CreateResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };

  const db = createAppDb();

  const { data: pr } = await db
    .from('purchase_requests')
    .select('id, procurement_case_id, department_id, budget_owner_employee_id, status')
    .eq('id', input.purchaseRequestId)
    .maybeSingle();
  if (!pr) return { ok: false, error: '找不到來源請購單' };
  if (pr.status !== 'approved') {
    return { ok: false, error: '來源請購單尚未核准，無法建立採購單' };
  }

  const { data: existing } = await db
    .from('purchase_orders')
    .select('id')
    .eq('procurement_case_id', pr.procurement_case_id)
    .maybeSingle();
  if (existing) return { ok: false, error: '此案件已建立過採購單' };

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', pr.procurement_case_id)
    .single();
  if (!caseRow) return { ok: false, error: '找不到案件資料' };
  const caseNumber = caseRow.case_number;

  const { data: prItems } = await db
    .from('purchase_request_items')
    .select('id, line_no, budget_code_id, item_category, description, quantity')
    .eq('purchase_request_id', pr.id)
    .order('line_no');
  if (!prItems || prItems.length === 0) {
    return { ok: false, error: '來源請購單沒有明細項次' };
  }

  const priceByItemId = new Map(input.items.map((i) => [i.purchaseRequestItemId, i.unitPrice]));
  if (priceByItemId.size !== prItems.length || prItems.some((i) => !priceByItemId.has(i.id))) {
    return { ok: false, error: '請為每一項請購明細填寫單價' };
  }

  const orderItems = prItems.map((i) => {
    const unitPrice = priceByItemId.get(i.id)!;
    return {
      line_no: i.line_no,
      budget_code_id: i.budget_code_id,
      item_category: i.item_category,
      description: i.description,
      quantity: i.quantity,
      unit_price: unitPrice,
      total_price: unitPrice * i.quantity,
    };
  });
  const totalAmount = orderItems.reduce((sum, i) => sum + i.total_price, 0);

  const validation = validatePurchaseOrderInput({
    items: orderItems.map((i) => ({ unitPrice: i.unit_price })),
    totalAmount,
    quoteCount: input.quoteCount,
    quoteCountReason: input.quoteCountReason,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: pr.department_id,
    budgetOwnerEmployeeId: pr.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;

  const isAutoApproved = chain.length === 0;
  const { data: order, error: orderError } = await db
    .from('purchase_orders')
    .insert({
      procurement_case_id: pr.procurement_case_id,
      purchase_request_id: pr.id,
      applicant_employee_id: employee.id,
      department_id: pr.department_id,
      budget_owner_employee_id: pr.budget_owner_employee_id,
      supplier_id: input.supplierId,
      payment_method: input.paymentMethod,
      payment_terms: input.paymentTerms,
      expected_delivery_days: input.expectedDeliveryDays,
      quote_count: input.quoteCount,
      quote_count_reason: input.quoteCountReason,
      total_amount: totalAmount,
      status: isAutoApproved ? 'approved' : 'pending_approval',
      current_step_order: isAutoApproved ? null : 1,
    })
    .select()
    .single();
  if (orderError || !order) return { ok: false, error: '建立採購單失敗' };

  const cleanup = async () => {
    await db.from('approval_steps').delete().eq('form_type', 'purchase_order').eq('form_id', order.id);
    await db.from('notifications').delete().eq('form_type', 'purchase_order').eq('form_id', order.id);
    await db.from('purchase_orders').delete().eq('id', order.id);
  };

  const { error: itemsError } = await db
    .from('purchase_order_items')
    .insert(orderItems.map((i) => ({ ...i, purchase_order_id: order.id })));
  if (itemsError) {
    await cleanup();
    return { ok: false, error: '建立採購明細失敗' };
  }

  if (!isAutoApproved) {
    const { error: stepsError } = await db.from('approval_steps').insert(
      chain.map((step, idx) => ({
        form_type: 'purchase_order',
        form_id: order.id,
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
      formType: 'purchase_order',
      formId: order.id,
      caseNumber,
      message: `採購單 ${caseNumber} 待您簽核`,
    });
    if (!notifyResult.ok) {
      await cleanup();
      return { ok: false, error: '建立通知失敗' };
    }
  }

  revalidatePath('/purchase-orders');
  revalidatePath('/approvals');
  return { ok: true, orderId: order.id, caseNumber };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

type LoadStepResult =
  | { error: string }
  | {
      order: { id: string; applicant_employee_id: string; procurement_case_id: string };
      step: { id: string; step_order: number; approver_employee_id: string };
    };

async function loadCurrentStep(
  db: ReturnType<typeof createAppDb>,
  orderId: string,
  callerId: string
): Promise<LoadStepResult> {
  const { data: order } = await db
    .from('purchase_orders')
    .select('id, applicant_employee_id, status, current_step_order, procurement_case_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order || order.status !== 'pending_approval' || order.current_step_order === null) {
    return { error: '這張採購單目前不在簽核中' };
  }
  const { data: step } = await db
    .from('approval_steps')
    .select('id, step_order, approver_employee_id')
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('step_order', order.current_step_order)
    .maybeSingle();
  if (!step || step.approver_employee_id !== callerId) {
    return { error: '您不是這張採購單目前的簽核人' };
  }
  return { order, step } as never;
}

export async function approvePurchaseOrderStep(orderId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const loaded = await loadCurrentStep(db, orderId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { order, step } = loaded;

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
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', order.procurement_case_id)
    .single();
  const caseNumber = caseRow!.case_number;

  const { data: nextStep } = await db
    .from('approval_steps')
    .select('step_order, approver_employee_id')
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('step_order', step.step_order + 1)
    .maybeSingle();

  if (nextStep) {
    await db
      .from('purchase_orders')
      .update({ current_step_order: nextStep.step_order, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    await notifyAndEmail(db, {
      recipientEmployeeId: nextStep.approver_employee_id,
      type: 'approval_requested',
      formType: 'purchase_order',
      formId: orderId,
      caseNumber,
      message: `採購單 ${caseNumber} 待您簽核`,
    });
  } else {
    await db
      .from('purchase_orders')
      .update({ status: 'approved', current_step_order: null, updated_at: new Date().toISOString() })
      .eq('id', orderId);
    await notifyAndEmail(db, {
      recipientEmployeeId: order.applicant_employee_id,
      type: 'request_approved',
      formType: 'purchase_order',
      formId: orderId,
      caseNumber,
      message: `採購單 ${caseNumber} 已完成簽核`,
    });
  }

  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}

export type ResubmitPurchaseOrderInput = {
  supplierId: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
  items: { purchaseOrderItemId: string; unitPrice: number }[];
};

export async function resubmitPurchaseOrder(
  orderId: string,
  input: ResubmitPurchaseOrderInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const { data: order } = await db
    .from('purchase_orders')
    .select(
      'id, applicant_employee_id, status, department_id, budget_owner_employee_id, procurement_case_id'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: '找不到這張採購單' };
  if (order.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以重新送出這張採購單' };
  }
  if (order.status !== 'returned') {
    return { ok: false, error: '只有被退回的採購單可以重新送出' };
  }

  const { data: existingItems } = await db
    .from('purchase_order_items')
    .select('id, line_no, budget_code_id, item_category, description, quantity')
    .eq('purchase_order_id', orderId)
    .order('line_no');
  if (!existingItems || existingItems.length === 0) {
    return { ok: false, error: '找不到採購明細' };
  }

  const priceByItemId = new Map(input.items.map((i) => [i.purchaseOrderItemId, i.unitPrice]));
  if (priceByItemId.size !== existingItems.length || existingItems.some((i) => !priceByItemId.has(i.id))) {
    return { ok: false, error: '請為每一項明細填寫單價' };
  }

  const orderItems = existingItems.map((i) => {
    const unitPrice = priceByItemId.get(i.id)!;
    return {
      line_no: i.line_no,
      budget_code_id: i.budget_code_id,
      item_category: i.item_category,
      description: i.description,
      quantity: i.quantity,
      unit_price: unitPrice,
      total_price: unitPrice * i.quantity,
    };
  });
  const totalAmount = orderItems.reduce((sum, i) => sum + i.total_price, 0);

  const validation = validatePurchaseOrderInput({
    items: orderItems.map((i) => ({ unitPrice: i.unit_price })),
    totalAmount,
    quoteCount: input.quoteCount,
    quoteCountReason: input.quoteCountReason,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: order.department_id,
    budgetOwnerEmployeeId: order.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '重新送出後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_purchase_order', {
    p_order_id: orderId,
    p_supplier: input.supplierId,
    p_payment_method: input.paymentMethod,
    p_payment_terms: input.paymentTerms,
    p_expected_delivery_days: input.expectedDeliveryDays,
    p_quote_count: input.quoteCount,
    p_quote_count_reason: input.quoteCountReason,
    p_total: totalAmount,
    p_items: orderItems,
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
    .eq('id', order.procurement_case_id)
    .single();
  await notifyAndEmail(db, {
    recipientEmployeeId: chain[0].approverEmployeeId,
    type: 'approval_requested',
    formType: 'purchase_order',
    formId: orderId,
    caseNumber: caseRow!.case_number,
    message: `採購單 ${caseRow!.case_number} 已重新送出，待您簽核`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}

export async function updatePurchaseOrder(
  orderId: string,
  input: ResubmitPurchaseOrderInput
): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const { data: order } = await db
    .from('purchase_orders')
    .select(
      'id, applicant_employee_id, status, current_step_order, department_id, budget_owner_employee_id'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: '找不到這張採購單' };
  if (order.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以修改這張採購單' };
  }
  if (order.status !== 'pending_approval' || order.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的採購單可以修改' };
  }

  const { data: existingItems } = await db
    .from('purchase_order_items')
    .select('id, line_no, budget_code_id, item_category, description, quantity')
    .eq('purchase_order_id', orderId)
    .order('line_no');
  if (!existingItems || existingItems.length === 0) {
    return { ok: false, error: '找不到採購明細' };
  }

  const priceByItemId = new Map(input.items.map((i) => [i.purchaseOrderItemId, i.unitPrice]));
  if (priceByItemId.size !== existingItems.length || existingItems.some((i) => !priceByItemId.has(i.id))) {
    return { ok: false, error: '請為每一項明細填寫單價' };
  }

  const orderItems = existingItems.map((i) => {
    const unitPrice = priceByItemId.get(i.id)!;
    return {
      line_no: i.line_no,
      budget_code_id: i.budget_code_id,
      item_category: i.item_category,
      description: i.description,
      quantity: i.quantity,
      unit_price: unitPrice,
      total_price: unitPrice * i.quantity,
    };
  });
  const totalAmount = orderItems.reduce((sum, i) => sum + i.total_price, 0);

  const validation = validatePurchaseOrderInput({
    items: orderItems.map((i) => ({ unitPrice: i.unit_price })),
    totalAmount,
    quoteCount: input.quoteCount,
    quoteCountReason: input.quoteCountReason,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chainResult = await buildApprovalChainForForm(db, {
    applicantEmployeeId: employee.id,
    departmentId: order.department_id,
    budgetOwnerEmployeeId: order.budget_owner_employee_id,
    totalAmount,
  });
  if (!chainResult.ok) return { ok: false, error: chainResult.error };
  const chain = chainResult.chain;
  if (chain.length === 0) {
    return { ok: false, error: '修改後找不到適用的簽核人，請聯絡系統管理員' };
  }

  const { error: txError } = await db.rpc('resubmit_purchase_order', {
    p_order_id: orderId,
    p_supplier: input.supplierId,
    p_payment_method: input.paymentMethod,
    p_payment_terms: input.paymentTerms,
    p_expected_delivery_days: input.expectedDeliveryDays,
    p_quote_count: input.quoteCount,
    p_quote_count_reason: input.quoteCountReason,
    p_total: totalAmount,
    p_items: orderItems,
    p_steps: chain.map((step, idx) => ({
      step_order: idx + 1,
      approver_employee_id: step.approverEmployeeId,
      approver_role: step.approverRole,
    })),
  });
  if (txError) return { ok: false, error: '修改失敗，請稍後再試' };

  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}

export async function withdrawPurchaseOrder(orderId: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  const db = createAppDb();

  const { data: order } = await db
    .from('purchase_orders')
    .select('id, applicant_employee_id, status, current_step_order')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: '找不到這張採購單' };
  if (order.applicant_employee_id !== employee.id) {
    return { ok: false, error: '只有申請人可以撤回這張採購單' };
  }
  if (order.status !== 'pending_approval' || order.current_step_order !== 1) {
    return { ok: false, error: '只有尚未有人簽核的採購單可以撤回' };
  }

  const { data: updated, error } = await db
    .from('purchase_orders')
    .update({ status: 'withdrawn', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', 'pending_approval')
    .eq('current_step_order', 1)
    .select('id');
  if (error) return { ok: false, error: '撤回失敗，請稍後再試' };
  if (!updated || updated.length === 0) {
    return { ok: false, error: '此表單已被處理，請重新整理頁面' };
  }

  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}

export async function returnPurchaseOrderStep(orderId: string, reason: string): Promise<ActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };
  if (reason.trim() === '') return { ok: false, error: '請填寫退回原因' };
  const db = createAppDb();

  const loaded = await loadCurrentStep(db, orderId, employee.id);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { order, step } = loaded;

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
    .eq('form_type', 'purchase_order')
    .eq('form_id', orderId)
    .eq('type', 'approval_requested')
    .eq('is_read', false);

  await db
    .from('purchase_orders')
    .update({ status: 'returned', current_step_order: null, updated_at: new Date().toISOString() })
    .eq('id', orderId);

  const { data: caseRow } = await db
    .from('procurement_cases')
    .select('case_number')
    .eq('id', order.procurement_case_id)
    .single();

  await notifyAndEmail(db, {
    recipientEmployeeId: order.applicant_employee_id,
    type: 'request_returned',
    formType: 'purchase_order',
    formId: orderId,
    caseNumber: caseRow!.case_number,
    message: `採購單 ${caseRow!.case_number} 已被退回：${reason}`,
  });

  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}
