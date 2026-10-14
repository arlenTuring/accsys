import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canAttachToForm, canReadForm, isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { ACTIVE_ASSET_STATUSES, ASSET_STATUS_LABELS, type AssetStatus } from '@/lib/asset-transfers/constants';
import {
  approvalSteps,
  assets,
  budgetCodes,
  departments,
  employeeJobRoles,
  employees,
  formCategories,
  formDefinitions,
  formDefinitionVersions,
  formSubmissionAssetLines,
  formSubmissions,
  jobRoles,
  procurementCases,
  projects,
  suppliers,
} from '@/lib/db/schema';
import { parseDefinition } from './definition';
import { allFields, sourceFieldOf, type BudgetScope, type FieldDef, type FormSchema } from './schema';
import { canSeeSensitive, maskSensitive } from './sensitive';
import { ruleHolds, sourceOptions, type SourceOption } from './source';
import type { TableValue } from './validate';
import { canFile, parseVisibility } from './visibility';

const FORM = 'custom' as const;

export type FilableDefinition = {
  key: string;
  name: string;
  description: string;
  categoryKey: string;
  categoryTitle: string;
  categoryDescription: string;
  categorySort: number;
  legacyFormType: string | null;
};

async function jobRolesOf(employeeId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ code: jobRoles.code })
    .from(employeeJobRoles)
    .innerJoin(jobRoles, eq(jobRoles.id, employeeJobRoles.jobRoleId))
    .where(eq(employeeJobRoles.employeeId, employeeId));
  return rows.map((r) => r.code);
}

/** Published forms the current employee may file, in menu order. */
export async function getFilableDefinitions(): Promise<FilableDefinition[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const rows = await getDb()
    .select({
      key: formDefinitions.key,
      name: formDefinitions.name,
      description: formDefinitions.description,
      visibility: formDefinitions.visibility,
      legacyFormType: formDefinitions.legacyFormType,
      categoryKey: formCategories.key,
      categoryTitle: formCategories.title,
      categoryDescription: formCategories.description,
      categorySort: formCategories.sortOrder,
    })
    .from(formDefinitions)
    .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId))
    .where(and(eq(formDefinitions.status, 'published'), eq(formCategories.active, true)))
    .orderBy(asc(formCategories.sortOrder), asc(formDefinitions.sortOrder), asc(formDefinitions.name));
  const roles = await jobRolesOf(employee.id);
  return rows
    .filter((r) => {
      const v = parseVisibility(r.visibility);
      return v.ok && canFile(v.value, { departmentId: employee.departmentId, jobRoles: roles });
    })
    .map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      categoryKey: r.categoryKey,
      categoryTitle: r.categoryTitle,
      categoryDescription: r.categoryDescription,
      categorySort: r.categorySort,
      legacyFormType: r.legacyFormType,
    }));
}

/** "高雄自駕車：劉君怡（差旅費｜B-001）" — project (or department), budget owner, category and code. */
async function budgetCodeLabels(ids?: string[]): Promise<BudgetCodeOption[]> {
  const owner = alias(employees, 'budget_owner');
  const rows = await getDb()
    .select({
      id: budgetCodes.id,
      code: budgetCodes.code,
      category: budgetCodes.category,
      departmentId: budgetCodes.departmentId,
      projectKind: projects.kind,
      project: projects.name,
      department: departments.name,
      owner: owner.name,
    })
    .from(budgetCodes)
    .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
    .leftJoin(departments, eq(departments.id, budgetCodes.departmentId))
    .leftJoin(owner, eq(owner.id, budgetCodes.ownerEmployeeId))
    .where(ids ? inArray(budgetCodes.id, ids) : undefined)
    .orderBy(asc(budgetCodes.code));
  return rows.map((c) => ({
    id: c.id,
    label: `${c.project ?? c.department ?? c.code}：${c.owner ?? '未指定預算負責人'}（${c.category}｜${c.code}）`,
    scope: c.departmentId ? 'department' : c.projectKind === 'revenue' ? 'revenue' : 'product',
  }));
}

export type BudgetCodeOption = { id: string; label: string; scope: BudgetScope };

export type PickerOptions = {
  employees: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  budgetCodes: BudgetCodeOption[];
  projects: { id: string; label: string }[];
  /** Names only; bank details never leave the server through the picker. */
  suppliers: { id: string; label: string }[];
  /** Assets still in the register; custodian / location pre-fill the register-linked rows. */
  assets: AssetPickerOption[];
  /** 關聯單據: submissions this form may continue (with the rows each carries over). */
  sources: SourceOption[];
};

/** Who files the form and, when editing, the source it already continues. */
export type SourceContext = { definitionId: string; applicantId: string; current?: string | null };

export type AssetPickerOption = { id: string; label: string; custodianId: string; location: string };

/** Field types and table column types the schema uses. */
function usedTypes(schema: FormSchema): Set<string> {
  const types = new Set<string>();
  for (const f of allFields(schema)) {
    types.add(f.type);
    if (f.type === 'table') f.columns.forEach((c) => types.add(c.type));
  }
  return types;
}

async function assetOptions(): Promise<AssetPickerOption[]> {
  const rows = await getDb()
    .select({
      id: assets.id,
      tag: assets.tag,
      name: assets.name,
      quantity: assets.quantity,
      status: assets.status,
      custodianId: assets.custodianEmployeeId,
      custodianName: employees.name,
      location: assets.location,
    })
    .from(assets)
    .innerJoin(employees, eq(employees.id, assets.custodianEmployeeId))
    .where(inArray(assets.status, [...ACTIVE_ASSET_STATUSES]))
    .orderBy(asc(assets.tag));
  return rows.map((a) => ({
    id: a.id,
    label: `${a.tag} ${a.name}（${ASSET_STATUS_LABELS[a.status as AssetStatus] ?? a.status}｜數量 ${a.quantity}｜保管人 ${a.custodianName}）`,
    custodianId: a.custodianId,
    location: a.location,
  }));
}

/** Choices for the reference fields the schema uses (active records only). */
export async function getPickerOptions(schema: FormSchema, sourceCtx?: SourceContext): Promise<PickerOptions> {
  const types = usedTypes(schema);
  const db = getDb();
  const link = sourceFieldOf(schema);
  const [emps, depts, codes, projs, sups, assetChoices, sourceChoices] = await Promise.all([
    types.has('employee') || schema.onBehalf
      ? db
          .select({ id: employees.id, name: employees.name, dept: departments.name })
          .from(employees)
          .innerJoin(departments, eq(departments.id, employees.departmentId))
          .where(eq(employees.accessEnabled, true))
          .orderBy(asc(departments.name), asc(employees.name))
      : [],
    types.has('department')
      ? db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.active, true)).orderBy(asc(departments.sortOrder), asc(departments.name))
      : [],
    types.has('budget_code') ? budgetCodeLabels() : [],
    types.has('project') ? db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).orderBy(asc(projects.code)) : [],
    types.has('supplier') ? db.select({ id: suppliers.id, label: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)) : [],
    types.has('asset') ? assetOptions() : [],
    link && sourceCtx ? sourceOptions(db, sourceCtx, link, sourceCtx.applicantId, sourceCtx.current ?? undefined) : [],
  ]);
  return {
    employees: emps.map((e) => ({ id: e.id, label: `${e.name}（${e.dept}）` })),
    departments: depts.map((d) => ({ id: d.id, label: d.name })),
    budgetCodes: codes,
    projects: projs.map((p) => ({ id: p.id, label: `${p.code} ${p.name}` })),
    suppliers: sups,
    assets: assetChoices,
    sources: sourceChoices,
  };
}

export type NewFormContext = {
  key: string;
  name: string;
  description: string;
  schema: FormSchema;
  options: PickerOptions;
  currentEmployeeId: string;
};

/** The published version of a form the current employee may file, or null (missing / hidden look the same). */
export async function getNewFormContext(key: string): Promise<NewFormContext | null> {
  const employee = await getCurrentEmployee();
  if (!employee || typeof key !== 'string' || key.length > 40) return null;
  const [row] = await getDb()
    .select({
      id: formDefinitions.id,
      key: formDefinitions.key,
      name: formDefinitions.name,
      description: formDefinitions.description,
      visibility: formDefinitions.visibility,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formDefinitions)
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
    .where(and(eq(formDefinitions.key, key), eq(formDefinitions.status, 'published')));
  if (!row) return null;
  const v = parseVisibility(row.visibility);
  if (!v.ok || !canFile(v.value, { departmentId: employee.departmentId, jobRoles: await jobRolesOf(employee.id) })) return null;
  const parsed = parseDefinition(row.schema, row.flow);
  if (!parsed.ok) return null;
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    schema: parsed.schema,
    options: await getPickerOptions(parsed.schema, { definitionId: row.id, applicantId: employee.id }),
    currentEmployeeId: employee.id,
  };
}

export type SubmissionListItem = {
  id: string;
  key: string;
  name: string;
  formNumber: string;
  status: string;
  totalAmount: number | null;
  createdAt: Date;
};

/** Submissions I applied for or filed for someone else, newest first (all designer forms, one form by key, or one category). */
export async function getMySubmissions(
  filter?: string | { categoryKey: string } | { legacyFormType: string | string[] }
): Promise<SubmissionListItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const scope =
    filter === undefined
      ? undefined
      : typeof filter === 'string'
        ? eq(formDefinitions.key, filter)
        : 'categoryKey' in filter
          ? eq(formCategories.key, filter.categoryKey)
          : inArray(formDefinitions.legacyFormType, typeof filter.legacyFormType === 'string' ? [filter.legacyFormType] : filter.legacyFormType);
  const rows = await getDb()
    .select({
      id: formSubmissions.id,
      key: formDefinitions.key,
      name: formDefinitions.name,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      totalAmount: formSubmissions.totalAmount,
      createdAt: formSubmissions.createdAt,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId))
    .innerJoin(procurementCases, eq(procurementCases.id, formSubmissions.procurementCaseId))
    .where(
      and(
        or(eq(formSubmissions.applicantEmployeeId, employee.id), eq(formSubmissions.filedByEmployeeId, employee.id)),
        scope
      )
    )
    .orderBy(desc(formSubmissions.createdAt));
  return rows.map((r) => ({ ...r, totalAmount: r.totalAmount === null ? null : Number(r.totalAmount) }));
}

export type CustomQueueItem = {
  id: string;
  formType: typeof FORM;
  caseNumber: string;
  applicantName: string;
  totalAmount: number | null;
  label: string;
};

export async function getMyCustomApprovalQueue(): Promise<CustomQueueItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const applicant = alias(employees, 'applicant');
  const rows = await getDb()
    .select({
      id: formSubmissions.id,
      caseNumber: formSubmissions.formNumber,
      applicantName: applicant.name,
      totalAmount: formSubmissions.totalAmount,
      label: formDefinitions.name,
    })
    .from(approvalSteps)
    .innerJoin(formSubmissions, eq(formSubmissions.id, approvalSteps.formId))
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(applicant, eq(applicant.id, formSubmissions.applicantEmployeeId))
    .where(
      and(
        eq(approvalSteps.formType, FORM),
        eq(approvalSteps.approverEmployeeId, employee.id),
        eq(approvalSteps.status, 'pending'),
        eq(formSubmissions.status, 'pending_approval'),
        eq(formSubmissions.currentStepOrder, approvalSteps.stepOrder)
      )
    )
    .orderBy(asc(formSubmissions.createdAt));
  return rows.map((r) => ({ ...r, formType: FORM, totalAmount: r.totalAmount === null ? null : Number(r.totalAmount) }));
}

export type SubmissionDetail = {
  id: string;
  key: string;
  name: string;
  formNumber: string;
  caseNumber: string;
  status: string;
  version: number;
  currentStepOrder: number | null;
  applicantEmployeeId: string;
  applicantName: string;
  applicantEmail: string | null;
  applicantPhone: string | null;
  departmentName: string;
  submittedAt: Date;
  schema: FormSchema;
  data: Record<string, unknown>;
  /** Display names of referenced records (inactive ones included). */
  labels: Record<string, string>;
  options: PickerOptions | null;
  /** Set when someone else filed the form for the applicant (代為申請). */
  filerName: string | null;
  isCurrentApprover: boolean;
  /** Applicant or filer, before the first person decided. */
  canEdit: boolean;
  canResubmit: boolean;
  /** Applicant or filer (may withdraw before the first decision). */
  isOwner: boolean;
  canAttach: boolean;
  /** Register-linked forms only (null otherwise). */
  assetRegister: { lines: SubmissionAssetLine[]; appliedAt: Date | null } | null;
  /** Forms the applicant may file next from this approved submission (關聯單據). */
  followUps: { key: string; name: string }[];
};

/**
 * Published forms the employee may file whose 關聯單據 field accepts this
 * submission (form `key`, rule condition met), minus those the case already has.
 */
async function followUpsOf(
  employee: { id: string; departmentId: string },
  source: { key: string; caseId: string; schema: FormSchema; data: Record<string, unknown> }
): Promise<{ key: string; name: string }[]> {
  const db = getDb();
  const [defs, existing] = await Promise.all([
    db
      .select({
        id: formDefinitions.id,
        key: formDefinitions.key,
        name: formDefinitions.name,
        visibility: formDefinitions.visibility,
        schema: formDefinitionVersions.schema,
        flow: formDefinitionVersions.flow,
      })
      .from(formDefinitions)
      .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
      .where(eq(formDefinitions.status, 'published'))
      .orderBy(asc(formDefinitions.sortOrder), asc(formDefinitions.name)),
    db
      .select({ definitionId: formSubmissions.definitionId, key: formDefinitions.key, status: formSubmissions.status })
      .from(formSubmissions)
      .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
      .where(eq(formSubmissions.procurementCaseId, source.caseId)),
  ]);
  const taken = new Set(existing.map((e) => e.definitionId));
  const candidates = defs.filter((d) => {
    if (taken.has(d.id)) return false;
    const parsed = parseDefinition(d.schema, d.flow);
    const link = parsed.ok ? sourceFieldOf(parsed.schema) : null;
    return !!link?.sources.some(
      (r) =>
        r.form === source.key &&
        ruleHolds(r, source.schema, source.data) &&
        !(r.unlessCaseHas && existing.some((e) => e.key === r.unlessCaseHas && e.status === 'approved'))
    );
  });
  if (candidates.length === 0) return [];
  const roles = await jobRolesOf(employee.id);
  return candidates
    .filter((d) => {
      const v = parseVisibility(d.visibility);
      return v.ok && canFile(v.value, { departmentId: employee.departmentId, jobRoles: roles });
    })
    .map((d) => ({ key: d.key, name: d.name }));
}

/** Ids referenced by reference fields and employee / asset table columns, resolved to display names. */
async function referenceLabels(fields: FieldDef[], data: Record<string, unknown>): Promise<Record<string, string>> {
  const ids = {
    employee: [] as string[],
    department: [] as string[],
    budget_code: [] as string[],
    project: [] as string[],
    supplier: [] as string[],
    asset: [] as string[],
    source: [] as string[],
  };
  for (const f of fields) {
    const v = data[f.id];
    if (f.type in ids && isUuid(v)) ids[f.type as keyof typeof ids].push(v);
    if (f.type === 'table') {
      const rows = (v as TableValue | undefined)?.rows ?? [];
      for (const c of f.columns) {
        if (c.type !== 'employee' && c.type !== 'asset' && c.type !== 'budget_code') continue;
        for (const row of rows) if (isUuid(row[c.id])) ids[c.type].push(row[c.id] as string);
      }
    }
  }
  const db = getDb();
  const [emps, depts, codes, projs, sups, assetRows, sourceRows] = await Promise.all([
    ids.employee.length ? db.select({ id: employees.id, label: employees.name }).from(employees).where(inArray(employees.id, ids.employee)) : [],
    ids.department.length ? db.select({ id: departments.id, label: departments.name }).from(departments).where(inArray(departments.id, ids.department)) : [],
    ids.budget_code.length ? budgetCodeLabels([...new Set(ids.budget_code)]) : [],
    ids.project.length ? db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(inArray(projects.id, ids.project)) : [],
    ids.supplier.length ? db.select({ id: suppliers.id, label: suppliers.name }).from(suppliers).where(inArray(suppliers.id, ids.supplier)) : [],
    ids.asset.length
      ? db.select({ id: assets.id, tag: assets.tag, name: assets.name }).from(assets).where(inArray(assets.id, [...new Set(ids.asset)]))
      : [],
    ids.source.length
      ? db
          .select({ id: formSubmissions.id, formNumber: formSubmissions.formNumber, name: formDefinitions.name })
          .from(formSubmissions)
          .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
          .where(inArray(formSubmissions.id, ids.source))
      : [],
  ]);
  return Object.fromEntries([
    ...sourceRows.map((s) => [s.id, `${s.formNumber}｜${s.name}`]),
    ...emps.map((e) => [e.id, e.label]),
    ...depts.map((d) => [d.id, d.label]),
    ...codes.map((c) => [c.id, c.label]),
    ...projs.map((p) => [p.id, `${p.code} ${p.name}`]),
    ...sups.map((s) => [s.id, s.label]),
    ...assetRows.map((a) => [a.id, `${a.tag} ${a.name}`]),
  ]);
}

export type SubmissionAssetLine = {
  lineNo: number;
  assetTag: string;
  assetName: string;
  quantity: number;
  originalCustodianName: string;
  originalLocation: string;
  reason: string;
  newCustodianName: string;
  newLocation: string;
};

/** Register snapshot of a register-linked submission (what the register says vs. what it will say). */
async function assetLinesOf(submissionId: string): Promise<SubmissionAssetLine[]> {
  const original = alias(employees, 'original_custodian');
  const next = alias(employees, 'new_custodian');
  const rows = await getDb()
    .select({ line: formSubmissionAssetLines, originalCustodianName: original.name, newCustodianName: next.name })
    .from(formSubmissionAssetLines)
    .innerJoin(original, eq(original.id, formSubmissionAssetLines.originalCustodianEmployeeId))
    .innerJoin(next, eq(next.id, formSubmissionAssetLines.newCustodianEmployeeId))
    .where(eq(formSubmissionAssetLines.submissionId, submissionId))
    .orderBy(asc(formSubmissionAssetLines.lineNo));
  return rows.map(({ line, originalCustodianName, newCustodianName }) => ({
    lineNo: line.lineNo,
    assetTag: line.assetTag,
    assetName: line.assetName,
    quantity: line.quantity,
    originalCustodianName,
    originalLocation: line.originalLocation,
    reason: line.reason,
    newCustodianName,
    newLocation: line.newLocation,
  }));
}

export async function getSubmissionDetail(id: string, opts: { withOptions?: boolean } = {}): Promise<SubmissionDetail | null> {
  const actor = await getCurrentEmployee();
  if (!actor || !(await canReadForm(actor, FORM, id))) return null;
  const db = getDb();
  const [row] = await db
    .select({
      s: formSubmissions,
      key: formDefinitions.key,
      name: formDefinitions.name,
      caseNumber: procurementCases.caseNumber,
      filerEmployeeId: sql<string>`coalesce(${formSubmissions.filedByEmployeeId}, ${procurementCases.createdByEmployeeId})`,
      applicantName: employees.name,
      applicantEmail: employees.googleEmail,
      applicantPhone: employees.phone,
      departmentName: departments.name,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formSubmissions.versionId))
    .innerJoin(procurementCases, eq(procurementCases.id, formSubmissions.procurementCaseId))
    .innerJoin(employees, eq(employees.id, formSubmissions.applicantEmployeeId))
    .innerJoin(departments, eq(departments.id, formSubmissions.departmentId))
    .where(eq(formSubmissions.id, id));
  if (!row) return null;
  const parsed = parseDefinition(row.schema, row.flow);
  if (!parsed.ok) return null;
  const s = row.s;
  const stored = (s.data ?? {}) as Record<string, unknown>;
  const data = canSeeSensitive(actor, { applicantId: s.applicantEmployeeId, filerId: row.filerEmployeeId })
    ? stored
    : maskSensitive(parsed.schema, stored);

  const steps = await db
    .select({ stepOrder: approvalSteps.stepOrder, approverEmployeeId: approvalSteps.approverEmployeeId, status: approvalSteps.status })
    .from(approvalSteps)
    .where(and(eq(approvalSteps.formType, FORM), eq(approvalSteps.formId, id)))
    .orderBy(asc(approvalSteps.stepOrder));
  const current = steps.find((st) => st.stepOrder === s.currentStepOrder);
  const firstHuman = steps.find((st) => st.status !== 'auto_approved' && st.status !== 'skipped');
  const isOwner = s.applicantEmployeeId === actor.id || row.filerEmployeeId === actor.id;
  const canEdit =
    isOwner && s.status === 'pending_approval' && s.currentStepOrder !== null && s.currentStepOrder === firstHuman?.stepOrder;
  const canResubmit = isOwner && s.status === 'returned';
  const [filer] =
    row.filerEmployeeId === s.applicantEmployeeId
      ? [null]
      : await db.select({ name: employees.name }).from(employees).where(eq(employees.id, row.filerEmployeeId));

  return {
    id: s.id,
    key: row.key,
    name: row.name,
    formNumber: s.formNumber,
    caseNumber: row.caseNumber,
    status: s.status,
    version: s.version,
    currentStepOrder: s.currentStepOrder,
    applicantEmployeeId: s.applicantEmployeeId,
    applicantName: row.applicantName,
    applicantEmail: row.applicantEmail,
    applicantPhone: row.applicantPhone,
    departmentName: row.departmentName,
    submittedAt: s.submittedAt,
    schema: parsed.schema,
    data,
    labels: await referenceLabels(allFields(parsed.schema), data),
    options:
      opts.withOptions && (canEdit || canResubmit)
        ? await getPickerOptions(parsed.schema, { definitionId: s.definitionId, applicantId: s.applicantEmployeeId, current: s.sourceSubmissionId })
        : null,
    followUps:
      s.status === 'approved' && s.applicantEmployeeId === actor.id
        ? await followUpsOf(actor, { key: row.key, caseId: s.procurementCaseId, schema: parsed.schema, data: stored })
        : [],
    filerName: filer?.name ?? null,
    isCurrentApprover: s.status === 'pending_approval' && current?.status === 'pending' && current.approverEmployeeId === actor.id,
    canEdit,
    canResubmit,
    isOwner,
    canAttach: await canAttachToForm(actor, FORM, id),
    assetRegister: parsed.schema.assetRegister ? { lines: await assetLinesOf(s.id), appliedAt: s.registerAppliedAt } : null,
  };
}

/** Definition key of a submission the viewer may read (for /f/_/<id> redirects). */
export async function getSubmissionKey(id: string): Promise<string | null> {
  const actor = await getCurrentEmployee();
  if (!actor || !(await canReadForm(actor, FORM, id))) return null;
  const [row] = await getDb()
    .select({ key: formDefinitions.key })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .where(eq(formSubmissions.id, id));
  return row?.key ?? null;
}

export type { TableValue };
