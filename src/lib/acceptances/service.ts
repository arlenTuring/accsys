import { and, asc, eq } from 'drizzle-orm';
import { validateAcceptanceInput } from '@/lib/acceptances/validate';
import { recordAudit } from '@/lib/audit/record';
import { isFinanceOrAdmin, isUuid } from '@/lib/authz/forms';
import { assertLegacyOpen } from '@/lib/custom-forms/legacy';
import { acceptanceItems, acceptances, purchaseOrderItems, purchaseOrders, suppliers } from '@/lib/db/schema';
import { centsToDecimal, toCents } from '@/lib/money';
import { isIsoDate } from '@/lib/travel-expenses/validate';
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

export type Actor = { id: string; role?: string } | null;
type PassFail = 'pass' | 'fail';

export type CreateAcceptanceInput = {
  purchaseOrderId: string;
  contractorSupplierId: string;
  acceptanceDate: string;
  items: { purchaseOrderItemId: string; passFail: PassFail }[];
  idempotencyKey: string;
};
export type EditAcceptanceInput = {
  contractorSupplierId: string;
  acceptanceDate: string;
  items: { acceptanceItemId: string; passFail: PassFail }[];
  expectedVersion: number;
};
export type CreateResult = { ok: true; acceptanceId: string; caseNumber: string } | Failure;

const FORM = 'acceptance' as const;

async function checkHeader(tx: Tx, input: { contractorSupplierId: string; acceptanceDate: string }) {
  if (!input || !isUuid(input.contractorSupplierId)) abort('validation', '請選擇驗收廠商');
  const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.contractorSupplierId));
  if (!supplier) abort('validation', '請選擇驗收廠商');
  if (!isIsoDate(input.acceptanceDate)) abort('validation', '驗收日期格式不正確');
}

/** Each existing line must get exactly one pass/fail result. */
function resultsFor<T extends { id: string }>(lines: T[], results: { id: string; passFail: unknown }[], message: string) {
  if (!Array.isArray(results)) abort('validation', message);
  const byId = new Map(results.map((r) => [r.id, r.passFail]));
  if (results.length !== lines.length || byId.size !== lines.length || lines.some((l) => !byId.has(l.id))) abort('validation', message);
  if ([...byId.values()].some((v) => v !== 'pass' && v !== 'fail')) abort('validation', '驗收結果只能是合格或不合格');
  const validation = validateAcceptanceInput({ items: lines.map((l) => ({ passFail: byId.get(l.id) as PassFail })) });
  if (!validation.ok) abort('validation', validation.error);
  return byId as Map<string, PassFail>;
}

export function createAcceptance(actor: Actor, input: CreateAcceptanceInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'acceptance.create';
  return runInTransaction(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateAcceptanceInput);
      const claim = await claimIdempotencyKey<{ ok: true; acceptanceId: string; caseNumber: string }>(tx, {
        actorId: actor.id,
        operation,
        key: idempotencyKey,
        request,
      });
      if ('replay' in claim) return claim.replay;
      await assertLegacyOpen(tx, 'acceptance', '驗收單');

      if (!isUuid(input.purchaseOrderId)) abort('not_found', '找不到來源採購單');
      const source = await lockForm(tx, 'purchase_order', input.purchaseOrderId);
      if (!source || source.applicantEmployeeId !== actor.id) abort('not_found', '找不到來源採購單');
      if (source!.status !== 'approved') abort('conflict', '來源採購單尚未核准，無法建立驗收單');
      const [existing] = await tx
        .select({ id: acceptances.id })
        .from(acceptances)
        .where(eq(acceptances.procurementCaseId, source!.procurementCaseId));
      if (existing) abort('conflict', '此案件已建立過驗收單');

      await checkHeader(tx, input);
      const poItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, source!.id))
        .orderBy(asc(purchaseOrderItems.lineNo));
      if (poItems.length === 0) abort('validation', '來源採購單沒有明細項次');
      const results = resultsFor(
        poItems,
        (input.items ?? []).map((i) => ({ id: i.purchaseOrderItemId, passFail: i.passFail })),
        '請為每一項採購明細填寫驗收結果'
      );
      const [order] = await tx
        .select({ total: purchaseOrders.totalAmount })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, source!.id));
      const total = toCents(order.total);

      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: source!.departmentId,
        budgetOwnerEmployeeId: source!.budgetOwnerEmployeeId,
        total,
      });
      const autoApproved = chain.length === 0;
      const [acceptance] = await tx
        .insert(acceptances)
        .values({
          procurementCaseId: source!.procurementCaseId,
          purchaseOrderId: source!.id,
          applicantEmployeeId: actor.id,
          departmentId: source!.departmentId,
          budgetOwnerEmployeeId: source!.budgetOwnerEmployeeId,
          contractorSupplierId: input.contractorSupplierId,
          acceptanceDate: input.acceptanceDate,
          totalAmount: centsToDecimal(total),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: acceptances.id });
      await tx.insert(acceptanceItems).values(
        poItems.map((i) => ({
          acceptanceId: acceptance.id,
          lineNo: i.lineNo,
          purchaseOrderItemId: i.id,
          description: i.description,
          quantity: i.quantity,
          amount: i.totalPrice,
          passFail: results.get(i.id)!,
        }))
      );
      await insertSteps(tx, FORM, acceptance.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: FORM,
          formId: acceptance.id,
          caseNumber: source!.caseNumber,
          version: 1,
          message: `驗收單 ${source!.caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: acceptance.id,
        details: { caseNumber: source!.caseNumber, purchaseOrderId: source!.id },
      });
      const result = { ok: true as const, acceptanceId: acceptance.id, caseNumber: source!.caseNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, acceptanceId: string) {
  if (!isUuid(acceptanceId)) abort('not_found', '找不到這張驗收單');
  const form = await lockForm(tx, FORM, acceptanceId);
  if (!form) abort('not_found', '找不到這張驗收單');
  return form!;
}

export function approveAcceptanceStep(actor: Actor, acceptanceId: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${FORM}.approve`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, acceptanceId);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'approve' });
      return { ok: true as const };
    },
    hooks
  );
}

export function returnAcceptanceStep(actor: Actor, acceptanceId: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  return runInTransaction(`${FORM}.return`, async (tx, outbox) => {
    const form = await lockOrFail(tx, acceptanceId);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'return', reason });
    return { ok: true as const };
  });
}

function reviseRound(actor: Actor, acceptanceId: string, input: EditAcceptanceInput, mode: 'update' | 'resubmit', hooks?: TxHooks) {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, acceptanceId);
      if (mode === 'update') {
        assertApplicantBeforeFirstDecision(form, actor.id, '修改', FORM);
      } else {
        if (form.applicantEmployeeId !== actor.id) abort('forbidden', '只有申請人可以重新送出這張驗收單');
        if (form.status !== 'returned') abort('conflict', '只有被退回的驗收單可以重新送出');
      }
      assertVersion(form, input?.expectedVersion);
      await checkHeader(tx, input);
      const existing = await tx
        .select()
        .from(acceptanceItems)
        .where(eq(acceptanceItems.acceptanceId, acceptanceId))
        .orderBy(asc(acceptanceItems.lineNo));
      if (existing.length === 0) abort('validation', '找不到驗收明細');
      const results = resultsFor(
        existing,
        (input.items ?? []).map((i) => ({ id: i.acceptanceItemId, passFail: i.passFail })),
        '請為每一項明細填寫驗收結果'
      );
      const [header] = await tx.select({ total: acceptances.totalAmount }).from(acceptances).where(eq(acceptances.id, acceptanceId));
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: form.departmentId,
        budgetOwnerEmployeeId: form.budgetOwnerEmployeeId,
        total: toCents(header.total),
      });
      if (chain.length === 0) abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);

      for (const line of existing) {
        await tx
          .update(acceptanceItems)
          .set({ passFail: results.get(line.id)! })
          .where(and(eq(acceptanceItems.id, line.id), eq(acceptanceItems.acceptanceId, acceptanceId)));
      }
      await tx
        .update(acceptances)
        .set({ contractorSupplierId: input.contractorSupplierId, acceptanceDate: input.acceptanceDate })
        .where(eq(acceptances.id, acceptanceId));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems: existing,
        message:
          mode === 'update' ? `驗收單 ${form.caseNumber} 已修改，待您簽核` : `驗收單 ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function updateAcceptance(actor: Actor, acceptanceId: string, input: EditAcceptanceInput, hooks?: TxHooks) {
  return reviseRound(actor, acceptanceId, input, 'update', hooks);
}

export function resubmitAcceptance(actor: Actor, acceptanceId: string, input: EditAcceptanceInput, hooks?: TxHooks) {
  return reviseRound(actor, acceptanceId, input, 'resubmit', hooks);
}

export function withdrawAcceptance(actor: Actor, acceptanceId: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${FORM}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, acceptanceId);
    await withdrawForm(tx, { formType: FORM, form, actorId: actor.id });
    return { ok: true as const };
  });
}

/** Finance records the asset tag after approval; locked against concurrent edits and audited. */
export function updateAcceptanceItemPropertyTag(actor: Actor, itemId: string, propertyTag: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (!isFinanceOrAdmin(actor as { id: string; role: string })) {
    return Promise.resolve(fail('forbidden', '只有財會人員可以填寫財產編號'));
  }
  if (typeof propertyTag !== 'string' || propertyTag.length > 100) return Promise.resolve(fail('validation', '財產編號過長'));
  return runInTransaction(`${FORM}.property_tag`, async (tx) => {
    if (!isUuid(itemId)) abort('not_found', '找不到驗收明細');
    const [item] = await tx
      .select({ acceptanceId: acceptanceItems.acceptanceId, before: acceptanceItems.propertyTag })
      .from(acceptanceItems)
      .where(eq(acceptanceItems.id, itemId));
    if (!item) abort('not_found', '找不到驗收明細');
    const form = await lockForm(tx, FORM, item.acceptanceId);
    if (form?.status !== 'approved') abort('conflict', '只能在驗收單已核准後填寫財產編號');
    await tx.update(acceptanceItems).set({ propertyTag: propertyTag.trim() || null }).where(eq(acceptanceItems.id, itemId));
    await recordAudit(tx, {
      actorEmployeeId: actor.id,
      action: `${FORM}.property_tag_set`,
      entityType: FORM,
      entityId: item.acceptanceId,
      details: { itemId, from: item.before, to: propertyTag.trim() || null },
    });
    return { ok: true as const };
  });
}
