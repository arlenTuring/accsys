import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { CHAIRMAN_THRESHOLD, generateApprovalChain, type ApprovalChainStep } from '@/lib/approval/chain';
import type { ResolvedStep } from '@/lib/approval/flow/types';
import { getDb, type Db } from '@/lib/db';
import { errorSummary } from '@/lib/db/error-summary';
import { approvalSteps, departments, employeeIdentities, employees, idempotencyKeys, notifications } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email/send';
import { centsToNumber, type Cents } from '@/lib/money';
import { FORM_LABELS, FORM_TABLE, type FormType, type SealFormType } from '@/lib/procurement/form-registry';

/**
 * Transaction building blocks shared by the four form modules. Each module's
 * service decides the business flow; these helpers only make the common steps
 * (lock, approval steps, notifications, audit, idempotency) consistent.
 *
 * Lock order (to avoid deadlocks): source form header -> own form header ->
 * approval steps / items. Nothing here calls SMTP, Google, storage or the
 * scanner inside a transaction; e-mails are sent after commit.
 */

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable';
export type Failure = { ok: false; error: string; code: ErrorCode };
export type ActionResult = { ok: true } | Failure;

export const fail = (code: ErrorCode, error: string): Failure => ({ ok: false, code, error });

/** Thrown inside a transaction to roll it back and return a user-facing failure. */
export class Abort extends Error {
  constructor(readonly failure: Failure) {
    super(failure.error);
  }
}
export function abort(code: ErrorCode, error: string): never {
  throw new Abort(fail(code, error));
}

export type Outbox = { recipientEmployeeId: string; subject: string; text: string }[];

/** Test-only fault injection: runs just before commit. */
export type TxHooks = { beforeCommit?: (tx: Tx) => Promise<void> };

/**
 * Runs `work` in one transaction. Business failures (Abort) roll back and are
 * returned; anything else rolls back and becomes 'unavailable' with a log
 * reference -- never a fake success or an empty result. Queued e-mails are
 * sent only after a successful commit (best effort).
 */
export async function runInTransaction<T extends { ok: true }>(
  label: string,
  work: (tx: Tx, outbox: Outbox) => Promise<T>,
  hooks?: TxHooks
): Promise<T | Failure> {
  const outbox: Outbox = [];
  let result: T;
  try {
    result = await getDb().transaction(async (tx) => {
      const r = await work(tx, outbox);
      if (hooks?.beforeCommit) await hooks.beforeCommit(tx);
      return r;
    });
  } catch (err) {
    if (err instanceof Abort) return err.failure;
    const ref = randomUUID().slice(0, 8);
    console.error(`[workflow] ${label} failed ref=${ref}`, errorSummary(err));
    return fail('unavailable', `系統暫時無法處理，請稍後再試（參考碼 ${ref}）`);
  }
  await deliverOutbox(outbox);
  return result;
}

async function deliverOutbox(outbox: Outbox): Promise<void> {
  if (outbox.length === 0 || !process.env.SMTP_HOST) return;
  const ids = [...new Set(outbox.map((m) => m.recipientEmployeeId))];
  // The bound Google identity's address follows Workspace renames (login and
  // directory sync update it); employees.google_email is only the original
  // registration value. Disabled accounts get no mail.
  const rows = await getDb()
    .select({ id: employees.id, current: employeeIdentities.email, registered: employees.googleEmail })
    .from(employees)
    .leftJoin(employeeIdentities, and(eq(employeeIdentities.employeeId, employees.id), isNull(employeeIdentities.revokedAt)))
    .where(and(inArray(employees.id, ids), eq(employees.accessEnabled, true)));
  const emailOf = new Map(rows.map((r) => [r.id, r.current ?? r.registered]));
  for (const m of outbox) {
    const to = emailOf.get(m.recipientEmployeeId);
    if (!to) continue;
    try {
      await sendEmail({ to, subject: m.subject, text: m.text });
    } catch {
      // In-app notifications are the source of truth; e-mail is best effort (at-least-once not guaranteed).
    }
  }
}

export type LockedForm = {
  id: string;
  applicantEmployeeId: string;
  status: string;
  currentStepOrder: number | null;
  version: number;
  procurementCaseId: string;
  caseNumber: string;
  departmentId: string;
  budgetOwnerEmployeeId: string | null;
  /** First step a person signs (steps before it were signed or skipped by the system); null without steps. */
  firstHumanStepOrder: number | null;
  /** Designer forms: the definition's name (messages use it instead of the generic label). */
  formLabel: string | null;
};

const labelOf = (formType: FormType, form: LockedForm) => form.formLabel ?? FORM_LABELS[formType];

/** Forms without a budget source; every other form header has budget_owner_employee_id. */
type UnbudgetedFormType = SealFormType | 'asset_transfer';
export type BudgetedLockedForm = LockedForm & { budgetOwnerEmployeeId: string };

/** SELECT ... FOR UPDATE of one form header (table name from a fixed allowlist). */
export async function lockForm(
  tx: Tx,
  formType: Exclude<FormType, UnbudgetedFormType>,
  formId: string
): Promise<BudgetedLockedForm | null>;
export async function lockForm(tx: Tx, formType: FormType, formId: string): Promise<LockedForm | null>;
export async function lockForm(tx: Tx, formType: FormType, formId: string): Promise<LockedForm | null> {
  const table = FORM_TABLE[formType];
  const rows = await tx.execute<{
    id: string;
    applicant_employee_id: string;
    status: string;
    current_step_order: number | null;
    version: number;
    procurement_case_id: string;
    case_number: string;
    department_id: string;
    budget_owner_employee_id: string | null;
    first_human_step_order: number | null;
    form_label: string | null;
  }>(sql`
    select f.id, f.applicant_employee_id, f.status, f.current_step_order, f.version, f.procurement_case_id,
           -- designer forms are known by their own form number
           coalesce(to_jsonb(f) ->> 'form_number', c.case_number) as case_number, f.department_id,
           to_jsonb(f) ->> 'budget_owner_employee_id' as budget_owner_employee_id, -- not every form has one
           (select min(s.step_order) from approval_steps s
             where s.form_type = ${formType} and s.form_id = f.id
               and s.status not in ('auto_approved', 'skipped')) as first_human_step_order,
           (select d.name from form_definitions d where d.id = (to_jsonb(f) ->> 'definition_id')::uuid) as form_label
      from ${sql.identifier(table)} f
      join procurement_cases c on c.id = f.procurement_case_id
     where f.id = ${formId}
       for update of f`);
  const r = rows[0];
  if (!r) return null;
  return {
    firstHumanStepOrder: r.first_human_step_order === null ? null : Number(r.first_human_step_order),
    id: r.id,
    applicantEmployeeId: r.applicant_employee_id,
    status: r.status,
    currentStepOrder: r.current_step_order,
    version: Number(r.version),
    procurementCaseId: r.procurement_case_id,
    caseNumber: r.case_number,
    departmentId: r.department_id,
    budgetOwnerEmployeeId: r.budget_owner_employee_id,
    formLabel: r.form_label,
  };
}

export async function bumpForm(
  tx: Tx,
  formType: FormType,
  formId: string,
  set: { status?: string; currentStepOrder?: number | null }
): Promise<number> {
  const table = FORM_TABLE[formType];
  const parts = [sql`version = version + 1`, sql`updated_at = now()`];
  if (set.status !== undefined) parts.push(sql`status = ${set.status}`);
  if (set.currentStepOrder !== undefined) parts.push(sql`current_step_order = ${set.currentStepOrder}`);
  const rows = await tx.execute<{ version: number }>(
    sql`update ${sql.identifier(table)} set ${sql.join(parts, sql`, `)} where id = ${formId} returning version`
  );
  return Number(rows[0].version);
}

/** Approval chain from current master data, read inside the transaction. */
export async function buildChain(
  tx: Tx,
  input: { applicantEmployeeId: string; departmentId: string; budgetOwnerEmployeeId: string | null; total: Cents }
): Promise<ApprovalChainStep[]> {
  const [dept] = await tx
    .select({ managerId: departments.managerEmployeeId })
    .from(departments)
    .where(eq(departments.id, input.departmentId));
  if (!dept) abort('validation', '找不到申請單位資料，請聯絡系統管理員');
  if (!dept.managerId) abort('validation', '申請單位尚未設定主管，無法送出簽核，請聯絡系統管理員');
  const [gm] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.isGeneralManager, true))
    .orderBy(asc(employees.createdAt), asc(employees.id))
    .limit(1);
  if (!gm) abort('validation', '系統尚未設定總經理，請聯絡系統管理員');
  const totalAmount = centsToNumber(input.total);
  let chairmanId = input.applicantEmployeeId;
  if (totalAmount > CHAIRMAN_THRESHOLD) {
    const [chairman] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.isChairman, true))
      .orderBy(asc(employees.createdAt), asc(employees.id))
      .limit(1);
    if (!chairman) abort('validation', '系統尚未設定董事長，無法送出逾 10 萬元的表單，請聯絡系統管理員');
    chairmanId = chairman.id;
  }
  const chain = generateApprovalChain({
    applicantEmployeeId: input.applicantEmployeeId,
    departmentManagerEmployeeId: dept.managerId!,
    budgetOwnerEmployeeId: input.budgetOwnerEmployeeId,
    generalManagerEmployeeId: gm.id,
    chairmanEmployeeId: chairmanId,
    totalAmount,
  });
  await assertApproversActive(tx, chain);
  return chain;
}

/** A disabled account can never sign, so the form would be stuck at that step. */
export async function assertApproversActive(tx: Tx, chain: ApprovalChainStep[]) {
  if (chain.length === 0) return;
  const disabled = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(inArray(employees.id, chain.map((s) => s.approverEmployeeId)), eq(employees.accessEnabled, false)));
  if (disabled.length > 0) abort('validation', '簽核流程中有帳號已停用的簽核人，請聯絡系統管理員更新主管或預算負責人設定');
}

export async function insertSteps(tx: Tx, formType: FormType, formId: string, chain: ApprovalChainStep[]) {
  if (chain.length === 0) return;
  await tx.insert(approvalSteps).values(
    chain.map((step, idx) => ({
      formType,
      formId,
      stepOrder: idx + 1,
      approverEmployeeId: step.approverEmployeeId,
      approverRole: step.approverRole,
    }))
  );
}

/**
 * Writes steps produced by the flow resolver. System-signed and skipped steps
 * are stamped as acted now. Returns the first step a person must sign, or
 * null when nobody has to (the caller then approves the form directly).
 */
export async function insertResolvedSteps(
  tx: Tx,
  formType: FormType,
  formId: string,
  steps: ResolvedStep[]
): Promise<{ stepOrder: number; approverEmployeeId: string } | null> {
  if (steps.length === 0) return null;
  await tx.insert(approvalSteps).values(
    steps.map((s, idx) => ({
      formType,
      formId,
      stepOrder: idx + 1,
      approverEmployeeId: s.approverEmployeeId,
      approverRole: `step:${s.blockId}`,
      status: s.status,
      stepLabel: s.label,
      sourceKind: s.sourceKind,
      delegatedFromEmployeeId: s.delegatedFromEmployeeId,
      systemNote: s.systemNote,
      actedAt: s.status === 'pending' ? null : sql`now()`,
    }))
  );
  const idx = steps.findIndex((s) => s.status === 'pending');
  return idx === -1 ? null : { stepOrder: idx + 1, approverEmployeeId: steps[idx].approverEmployeeId! };
}

export async function readSteps(tx: Tx, formType: FormType, formId: string) {
  return tx
    .select({
      stepOrder: approvalSteps.stepOrder,
      approverEmployeeId: approvalSteps.approverEmployeeId,
      approverRole: approvalSteps.approverRole,
      status: approvalSteps.status,
      comment: approvalSteps.comment,
      actedAt: approvalSteps.actedAt,
      stepLabel: approvalSteps.stepLabel,
      delegatedFromEmployeeId: approvalSteps.delegatedFromEmployeeId,
      systemNote: approvalSteps.systemNote,
    })
    .from(approvalSteps)
    .where(and(eq(approvalSteps.formType, formType), eq(approvalSteps.formId, formId)))
    .orderBy(asc(approvalSteps.stepOrder));
}

export async function deleteSteps(tx: Tx, formType: FormType, formId: string) {
  await tx.delete(approvalSteps).where(and(eq(approvalSteps.formType, formType), eq(approvalSteps.formId, formId)));
}

type NotificationType = 'approval_requested' | 'request_returned' | 'request_approved';
const SUBJECT_PREFIX: Record<NotificationType, string> = {
  approval_requested: '【待簽核】',
  request_returned: '【已退回】',
  request_approved: '【已核准】',
};

/**
 * In-app notification in the same transaction, keyed by the event
 * (form, version, type, recipient) so a retried action cannot duplicate it.
 */
export async function notify(
  tx: Tx,
  outbox: Outbox,
  input: {
    recipientEmployeeId: string;
    type: NotificationType;
    formType: FormType;
    formId: string;
    caseNumber: string;
    version: number;
    message: string;
  }
) {
  const eventKey = `${input.formType}:${input.formId}:v${input.version}:${input.type}:${input.recipientEmployeeId}`;
  const inserted = await tx
    .insert(notifications)
    .values({
      recipientEmployeeId: input.recipientEmployeeId,
      type: input.type,
      formType: input.formType,
      formId: input.formId,
      caseNumber: input.caseNumber,
      message: input.message,
      eventKey,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (inserted.length > 0) {
    outbox.push({
      recipientEmployeeId: input.recipientEmployeeId,
      subject: `${SUBJECT_PREFIX[input.type]}${input.caseNumber}`,
      text: input.message,
    });
  }
}

export async function markApprovalNotificationsRead(tx: Tx, formType: FormType, formId: string, recipientId: string) {
  await tx
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.recipientEmployeeId, recipientId),
        eq(notifications.formType, formType),
        eq(notifications.formId, formId),
        eq(notifications.type, 'approval_requested'),
        eq(notifications.isRead, false)
      )
    );
}

/**
 * Approve or return the current step. Must be called with the form already
 * locked; re-checks state and approver inside the lock, so two concurrent
 * decisions produce exactly one result.
 */
export async function decideCurrentStep(
  tx: Tx,
  outbox: Outbox,
  input: { formType: FormType; form: LockedForm; actorId: string; decision: 'approve' | 'return'; reason?: string; requestId?: string }
): Promise<void> {
  const { formType, form, actorId } = input;
  const label = labelOf(formType, form);
  if (form.status !== 'pending_approval' || form.currentStepOrder === null) {
    abort('conflict', `這張${label}目前不在簽核中`);
  }
  const [step] = await tx
    .select()
    .from(approvalSteps)
    .where(
      and(
        eq(approvalSteps.formType, formType),
        eq(approvalSteps.formId, form.id),
        eq(approvalSteps.stepOrder, form.currentStepOrder!)
      )
    )
    .for('update');
  if (!step || step.approverEmployeeId !== actorId) abort('forbidden', `您不是這張${label}目前的簽核人`);
  if (step.status !== 'pending') abort('conflict', '此表單已被處理，請重新整理頁面');

  const approving = input.decision === 'approve';
  await tx
    .update(approvalSteps)
    .set({ status: approving ? 'approved' : 'returned', comment: approving ? null : input.reason, actedAt: sql`now()` })
    .where(eq(approvalSteps.id, step.id));
  await markApprovalNotificationsRead(tx, formType, form.id, actorId);

  if (!approving) {
    const version = await bumpForm(tx, formType, form.id, { status: 'returned', currentStepOrder: null });
    await notify(tx, outbox, {
      recipientEmployeeId: form.applicantEmployeeId,
      type: 'request_returned',
      formType,
      formId: form.id,
      caseNumber: form.caseNumber,
      version,
      message: `${label} ${form.caseNumber} 已被退回：${input.reason}`,
    });
    await recordAudit(tx, {
      actorEmployeeId: actorId,
      action: `${formType}.step_returned`,
      entityType: formType,
      entityId: form.id,
      requestId: input.requestId,
      details: { stepOrder: step.stepOrder, reason: input.reason },
    });
    return;
  }

  // Steps the system signed or skipped when the flow was resolved are passed over.
  const [next] = await tx
    .select()
    .from(approvalSteps)
    .where(
      and(
        eq(approvalSteps.formType, formType),
        eq(approvalSteps.formId, form.id),
        gt(approvalSteps.stepOrder, step.stepOrder),
        eq(approvalSteps.status, 'pending')
      )
    )
    .orderBy(asc(approvalSteps.stepOrder))
    .limit(1);
  if (next?.approverEmployeeId) {
    const version = await bumpForm(tx, formType, form.id, { currentStepOrder: next.stepOrder });
    await notify(tx, outbox, {
      recipientEmployeeId: next.approverEmployeeId,
      type: 'approval_requested',
      formType,
      formId: form.id,
      caseNumber: form.caseNumber,
      version,
      message: `${label} ${form.caseNumber} 待您簽核`,
    });
  } else {
    const version = await bumpForm(tx, formType, form.id, { status: 'approved', currentStepOrder: null });
    await notify(tx, outbox, {
      recipientEmployeeId: form.applicantEmployeeId,
      type: 'request_approved',
      formType,
      formId: form.id,
      caseNumber: form.caseNumber,
      version,
      message: `${label} ${form.caseNumber} 已完成簽核`,
    });
  }
  await recordAudit(tx, {
    actorEmployeeId: actorId,
    action: `${formType}.step_approved`,
    entityType: formType,
    entityId: form.id,
    requestId: input.requestId,
    details: { stepOrder: step.stepOrder, final: !next },
  });
}

/** Still waiting on the first person in the chain (system-signed steps before it do not count). */
export function beforeFirstDecision(form: LockedForm): boolean {
  return form.status === 'pending_approval' && form.currentStepOrder !== null && form.currentStepOrder === form.firstHumanStepOrder;
}

/** Edit/withdraw window: pending, nobody has acted yet, requested by the applicant. */
export function assertApplicantBeforeFirstDecision(form: LockedForm, actorId: string, verb: string, formType: FormType) {
  const label = labelOf(formType, form);
  if (form.applicantEmployeeId !== actorId) abort('forbidden', `只有申請人可以${verb}這張${label}`);
  if (!beforeFirstDecision(form)) abort('conflict', `只有尚未有人簽核的${label}可以${verb}`);
}

export function assertVersion(form: LockedForm, expectedVersion: unknown) {
  if (typeof expectedVersion !== 'number' || expectedVersion !== form.version) {
    abort('conflict', '表單已被其他人更新，請重新整理頁面後再修改');
  }
}

/** Starts a new round after an edit/resubmit: snapshot the old steps into the audit trail first. */
export async function replaceSteps(
  tx: Tx,
  outbox: Outbox,
  input: {
    formType: FormType;
    form: LockedForm;
    /** Hard-coded chain (non-empty), or steps from the flow resolver. */
    chain: ApprovalChainStep[] | { resolved: ResolvedStep[] };
    actorId: string;
    action: string;
    previousItems: unknown[];
    requestId?: string;
    message: string;
    extraSet?: Record<string, unknown>;
  }
): Promise<number> {
  const { formType, form } = input;
  const previousSteps = await readSteps(tx, formType, form.id);
  await recordAudit(tx, {
    actorEmployeeId: input.actorId,
    action: input.action,
    entityType: formType,
    entityId: form.id,
    requestId: input.requestId,
    details: { previousVersion: form.version, previousStatus: form.status, previousSteps, previousItems: input.previousItems },
  });
  await deleteSteps(tx, formType, form.id);
  let first: { stepOrder: number; approverEmployeeId: string } | null;
  if (Array.isArray(input.chain)) {
    await insertSteps(tx, formType, form.id, input.chain);
    first = { stepOrder: 1, approverEmployeeId: input.chain[0].approverEmployeeId };
  } else {
    first = await insertResolvedSteps(tx, formType, form.id, input.chain.resolved);
  }
  // Requests from the previous round are obsolete.
  await tx
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.formType, formType),
        eq(notifications.formId, form.id),
        eq(notifications.type, 'approval_requested'),
        eq(notifications.isRead, false)
      )
    );
  if (!first) {
    const version = await bumpForm(tx, formType, form.id, { status: 'approved', currentStepOrder: null });
    await notify(tx, outbox, {
      recipientEmployeeId: form.applicantEmployeeId,
      type: 'request_approved',
      formType,
      formId: form.id,
      caseNumber: form.caseNumber,
      version,
      message: `${labelOf(formType, form)} ${form.caseNumber} 已完成簽核`,
    });
    return version;
  }
  const version = await bumpForm(tx, formType, form.id, { status: 'pending_approval', currentStepOrder: first.stepOrder });
  await notify(tx, outbox, {
    recipientEmployeeId: first.approverEmployeeId,
    type: 'approval_requested',
    formType,
    formId: form.id,
    caseNumber: form.caseNumber,
    version,
    message: input.message,
  });
  return version;
}

export async function withdrawForm(tx: Tx, input: { formType: FormType; form: LockedForm; actorId: string; requestId?: string }) {
  assertApplicantBeforeFirstDecision(input.form, input.actorId, '撤回', input.formType);
  await bumpForm(tx, input.formType, input.form.id, { status: 'withdrawn', currentStepOrder: null });
  await recordAudit(tx, {
    actorEmployeeId: input.actorId,
    action: `${input.formType}.withdrawn`,
    entityType: input.formType,
    entityId: input.form.id,
    requestId: input.requestId,
  });
}

/**
 * Claims an idempotency key inside the create transaction. Returns the stored
 * result for a repeat of the same request; refuses the same key with a
 * different request. Concurrent duplicates wait on the row lock.
 */
export async function claimIdempotencyKey<T>(
  tx: Tx,
  input: { actorId: string; operation: string; key: unknown; request: unknown }
): Promise<{ replay: T } | { claimed: true }> {
  if (typeof input.key !== 'string' || input.key.length < 8 || input.key.length > 100) {
    abort('validation', '缺少有效的請求識別碼，請重新整理頁面後再送出');
  }
  const requestHash = createHash('sha256').update(JSON.stringify(input.request)).digest('hex');
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ actorEmployeeId: input.actorId, operation: input.operation, idempotencyKey: input.key as string, requestHash })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.idempotencyKey });
  if (inserted.length > 0) return { claimed: true };
  const [existing] = await tx
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.actorEmployeeId, input.actorId),
        eq(idempotencyKeys.operation, input.operation),
        eq(idempotencyKeys.idempotencyKey, input.key as string)
      )
    );
  if (!existing || existing.requestHash !== requestHash || !existing.result) {
    abort('conflict', '此請求識別碼已用於不同內容，請重新整理頁面後再送出');
  }
  return { replay: existing.result as T };
}

export async function storeIdempotentResult(tx: Tx, input: { actorId: string; operation: string; key: string; result: unknown }) {
  await tx
    .update(idempotencyKeys)
    .set({ result: input.result })
    .where(
      and(
        eq(idempotencyKeys.actorEmployeeId, input.actorId),
        eq(idempotencyKeys.operation, input.operation),
        eq(idempotencyKeys.idempotencyKey, input.key)
      )
    );
}
