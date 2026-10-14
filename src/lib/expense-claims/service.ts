import { eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { assertLegacyOpen } from '@/lib/custom-forms/legacy';
import { budgetCodes, departments, procurementCases, projects, suppliers } from '@/lib/db/schema';
import { EDITIONS, PROJECT_KIND_LABELS, type ExpenseEdition } from '@/lib/expense-claims/editions';
import { CLAIM_TABLES } from '@/lib/expense-claims/tables';
import { parseExpenseClaimInput, type ExpenseClaimInput, type NormalizedExpenseClaim } from '@/lib/expense-claims/validate';
import { centsToDecimal } from '@/lib/money';
import { taipeiToday } from '@/lib/taipei-date';
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

export type CreateExpenseClaimInput = ExpenseClaimInput & { idempotencyKey: string };
export type EditExpenseClaimInput = ExpenseClaimInput & { expectedVersion: number };
export type CreateResult = { ok: true; claimId: string; caseNumber: string; replayed?: boolean } | Failure;

function normalize(edition: ExpenseEdition, input: ExpenseClaimInput): NormalizedExpenseClaim {
  const parsed = parseExpenseClaimInput(edition, input, taipeiToday());
  if (!parsed.ok) abort('validation', parsed.error);
  return parsed.value;
}

/** Checks the referenced rows; the budget code (of the edition's scope) decides the budget owner, an approver. */
async function resolveRefs(tx: Tx, edition: ExpenseEdition, form: NormalizedExpenseClaim) {
  if (!isUuid(form.departmentId)) abort('validation', '請選擇申請部門');
  const [dept] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, form.departmentId));
  if (!dept) abort('validation', '選取的申請部門無效');

  if (!isUuid(form.budgetCodeId)) abort('validation', '請選擇預算來源');
  const [code] = await tx
    .select({
      id: budgetCodes.id,
      departmentId: budgetCodes.departmentId,
      projectKind: projects.kind,
      ownerId: budgetCodes.ownerEmployeeId,
    })
    .from(budgetCodes)
    .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
    .where(eq(budgetCodes.id, form.budgetCodeId));
  const scope = EDITIONS[edition].budgetScope;
  if (!code || (scope === 'department' ? !code.departmentId : code.projectKind !== scope)) {
    abort('validation', `選取的預算來源無效（需為${scope === 'department' ? '部門' : PROJECT_KIND_LABELS[scope]}預算）`);
  }
  if (!code!.ownerId) abort('validation', '選取的預算來源沒有指定預算負責人，請聯絡財會');

  if (form.payeeSupplierId !== null) {
    if (!isUuid(form.payeeSupplierId)) abort('validation', '選取的付款廠商無效');
    const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, form.payeeSupplierId));
    if (!s) abort('validation', '選取的付款廠商無效');
  }
  return { budgetCodeId: code!.id, ownerId: code!.ownerId! };
}

function headerColumns(form: NormalizedExpenseClaim) {
  return {
    departmentId: form.departmentId,
    remark: form.remark,
    payeeType: form.payeeType,
    payeeSupplierId: form.payeeSupplierId,
    expectedPaymentDate: form.expectedPaymentDate,
    paymentMethod: form.paymentMethod,
    remittanceInfo: form.remittanceInfo,
    totalAmount: centsToDecimal(form.total),
  };
}

async function writeItems(tx: Tx, edition: ExpenseEdition, claimId: string, form: NormalizedExpenseClaim) {
  await tx.insert(CLAIM_TABLES[edition].items).values(
    form.items.map((i, idx) => ({
      claimId,
      lineNo: idx + 1,
      category: i.category,
      description: i.description,
      currency: i.currency,
      exchangeRate: i.exchangeRate,
      amount: centsToDecimal(i.amount),
      twdAmount: centsToDecimal(i.twdAmount),
    }))
  );
}

type Claimed = { ok: true; claimId: string; caseNumber: string };

export function createExpenseClaim(
  edition: ExpenseEdition,
  actor: Actor,
  input: CreateExpenseClaimInput,
  hooks?: TxHooks
): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const { formType: form, label } = EDITIONS[edition];
  const { header } = CLAIM_TABLES[edition];
  const operation = `${form}.create`;
  return runInTransaction<Claimed & { replayed?: boolean }>(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateExpenseClaimInput);
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return { ...claim.replay, replayed: true };
      await assertLegacyOpen(tx, form, label);

      const next = { ...normalize(edition, request), departmentId: actor.departmentId };
      const budget = await resolveRefs(tx, edition, next);
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: next.departmentId,
        budgetOwnerEmployeeId: budget.ownerId,
        total: next.total,
      });
      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id, caseType: form })
        .returning({ id: procurementCases.id });
      const autoApproved = chain.length === 0;
      const [row] = await tx
        .insert(header)
        .values({
          procurementCaseId: pcase.id,
          applicantEmployeeId: actor.id,
          budgetCodeId: budget.budgetCodeId,
          budgetOwnerEmployeeId: budget.ownerId,
          ...headerColumns(next),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: header.id });
      await writeItems(tx, edition, row.id, next);
      await insertSteps(tx, form, row.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: form,
          formId: row.id,
          caseNumber,
          version: 1,
          message: `${label} ${caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${form}.created`,
        entityType: form,
        entityId: row.id,
        details: { caseNumber, total: centsToDecimal(next.total), lines: next.items.length },
      });
      const result: Claimed = { ok: true, claimId: row.id, caseNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, edition: ExpenseEdition, id: string) {
  const { formType, label } = EDITIONS[edition];
  if (!isUuid(id)) abort('not_found', `找不到這張${label}`);
  const form = await lockForm(tx, formType, id);
  if (!form) abort('not_found', `找不到這張${label}`);
  return form!;
}

export function approveExpenseClaimStep(
  edition: ExpenseEdition,
  actor: Actor,
  id: string,
  expectedVersion: number,
  hooks?: TxHooks
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  const formType = EDITIONS[edition].formType;
  return runInTransaction(
    `${formType}.approve`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, edition, id);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType, form, actorId: actor.id, decision: 'approve' });
      return { ok: true as const };
    },
    hooks
  );
}

export function returnExpenseClaimStep(
  edition: ExpenseEdition,
  actor: Actor,
  id: string,
  reason: string,
  expectedVersion: number
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  const formType = EDITIONS[edition].formType;
  return runInTransaction(`${formType}.return`, async (tx, outbox) => {
    const form = await lockOrFail(tx, edition, id);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType, form, actorId: actor.id, decision: 'return', reason });
    return { ok: true as const };
  });
}

export function reviseExpenseClaim(
  edition: ExpenseEdition,
  actor: Actor,
  id: string,
  input: EditExpenseClaimInput,
  mode: 'update' | 'resubmit',
  hooks?: TxHooks
) {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  const { formType, label } = EDITIONS[edition];
  const { header, items } = CLAIM_TABLES[edition];
  return runInTransaction<{ ok: true }>(
    `${formType}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, edition, id);
      if (mode === 'update') {
        assertApplicantBeforeFirstDecision(form, actor.id, '修改', formType);
      } else {
        if (form.applicantEmployeeId !== actor.id) abort('forbidden', `只有申請人可以重新送出這張${label}`);
        if (form.status !== 'returned') abort('conflict', `只有被退回的${label}可以重新送出`);
      }
      assertVersion(form, input?.expectedVersion);
      const next = { ...normalize(edition, input), departmentId: form.departmentId };
      const budget = await resolveRefs(tx, edition, next);
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: next.departmentId,
        budgetOwnerEmployeeId: budget.ownerId,
        total: next.total,
      });
      if (chain.length === 0) abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);

      const previousItems = await tx.select().from(items).where(eq(items.claimId, id));
      await tx.delete(items).where(eq(items.claimId, id));
      await writeItems(tx, edition, id, next);
      await tx
        .update(header)
        .set({ ...headerColumns(next), budgetCodeId: budget.budgetCodeId, budgetOwnerEmployeeId: budget.ownerId })
        .where(eq(header.id, id));
      await replaceSteps(tx, outbox, {
        formType,
        form,
        chain,
        actorId: actor.id,
        action: `${formType}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems,
        message:
          mode === 'update'
            ? `${label} ${form.caseNumber} 已修改，待您簽核`
            : `${label} ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function withdrawExpenseClaim(edition: ExpenseEdition, actor: Actor, id: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  const formType = EDITIONS[edition].formType;
  return runInTransaction(`${formType}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, edition, id);
    await withdrawForm(tx, { formType, form, actorId: actor.id });
    return { ok: true as const };
  });
}
