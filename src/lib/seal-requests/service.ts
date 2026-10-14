import { eq, sql } from 'drizzle-orm';
import { withoutFiler, type ApprovalChainStep } from '@/lib/approval/chain';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { departments, employees, procurementCases } from '@/lib/db/schema';
import { FORM_LABELS, FORM_TABLE, type SealFormType } from '@/lib/procurement/form-registry';
import {
  abort,
  assertVersion,
  beforeFirstDecision,
  bumpForm,
  decideCurrentStep,
  fail,
  lockForm,
  notify,
  runInTransaction,
  type ActionResult,
  type LockedForm,
  type Outbox,
  type Tx,
  type TxHooks,
} from '@/lib/workflow/tx';

// Workflow shared by both seal request forms. The applicant may differ from the
// employee who filed the form (經辦, procurement_cases.created_by); the filer may
// also edit / withdraw it and hears about the outcome.

export type Actor = { id: string; departmentId: string } | null;

/**
 * 申請人 can be changed when someone files on another employee's behalf. The
 * 部門 decides who signs as department manager, so it is always the
 * applicant's own department, whatever the form sent.
 */
export async function resolveParties<T extends { applicantEmployeeId: string; departmentId: string }>(tx: Tx, form: T): Promise<T> {
  if (!isUuid(form.applicantEmployeeId)) abort('validation', '請選擇申請人');
  const [applicant] = await tx
    .select({ id: employees.id, accessEnabled: employees.accessEnabled, departmentId: employees.departmentId })
    .from(employees)
    .where(eq(employees.id, form.applicantEmployeeId));
  if (!applicant || !applicant.accessEnabled) abort('validation', '選取的申請人無效或已停用');
  const [dept] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, applicant!.departmentId));
  if (!dept) abort('validation', '申請人的部門資料無效，請聯絡系統管理員');
  return { ...form, departmentId: applicant!.departmentId };
}

/**
 * On a form filed or revised for someone else, the filer and the editor sign
 * nothing (just like the applicant) and at least one other approver is needed.
 * The named applicant confirms it first, so nobody can file under another
 * employee's name, or borrow a manager's shorter chain, without that employee
 * agreeing. `editorId` is whoever submits this round (the filer on create).
 */
export function excludeFiler(
  chain: ApprovalChainStep[],
  filerId: string,
  applicantId: string,
  editorId: string = filerId
): ApprovalChainStep[] {
  if (filerId === applicantId && editorId === applicantId) return chain;
  const rest = withoutFiler(withoutFiler(chain, filerId), editorId);
  if (rest.length === 0) abort('validation', '代為申請的表單需要申請人與經辦人以外的人簽核，但找不到適用的簽核人，請聯絡系統管理員');
  if (editorId === applicantId) return rest;
  return [{ approverEmployeeId: applicantId, approverRole: 'applicant_confirmation' }, ...rest];
}

export async function lockSealOrFail(tx: Tx, formType: SealFormType, id: string): Promise<LockedForm> {
  const missing = `找不到這張${FORM_LABELS[formType]}`;
  if (!isUuid(id)) abort('not_found', missing);
  const form = await lockForm(tx, formType, id);
  if (!form) abort('not_found', missing);
  return form!;
}

/** The employee who filed the form (may differ from the applicant). */
export async function filerOf(tx: Tx, form: LockedForm): Promise<string> {
  const [c] = await tx
    .select({ createdBy: procurementCases.createdByEmployeeId })
    .from(procurementCases)
    .where(eq(procurementCases.id, form.procurementCaseId));
  return c.createdBy;
}

export async function assertSealOwner(tx: Tx, formType: SealFormType, form: LockedForm, actorId: string, verb: string) {
  if (form.applicantEmployeeId !== actorId && (await filerOf(tx, form)) !== actorId) {
    abort('forbidden', `只有申請人或經辦人可以${verb}這張${FORM_LABELS[formType]}`);
  }
}

/** decideCurrentStep notifies the applicant; a different filer hears about the outcome too. */
async function notifyFiler(tx: Tx, outbox: Outbox, formType: SealFormType, form: LockedForm, reason?: string) {
  const filer = await filerOf(tx, form);
  if (filer === form.applicantEmployeeId) return;
  const [after] = await tx.execute<{ status: string; version: number }>(
    sql`select status, version from ${sql.identifier(FORM_TABLE[formType])} where id = ${form.id}`
  );
  if (after.status !== 'approved' && after.status !== 'returned') return;
  const returned = after.status === 'returned';
  const label = FORM_LABELS[formType];
  await notify(tx, outbox, {
    recipientEmployeeId: filer,
    type: returned ? 'request_returned' : 'request_approved',
    formType,
    formId: form.id,
    caseNumber: form.caseNumber,
    version: after.version,
    message: returned ? `${label} ${form.caseNumber} 已被退回：${reason}` : `${label} ${form.caseNumber} 已完成簽核`,
  });
}

export function approveSealStep(
  formType: SealFormType,
  actor: Actor,
  id: string,
  expectedVersion: number,
  hooks?: TxHooks
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${formType}.approve`,
    async (tx, outbox) => {
      const form = await lockSealOrFail(tx, formType, id);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType, form, actorId: actor.id, decision: 'approve' });
      await notifyFiler(tx, outbox, formType, form);
      return { ok: true as const };
    },
    hooks
  );
}

export function returnSealStep(
  formType: SealFormType,
  actor: Actor,
  id: string,
  reason: string,
  expectedVersion: number
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  return runInTransaction(`${formType}.return`, async (tx, outbox) => {
    const form = await lockSealOrFail(tx, formType, id);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType, form, actorId: actor.id, decision: 'return', reason });
    await notifyFiler(tx, outbox, formType, form, reason);
    return { ok: true as const };
  });
}

/** Edit (before anyone signed) or resubmit (after a return): who may, and when. */
export async function assertRevisable(
  tx: Tx,
  formType: SealFormType,
  form: LockedForm,
  actorId: string,
  mode: 'update' | 'resubmit',
  expectedVersion: unknown
) {
  const label = FORM_LABELS[formType];
  if (mode === 'update') {
    await assertSealOwner(tx, formType, form, actorId, '修改');
    if (!beforeFirstDecision(form)) abort('conflict', `只有尚未有人簽核的${label}可以修改`);
  } else {
    await assertSealOwner(tx, formType, form, actorId, '重新送出');
    if (form.status !== 'returned') abort('conflict', `只有被退回的${label}可以重新送出`);
  }
  assertVersion(form, expectedVersion);
}

export function withdrawSealRequest(formType: SealFormType, actor: Actor, id: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${formType}.withdraw`, async (tx) => {
    const form = await lockSealOrFail(tx, formType, id);
    await assertSealOwner(tx, formType, form, actor.id, '撤回');
    if (!beforeFirstDecision(form)) {
      abort('conflict', `只有尚未有人簽核的${FORM_LABELS[formType]}可以撤回`);
    }
    await bumpForm(tx, formType, form.id, { status: 'withdrawn', currentStepOrder: null });
    await recordAudit(tx, { actorEmployeeId: actor.id, action: `${formType}.withdrawn`, entityType: formType, entityId: form.id });
    return { ok: true as const };
  });
}
