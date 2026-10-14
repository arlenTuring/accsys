import { and, eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import {
  acceptanceItems,
  acceptances,
  budgetCodes,
  expenseRequestItems,
  expenseRequests,
  procurementCases,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
} from '@/lib/db/schema';
import { STANDALONE_EXPENSE_REQUEST_LIMIT } from '@/lib/expense-requests/constants';
import { validateExpenseRequestInput } from '@/lib/expense-requests/validate';
import { addCents, centsToDecimal, MoneyError, toCents, type Cents } from '@/lib/money';
import { computeDefaultExpectedPaymentDate, computePaymentBatchDate } from '@/lib/procurement/payment-batch';
import { taipeiToday } from '@/lib/taipei-date';
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

export type Actor = { id: string; departmentId: string } | null;

export type PaymentInput = {
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
  invoiceMonth: string | null;
  expectedPaymentDate: string | null;
};
export type CreateExpenseRequestInput = PaymentInput & {
  purchaseOrderId: string;
  includedSourceItemIds: string[];
  idempotencyKey: string;
};
export type CreateStandaloneExpenseRequestInput = PaymentInput & {
  budgetCodeId: string;
  items: { description: string; amount: number | string }[];
  idempotencyKey: string;
};
export type EditExpenseRequestInput = PaymentInput & { includedSourceItemIds: string[]; expectedVersion: number };
export type CreateResult =
  | { ok: true; expenseRequestId: string; caseNumber: string; paymentBatchDate: string }
  | Failure;

const FORM = 'expense_request' as const;
const LIMIT_CENTS = toCents(STANDALONE_EXPENSE_REQUEST_LIMIT);

type SourceLine = { id: string; purchaseOrderItemId: string | null; description: string; amount: Cents };

/** Payee, bank and schedule fields; returns the normalized columns and the payment batch. */
async function preparePayment(tx: Tx, input: PaymentInput, includedCount: number) {
  if (!input || (input.payeeType !== 'employee' && input.payeeType !== 'supplier')) abort('validation', '付款對象不正確');
  const validation = validateExpenseRequestInput({
    payeeType: input.payeeType,
    payeeSupplierId: input.payeeSupplierId,
    bankAccount: input.bankAccount,
    includedItemCount: includedCount,
  });
  if (!validation.ok) abort('validation', validation.error);
  if (input.payeeType === 'supplier') {
    if (!isUuid(input.payeeSupplierId)) abort('validation', '付款對象為廠商時必須選擇廠商');
    const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.payeeSupplierId!));
    if (!s) abort('validation', '付款對象為廠商時必須選擇廠商');
  } else {
    if (typeof input.bankAccount !== 'string' || !/^[0-9 -]{4,30}$/.test(input.bankAccount.trim())) {
      abort('validation', '銀行帳號只能包含數字、空白與連字號（4–30 字元）');
    }
    for (const v of [input.bankName, input.accountName]) {
      if (v !== null && (typeof v !== 'string' || v.length > 100)) abort('validation', '銀行資料過長');
    }
  }
  if (typeof input.paymentMethod !== 'string' || input.paymentMethod.trim() === '' || input.paymentMethod.length > 100) {
    abort('validation', '請填寫付款方式');
  }
  if (input.invoiceMonth !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.invoiceMonth ?? '')) abort('validation', '發票月份格式不正確');
  if (input.expectedPaymentDate !== null && !isIsoDate(input.expectedPaymentDate)) {
    abort('validation', '預計付款日期格式不正確');
  }

  const expectedPaymentDate =
    input.expectedPaymentDate ?? (input.invoiceMonth ? computeDefaultExpectedPaymentDate(input.invoiceMonth) : null);
  const batch = computePaymentBatchDate({
    payeeType: input.payeeType,
    // Business dates follow the Taipei calendar, not the server's UTC day.
    referenceDate: taipeiToday(),
    expectedPaymentDate,
    invoiceMonth: input.invoiceMonth,
  });
  const employeePayee = input.payeeType === 'employee';
  return {
    columns: {
      payeeType: input.payeeType,
      payeeSupplierId: employeePayee ? null : input.payeeSupplierId,
      paymentMethod: input.paymentMethod.trim(),
      bankName: employeePayee ? input.bankName : null,
      bankAccount: employeePayee ? input.bankAccount!.trim() : null,
      accountName: employeePayee ? input.accountName : null,
      invoiceMonth: input.invoiceMonth,
      expectedPaymentDate,
      paymentBatchDate: batch.batchDate,
    },
    batchDate: batch.batchDate,
  };
}

/** Lines a PO-based expense request may bill: passed lines of the approved acceptance, or PO lines for prepayment. */
async function sourceLines(tx: Tx, purchaseOrderId: string, acceptanceId: string | null): Promise<SourceLine[]> {
  if (acceptanceId) {
    const rows = await tx
      .select()
      .from(acceptanceItems)
      .where(and(eq(acceptanceItems.acceptanceId, acceptanceId), eq(acceptanceItems.passFail, 'pass')));
    return rows.map((r) => ({ id: r.id, purchaseOrderItemId: r.purchaseOrderItemId, description: r.description, amount: toCents(r.amount) }));
  }
  const rows = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
  return rows.map((r) => ({ id: r.id, purchaseOrderItemId: r.id, description: r.description, amount: toCents(r.totalPrice) }));
}

function pick(lines: SourceLine[], ids: unknown): SourceLine[] {
  if (!Array.isArray(ids)) abort('validation', '費用申請單至少需要一個明細項次');
  const wanted = new Set(ids as string[]);
  const known = new Set(lines.map((l) => l.id));
  if ([...wanted].some((id) => !known.has(id))) abort('validation', '選取的明細不屬於這張採購單');
  return lines.filter((l) => wanted.has(l.id));
}

async function writeItems(tx: Tx, expenseRequestId: string, lines: SourceLine[]) {
  await tx.insert(expenseRequestItems).values(
    lines.map((l, idx) => ({
      expenseRequestId,
      lineNo: idx + 1,
      purchaseOrderItemId: l.purchaseOrderItemId,
      description: l.description,
      amount: centsToDecimal(l.amount),
    }))
  );
}

type Claimed = { ok: true; expenseRequestId: string; caseNumber: string; paymentBatchDate: string };

export function createExpenseRequest(actor: Actor, input: CreateExpenseRequestInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'expense_request.create';
  return runInTransaction(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateExpenseRequestInput);
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return claim.replay;

      if (!isUuid(input.purchaseOrderId)) abort('not_found', '找不到來源採購單');
      const source = await lockForm(tx, 'purchase_order', input.purchaseOrderId);
      if (!source || source.applicantEmployeeId !== actor.id) abort('not_found', '找不到來源採購單');
      if (source!.status !== 'approved') abort('conflict', '來源採購單尚未核准，無法建立費用申請單');
      const [existing] = await tx
        .select({ id: expenseRequests.id })
        .from(expenseRequests)
        .where(eq(expenseRequests.procurementCaseId, source!.procurementCaseId));
      if (existing) abort('conflict', '此案件已建立過費用申請單');

      const [order] = await tx.select({ terms: purchaseOrders.paymentTerms }).from(purchaseOrders).where(eq(purchaseOrders.id, source!.id));
      const [acceptance] = await tx
        .select({ id: acceptances.id })
        .from(acceptances)
        .where(and(eq(acceptances.purchaseOrderId, source!.id), eq(acceptances.status, 'approved')));
      if (!acceptance && order.terms !== '預付款') {
        abort('conflict', '此採購單尚未完成驗收，且付款條件非預付款，無法建立費用申請單');
      }
      const lines = pick(await sourceLines(tx, source!.id, acceptance?.id ?? null), input.includedSourceItemIds);
      const payment = await preparePayment(tx, input, lines.length);
      const total = addCents(...lines.map((l) => l.amount));

      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: source!.departmentId,
        budgetOwnerEmployeeId: source!.budgetOwnerEmployeeId,
        total,
      });
      const autoApproved = chain.length === 0;
      const [er] = await tx
        .insert(expenseRequests)
        .values({
          procurementCaseId: source!.procurementCaseId,
          purchaseOrderId: source!.id,
          acceptanceId: acceptance?.id ?? null,
          applicantEmployeeId: actor.id,
          departmentId: source!.departmentId,
          budgetOwnerEmployeeId: source!.budgetOwnerEmployeeId,
          ...payment.columns,
          totalAmount: centsToDecimal(total),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: expenseRequests.id });
      await writeItems(tx, er.id, lines);
      await insertSteps(tx, FORM, er.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: FORM,
          formId: er.id,
          caseNumber: source!.caseNumber,
          version: 1,
          message: `費用申請單 ${source!.caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: er.id,
        details: { caseNumber: source!.caseNumber, purchaseOrderId: source!.id, total: centsToDecimal(total) },
      });
      const result: Claimed = { ok: true, expenseRequestId: er.id, caseNumber: source!.caseNumber, paymentBatchDate: payment.batchDate };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

export function createStandaloneExpenseRequest(
  actor: Actor,
  input: CreateStandaloneExpenseRequestInput,
  hooks?: TxHooks
): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'expense_request.create_standalone';
  return runInTransaction(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateStandaloneExpenseRequestInput);
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return claim.replay;

      if (!Array.isArray(input.items) || input.items.length === 0) abort('validation', '費用申請單至少需要一個明細項次');
      if (input.items.length > 50) abort('validation', '明細項次不可超過 50 項');
      const lines: SourceLine[] = input.items.map((i, idx) => {
        if (typeof i.description !== 'string' || i.description.trim() === '' || i.description.length > 500) {
          abort('validation', `第 ${idx + 1} 項的說明不正確`);
        }
        let amount: Cents;
        try {
          amount = toCents(i.amount);
        } catch (err) {
          abort('validation', `第 ${idx + 1} 項的金額：${(err as MoneyError).message}`);
        }
        if (amount! <= 0) abort('validation', `第 ${idx + 1} 項的金額必須大於 0`);
        return { id: String(idx), purchaseOrderItemId: null, description: i.description, amount: amount! };
      });
      const total = addCents(...lines.map((l) => l.amount));
      if (total >= LIMIT_CENTS) {
        abort(
          'validation',
          `免走採購流程的費用申請單總金額須低於 NT$ ${STANDALONE_EXPENSE_REQUEST_LIMIT.toLocaleString()}，請改用一般採購流程建立`
        );
      }
      if (!isUuid(input.budgetCodeId)) abort('validation', '選取的預算編號無效');
      const [code] = await tx
        .select({ id: budgetCodes.id, ownerId: budgetCodes.ownerEmployeeId })
        .from(budgetCodes)
        .where(eq(budgetCodes.id, input.budgetCodeId));
      if (!code) abort('validation', '選取的預算編號無效');
      if (!code.ownerId) abort('validation', '選取的預算編號沒有指定預算負責人');
      const payment = await preparePayment(tx, input, lines.length);

      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: actor.departmentId,
        budgetOwnerEmployeeId: code.ownerId!,
        total,
      });
      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id, caseType: 'standalone_expense' })
        .returning({ id: procurementCases.id });
      const autoApproved = chain.length === 0;
      const [er] = await tx
        .insert(expenseRequests)
        .values({
          procurementCaseId: pcase.id,
          purchaseOrderId: null,
          budgetCodeId: code.id,
          applicantEmployeeId: actor.id,
          departmentId: actor.departmentId,
          budgetOwnerEmployeeId: code.ownerId!,
          ...payment.columns,
          totalAmount: centsToDecimal(total),
          status: autoApproved ? 'approved' : 'pending_approval',
          currentStepOrder: autoApproved ? null : 1,
        })
        .returning({ id: expenseRequests.id });
      await writeItems(tx, er.id, lines);
      await insertSteps(tx, FORM, er.id, chain);
      if (!autoApproved) {
        await notify(tx, outbox, {
          recipientEmployeeId: chain[0].approverEmployeeId,
          type: 'approval_requested',
          formType: FORM,
          formId: er.id,
          caseNumber,
          version: 1,
          message: `費用申請單 ${caseNumber} 待您簽核`,
        });
      }
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: er.id,
        details: { caseNumber, standalone: true, total: centsToDecimal(total) },
      });
      const result: Claimed = { ok: true, expenseRequestId: er.id, caseNumber, paymentBatchDate: payment.batchDate };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, id: string) {
  if (!isUuid(id)) abort('not_found', '找不到這張費用申請單');
  const form = await lockForm(tx, FORM, id);
  if (!form) abort('not_found', '找不到這張費用申請單');
  return form!;
}

export function approveExpenseRequestStep(actor: Actor, id: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
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

export function returnExpenseRequestStep(actor: Actor, id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
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

function reviseRound(actor: Actor, id: string, input: EditExpenseRequestInput, mode: 'update' | 'resubmit', hooks?: TxHooks) {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, id);
      if (mode === 'update') {
        assertApplicantBeforeFirstDecision(form, actor.id, '修改', FORM);
      } else {
        if (form.applicantEmployeeId !== actor.id) abort('forbidden', '只有申請人可以重新送出這張費用申請單');
        if (form.status !== 'returned') abort('conflict', '只有被退回的費用申請單可以重新送出');
      }
      assertVersion(form, input?.expectedVersion);
      const [er] = await tx
        .select({ purchaseOrderId: expenseRequests.purchaseOrderId, acceptanceId: expenseRequests.acceptanceId })
        .from(expenseRequests)
        .where(eq(expenseRequests.id, id));
      if (!er.purchaseOrderId) {
        // No edit screen exists for standalone requests; they are withdrawn and re-created.
        abort('validation', '免走採購流程的費用申請單目前不支援編輯，請改用撤回後重新建立');
      }
      const lines = pick(await sourceLines(tx, er.purchaseOrderId!, er.acceptanceId), input.includedSourceItemIds);
      const payment = await preparePayment(tx, input, lines.length);
      const total = addCents(...lines.map((l) => l.amount));
      const chain = await buildChain(tx, {
        applicantEmployeeId: actor.id,
        departmentId: form.departmentId,
        budgetOwnerEmployeeId: form.budgetOwnerEmployeeId,
        total,
      });
      if (chain.length === 0) abort('validation', `${mode === 'update' ? '修改' : '重新送出'}後找不到適用的簽核人，請聯絡系統管理員`);

      const previousItems = await tx.select().from(expenseRequestItems).where(eq(expenseRequestItems.expenseRequestId, id));
      await tx.delete(expenseRequestItems).where(eq(expenseRequestItems.expenseRequestId, id));
      await writeItems(tx, id, lines);
      await tx
        .update(expenseRequests)
        .set({ ...payment.columns, totalAmount: centsToDecimal(total) })
        .where(eq(expenseRequests.id, id));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        // Bank numbers are redacted by recordAudit; the rest documents the previous round.
        previousItems,
        message:
          mode === 'update'
            ? `費用申請單 ${form.caseNumber} 已修改，待您簽核`
            : `費用申請單 ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function updateExpenseRequest(actor: Actor, id: string, input: EditExpenseRequestInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'update', hooks);
}

export function resubmitExpenseRequest(actor: Actor, id: string, input: EditExpenseRequestInput, hooks?: TxHooks) {
  return reviseRound(actor, id, input, 'resubmit', hooks);
}

export function withdrawExpenseRequest(actor: Actor, id: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${FORM}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, id);
    await withdrawForm(tx, { formType: FORM, form, actorId: actor.id });
    return { ok: true as const };
  });
}
