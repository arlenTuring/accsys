import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { resolveFlowInTx } from '@/lib/approval/flow/load';
import type { FlowContext, FlowDef, ResolvedStep } from '@/lib/approval/flow/types';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import {
  attachments,
  budgetCodes,
  departments,
  employeeJobRoles,
  employees,
  formDefinitions,
  formDefinitionVersions,
  formSubmissions,
  jobRoles,
  procurementCases,
  projects,
  suppliers,
} from '@/lib/db/schema';
import { taipeiToday } from '@/lib/taipei-date';
import {
  abort,
  assertVersion,
  beforeFirstDecision,
  bumpForm,
  claimIdempotencyKey,
  decideCurrentStep,
  fail,
  insertResolvedSteps,
  lockForm,
  notify,
  replaceSteps,
  runInTransaction,
  storeIdempotentResult,
  type ActionResult,
  type Failure,
  type LockedForm,
  type Outbox,
  type Tx,
  type TxHooks,
} from '@/lib/workflow/tx';
import { parseDefinition } from './definition';
import { withApplicantConfirmation } from './on-behalf';
import { allFields, BUDGET_SCOPE_LABELS, type FormSchema } from './schema';
import { summarizeErrors, validateSubmission, type NormalizedSubmission } from './validate';
import { canFile, parseVisibility, type Visibility } from './visibility';

// Workflow of designer forms (form_type 'custom'). The department is always
// the applicant's own. On a 代為申請 form (schema.onBehalf) the employee who
// files (經辦, procurement_cases.created_by) may name someone else as the
// applicant; that applicant confirms first, and the filer may also edit,
// withdraw and resubmit and hears about the outcome. Edits and resubmits stay
// on the definition version the form was first submitted with.

export type Actor = { id: string } | null;
export type CreateInput = { data: unknown; idempotencyKey: string; fileCount: number; applicantEmployeeId?: unknown };
export type ReviseInput = { data: unknown; expectedVersion: number; newFileCount: number };
export type CreateResult = { ok: true; submissionId: string; formNumber: string; replayed?: boolean } | Failure;

const FORM = 'custom' as const;

type Version = {
  definitionId: string;
  key: string;
  name: string;
  numberPrefix: string;
  versionId: string;
  schema: FormSchema;
  flow: FlowDef;
  visibility: Visibility;
};

/** Stored versions were validated on publish; parsing again guards against hand-edited rows. */
function parseStored(schema: unknown, flow: unknown) {
  const parsed = parseDefinition(schema, flow);
  if (!parsed.ok) abort('unavailable', '表單定義有誤，請聯絡系統管理員');
  return parsed as Extract<typeof parsed, { ok: true }>;
}

async function applicantOf(tx: Tx, employeeId: string, missing: { code: 'forbidden' | 'validation'; message: string } = { code: 'forbidden', message: '找不到您的員工資料' }) {
  const [emp] = await tx
    .select({ id: employees.id, departmentId: employees.departmentId, accessEnabled: employees.accessEnabled })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!emp || !emp.accessEnabled) abort(missing.code, missing.message);
  const roles = await tx
    .select({ code: jobRoles.code })
    .from(employeeJobRoles)
    .innerJoin(jobRoles, eq(jobRoles.id, employeeJobRoles.jobRoleId))
    .where(eq(employeeJobRoles.employeeId, employeeId));
  return { departmentId: emp!.departmentId, jobRoles: roles.map((r) => r.code) };
}

/** The published version of a form the actor may file (unpublished and hidden forms look missing). */
async function publishedVersion(tx: Tx, key: unknown, applicant: { departmentId: string; jobRoles: string[] }): Promise<Version> {
  const missing = '找不到這張表單，或您沒有填寫權限';
  if (typeof key !== 'string' || key.length > 40) abort('not_found', missing);
  const [row] = await tx
    .select({
      definitionId: formDefinitions.id,
      key: formDefinitions.key,
      name: formDefinitions.name,
      numberPrefix: formDefinitions.numberPrefix,
      visibility: formDefinitions.visibility,
      versionId: formDefinitionVersions.id,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formDefinitions)
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
    .where(and(eq(formDefinitions.key, key as string), eq(formDefinitions.status, 'published')));
  if (!row) abort('not_found', missing);
  const visibility = parseVisibility(row!.visibility);
  if (!visibility.ok || !canFile(visibility.value, applicant)) abort('not_found', missing);
  const { schema, flow } = parseStored(row!.schema, row!.flow);
  return { ...row!, schema, flow, visibility: visibility.value };
}

async function versionOfSubmission(tx: Tx, submissionId: string): Promise<Version> {
  const [row] = await tx
    .select({
      definitionId: formDefinitions.id,
      key: formDefinitions.key,
      name: formDefinitions.name,
      numberPrefix: formDefinitions.numberPrefix,
      versionId: formDefinitionVersions.id,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formSubmissions.versionId))
    .where(eq(formSubmissions.id, submissionId));
  const { schema, flow } = parseStored(row.schema, row.flow);
  return { ...row, schema, flow, visibility: {} };
}

function normalize(schema: FormSchema, data: unknown): NormalizedSubmission {
  const result = validateSubmission(schema, data, taipeiToday());
  if (!result.ok) abort('validation', summarizeErrors(result.errors));
  return (result as Extract<typeof result, { ok: true }>).value;
}

/** Referenced employees, departments, budget codes, projects and suppliers must exist (and be active); scoped budget codes must match. */
async function assertRefs(tx: Tx, refs: NormalizedSubmission['refs']) {
  const check = async (ids: string[], query: (l: string[]) => Promise<{ id: string }[]>, what: string) => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = new Set((await query(unique)).map((r) => r.id));
    if (unique.some((id) => !found.has(id))) abort('validation', `選擇的${what}不存在或已停用`);
  };
  await check(refs.employees, (l) => tx.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, l), eq(employees.accessEnabled, true))), '員工');
  await check(refs.departments, (l) => tx.select({ id: departments.id }).from(departments).where(and(inArray(departments.id, l), eq(departments.active, true))), '部門');
  await check(refs.budgetCodes, (l) => tx.select({ id: budgetCodes.id }).from(budgetCodes).where(inArray(budgetCodes.id, l)), '預算編號');
  await check(refs.projects, (l) => tx.select({ id: projects.id }).from(projects).where(inArray(projects.id, l)), '專案');
  await check(refs.suppliers, (l) => tx.select({ id: suppliers.id }).from(suppliers).where(inArray(suppliers.id, l)), '廠商');
  if (refs.budgetScopes.length > 0) {
    const rows = await tx
      .select({ id: budgetCodes.id, departmentId: budgetCodes.departmentId, projectKind: projects.kind })
      .from(budgetCodes)
      .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
      .where(inArray(budgetCodes.id, [...new Set(refs.budgetScopes.map((r) => r.id))]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const { id, scope } of refs.budgetScopes) {
      const code = byId.get(id);
      if (!code || (scope === 'department' ? !code.departmentId : code.projectKind !== scope)) {
        abort('validation', `選取的預算來源無效（需為${BUDGET_SCOPE_LABELS[scope]}預算）`);
      }
    }
  }
}

function assertAttachments(schema: FormSchema, value: NormalizedSubmission, fileCount: number) {
  if (value.attachmentsRequired && fileCount === 0) abort('validation', '請上傳附件');
  const field = allFields(schema).find((f) => f.type === 'attachments');
  const max = field?.type === 'attachments' ? field.maxFiles : null;
  if (max !== null && fileCount > max) abort('validation', `附件最多 ${max} 個`);
}

function flowContext(
  parties: { applicantId: string; filerId: string; departmentId: string },
  key: string,
  value: NormalizedSubmission
): FlowContext {
  return {
    applicantEmployeeId: parties.applicantId,
    filerEmployeeId: parties.filerId,
    departmentId: parties.departmentId,
    formKey: key,
    today: taipeiToday(),
    fields: value.flowFields,
  };
}

/** The applicant named on create: the actor, or (代為申請 forms only) another employee. */
function applicantIdFor(schema: FormSchema, actorId: string, requested: unknown): string {
  if (requested === undefined || requested === null || requested === '' || requested === actorId) return actorId;
  if (!schema.onBehalf) abort('validation', '這張表單不能代為申請');
  if (!isUuid(requested)) abort('validation', '請選擇申請人');
  return (requested as string).toLowerCase();
}

function confirmed(steps: ResolvedStep[], p: { applicantId: string; filerId: string; editorId: string }): ResolvedStep[] {
  const out = withApplicantConfirmation(steps, p);
  if (!out) abort('validation', '代為申請的表單需要申請人與經辦人以外的人簽核，但找不到適用的簽核人，請聯絡系統管理員');
  return out!;
}

/** The employee who filed the form (the applicant, unless filed on their behalf). */
async function filerOf(tx: Tx, form: LockedForm): Promise<string> {
  const [c] = await tx
    .select({ createdBy: procurementCases.createdByEmployeeId })
    .from(procurementCases)
    .where(eq(procurementCases.id, form.procurementCaseId));
  return c.createdBy;
}

async function assertOwner(tx: Tx, form: LockedForm, actorId: string, verb: string): Promise<string> {
  const filerId = await filerOf(tx, form);
  if (form.applicantEmployeeId !== actorId && filerId !== actorId) {
    const who = filerId === form.applicantEmployeeId ? '申請人' : '申請人或經辦人';
    abort('forbidden', `只有${who}可以${verb}這張${form.formLabel ?? '申請單'}`);
  }
  return filerId;
}

/** decideCurrentStep tells the applicant; a different filer hears about the outcome too. */
async function notifyFiler(tx: Tx, outbox: Outbox, form: LockedForm, reason?: string) {
  const filerId = await filerOf(tx, form);
  if (filerId === form.applicantEmployeeId) return;
  const [after] = await tx
    .select({ status: formSubmissions.status, version: formSubmissions.version })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, form.id));
  if (after.status !== 'approved' && after.status !== 'returned') return;
  const returned = after.status === 'returned';
  const label = form.formLabel ?? '申請單';
  await notify(tx, outbox, {
    recipientEmployeeId: filerId,
    type: returned ? 'request_returned' : 'request_approved',
    formType: FORM,
    formId: form.id,
    caseNumber: form.caseNumber,
    version: after.version,
    message: returned ? `${label} ${form.caseNumber} 已被退回：${reason}` : `${label} ${form.caseNumber} 已完成簽核`,
  });
}

/** YYYYMMDD + prefix + daily serial per definition (4 digits, widening past 9999). */
async function nextFormNumber(tx: Tx, definitionId: string, prefix: string): Promise<string> {
  const period = taipeiToday().replaceAll('-', '');
  const [{ serial }] = await tx.execute<{ serial: number }>(sql`
    insert into form_number_counters (definition_id, period, last_serial) values (${definitionId}, ${period}, 1)
    on conflict (definition_id, period) do update set last_serial = form_number_counters.last_serial + 1
    returning last_serial as serial`);
  return `${period}${prefix}${String(serial).padStart(4, '0')}`;
}

const promotedColumns = (v: NormalizedSubmission) => ({
  data: v.data,
  totalAmount: v.promoted.totalAmount,
  budgetCodeId: v.promoted.budgetCodeId,
  projectId: v.promoted.projectId,
});

type Claimed = { ok: true; submissionId: string; formNumber: string };

export function createSubmission(actor: Actor, key: string, input: CreateInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = 'custom_form.create';
  return runInTransaction<Claimed & { replayed?: boolean }>(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, fileCount, ...rest } = input ?? ({} as CreateInput);
      const request = { key, ...rest };
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return { ...claim.replay, replayed: true };

      const filer = await applicantOf(tx, actor.id);
      const def = await publishedVersion(tx, key, filer);
      const applicantId = applicantIdFor(def.schema, actor.id, rest.applicantEmployeeId);
      const applicant =
        applicantId === actor.id ? filer : await applicantOf(tx, applicantId, { code: 'validation', message: '選取的申請人無效或已停用' });
      if (!canFile(def.visibility, applicant)) abort('validation', '選取的申請人沒有這張表單的填寫權限');
      const value = normalize(def.schema, rest.data);
      assertAttachments(def.schema, value, typeof fileCount === 'number' ? fileCount : 0);
      await assertRefs(tx, value.refs);
      const parties = { applicantId, filerId: actor.id, departmentId: applicant.departmentId };
      const steps = confirmed(await resolveFlowInTx(tx, def.flow, flowContext(parties, def.key, value)), { ...parties, editorId: actor.id });

      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id, caseType: 'custom' })
        .returning({ id: procurementCases.id });
      const formNumber = await nextFormNumber(tx, def.definitionId, def.numberPrefix);
      const firstPending = steps.findIndex((s) => s.status === 'pending');
      const [row] = await tx
        .insert(formSubmissions)
        .values({
          procurementCaseId: pcase.id,
          definitionId: def.definitionId,
          versionId: def.versionId,
          formNumber,
          applicantEmployeeId: applicantId,
          departmentId: applicant.departmentId,
          status: firstPending === -1 ? 'approved' : 'pending_approval',
          currentStepOrder: firstPending === -1 ? null : firstPending + 1,
          ...promotedColumns(value),
        })
        .returning({ id: formSubmissions.id });
      const first = await insertResolvedSteps(tx, FORM, row.id, steps);
      await notify(tx, outbox, {
        recipientEmployeeId: first ? first.approverEmployeeId : applicantId,
        type: first ? 'approval_requested' : 'request_approved',
        formType: FORM,
        formId: row.id,
        caseNumber: formNumber,
        version: 1,
        message: first ? `${def.name} ${formNumber} 待您簽核` : `${def.name} ${formNumber} 已完成簽核（無需人工簽核）`,
      });
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: row.id,
        details: {
          key: def.key,
          version: def.versionId,
          formNumber,
          caseNumber,
          autoApproved: !first,
          onBehalfOf: applicantId === actor.id ? undefined : applicantId,
        },
      });
      const result: Claimed = { ok: true, submissionId: row.id, formNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, id: string): Promise<LockedForm> {
  if (!isUuid(id)) abort('not_found', '找不到這張申請單');
  const form = await lockForm(tx, FORM, id);
  if (!form) abort('not_found', '找不到這張申請單');
  return form!;
}

export function approveSubmissionStep(actor: Actor, id: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${FORM}.approve`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, id);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'approve' });
      await notifyFiler(tx, outbox, form);
      return { ok: true as const };
    },
    hooks
  );
}

export function returnSubmissionStep(actor: Actor, id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  return runInTransaction(`${FORM}.return`, async (tx, outbox) => {
    const form = await lockOrFail(tx, id);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'return', reason: reason.trim() });
    await notifyFiler(tx, outbox, form, reason.trim());
    return { ok: true as const };
  });
}

/** update: before the first person decides; resubmit: after a return. Same definition version either way. */
export function reviseSubmission(actor: Actor, id: string, mode: 'update' | 'resubmit', input: ReviseInput, hooks?: TxHooks): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (mode !== 'update' && mode !== 'resubmit') return Promise.resolve(fail('validation', '操作不正確'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, id);
      const filerId = await assertOwner(tx, form, actor.id, mode === 'update' ? '修改' : '重新送出');
      if (mode === 'update') {
        if (!beforeFirstDecision(form)) abort('conflict', `只有尚未有人簽核的${form.formLabel ?? '申請單'}可以修改`);
      } else if (form.status !== 'returned') {
        abort('conflict', `只有被退回的${form.formLabel ?? '申請單'}可以重新送出`);
      }
      assertVersion(form, input?.expectedVersion);

      const applicant = await applicantOf(tx, form.applicantEmployeeId, {
        code: 'validation',
        message: '申請人的帳號已停用，無法修改或重新送出',
      });
      const def = await versionOfSubmission(tx, id);
      const value = normalize(def.schema, input?.data);
      const [{ n }] = await tx
        .select({ n: count() })
        .from(attachments)
        .where(and(eq(attachments.formType, FORM), eq(attachments.formId, id)));
      assertAttachments(def.schema, value, n + (typeof input?.newFileCount === 'number' ? input.newFileCount : 0));
      await assertRefs(tx, value.refs);
      const parties = { applicantId: form.applicantEmployeeId, filerId, departmentId: applicant.departmentId };
      const steps = confirmed(await resolveFlowInTx(tx, def.flow, flowContext(parties, def.key, value)), { ...parties, editorId: actor.id });

      const [previous] = await tx
        .select({ data: formSubmissions.data, departmentId: formSubmissions.departmentId })
        .from(formSubmissions)
        .where(eq(formSubmissions.id, id));
      await tx
        .update(formSubmissions)
        .set({ ...promotedColumns(value), departmentId: applicant.departmentId })
        .where(eq(formSubmissions.id, id));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain: { resolved: steps },
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems: [previous],
        message: `${def.name} ${form.caseNumber} 已${mode === 'update' ? '修改' : '重新送出'}，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function withdrawSubmission(actor: Actor, id: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${FORM}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, id);
    await assertOwner(tx, form, actor.id, '撤回');
    if (!beforeFirstDecision(form)) abort('conflict', `只有尚未有人簽核的${form.formLabel ?? '申請單'}可以撤回`);
    await bumpForm(tx, FORM, form.id, { status: 'withdrawn', currentStepOrder: null });
    await recordAudit(tx, { actorEmployeeId: actor.id, action: `${FORM}.withdrawn`, entityType: FORM, entityId: form.id });
    return { ok: true as const };
  });
}
