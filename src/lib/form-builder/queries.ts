import { asc, desc, eq, sql } from 'drizzle-orm';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { isUuid } from '@/lib/authz/forms';
import type { FlowDef } from '@/lib/approval/flow/types';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { getPickerOptions, type PickerOptions } from '@/lib/custom-forms/queries';
import type { FormSchema } from '@/lib/custom-forms/schema';
import { parseVisibility, type Visibility } from '@/lib/custom-forms/visibility';
import { getDb } from '@/lib/db';
import {
  departments,
  employeeGroups,
  employees,
  formCategories,
  formDefinitions,
  formDefinitionVersions,
  formSubmissions,
  jobRoles,
  orgLevels,
} from '@/lib/db/schema';
import { FORM_LABELS, type FormType } from '@/lib/procurement/form-registry';
import { taipeiToday } from '@/lib/taipei-date';
import { emptyFlow, emptySchema } from './blank';
import { collectFieldTypes, type PublishedFieldTypes } from './diff';
import { draftProblem } from './draft';

export type BuilderStatus = 'draft' | 'published' | 'archived';

export type BuilderListItem = {
  id: string;
  key: string;
  name: string;
  categoryTitle: string;
  status: BuilderStatus;
  publishedVersion: number | null;
  hasDraft: boolean;
  updatedAt: Date;
  submissionCount: number;
  openCount: number;
};

export type BuilderCategory = { key: string; title: string };

export type BuilderList = { forms: BuilderListItem[]; categories: BuilderCategory[] };

async function requireAdmin() {
  const me = await getCurrentEmployee();
  return me?.role === 'admin' ? me : null;
}

const activeCategories = () =>
  getDb()
    .select({ key: formCategories.key, title: formCategories.title })
    .from(formCategories)
    .where(eq(formCategories.active, true))
    .orderBy(asc(formCategories.sortOrder));

/** Every designer form with its state, or null for non-admins. */
export async function getFormBuilderList(): Promise<BuilderList | null> {
  if (!(await requireAdmin())) return null;
  const db = getDb();
  const [rows, counts, categories] = await Promise.all([
    db
      .select({
        id: formDefinitions.id,
        key: formDefinitions.key,
        name: formDefinitions.name,
        categoryTitle: formCategories.title,
        status: formDefinitions.status,
        publishedVersion: formDefinitionVersions.version,
        draftSchema: formDefinitions.draftSchema,
        draftFlow: formDefinitions.draftFlow,
        updatedAt: formDefinitions.updatedAt,
      })
      .from(formDefinitions)
      .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId))
      .leftJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
      .orderBy(asc(formCategories.sortOrder), asc(formDefinitions.sortOrder), asc(formDefinitions.name)),
    db
      .select({
        definitionId: formSubmissions.definitionId,
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${formSubmissions.status} in ('pending_approval', 'returned'))::int`,
      })
      .from(formSubmissions)
      .groupBy(formSubmissions.definitionId),
    activeCategories(),
  ]);
  return {
    categories,
    forms: rows.map((r) => {
      const c = counts.find((x) => x.definitionId === r.id);
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        categoryTitle: r.categoryTitle,
        status: r.status as BuilderStatus,
        publishedVersion: r.publishedVersion,
        hasDraft: r.draftSchema !== null || r.draftFlow !== null,
        updatedAt: r.updatedAt,
        submissionCount: c?.total ?? 0,
        openCount: c?.open ?? 0,
      };
    }),
  };
}

export type BuilderVersion = { version: number; publishedAt: Date; publishedByName: string; submissionCount: number; current: boolean };

export type BuilderOrg = {
  employees: { id: string; label: string }[];
  departments: { id: string; name: string; levelCode: string | null }[];
  groups: { id: string; name: string }[];
  jobRoles: { code: string; name: string }[];
  levels: { code: string; name: string; rank: number }[];
};

export type DesignerData = {
  id: string;
  rowVersion: number;
  status: BuilderStatus;
  keyEditable: boolean;
  settings: {
    key: string;
    name: string;
    description: string;
    categoryKey: string;
    sortOrder: number;
    numberPrefix: string;
    visibility: Visibility;
  };
  /** Working copy: the draft, else the published version, else an empty form. */
  schema: FormSchema;
  flow: FlowDef;
  hasDraft: boolean;
  /** A stored draft the editor could not load (shown as a warning; starts from the published version). */
  draftUnreadable: boolean;
  published: { version: number; schema: FormSchema; flow: FlowDef } | null;
  publishedTypes: PublishedFieldTypes;
  versions: BuilderVersion[];
  categories: BuilderCategory[];
  org: BuilderOrg;
  /** Choices for every reference field type (preview and simulation). */
  options: PickerOptions;
  today: string;
  currentEmployeeId: string;
  /** Name of the hard-coded form this definition replaces once published (migration batches). */
  replacesLegacy: string | null;
};

const ALL_REFERENCE_TYPES: FormSchema = {
  version: 1,
  sections: [
    {
      id: 'all',
      title: '',
      description: '',
      fields: (['employee', 'department', 'budget_code', 'project', 'supplier'] as const).map((type) => ({
        id: type,
        type,
        label: type,
        help: '',
        required: false,
        width: 4 as const,
        showInHeader: false,
      })),
    },
  ],
};

/** Everything the designer needs for one form, or null (non-admin / missing). */
export async function getDesignerData(id: string): Promise<DesignerData | null> {
  const me = await requireAdmin();
  if (!me || !isUuid(id)) return null;
  const db = getDb();
  const [row] = await db
    .select({ d: formDefinitions, categoryKey: formCategories.key })
    .from(formDefinitions)
    .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId))
    .where(eq(formDefinitions.id, id));
  if (!row) return null;
  const d = row.d;

  const [versionRows, counts, categories, emps, depts, groups, roles, levels, options] = await Promise.all([
    db
      .select({
        id: formDefinitionVersions.id,
        version: formDefinitionVersions.version,
        schema: formDefinitionVersions.schema,
        flow: formDefinitionVersions.flow,
        publishedAt: formDefinitionVersions.publishedAt,
        publishedByName: employees.name,
      })
      .from(formDefinitionVersions)
      .innerJoin(employees, eq(employees.id, formDefinitionVersions.publishedByEmployeeId))
      .where(eq(formDefinitionVersions.definitionId, d.id))
      .orderBy(asc(formDefinitionVersions.version)),
    db
      .select({ versionId: formSubmissions.versionId, n: sql<number>`count(*)::int` })
      .from(formSubmissions)
      .where(eq(formSubmissions.definitionId, d.id))
      .groupBy(formSubmissions.versionId),
    activeCategories(),
    db
      .select({ id: employees.id, name: employees.name, dept: departments.name })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.accessEnabled, true))
      .orderBy(asc(departments.name), asc(employees.name)),
    db
      .select({ id: departments.id, name: departments.name, levelCode: orgLevels.code })
      .from(departments)
      .leftJoin(orgLevels, eq(orgLevels.id, departments.orgLevelId))
      .where(eq(departments.active, true))
      .orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select({ id: employeeGroups.id, name: employeeGroups.name }).from(employeeGroups).where(eq(employeeGroups.active, true)).orderBy(asc(employeeGroups.name)),
    db.select({ code: jobRoles.code, name: jobRoles.name }).from(jobRoles).where(eq(jobRoles.active, true)).orderBy(desc(jobRoles.isSystem), asc(jobRoles.name)),
    db.select({ code: orgLevels.code, name: orgLevels.name, rank: orgLevels.rank }).from(orgLevels).orderBy(desc(orgLevels.rank)),
    getPickerOptions(ALL_REFERENCE_TYPES),
  ]);

  const current = versionRows.find((v) => v.id === d.publishedVersionId);
  const currentParsed = current ? parseDefinition(current.schema, current.flow) : null;
  const published = current && currentParsed?.ok ? { version: current.version, schema: currentParsed.schema, flow: currentParsed.flow } : null;

  const hasDraft = d.draftSchema !== null || d.draftFlow !== null;
  const draftSchema = d.draftSchema ?? published?.schema ?? emptySchema();
  const draftFlow = d.draftFlow ?? published?.flow ?? emptyFlow();
  const draftUnreadable = hasDraft && draftProblem(draftSchema, draftFlow) !== null;
  const visibility = parseVisibility(d.visibility);

  return {
    id: d.id,
    rowVersion: d.version,
    status: d.status as BuilderStatus,
    keyEditable: d.publishedVersionId === null,
    settings: {
      key: d.key,
      name: d.name,
      description: d.description,
      categoryKey: row.categoryKey,
      sortOrder: d.sortOrder,
      numberPrefix: d.numberPrefix,
      visibility: visibility.ok ? visibility.value : {},
    },
    schema: draftUnreadable ? (published?.schema ?? emptySchema()) : (draftSchema as FormSchema),
    flow: draftUnreadable ? (published?.flow ?? emptyFlow()) : (draftFlow as FlowDef),
    hasDraft,
    draftUnreadable,
    published,
    publishedTypes: collectFieldTypes(versionRows.map((v) => v.schema)),
    versions: versionRows
      .map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt,
        publishedByName: v.publishedByName,
        submissionCount: counts.find((c) => c.versionId === v.id)?.n ?? 0,
        current: v.id === d.publishedVersionId,
      }))
      .reverse(),
    categories,
    org: {
      employees: emps.map((e) => ({ id: e.id, label: `${e.name}（${e.dept}）` })),
      departments: depts,
      groups,
      jobRoles: roles,
      levels,
    },
    options,
    today: taipeiToday(),
    currentEmployeeId: me.id,
    replacesLegacy: d.legacyFormType ? (FORM_LABELS[d.legacyFormType as FormType] ?? d.legacyFormType) : null,
  };
}

/** Other forms a new one can start from (working copy is copied). */
export async function getCopySources(): Promise<{ id: string; name: string }[]> {
  if (!(await requireAdmin())) return [];
  return getDb().select({ id: formDefinitions.id, name: formDefinitions.name }).from(formDefinitions).orderBy(asc(formDefinitions.name));
}