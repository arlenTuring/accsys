import { and, asc, eq } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { assertLegacyOpen } from '@/lib/custom-forms/legacy';
import { purchaseOrderItems, purchaseOrders, purchaseRequestItems, suppliers } from '@/lib/db/schema';
import { addCents, centsToDecimal, centsToNumber, MoneyError, multiplyCents, toCents, type Cents } from '@/lib/money';
import { validatePurchaseOrderInput } from '@/lib/purchase-orders/validate';
import {
  abort,
  assertApplicantBeforeFirstDecision,
  assertVersion,
  buildChain,
  claimIdempotencyKey,
  decideCurrentStep,
  fail,
  insertSteps,
  lockForm,
  notify,
  replaceSteps,
  runInTransaction,
  storeIdempotentResult,
  withdrawForm,
  type ActionResult,
  type Failure,
  type Tx,
  type TxHooks,
} from '@/lib/workflow/tx';

export type Actor = { id: string } | null;

const PAYMENT_TERMS = ['預付款', '貨到付款', '月結30天', '月結45天', '月結60天', '其他'];
const FORM = 'purchase_order' as const;

export type OrderHeaderInput = {
  supplierId: string;
  paymentMethod: string;
  paymentTerms: string;
  expectedDeliveryDays: number | null;
  quoteCount: number;
  quoteCountReason: string | null;
};
export type CreatePurchaseOrderInput = OrderHeaderInput & {
  purchaseRequestId: string;
  items: { purchaseRequestItemId: string; unitPrice: number | string }[];
  idempotencyKey: string;
};
export type EditPurchaseOrderInput = OrderHeaderInput & {
  items: { purchaseOrderItemId: string; unitPrice: number | string }[];
  expectedVersion: number;
};
export type CreateResult = { ok: true; orderId: string; caseNumber: string } | Failure;

async function checkHeader(tx: Tx, input: OrderHeaderInput) {
  if (!input || !isUuid(input.supplierId)) abort('validation', '請選擇供應商');
  const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId));
  if (!supplier) abort('validation', '請選擇供應商');
  if (typeof input.paymentMethod !== 'string' || input.paymentMethod.trim() === '' || input.paymentMethod.length > 100) {
    abort('validation', '請填寫付款方式');
  }
  if (!PAYMENT_TERMS.includes(input.paymentTerms)) abort('validation', '付款條件不正確');
  const days = input.expectedDeliveryDays;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) abort('validation', '預計交期天數不正確');
  if (!Number.isInteger(input.quoteCount) || input.quoteCount < 0 || input.quoteCount > 100) abort('validation', '報價家數不正確');
  if (input.quoteCountReason !== null && (typeof input.quoteCountReason !== 'string' || input.quoteCountReason.length > 1000)) {
    abort('validation', '報價說明不正確');
  }
}

type PricedLine = { sourceId: string; quantity: number; unit: Cents; total: Cents };

/** Every source line must get exactly one valid unit price. */
function priceLines(
  lines: { id: string; quantity: number }[],
  prices: { id: string; unitPrice: number | string }[],
  missingMessage: string
): { lines: PricedLine[]; total: Cents } {
  if (!Array.isArray(prices)) abort('validation', missingMessage);
  const byId = new Map(prices.map((p) => [p.id, p.unitPrice]));
  if (byId.size !== lines.length || lines.some((l) => !byId.has(l.id))) abort('validation', missingMessage);
  const priced = lines.map((l, idx) => {
    try {
      const unit = toCents(byId.get(l.id));
      if (unit <= 0) abort('validation', `第 ${idx + 1} 項的單價必須大於 0`);
      return { sourceId: l.id, quantity: l.quantity, unit, total: multiplyCents(unit, l.quantity) };
    } catch (err) {
      if (err instanceof MoneyError) abort('validation', `第 ${idx + 1} 項的單價：${err.message}`);
      throw err;
    }
  });
  return { lines: priced, total: addCents(...priced.map((p) => p.total)) };
}

function checkQuotes(input: OrderHeaderInput, priced: { lines: PricedLine[]; total: Cents }) {
  const validation = validatePurchaseOrderInput({
    items: priced.lines.map((l) => ({ unitPrice: centsToNumber(l.unit) })),
    totalAmount: centsToNumber(priced.total),
    quoteCount: input.quoteCount,
    quoteCountReason: input.quoteCountReason,
  });
  if (!validation.ok) abort('validation', validation.error);
}

const header = (input: OrderHeaderInput) => ({
  supplierId: input.supplierId,
  paymentMethod: input.paymentMethod.trim(),
  paymentTerms: input.paymentTerms,
  expectedDeliveryDays: input.expectedDeliveryDays,
  quoteCount: input.quoteCount,
  quoteCountReason: input.quoteCountReason,
});

export function createPurchaseOrder(actor: Actor, input: CreatePurchaseOrderInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'purchase_order.create';
  return runInTransaction(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreatePurchaseOrderInput);
      const claim = await claimIdempotencyKey<{ ok: true; orderId: string; caseNumber: string }>(tx, {
        actorId: actor.id,
        operation,
        key: idempotencyKey,
        request,
      });
      if ('replay' in claim) return claim.replay;
      await assertLegacyOpen(tx, 'purchase_order', '採購單');

      // Lock order: source request first, then our own rows.
      if (!isUuid(input.purchaseRequestId)) abort('not_found', '找不到來源請購單');
      const source = await lockForm(tx, 'purchase_request', input.purchaseRequestId);
      // Only the applicant of the source request continues the case.
      if (!source || source.applicantEmployeeId !== actor.id) abort('not_found', '找不到來源請購單');
      if (source!.status !== 'approved') abort('conflict', '來源請購單尚未核准，無法建立採購單');
      const [existing] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.procurementCaseId, source!.procurementCaseId));
      if (existing) abort('conflict', '此案件已建立過採購單');

      await checkHeader(tx, input);
      const prItems = await tx
        .select()
        .from(purchaseRequestItems)
        .where(eq(purchaseRequestItems.purchaseRequestId, source!.id))
        .orderBy(asc(purchaseRequestItems.lineNo));
      if (prItems.length === 0) abort('validation', '來源請購單沒有明細項次');
      const priced = priceLines(
        prItems,
        (input.items ?? []).map((i) => ({ id: i.purchaseRequestItemId, unitPrice: i.unitPrice })),
        '請為每一項請購明細填寫單價'
      );
      checkQuotes(input, priced);

      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: source!.departmentId,
        budgetOwnerEmployeeId: source!.budgetOwnerEmployeeId,
        total: priced.total,
      });
      const autoApproved = chain.length === 0;
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          procurementCaseId: source!.procurementCaseId,
          purchaseRequestId: source!.id,
          applicantEmployeeId: actor.id,
          departmentId: source!.departmentId,
          budgetOwnerEmployeeId: source!.budgetOwnerEmployeeId,
          ...header(input),
          totalAmount: centsToDecimal(priced.total),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderItems).values(
        prItems.map((src, idx) => ({
          purchaseOrderId: order.id,
          lineNo: src.lineNo,
          budgetCodeId: src.budgetCodeId,
          itemCategory: src.itemCategory,
          description: src.description,
          quantity: src.quantity,
          unitPrice: centsToDecimal(priced.lines[idx].unit),
          totalPrice: centsToDecimal(priced.lines[idx].total),
        }))
      );
      await insertSteps(tx, FORM, order.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: FORM,
          formId: order.id,
          caseNumber: source!.caseNumber,
          version: 1,
          message: `採購單 ${source!.caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: order.id,
        details: { caseNumber: source!.caseNumber, purchaseRequestId: source!.id, total: centsToDecimal(priced.total) },
      });
      const result = { ok: true as const, orderId: order.id, caseNumber: source!.caseNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, orderId: string) {
  if (!isUuid(orderId)) abort('not_found', '找不到這張採購單');
  const form = await lockForm(tx, FORM, orderId);
  if (!form) abort('not_found', '找不到這張採購單');
  return form!;
}

export function approvePurchaseOrderStep(actor: Actor, orderId: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${FORM}.approve`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, orderId);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'approve' });
      return { ok: true as const };
    },
    hooks
  );
}

export function returnPurchaseOrderStep(actor: Actor, orderId: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  return runInTransaction(`${FORM}.return`, async (tx, outbox) => {
    const form = await lockOrFail(tx, orderId);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'return', reason });
    return { ok: true as const };
  });
}

function reviseRound(actor: Actor, orderId: string, input: EditPurchaseOrderInput, mode: 'update' | 'resubmit', hooks?: TxHooks) {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, orderId);
      if (mode === 'update') {
        assertApplicantBeforeFirstDecision(form, actor.id, '修改', FORM);
      } else {
        if (form.applicantEmployeeId !== actor.id) abort('forbidden', '只有申請人可以重新送出這張採購單');
        if (form.status !== 'returned') abort('conflict', '只有被退回的採購單可以重新送出');
      }
      assertVersion(form, input?.expectedVersion);
      await checkHeader(tx, input);

      const existing = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, orderId))
        .orderBy(asc(purchaseOrderItems.lineNo));
      if (existing.length === 0) abort('validation', '找不到採購明細');
      const priced = priceLines(
        existing,
        (input.items ?? []).map((i) => ({ id: i.purchaseOrderItemId, unitPrice: i.unitPrice })),
        '請為每一項明細填寫單價'
      );
      checkQuotes(input, priced);
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: form.departmentId,
        budgetOwnerEmployeeId: form.budgetOwnerEmployeeId,
        total: priced.total,
      });
      if (chain.length === 0) abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);

      // Item rows keep their ids (acceptances reference them); only prices change.
      for (const line of priced.lines) {
        await tx
          .update(purchaseOrderItems)
          .set({ unitPrice: centsToDecimal(line.unit), totalPrice: centsToDecimal(line.total) })
          .where(and(eq(purchaseOrderItems.id, line.sourceId), eq(purchaseOrderItems.purchaseOrderId, orderId)));
      }
      await tx
        .update(purchaseOrders)
        .set({ ...header(input), totalAmount: centsToDecimal(priced.total) })
        .where(eq(purchaseOrders.id, orderId));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems: existing,
        message:
          mode === 'update' ? `採購單 ${form.caseNumber} 已修改，待您簽核` : `採購單 ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function updatePurchaseOrder(actor: Actor, orderId: string, input: EditPurchaseOrderInput, hooks?: TxHooks) {
  return reviseRound(actor, orderId, input, 'update', hooks);
}

export function resubmitPurchaseOrder(actor: Actor, orderId: string, input: EditPurchaseOrderInput, hooks?: TxHooks) {
  return reviseRound(actor, orderId, input, 'resubmit', hooks);
}

export function withdrawPurchaseOrder(actor: Actor, orderId: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${FORM}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, orderId);
    await withdrawForm(tx, { formType: FORM, form, actorId: actor.id });
    return { ok: true as const };
  });
}
