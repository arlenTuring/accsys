import { eq, inArray, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { budgetCodes, procurementCases, purchaseRequestItems, purchaseRequests } from '@/lib/db/schema';
import { addCents, centsToDecimal, MoneyError, toCents, type Cents } from '@/lib/money';
import { validatePurchaseRequestInput } from '@/lib/purchase-requests/validate';
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

export type Actor = { id: string; departmentId: string } | null;

export type PurchaseRequestInput = {
  neededWithinDays: number | null;
  items: { budgetCodeId: string; description: string; quantity: number; estimatedAmount: number | string }[];
};
export type CreatePurchaseRequestInput = PurchaseRequestInput & { idempotencyKey: string };
export type EditPurchaseRequestInput = PurchaseRequestInput & { expectedVersion: number };

export type CreateResult = { ok: true; requestId: string; caseNumber: string } | Failure;

const FORM = 'purchase_request' as const;

type PreparedItem = {
  budgetCodeId: string;
  itemCategory: string;
  description: string;
  quantity: number;
  estimated: Cents;
};

/** Validates input against current budget codes (inside the transaction). */
async function prepare(tx: Tx, input: PurchaseRequestInput) {
  if (!input || !Array.isArray(input.items) || input.items.length === 0) abort('validation', '請購單至少需要一個明細項次');
  if (input.items.length > 100) abort('validation', '明細項次不可超過 100 項');
  const days = input.neededWithinDays;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) abort('validation', '需求天數不正確');

  const ids = [...new Set(input.items.map((i) => i.budgetCodeId))];
  if (!ids.every(isUuid)) abort('validation', '選取的預算編號無效');
  const codes = await tx
    .select({ id: budgetCodes.id, category: budgetCodes.category, ownerId: budgetCodes.ownerEmployeeId })
    .from(budgetCodes)
    .where(inArray(budgetCodes.id, ids));
  if (codes.length !== ids.length) abort('validation', '選取的預算編號無效');
  const byId = new Map(codes.map((c) => [c.id, c]));

  const items: PreparedItem[] = input.items.map((i, idx) => {
    if (typeof i.description !== 'string' || i.description.length > 500) abort('validation', `第 ${idx + 1} 項的說明不正確`);
    if (!Number.isSafeInteger(i.quantity) || i.quantity > 1_000_000) abort('validation', `第 ${idx + 1} 項的數量必須為正整數`);
    let estimated: Cents;
    try {
      estimated = toCents(i.estimatedAmount);
    } catch (err) {
      abort('validation', `第 ${idx + 1} 項的預估費用：${(err as MoneyError).message}`);
    }
    return {
      budgetCodeId: i.budgetCodeId,
      itemCategory: byId.get(i.budgetCodeId)!.category,
      description: i.description,
      quantity: i.quantity,
      estimated: estimated!,
    };
  });

  const validation = validatePurchaseRequestInput(
    items.map((i) => ({
      budgetCodeId: i.budgetCodeId,
      budgetOwnerEmployeeId: byId.get(i.budgetCodeId)!.ownerId ?? '',
      itemCategory: i.itemCategory,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: i.estimated,
    }))
  );
  if (!validation.ok) abort('validation', validation.error);
  const budgetOwnerId = byId.get(items[0].budgetCodeId)!.ownerId;
  if (!budgetOwnerId) abort('validation', '選取的預算編號沒有指定預算負責人');

  const total = addCents(...items.map((i) => i.estimated));
  return { items, total, budgetOwnerId: budgetOwnerId!, neededWithinDays: days };
}

async function writeItems(tx: Tx, requestId: string, items: PreparedItem[]) {
  await tx.insert(purchaseRequestItems).values(
    items.map((i, idx) => ({
      purchaseRequestId: requestId,
      lineNo: idx + 1,
      budgetCodeId: i.budgetCodeId,
      itemCategory: i.itemCategory,
      description: i.description,
      quantity: i.quantity,
      estimatedAmount: centsToDecimal(i.estimated),
    }))
  );
}

async function currentItems(tx: Tx, requestId: string) {
  return tx.select().from(purchaseRequestItems).where(eq(purchaseRequestItems.purchaseRequestId, requestId));
}

export function createPurchaseRequest(
  actor: Actor,
  input: CreatePurchaseRequestInput,
  hooks?: TxHooks
): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'purchase_request.create';
  return runInTransaction(
    operation,
    async (tx, outbox) => {
      const { neededWithinDays, items } = input ?? ({} as CreatePurchaseRequestInput);
      const claim = await claimIdempotencyKey<{ ok: true; requestId: string; caseNumber: string }>(tx, {
        actorId: actor.id,
        operation,
        key: input?.idempotencyKey,
        request: { neededWithinDays, items },
      });
      if ('replay' in claim) return claim.replay;

      const prepared = await prepare(tx, input);
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: actor.departmentId,
        budgetOwnerEmployeeId: prepared.budgetOwnerId,
        total: prepared.total,
      });

      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id })
        .returning({ id: procurementCases.id });
      const autoApproved = chain.length === 0;
      const [pr] = await tx
        .insert(purchaseRequests)
        .values({
          procurementCaseId: pcase.id,
          applicantEmployeeId: actor.id,
          departmentId: actor.departmentId,
          budgetOwnerEmployeeId: prepared.budgetOwnerId,
          neededWithinDays: prepared.neededWithinDays,
          totalAmount: centsToDecimal(prepared.total),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: purchaseRequests.id });
      await writeItems(tx, pr.id, prepared.items);
      await insertSteps(tx, FORM, pr.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: FORM,
          formId: pr.id,
          caseNumber,
          version: 1,
          message: `請購單 ${caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: pr.id,
        details: { caseNumber, total: centsToDecimal(prepared.total), steps: chain.length },
      });
      const result = { ok: true as const, requestId: pr.id, caseNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: input.idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, requestId: string) {
  if (!isUuid(requestId)) abort('not_found', '找不到這張請購單');
  const form = await lockForm(tx, FORM, requestId);
  if (!form) abort('not_found', '找不到這張請購單');
  return form!;
}

/** `expectedVersion`: the version the approver was looking at; a changed form must be re-read. */
export function approvePurchaseRequestStep(
  actor: Actor,
  requestId: string,
  expectedVersion: number,
  hooks?: TxHooks
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${FORM}.approve`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, requestId);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'approve' });
      return { ok: true as const };
    },
    hooks
  );
}

export function returnPurchaseRequestStep(
  actor: Actor,
  requestId: string,
  reason: string,
  expectedVersion: number
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  return runInTransaction(`${FORM}.return`, async (tx, outbox) => {
    const form = await lockOrFail(tx, requestId);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'return', reason });
    return { ok: true as const };
  });
}

/** Shared body of edit (before the first decision) and resubmit (after a return). */
function reviseRound(
  actor: Actor,
  requestId: string,
  input: EditPurchaseRequestInput,
  mode: 'update' | 'resubmit',
  hooks?: TxHooks
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, requestId);
      if (mode === 'update') {
        assertApplicantBeforeFirstDecision(form, actor.id, '修改', FORM);
      } else {
        if (form.applicantEmployeeId !== actor.id) abort('forbidden', '只有申請人可以重新送出這張請購單');
        if (form.status !== 'returned') abort('conflict', '只有被退回的請購單可以重新送出');
      }
      assertVersion(form, input?.expectedVersion);

      const prepared = await prepare(tx, input);
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: form.departmentId,
        budgetOwnerEmployeeId: prepared.budgetOwnerId,
        total: prepared.total,
      });
      if (chain.length === 0) {
        abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);
      }

      const previousItems = await currentItems(tx, requestId);
      await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.purchaseRequestId, requestId));
      await writeItems(tx, requestId, prepared.items);
      await tx
        .update(purchaseRequests)
        .set({
          budgetOwnerEmployeeId: prepared.budgetOwnerId,
          neededWithinDays: prepared.neededWithinDays,
          totalAmount: centsToDecimal(prepared.total),
        })
        .where(eq(purchaseRequests.id, requestId));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems,
        message:
          mode === 'update'
            ? `請購單 ${form.caseNumber} 已修改，待您簽核`
            : `請購單 ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function updatePurchaseRequest(actor: Actor, requestId: string, input: EditPurchaseRequestInput, hooks?: TxHooks) {
  return reviseRound(actor, requestId, input, 'update', hooks);
}

export function resubmitPurchaseRequest(actor: Actor, requestId: string, input: EditPurchaseRequestInput, hooks?: TxHooks) {
  return reviseRound(actor, requestId, input, 'resubmit', hooks);
}

export function withdrawPurchaseRequest(actor: Actor, requestId: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${FORM}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, requestId);
    await withdrawForm(tx, { formType: FORM, form, actorId: actor.id });
    return { ok: true as const };
  });
}
