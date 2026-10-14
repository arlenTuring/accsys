import { eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { assertLegacyOpen } from '@/lib/custom-forms/legacy';
import {
  budgetCodes,
  procurementCases,
  travelExpenseCostItems,
  travelExpenseReportItems,
  travelExpenses,
} from '@/lib/db/schema';
import { centsToDecimal } from '@/lib/money';
import {
  parseTravelExpenseInput,
  type NormalizedTravelExpense,
  type TravelExpenseInput,
} from '@/lib/travel-expenses/validate';
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

export type CreateTravelExpenseInput = TravelExpenseInput & { idempotencyKey: string };
export type EditTravelExpenseInput = TravelExpenseInput & { expectedVersion: number };
export type CreateResult = { ok: true; travelExpenseId: string; caseNumber: string; replayed?: boolean } | Failure;

const FORM = 'travel_expense' as const;
const LABEL = '出差報告暨旅費報支單';

function normalize(input: TravelExpenseInput): NormalizedTravelExpense {
  const parsed = parseTravelExpenseInput(input);
  if (!parsed.ok) abort('validation', parsed.error);
  return parsed.value;
}

/** 預算來源 decides the budget owner (an approver in the chain). */
async function resolveBudget(tx: Tx, budgetCodeId: string) {
  if (!isUuid(budgetCodeId)) abort('validation', '請選擇預算來源');
  const [code] = await tx
    .select({ id: budgetCodes.id, ownerId: budgetCodes.ownerEmployeeId })
    .from(budgetCodes)
    .where(eq(budgetCodes.id, budgetCodeId));
  if (!code) abort('validation', '選取的預算來源無效');
  if (!code.ownerId) abort('validation', '選取的預算來源沒有指定預算負責人，請聯絡財會');
  return { budgetCodeId: code.id, ownerId: code.ownerId! };
}

function headerColumns(form: NormalizedTravelExpense) {
  return {
    advanceAmount: centsToDecimal(form.advanceAmount),
    tripStartDate: form.tripStartDate,
    tripEndDate: form.tripEndDate,
    purpose: form.purpose,
    tripOrderNo: form.tripOrderNo,
    companions: form.companions,
    totalAmount: centsToDecimal(form.total),
  };
}

async function writeItems(tx: Tx, travelExpenseId: string, form: NormalizedTravelExpense) {
  await tx.insert(travelExpenseReportItems).values(
    form.reportItems.map((r, idx) => ({ travelExpenseId, lineNo: idx + 1, ...r }))
  );
  await tx.insert(travelExpenseCostItems).values(
    form.costItems.map((c, idx) => ({
      travelExpenseId,
      lineNo: idx + 1,
      expenseDate: c.expenseDate,
      category: c.category,
      fromStation: c.fromStation,
      toStation: c.toStation,
      mileage: c.mileage,
      summary: c.summary,
      currency: c.currency,
      amount: centsToDecimal(c.amount),
      exchangeRate: c.exchangeRate,
      twdAmount: centsToDecimal(c.twdAmount),
    }))
  );
}

type Claimed = { ok: true; travelExpenseId: string; caseNumber: string };

export function createTravelExpense(actor: Actor, input: CreateTravelExpenseInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'travel_expense.create';
  return runInTransaction<Claimed & { replayed?: boolean }>(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateTravelExpenseInput);
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return { ...claim.replay, replayed: true };
      await assertLegacyOpen(tx, FORM, LABEL);

      const form = normalize(request);
      const budget = await resolveBudget(tx, form.budgetCodeId);
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: actor.departmentId,
        budgetOwnerEmployeeId: budget.ownerId,
        total: form.total,
      });
      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id, caseType: 'travel_expense' })
        .returning({ id: procurementCases.id });
      const autoApproved = chain.length === 0;
      const [te] = await tx
        .insert(travelExpenses)
        .values({
          procurementCaseId: pcase.id,
          applicantEmployeeId: actor.id,
          departmentId: actor.departmentId,
          budgetCodeId: budget.budgetCodeId,
          budgetOwnerEmployeeId: budget.ownerId,
          ...headerColumns(form),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: travelExpenses.id });
      await writeItems(tx, te.id, form);
      await insertSteps(tx, FORM, te.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: FORM,
          formId: te.id,
          caseNumber,
          version: 1,
          message: `${LABEL} ${caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: te.id,
        details: { caseNumber, total: centsToDecimal(form.total), costLines: form.costItems.length },
      });
      const result: Claimed = { ok: true, travelExpenseId: te.id, caseNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, id: string) {
  if (!isUuid(id)) abort('not_found', `找不到這張${LABEL}`);
  const form = await lockForm(tx, FORM, id);
  if (!form) abort('not_found', `找不到這張${LABEL}`);
  return form!;
}

export function approveTravelExpenseStep(actor: Actor, id: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${FORM}.approve`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, id);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'approve' });
      return { ok: true as const };
    },
    hooks
  );
}

export function returnTravelExpenseStep(actor: Actor, id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  return runInTransaction(`${FORM}.return`, async (tx, outbox) => {
    const form = await lockOrFail(tx, id);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'return', reason });
    return { ok: true as const };
  });
}

function reviseRound(actor: Actor, id: string, input: EditTravelExpenseInput, mode: 'update' | 'resubmit', hooks?: TxHooks) {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, id);
      if (mode === 'update') {
        assertApplicantBeforeFirstDecision(form, actor.id, '修改', FORM);
      } else {
        if (form.applicantEmployeeId !== actor.id) abort('forbidden', `只有申請人可以重新送出這張${LABEL}`);
        if (form.status !== 'returned') abort('conflict', `只有被退回的${LABEL}可以重新送出`);
      }
      assertVersion(form, input?.expectedVersion);
      const next = normalize(input);
      const budget = await resolveBudget(tx, next.budgetCodeId);
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: form.departmentId,
        budgetOwnerEmployeeId: budget.ownerId,
        total: next.total,
      });
      if (chain.length === 0) abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);

      const previousReport = await tx
        .select()
        .from(travelExpenseReportItems)
        .where(eq(travelExpenseReportItems.travelExpenseId, id));
      const previousCosts = await tx.select().from(travelExpenseCostItems).where(eq(travelExpenseCostItems.travelExpenseId, id));
      await tx.delete(travelExpenseReportItems).where(eq(travelExpenseReportItems.travelExpenseId, id));
      await tx.delete(travelExpenseCostItems).where(eq(travelExpenseCostItems.travelExpenseId, id));
      await writeItems(tx, id, next);
      await tx
        .update(travelExpenses)
        .set({ ...headerColumns(next), budgetCodeId: budget.budgetCodeId, budgetOwnerEmployeeId: budget.ownerId })
        .where(eq(travelExpenses.id, id));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems: [...previousReport, ...previousCosts],
        message:
          mode === 'update'
            ? `${LABEL} ${form.caseNumber} 已修改，待您簽核`
            : `${LABEL} ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function updateTravelExpense(actor: Actor, id: string, input: EditTravelExpenseInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'update', hooks);
}

export function resubmitTravelExpense(actor: Actor, id: string, input: EditTravelExpenseInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'resubmit', hooks);
}

export function withdrawTravelExpense(actor: Actor, id: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${FORM}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, id);
    await withdrawForm(tx, { formType: FORM, form, actorId: actor.id });
    return { ok: true as const };
  });
}
