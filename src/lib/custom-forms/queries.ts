import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canAttachToForm, canReadForm, isFinanceOrAdmin, isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { ACTIVE_ASSET_STATUSES, ASSET_STATUS_LABELS, type AssetStatus } from '@/lib/asset-transfers/constants';
import {
  approvalSteps,
  assets,
  attachments,
  budgetCodes,
  departments,
  employeeJobRoles,
  employees,
  formCategories,
  formDefinitions,
  formDefinitionVersions,
  formNumberCounters,
  formSubmissionAssetLines,
  formSubmissions,
  jobRoles,
  notifications,
  procurementCases,
  projects,
  suppliers,
} from '@/lib/db/schema';
import { designerPaymentTermsCheck, type PaymentTermsCheck } from '@/lib/procurement/designer-forms';
import {
  ACCEPTANCE_FORM,
  ACCEPTANCE_KEY,
  PROCUREMENT_PAYMENT_FORM,
  PROCUREMENT_PAYMENT_KEY,
  PURCHASE_ORDER_FORM,
  PURCHASE_ORDER_KEY,
  PURCHASE_REQUEST_FORM,
  PURCHASE_REQUEST_KEY,
  STANDALONE_PAYMENT_FORM,
  STANDALONE_PAYMENT_KEY,
} from './migrated/procurement';
import { EXPENSE_CLAIM_FORMS, UNIFIED_EXPENSE_CLAIM_FORM, UNIFIED_EXPENSE_CLAIM_KEY } from './migrated/expense-claims';
import { BUDGET_CHANGE_FORM, BUDGET_CHANGE_KEY, BUDGET_FORMS, BUDGET_REQUEST_FORM, BUDGET_REQUEST_KEY } from './migrated/budget';
import { TRAVEL_EXPENSE_FORM } from './migrated/travel';
import { parseDefinition } from './definition';
import { publishDefinition } from './publish';
import { runInTransaction } from '@/lib/workflow/tx';
import { allFields, sourceFieldOf, type BudgetScope, type FieldDef, type FormSchema } from './schema';
import { canSeeSensitive, maskSensitive } from './sensitive';
import { expectedPaymentDateOf, paymentBatchOf, type PaymentBatch } from './payment';
import { ruleHolds, sourceOptions, type SourceOption } from './source';
import type { TableValue } from './validate';
import { canFile, parseVisibility } from './visibility';
import { projectUsableBy } from '@/lib/projects/access';
import { getEmployeeFilingScope, type EmployeeFilingScope } from '@/lib/filing-agents/queries';
import { listFormDraftsForOwner, type SavedFormDraft } from '@/lib/form-drafts/service';

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

export const LEGACY_SPLIT_EXPENSE_KEYS = new Set([
  ...EXPENSE_CLAIM_FORMS.map((f) => f.key),
  STANDALONE_PAYMENT_KEY,
]);

export const OBSOLETE_PURGED_FORM_KEYS = [
  ...EXPENSE_CLAIM_FORMS.map((f) => f.key),
  STANDALONE_PAYMENT_KEY,
  'admin-purchase',
  'designer-smoke',
] as const;

let obsoleteFormsPurgePromise: Promise<void> | null = null;

/**
 * Permanently deletes obsolete split-expense forms and legacy sample/smoke forms
 * (along with their submissions, drafts, versions, and counters) from PostgreSQL,
 * and aligns sort order between Form Builder and the Form Catalog.
 */
export async function ensureObsoleteFormsPurged(): Promise<void> {
  if (process.env.VITEST) return;
  if (obsoleteFormsPurgePromise) return obsoleteFormsPurgePromise;
  obsoleteFormsPurgePromise = (async () => {
    const db = getDb();
    const existing = await db
      .select({ id: formDefinitions.id, key: formDefinitions.key })
      .from(formDefinitions)
      .where(inArray(formDefinitions.key, [...OBSOLETE_PURGED_FORM_KEYS]));

    await runInTransaction('custom_form.purge_obsolete_definitions', async (tx) => {
      if (existing.length > 0) {
        const defIds = existing.map((d) => d.id);
        const subs = await tx
          .select({ id: formSubmissions.id, procurementCaseId: formSubmissions.procurementCaseId })
          .from(formSubmissions)
          .where(inArray(formSubmissions.definitionId, defIds));
        const subIds = subs.map((s) => s.id);
        const caseIds = [...new Set(subs.map((s) => s.procurementCaseId))];

        await tx.execute(
          sql`delete from form_drafts where form_key in (${sql.join(
            OBSOLETE_PURGED_FORM_KEYS.map((k) => sql`${k}`),
            sql`, `
          )})`
        );

        if (subIds.length > 0) {
          await tx.execute(
            sql`update ai_application_drafts set submission_id = null where submission_id in (${sql.join(
              subIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          );
          await tx.execute(
            sql`update ai_application_drafts set resubmit_of_submission_id = null where resubmit_of_submission_id in (${sql.join(
              subIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          );
          await tx
            .update(formSubmissions)
            .set({ sourceSubmissionId: null })
            .where(inArray(formSubmissions.sourceSubmissionId, subIds));
          await tx
            .delete(approvalSteps)
            .where(and(eq(approvalSteps.formType, FORM), inArray(approvalSteps.formId, subIds)));
          await tx
            .delete(notifications)
            .where(and(eq(notifications.formType, FORM), inArray(notifications.formId, subIds)));
          await tx
            .delete(attachments)
            .where(and(eq(attachments.formType, FORM), inArray(attachments.formId, subIds)));
          await tx
            .delete(formSubmissionAssetLines)
            .where(inArray(formSubmissionAssetLines.submissionId, subIds));
          await tx.delete(formSubmissions).where(inArray(formSubmissions.id, subIds));
        }

        await tx.execute(
          sql`update ai_application_drafts set form_version_id = null where form_definition_key in (${sql.join(
            OBSOLETE_PURGED_FORM_KEYS.map((k) => sql`${k}`),
            sql`, `
          )})`
        );

        await tx
          .update(formDefinitions)
          .set({
            publishedVersionId: null,
            status: 'draft',
            deletedAt: null,
            deletedByEmployeeId: null,
          })
          .where(inArray(formDefinitions.id, defIds));
        await tx
          .delete(formDefinitionVersions)
          .where(inArray(formDefinitionVersions.definitionId, defIds));
        await tx
          .delete(formNumberCounters)
          .where(inArray(formNumberCounters.definitionId, defIds));
        await tx.delete(formDefinitions).where(inArray(formDefinitions.id, defIds));

        if (caseIds.length > 0) {
          await tx.execute(
            sql`delete from procurement_cases pc
                where pc.id in (${sql.join(
                  caseIds.map((id) => sql`${id}`),
                  sql`, `
                )})
                  and not exists (select 1 from form_submissions fs where fs.procurement_case_id = pc.id)
                  and not exists (select 1 from purchase_requests pr where pr.procurement_case_id = pc.id)`
          );
        }
      }

      // Clear stale draft_schema on auto-upgraded system forms and align expense form sort_order
      await tx.execute(
        sql`update form_definitions
            set draft_schema = null, draft_flow = null
            where key in ('expense-claim', 'travel-expense', 'budget-request', 'budget-change')
              and status = 'published'
              and (draft_schema is not null or draft_flow is not null)`
      );
      await tx.execute(sql`update form_definitions set sort_order = 1 where key = 'expense-claim' and sort_order <> 1`);
      await tx.execute(sql`update form_definitions set sort_order = 2 where key = 'travel-expense' and sort_order <> 2`);
      await tx.execute(sql`update form_definitions set sort_order = 3 where key = 'business-trip' and sort_order <> 3`);
      return { ok: true as const };
    }).catch(() => null);
  })().finally(() => {
    obsoleteFormsPurgePromise = null;
  });
  return obsoleteFormsPurgePromise;
}

async function publishUpgradedSchemaVersion(params: {
  definitionId: string;
  actorId: string;
  schema: FormSchema;
  flow: unknown;
  description?: string;
}): Promise<void> {
  await runInTransaction('custom_form.upgrade_schema_version', async (tx) => {
    const [{ next }] = await tx.execute<{ next: number }>(
      sql`select coalesce(max(version), 0) + 1 as next from form_definition_versions where definition_id = ${params.definitionId}`
    );
    const version = Number(next);
    const [ver] = await tx
      .insert(formDefinitionVersions)
      .values({
        definitionId: params.definitionId,
        version,
        schema: params.schema,
        flow: params.flow,
        publishedByEmployeeId: params.actorId,
      })
      .returning({ id: formDefinitionVersions.id });
    await tx
      .update(formDefinitions)
      .set({
        draftSchema: null,
        draftFlow: null,
        publishedVersionId: ver.id,
        ...(params.description !== undefined ? { description: params.description } : {}),
        updatedAt: sql`now()`,
        version: sql`${formDefinitions.version} + 1`,
      })
      .where(eq(formDefinitions.id, params.definitionId));
    return { ok: true as const, versionId: ver.id };
  }).catch(() => null);
}

export async function ensureUnifiedExpenseClaimPublished(actorId: string): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({
      id: formDefinitions.id,
      status: formDefinitions.status,
      description: formDefinitions.description,
      publishedVersionId: formDefinitions.publishedVersionId,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formDefinitions)
    .leftJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
    .where(eq(formDefinitions.key, UNIFIED_EXPENSE_CLAIM_KEY));

  if (!existing || existing.status !== 'published') {
    await runInTransaction('custom_form.ensure_unified_expense', async (tx) => {
      const r = await publishDefinition(tx, { ...UNIFIED_EXPENSE_CLAIM_FORM, actorId });
      return { ok: true as const, ...r };
    }).catch(() => null);
    return;
  }

  const rawSchemaJson = JSON.stringify(existing.schema ?? {});
  const needsUpgrade =
    existing.description !== UNIFIED_EXPENSE_CLAIM_FORM.description ||
    rawSchemaJson.includes('單筆新臺幣30,000元以下') ||
    rawSchemaJson.includes('採購金額 ≤ NT$ 30,000');

  if (needsUpgrade && existing.publishedVersionId) {
    const upgraded = parseDefinition(UNIFIED_EXPENSE_CLAIM_FORM.schema, UNIFIED_EXPENSE_CLAIM_FORM.flow);
    if (upgraded.ok) {
      await publishUpgradedSchemaVersion({
        definitionId: existing.id,
        actorId,
        schema: upgraded.schema,
        flow: existing.flow ?? upgraded.flow,
        description: UNIFIED_EXPENSE_CLAIM_FORM.description,
      });
    }
  }
}

export async function ensureBudgetFormsPublished(actorId: string): Promise<void> {
  const db = getDb();
  for (const form of BUDGET_FORMS) {
    const [existing] = await db
      .select({
        id: formDefinitions.id,
        status: formDefinitions.status,
        publishedVersionId: formDefinitions.publishedVersionId,
        schema: formDefinitionVersions.schema,
        flow: formDefinitionVersions.flow,
      })
      .from(formDefinitions)
      .leftJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
      .where(eq(formDefinitions.key, form.key));

    if (!existing || existing.status !== 'published') {
      await runInTransaction(`custom_form.ensure_${form.key}`, async (tx) => {
        const r = await publishDefinition(tx, { ...form, actorId });
        return { ok: true as const, ...r };
      }).catch(() => null);
      continue;
    }

    if (form.key === BUDGET_REQUEST_KEY && existing.publishedVersionId) {
      const check = parseDefinition(existing.schema, form.flow);
      const itemsField = check.ok ? allFields(check.schema).find((f) => f.id === 'items' && f.type === 'table') : undefined;
      const hasRowOriginCol =
        itemsField?.type === 'table' &&
        itemsField.columns.some((c) => c.id === 'm1') &&
        itemsField.columns.some((c) => c.id === 'rowOrigin');
      const hasDeprecatedReasonField =
        check.ok && allFields(check.schema).some((f) => f.id === 'reason');
      if (!hasRowOriginCol || hasDeprecatedReasonField) {
        const upgraded = parseDefinition(BUDGET_REQUEST_FORM.schema, BUDGET_REQUEST_FORM.flow);
        if (upgraded.ok) {
          await publishUpgradedSchemaVersion({
            definitionId: existing.id,
            actorId,
            schema: upgraded.schema,
            flow: existing.flow ?? upgraded.flow,
          });
        }
      }
    }
  }
}

/** Published forms the current employee may file, in menu order. */
export async function getFilableDefinitions(): Promise<FilableDefinition[]> {
  await ensureObsoleteFormsPurged();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { getSystemFeatureFlags } = await import('@/lib/feature-flags/service');
  const { resolveFeatureFlagForFormKey } = await import('@/lib/feature-flags/definitions');
  const [, , featureFlags] = await Promise.all([
    ensureUnifiedExpenseClaimPublished(employee.id),
    ensureBudgetFormsPublished(employee.id),
    getSystemFeatureFlags(),
  ]);
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
  const hasUnifiedExpense = rows.some((r) => r.key === UNIFIED_EXPENSE_CLAIM_KEY);
  const roles = await jobRolesOf(employee.id);
  return rows
    .filter((r) => {
      if (hasUnifiedExpense && LEGACY_SPLIT_EXPENSE_KEYS.has(r.key)) return false;
      // 第一層：全公司系統功能授權硬門檻（若全公司未授權或已關閉該模組，即便是系統管理員亦不可見／不可填寫）
      const requiredFlag = resolveFeatureFlagForFormKey(
        r.key,
        r.key === STANDALONE_PAYMENT_KEY ? 'expense' : r.categoryKey
      );
      if (requiredFlag && !featureFlags[requiredFlag]) return false;
      // 第二層：個人部門與職務角色權限
      const v = parseVisibility(r.visibility);
      return v.ok && canFile(v.value, { departmentId: employee.departmentId, jobRoles: roles });
    })
    .map((r) => {
      if (r.key === STANDALONE_PAYMENT_KEY && r.categoryKey === 'procurement') {
        return {
          key: r.key,
          name: r.name,
          description: r.description,
          categoryKey: 'expense',
          categoryTitle: '費用報支',
          categoryDescription: '差旅與日常費用報支',
          categorySort: 2,
          legacyFormType: r.legacyFormType,
        };
      }
      return {
        key: r.key,
        name: r.name,
        description: r.description,
        categoryKey: r.categoryKey,
        categoryTitle: r.categoryTitle,
        categoryDescription: r.categoryDescription,
        categorySort: r.categorySort,
        legacyFormType: r.legacyFormType,
      };
    });
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
    .where(ids ? inArray(budgetCodes.id, ids) : eq(budgetCodes.active, true))
    .orderBy(asc(budgetCodes.code));
  return rows.map((c) => {
    const groupName = c.project ?? c.department ?? c.code;
    const ownerText = c.owner ?? '未指定預算負責人';
    return {
      id: c.id,
      label: `${groupName}：${ownerText}（${c.category}｜${c.code}）`,
      groupName,
      itemLabel: `${c.category}｜${c.code}（負責人：${ownerText}）`,
      scope: c.departmentId ? 'department' : c.projectKind === 'revenue' ? 'revenue' : 'product',
    };
  });
}

export type BudgetCodeOption = {
  id: string;
  label: string;
  scope: BudgetScope;
  groupName?: string;
  itemLabel?: string;
};

export type HistoricalBudgetSubmissionOption = {
  id: string;
  formNumber: string;
  fiscalYear: string;
  budgetScope: 'department' | 'project';
  targetDepartmentId?: string;
  targetProjectId?: string;
  rows: Record<string, unknown>[];
};

export type PickerOptions = {
  employees: { id: string; label: string }[];
  departments: { id: string; label: string; code?: string; managerEmployeeId?: string | null }[];
  budgetCodes: BudgetCodeOption[];
  projects: { id: string; label: string; code?: string; kind?: string }[];
  /** Names only; bank details never leave the server through the picker. */
  suppliers: { id: string; label: string }[];
  /** Assets still in the register; custodian / location pre-fill the register-linked rows. */
  assets: AssetPickerOption[];
  /** 關聯單據: submissions this form may continue (with the rows each carries over). */
  sources: SourceOption[];
  /** 歷年已填寫之預算申請單明細（供線上預算申請單切換檢視去年填寫資料與科目增減對照） */
  historicalBudgetSubmissions?: HistoricalBudgetSubmissionOption[];
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
      ? db
          .select({ id: departments.id, code: departments.code, name: departments.name, managerEmployeeId: departments.managerEmployeeId })
          .from(departments)
          .where(eq(departments.active, true))
          .orderBy(asc(departments.sortOrder), asc(departments.name))
      : [],
    types.has('budget_code') ? budgetCodeLabels() : [],
    types.has('project')
      ? db
          .select({ id: projects.id, code: projects.code, name: projects.name, kind: projects.kind })
          .from(projects)
          .where(projectUsableBy(sourceCtx?.applicantId))
          .orderBy(asc(projects.code))
      : [],
    types.has('supplier') ? db.select({ id: suppliers.id, label: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)) : [],
    types.has('asset') ? assetOptions() : [],
    link && sourceCtx ? sourceOptions(db, sourceCtx, link, sourceCtx.applicantId, sourceCtx.current ?? undefined) : [],
  ]);
  return {
    employees: emps.map((e) => ({ id: e.id, label: `${e.name}（${e.dept}）` })),
    departments: depts.map((d) => ({ id: d.id, label: `${d.code}｜${d.name}`, code: d.code, managerEmployeeId: d.managerEmployeeId })),
    budgetCodes: codes,
    projects: projs.map((p) => ({
      id: p.id,
      label: p.name && p.name !== p.code && !p.name.startsWith(p.code) ? `${p.code}｜${p.name}` : p.name || p.code,
      code: p.code,
      kind: p.kind,
    })),
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
  filingScope: EmployeeFilingScope;
  savedDrafts: SavedFormDraft[];
};

/** The published version of a form the current employee may file, or null (missing / hidden look the same). */
export async function getNewFormContext(key: string): Promise<NewFormContext | null> {
  const employee = await getCurrentEmployee();
  if (!employee || typeof key !== 'string' || key.length > 40) return null;
  if (key === UNIFIED_EXPENSE_CLAIM_KEY) {
    await ensureUnifiedExpenseClaimPublished(employee.id);
  }
  if (key === BUDGET_REQUEST_KEY || key === BUDGET_CHANGE_KEY) {
    await ensureBudgetFormsPublished(employee.id);
  }
  const db = getDb();
  const [row] = await db
    .select({
      id: formDefinitions.id,
      publishedVersionId: formDefinitions.publishedVersionId,
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
  let rawSchema = row.schema;
  if (key === BUDGET_REQUEST_KEY) {
    const check = parseDefinition(rawSchema, row.flow);
    const hasDeprecatedReasonField = check.ok && allFields(check.schema).some((f) => f.id === 'reason');
    if (hasDeprecatedReasonField) {
      const upgraded = parseDefinition(BUDGET_REQUEST_FORM.schema, row.flow);
      if (upgraded.ok) {
        rawSchema = upgraded.schema;
        if (row.publishedVersionId) {
          await publishUpgradedSchemaVersion({
            definitionId: row.id,
            actorId: employee.id,
            schema: upgraded.schema,
            flow: row.flow,
          });
        }
      }
    }
  }
  if (key === PURCHASE_REQUEST_KEY) {
    const check = parseDefinition(rawSchema, row.flow);
    const itemsField = check.ok ? allFields(check.schema).find((f) => f.id === 'items' && f.type === 'table') : undefined;
    const hasUnitPrice = itemsField?.type === 'table' && itemsField.columns.some((c) => c.id === 'unitPrice');
    if (!hasUnitPrice) {
      const upgraded = parseDefinition(PURCHASE_REQUEST_FORM.schema, row.flow);
      if (upgraded.ok && row.publishedVersionId) {
        rawSchema = upgraded.schema;
        await publishUpgradedSchemaVersion({
          definitionId: row.id,
          actorId: employee.id,
          schema: upgraded.schema,
          flow: row.flow,
        });
      }
    }
  }
  const oneToManyMigratedMap: Record<string, unknown> = {
    [PURCHASE_ORDER_KEY]: PURCHASE_ORDER_FORM.schema,
    [ACCEPTANCE_KEY]: ACCEPTANCE_FORM.schema,
    [PROCUREMENT_PAYMENT_KEY]: PROCUREMENT_PAYMENT_FORM.schema,
  };
  if (key in oneToManyMigratedMap) {
    const check = parseDefinition(rawSchema, row.flow);
    const srcField = check.ok ? sourceFieldOf(check.schema) : undefined;
    const hasAllowMultiple = srcField?.sources.every((s) => s.allowMultiple === true);
    if (!hasAllowMultiple) {
      const upgraded = parseDefinition(oneToManyMigratedMap[key], row.flow);
      if (upgraded.ok && row.publishedVersionId) {
        rawSchema = upgraded.schema;
        await publishUpgradedSchemaVersion({
          definitionId: row.id,
          actorId: employee.id,
          schema: upgraded.schema,
          flow: row.flow,
        });
      }
    }
  }
  const qtyMigratedMap: Record<string, unknown> = {
    [PROCUREMENT_PAYMENT_KEY]: PROCUREMENT_PAYMENT_FORM.schema,
    [STANDALONE_PAYMENT_KEY]: STANDALONE_PAYMENT_FORM.schema,
    ...Object.fromEntries(EXPENSE_CLAIM_FORMS.map((f) => [f.key, f.schema])),
  };
  if (key in qtyMigratedMap) {
    const check = parseDefinition(rawSchema, row.flow);
    const itemsField = check.ok ? allFields(check.schema).find((f) => f.id === 'items' && f.type === 'table') : undefined;
    const hasQuantity = itemsField?.type === 'table' && itemsField.columns.some((c) => c.id === 'quantity');
    if (!hasQuantity) {
      const upgraded = parseDefinition(qtyMigratedMap[key], row.flow);
      if (upgraded.ok && row.publishedVersionId) {
        rawSchema = upgraded.schema;
        await publishUpgradedSchemaVersion({
          definitionId: row.id,
          actorId: employee.id,
          schema: upgraded.schema,
          flow: row.flow,
        });
      }
    }
  }
  if (key === TRAVEL_EXPENSE_FORM.key) {
    const check = parseDefinition(rawSchema, row.flow);
    if (check.ok) {
      const costsField = allFields(check.schema).find((f) => f.id === 'costItems' && f.type === 'table');
      const summaryCol = costsField?.type === 'table' ? costsField.columns.find((c) => c.id === 'summary') : undefined;
      if (summaryCol && summaryCol.label === '摘要') {
        summaryCol.label = '備註說明(起-迄點、油資補助公里數等)';
        rawSchema = check.schema;
        if (row.publishedVersionId) {
          await publishUpgradedSchemaVersion({
            definitionId: row.id,
            actorId: employee.id,
            schema: check.schema,
            flow: row.flow,
          });
        }
      }
    }
  }
  const parsed = parseDefinition(rawSchema, row.flow);
  if (!parsed.ok) return null;
  const [options, filingScope, savedDrafts, histBudgets] = await Promise.all([
    getPickerOptions(parsed.schema, { definitionId: row.id, applicantId: employee.id }),
    getEmployeeFilingScope(employee.id, parsed.schema.onBehalf === true, db),
    listFormDraftsForOwner(employee.id, row.key),
    row.key === BUDGET_REQUEST_KEY
      ? db
          .select({
            id: formSubmissions.id,
            formNumber: formSubmissions.formNumber,
            data: formSubmissions.data,
          })
          .from(formSubmissions)
          .where(
            and(
              eq(formSubmissions.definitionId, row.id),
              eq(formSubmissions.applicantEmployeeId, employee.id)
            )
          )
          .orderBy(desc(formSubmissions.submittedAt))
      : Promise.resolve([]),
  ]);
  if (histBudgets.length > 0) {
    options.historicalBudgetSubmissions = histBudgets.map((h) => {
      const d = (h.data ?? {}) as Record<string, unknown>;
      const itemsObj = (d.items ?? {}) as { rows?: Record<string, unknown>[] };
      return {
        id: h.id,
        formNumber: h.formNumber,
        fiscalYear: String(d.fiscalYear ?? ''),
        budgetScope: d.budgetScope === 'project' ? 'project' : 'department',
        targetDepartmentId: typeof d.targetDepartmentId === 'string' ? d.targetDepartmentId : undefined,
        targetProjectId: typeof d.targetProjectId === 'string' ? d.targetProjectId : undefined,
        rows: Array.isArray(itemsObj.rows) ? itemsObj.rows : [],
      };
    });
  }
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    schema: parsed.schema,
    options,
    currentEmployeeId: employee.id,
    filingScope,
    savedDrafts,
  };
}

export type CloneableSubmissionData = {
  sourceFormNumber: string;
  applicantEmployeeId: string;
  data: Record<string, unknown>;
};

/**
 * Load an existing submission's field data so a user can duplicate ("複製舊單")
 * it into a fresh form without re-typing. Strips finance-filled values.
 */
export async function getCloneableSubmissionData(key: string, copyFromId: string): Promise<CloneableSubmissionData | null> {
  const actor = await getCurrentEmployee();
  if (!actor || !isUuid(copyFromId)) return null;
  if (!(await canReadForm(actor, FORM, copyFromId))) return null;
  const db = getDb();
  const [row] = await db
    .select({
      formNumber: formSubmissions.formNumber,
      applicantEmployeeId: formSubmissions.applicantEmployeeId,
      filedByEmployeeId: formSubmissions.filedByEmployeeId,
      data: formSubmissions.data,
      defKey: formDefinitions.key,
      schema: formDefinitionVersions.schema,
      flow: formDefinitionVersions.flow,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formSubmissions.versionId))
    .where(eq(formSubmissions.id, copyFromId));
  if (!row || row.defKey !== key) return null;
  const parsed = parseDefinition(row.schema, row.flow);
  const raw = ((row.data ?? {}) as Record<string, unknown>);
  const safe =
    parsed.ok && !canSeeSensitive(actor, { applicantId: row.applicantEmployeeId, filerId: row.filedByEmployeeId ?? row.applicantEmployeeId })
      ? maskSensitive(parsed.schema, raw)
      : { ...raw };

  // Strip finance-only columns when cloning into a fresh submission
  if (parsed.ok) {
    for (const f of allFields(parsed.schema)) {
      if (f.type === 'table' && safe[f.id] && typeof safe[f.id] === 'object') {
        const financeCols = new Set(f.columns.filter((c) => c.financeFill).map((c) => c.id));
        if (financeCols.size > 0) {
          const tableVal = safe[f.id] as { rows?: Record<string, unknown>[] };
          if (Array.isArray(tableVal.rows)) {
            safe[f.id] = {
              ...tableVal,
              rows: tableVal.rows.map((r) => {
                const copy = { ...r };
                for (const colId of financeCols) delete copy[colId];
                return copy;
              }),
            };
          }
        }
      }
    }
  }
  return {
    sourceFormNumber: row.formNumber,
    applicantEmployeeId: row.applicantEmployeeId,
    data: safe,
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
  formKey: string;
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
      formKey: formDefinitions.key,
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

export type CaseChainNode = {
  id: string;
  key: string;
  name: string;
  formNumber: string;
  status: string;
  totalAmount: number | null;
  sourceSubmissionId: string | null;
  paymentTerms: string | null;
  submittedAt: Date;
};

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
  /** Finance / admin on an approved submission with 核准後由財會填寫 columns. */
  canFinanceFill: boolean;
  /** Forms with 付款排程 (null otherwise). */
  paymentBatch: PaymentBatch | null;
  /** Forms with 付款排程 in a case with an approved designer 採購單 (null otherwise). */
  paymentTerms: PaymentTermsCheck | null;
  /** Register-linked forms only (null otherwise). */
  assetRegister: { lines: SubmissionAssetLine[]; appliedAt: Date | null } | null;
  /** Forms the applicant may file next from this approved submission (關聯單據). */
  followUps: { key: string; name: string; sourceId?: string }[];
  /** 第 16、17 條：同採購案號下之 1 對多關聯單據鏈與預付／非預付流程進度。 */
  caseChain: CaseChainNode[];
};

/**
 * Published forms the employee may file whose 關聯單據 field accepts this
 * submission (form `key`, rule condition met), supporting 1-to-many
 * (`allowMultiple: true`) and prepayment order (`2.採購單[預付款] → 4.費用申請單 → 3.驗收單`).
 */
async function followUpsOf(
  employee: { id: string; departmentId: string },
  source: { id: string; key: string; caseId: string; sourceSubmissionId: string | null; schema: FormSchema; data: Record<string, unknown> }
): Promise<{ key: string; name: string; sourceId?: string }[]> {
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
      .select({
        id: formSubmissions.id,
        definitionId: formSubmissions.definitionId,
        key: formDefinitions.key,
        status: formSubmissions.status,
        sourceSubmissionId: formSubmissions.sourceSubmissionId,
      })
      .from(formSubmissions)
      .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
      .where(eq(formSubmissions.procurementCaseId, source.caseId)),
  ]);
  const taken = new Set(existing.map((e) => e.definitionId));
  const candidates: { key: string; name: string; visibility: unknown; sourceId?: string }[] = [];

  for (const d of defs) {
    const parsed = parseDefinition(d.schema, d.flow);
    const link = parsed.ok ? sourceFieldOf(parsed.schema) : null;
    if (!link) continue;
    const matchedRule = link.sources.find(
      (r) =>
        r.form === source.key &&
        ruleHolds(r, source.schema, source.data) &&
        !(
          r.unlessCaseHas &&
          existing.some(
            (e) =>
              e.key === r.unlessCaseHas &&
              e.status === 'approved' &&
              (e.sourceSubmissionId === source.id || e.sourceSubmissionId === null)
          )
        )
    );
    if (!matchedRule) continue;
    const allowMultiple =
      matchedRule.allowMultiple === true ||
      d.key === PURCHASE_ORDER_KEY ||
      d.key === ACCEPTANCE_KEY ||
      d.key === PROCUREMENT_PAYMENT_KEY;
    if (!allowMultiple && taken.has(d.id)) continue;
    candidates.push({ key: d.key, name: d.name, visibility: d.visibility });
  }

  // 第 17 條（預付款流程：2.採購單 → 4.費用申請單 → 3.驗收單）：
  // 當一張來自「預付採購單」的 4.費用申請單(採購付款) 核准後，直接提供「接續建立驗收單（預付後補驗收）」按鈕
  if (source.key === PROCUREMENT_PAYMENT_KEY && source.sourceSubmissionId) {
    const parentPo = existing.find((e) => e.id === source.sourceSubmissionId && e.key === PURCHASE_ORDER_KEY);
    const acDef = defs.find((d) => d.key === ACCEPTANCE_KEY);
    if (parentPo && acDef && !candidates.some((c) => c.key === ACCEPTANCE_KEY)) {
      candidates.push({
        key: acDef.key,
        name: `${acDef.name}（預付後補驗收：入庫、貼財編）`,
        visibility: acDef.visibility,
        sourceId: parentPo.id,
      });
    }
  }

  if (candidates.length === 0) return [];
  const roles = await jobRolesOf(employee.id);
  return candidates
    .filter((d) => {
      const v = parseVisibility(d.visibility);
      return v.ok && canFile(v.value, { departmentId: employee.departmentId, jobRoles: roles });
    })
    .map((d) => ({ key: d.key, name: d.name, ...(d.sourceId ? { sourceId: d.sourceId } : {}) }));
}

/** Ids referenced by reference fields and employee / asset table columns, resolved to display names. */
export async function referenceLabels(fields: FieldDef[], data: Record<string, unknown>): Promise<Record<string, string>> {
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
        ? await followUpsOf(actor, {
            id: s.id,
            key: row.key,
            caseId: s.procurementCaseId,
            sourceSubmissionId: s.sourceSubmissionId,
            schema: parsed.schema,
            data: stored,
          })
        : [],
    caseChain: await loadCaseChain(s.procurementCaseId),
    filerName: filer?.name ?? null,
    isCurrentApprover: s.status === 'pending_approval' && current?.status === 'pending' && current.approverEmployeeId === actor.id,
    canEdit,
    canResubmit,
    isOwner,
    canAttach: await canAttachToForm(actor, FORM, id),
    canFinanceFill:
      s.status === 'approved' &&
      isFinanceOrAdmin(actor) &&
      allFields(parsed.schema).some((f) => f.type === 'table' && f.columns.some((c) => c.financeFill)),
    assetRegister: parsed.schema.assetRegister ? { lines: await assetLinesOf(s.id), appliedAt: s.registerAppliedAt } : null,
    paymentBatch: parsed.schema.payment ? paymentBatchOf(stored) : null,
    paymentTerms: parsed.schema.payment
      ? await designerPaymentTermsCheck(s.procurementCaseId, expectedPaymentDateOf(parsed.schema.payment, stored))
      : null,
  };
}

async function loadCaseChain(caseId: string): Promise<CaseChainNode[]> {
  const rows = await getDb()
    .select({
      id: formSubmissions.id,
      key: formDefinitions.key,
      name: formDefinitions.name,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      totalAmount: formSubmissions.totalAmount,
      sourceSubmissionId: formSubmissions.sourceSubmissionId,
      data: formSubmissions.data,
      submittedAt: formSubmissions.submittedAt,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .where(eq(formSubmissions.procurementCaseId, caseId))
    .orderBy(asc(formSubmissions.submittedAt));
  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      formNumber: r.formNumber,
      status: r.status,
      totalAmount: r.totalAmount === null ? null : Number(r.totalAmount),
      sourceSubmissionId: r.sourceSubmissionId,
      paymentTerms: typeof d.paymentTerms === 'string' ? d.paymentTerms : null,
      submittedAt: r.submittedAt,
    };
  });
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
