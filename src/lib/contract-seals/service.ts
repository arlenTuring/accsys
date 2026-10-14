import { eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { parseContractSealInput, type ContractSealInput, type NormalizedContractSeal } from '@/lib/contract-seals/validate';
import { assertLegacyOpen } from '@/lib/custom-forms/legacy';
import { contractSealRequests, procurementCases } from '@/lib/db/schema';
import { centsToDecimal } from '@/lib/money';
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
import { taipeiToday } from '@/lib/taipei-date';
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
export type CreateContractSealInput = ContractSealInput & { idempotencyKey: string };
export type EditContractSealInput = ContractSealInput & { expectedVersion: number };
export type CreateResult = { ok: true; sealRequestId: string; caseNumber: string; replayed?: boolean } | Failure;

const FORM = 'contract_seal_request' as const;
const LABEL = '用印申請單(合約類)';

function normalize(input: ContractSealInput): NormalizedContractSeal {
  const parsed = parseContractSealInput(input, taipeiToday());
  if (!parsed.ok) abort('validation', parsed.error);
  return parsed.value;
}

function columns(form: NormalizedContractSeal) {
  return {
    applicantEmployeeId: form.applicantEmployeeId,
    departmentId: form.departmentId,
    urgency: form.urgency,
    expectedCompletionDate: form.expectedCompletionDate,
    remark: form.remark,
    documentType: form.documentType,
    seals: form.seals,
    periodStart: form.periodStart,
    periodEnd: form.periodEnd,
    totalAmount: centsToDecimal(form.totalAmount),
    counterparty: form.counterparty,
    subject: form.subject,
    ndaChecks: form.ndaChecks,
    mouChecks: form.mouChecks,
    legalReviewConfirmed: form.legalReviewConfirmed,
    lendSeal: form.lendSeal,
    lendSealNote: form.lendSealNote,
  };
}

function chainFor(tx: Tx, form: NormalizedContractSeal) {
  return buildChain(tx, {
    applicantEmployeeId: form.applicantEmployeeId,
    departmentId: form.departmentId,
    budgetOwnerEmployeeId: null,
    total: form.totalAmount,
  });
}

type Claimed = { ok: true; sealRequestId: string; caseNumber: string };

export function createContractSealRequest(actor: Actor, input: CreateContractSealInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'contract_seal_request.create';
  return runInTransaction<Claimed & { replayed?: boolean }>(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateContractSealInput);
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return { ...claim.replay, replayed: true };
      await assertLegacyOpen(tx, FORM, LABEL);

      const form = await resolveParties(tx, normalize(request));
      const chain = excludeFiler(await chainFor(tx, form), actor.id, form.applicantEmployeeId);
      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id, caseType: 'contract_seal' })
        .returning({ id: procurementCases.id });
      const autoApproved = chain.length === 0;
      const [row] = await tx
        .insert(contractSealRequests)
        .values({
          procurementCaseId: pcase.id,
          ...columns(form),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: contractSealRequests.id });
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
          documentType: form.documentType,
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

export function approveContractSealStep(actor: Actor, id: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
  return approveSealStep(FORM, actor, id, expectedVersion, hooks);
}

export function returnContractSealStep(actor: Actor, id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  return returnSealStep(FORM, actor, id, reason, expectedVersion);
}

function reviseRound(actor: Actor, id: string, input: EditContractSealInput, mode: 'update' | 'resubmit', hooks?: TxHooks) {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockSealOrFail(tx, FORM, id);
      await assertRevisable(tx, FORM, form, actor.id, mode, input?.expectedVersion);
      const next = await resolveParties(tx, normalize(input));
      const chain = excludeFiler(await chainFor(tx, next), await filerOf(tx, form), next.applicantEmployeeId, actor.id);
      if (chain.length === 0) abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);

      const [previous] = await tx.select().from(contractSealRequests).where(eq(contractSealRequests.id, id));
      await tx.update(contractSealRequests).set(columns(next)).where(eq(contractSealRequests.id, id));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems: [previous],
        message:
          mode === 'update' ? `${LABEL} ${form.caseNumber} 已修改，待您簽核` : `${LABEL} ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function updateContractSealRequest(actor: Actor, id: string, input: EditContractSealInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'update', hooks);
}

export function resubmitContractSealRequest(actor: Actor, id: string, input: EditContractSealInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'resubmit', hooks);
}

export function withdrawContractSealRequest(actor: Actor, id: string): Promise<ActionResult> {
  return withdrawSealRequest(FORM, actor, id);
}
