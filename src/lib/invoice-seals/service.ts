import { asc, eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { assertLegacyOpen } from '@/lib/custom-forms/legacy';
import { invoiceSealRequestItems, invoiceSealRequests, procurementCases } from '@/lib/db/schema';
import { parseInvoiceSealInput, type InvoiceSealInput, type NormalizedInvoiceSeal } from '@/lib/invoice-seals/validate';
import { centsToDecimal, toCents } from '@/lib/money';
import {
  approveSealStep,
  assertRevisable,
  excludeFiler,
  filerOf,
  lockSealOrFail,
  resolveParties,
  returnSealStep,
  withdrawSealRequest,
  type Actor,
} from '@/lib/seal-requests/service';
import {
  abort,
  buildChain,
  claimIdempotencyKey,
  fail,
  insertSteps,
  notify,
  replaceSteps,
  runInTransaction,
  storeIdempotentResult,
  type ActionResult,
  type Failure,
  type Tx,
  type TxHooks,
} from '@/lib/workflow/tx';

export type { Actor };
export type CreateInvoiceSealInput = InvoiceSealInput & { idempotencyKey: string };
export type EditInvoiceSealInput = InvoiceSealInput & { expectedVersion: number };
export type CreateResult = { ok: true; sealRequestId: string; caseNumber: string; replayed?: boolean } | Failure;

const FORM = 'invoice_seal_request' as const;
const LABEL = '用印申請單(開立發票/Invoice)';

function normalize(input: InvoiceSealInput): NormalizedInvoiceSeal {
  const parsed = parseInvoiceSealInput(input);
  if (!parsed.ok) abort('validation', parsed.error);
  return parsed.value;
}

function columns(form: NormalizedInvoiceSeal) {
  return {
    applicantEmployeeId: form.applicantEmployeeId,
    departmentId: form.departmentId,
    invoiceType: form.invoiceType,
    seal: form.seal,
    customerName: form.customerName,
    customerTaxId: form.customerTaxId,
    customerAddress: form.customerAddress,
    customerPhone: form.customerPhone,
    currency: form.currency,
    untaxedTotal: centsToDecimal(form.untaxedTotal),
    totalAmount: centsToDecimal(form.totalAmount),
  };
}

async function insertItems(tx: Tx, formId: string, form: NormalizedInvoiceSeal) {
  await tx.insert(invoiceSealRequestItems).values(
    form.items.map((it, i) => ({
      invoiceSealRequestId: formId,
      lineNo: i + 1,
      itemName: it.itemName,
      quantity: it.quantity,
      currency: it.currency,
      unitPrice: centsToDecimal(it.unitPrice),
      amount: centsToDecimal(it.amount),
    }))
  );
}

/** Revenue, not spending: the invoice amount never brings in the chairman. Department manager → general manager. */
function chainFor(tx: Tx, form: NormalizedInvoiceSeal) {
  return buildChain(tx, {
    applicantEmployeeId: form.applicantEmployeeId,
    departmentId: form.departmentId,
    budgetOwnerEmployeeId: null,
    total: toCents('0'),
  });
}

type Claimed = { ok: true; sealRequestId: string; caseNumber: string };

export function createInvoiceSealRequest(actor: Actor, input: CreateInvoiceSealInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'invoice_seal_request.create';
  return runInTransaction<Claimed & { replayed?: boolean }>(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateInvoiceSealInput);
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return { ...claim.replay, replayed: true };
      await assertLegacyOpen(tx, FORM, LABEL);

      const form = await resolveParties(tx, normalize(request));
      const chain = excludeFiler(await chainFor(tx, form), actor.id, form.applicantEmployeeId);
      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id, caseType: 'invoice_seal' })
        .returning({ id: procurementCases.id });
      const autoApproved = chain.length === 0;
      const [row] = await tx
        .insert(invoiceSealRequests)
        .values({
          procurementCaseId: pcase.id,
          ...columns(form),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: invoiceSealRequests.id });
      await insertItems(tx, row.id, form);
      await insertSteps(tx, FORM, row.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: FORM,
          formId: row.id,
          caseNumber,
          version: 1,
          message: `${LABEL} ${caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: row.id,
        details: {
          caseNumber,
          customerName: form.customerName,
          currency: form.currency,
          totalAmount: centsToDecimal(form.totalAmount),
          onBehalfOf: form.applicantEmployeeId === actor.id ? undefined : form.applicantEmployeeId,
        },
      });
      const result: Claimed = { ok: true, sealRequestId: row.id, caseNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

export function approveInvoiceSealStep(actor: Actor, id: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
  return approveSealStep(FORM, actor, id, expectedVersion, hooks);
}

export function returnInvoiceSealStep(actor: Actor, id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  return returnSealStep(FORM, actor, id, reason, expectedVersion);
}

function reviseRound(actor: Actor, id: string, input: EditInvoiceSealInput, mode: 'update' | 'resubmit', hooks?: TxHooks) {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockSealOrFail(tx, FORM, id);
      await assertRevisable(tx, FORM, form, actor.id, mode, input?.expectedVersion);
      const next = await resolveParties(tx, normalize(input));
      const chain = excludeFiler(await chainFor(tx, next), await filerOf(tx, form), next.applicantEmployeeId, actor.id);
      if (chain.length === 0) abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);

      const [previous] = await tx.select().from(invoiceSealRequests).where(eq(invoiceSealRequests.id, id));
      const previousItems = await tx
        .select()
        .from(invoiceSealRequestItems)
        .where(eq(invoiceSealRequestItems.invoiceSealRequestId, id))
        .orderBy(asc(invoiceSealRequestItems.lineNo));
      await tx.update(invoiceSealRequests).set(columns(next)).where(eq(invoiceSealRequests.id, id));
      await tx.delete(invoiceSealRequestItems).where(eq(invoiceSealRequestItems.invoiceSealRequestId, id));
      await insertItems(tx, id, next);
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems: [{ ...previous, items: previousItems }],
        message:
          mode === 'update' ? `${LABEL} ${form.caseNumber} 已修改，待您簽核` : `${LABEL} ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function updateInvoiceSealRequest(actor: Actor, id: string, input: EditInvoiceSealInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'update', hooks);
}

export function resubmitInvoiceSealRequest(actor: Actor, id: string, input: EditInvoiceSealInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'resubmit', hooks);
}

export function withdrawInvoiceSealRequest(actor: Actor, id: string): Promise<ActionResult> {
  return withdrawSealRequest(FORM, actor, id);
}
