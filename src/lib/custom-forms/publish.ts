import { and, eq, inArray, sql } from 'drizzle-orm';
import { flowReferences } from '@/lib/approval/flow/references';
import type { FlowDef } from '@/lib/approval/flow/types';
import { recordAudit } from '@/lib/audit/record';
import {
  departments,
  employeeGroups,
  employees,
  formCategories,
  formDefinitions,
  formDefinitionVersions,
  jobRoles,
  orgLevels,
} from '@/lib/db/schema';
import { FORM_KEY, NUMBER_PREFIX } from '@/lib/form-builder/settings';
import { abort, type Tx } from '@/lib/workflow/tx';
import { parseDefinition } from './definition';
import { assertSourceForms } from './source';
import { parseVisibility, type Visibility } from './visibility';

/**
 * Publishes a new immutable version of a form definition (creating the
 * definition on first publish). Callers authorize (admin designer, seed
 * scripts, tests); this checks the definition itself and every employee,
 * department, group, job role and level the flow names against live data.
 */

export type PublishInput = {
  key: string;
  name: string;
  description?: string;
  categoryKey: string;
  numberPrefix: string;
  schema: unknown;
  flow: unknown;
  visibility?: Visibility;
  sortOrder?: number;
  legacyFormType?: string | null;
  actorId: string;
};

const KEY = FORM_KEY;
const PREFIX = NUMBER_PREFIX;

async function assertFlowReferencesExist(tx: Tx, flow: FlowDef) {
  const r = flowReferences(flow);
  const missing = async (ids: Set<string>, query: (list: string[]) => Promise<{ id: string }[]>, what: string) => {
    if (ids.size === 0) return;
    const found = new Set((await query([...ids])).map((x) => x.id));
    if ([...ids].some((id) => !found.has(id))) abort('validation', `簽核流程中的${what}不存在或已停用，請重新選擇`);
  };
  await missing(r.employees, (l) => tx.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, l), eq(employees.accessEnabled, true))), '員工');
  await missing(r.departments, (l) => tx.select({ id: departments.id }).from(departments).where(and(inArray(departments.id, l), eq(departments.active, true))), '部門');
  await missing(r.groups, (l) => tx.select({ id: employeeGroups.id }).from(employeeGroups).where(and(inArray(employeeGroups.id, l), eq(employeeGroups.active, true))), '員工群組');
  await missing(r.roles, (l) => tx.select({ id: jobRoles.code }).from(jobRoles).where(and(inArray(jobRoles.code, l), eq(jobRoles.active, true))), '職務類別');
  await missing(r.levels, (l) => tx.select({ id: orgLevels.code }).from(orgLevels).where(inArray(orgLevels.code, l)), '組織層級');
}

export async function publishDefinition(
  tx: Tx,
  input: PublishInput
): Promise<{ definitionId: string; versionId: string; version: number }> {
  if (typeof input.key !== 'string' || !KEY.test(input.key)) abort('validation', '表單代號需為 2–40 個小寫英數字或連字號，且以英文字母開頭');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 60) abort('validation', '表單名稱需為 1–60 字');
  const description = (input.description ?? '').trim();
  if (description.length > 300) abort('validation', '表單說明最多 300 字');
  if (typeof input.numberPrefix !== 'string' || !PREFIX.test(input.numberPrefix)) {
    abort('validation', '表單編號字首需為 1–6 個大寫英數字，且以英文字母開頭');
  }
  const visibility = parseVisibility(input.visibility ?? {});
  if (!visibility.ok) abort('validation', visibility.error);
  const parsed = parseDefinition(input.schema, input.flow);
  if (!parsed.ok) abort('validation', parsed.errors.slice(0, 5).join('；'));
  const { schema, flow } = parsed as Extract<typeof parsed, { ok: true }>;
  await assertFlowReferencesExist(tx, flow);
  await assertSourceForms(tx, schema);

  const [category] = await tx
    .select({ id: formCategories.id })
    .from(formCategories)
    .where(and(eq(formCategories.key, input.categoryKey), eq(formCategories.active, true)));
  if (!category) abort('validation', '入口分類不存在或已停用');

  const fields = {
    name,
    description,
    categoryId: category!.id,
    numberPrefix: input.numberPrefix,
    visibility: (visibility as Extract<typeof visibility, { ok: true }>).value,
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.legacyFormType !== undefined ? { legacyFormType: input.legacyFormType } : {}),
  };
  // Serializes concurrent publishes of the same key (version numbers stay gapless and unique).
  let [def] = await tx.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, input.key)).for('update');
  if (!def) {
    [def] = await tx
      .insert(formDefinitions)
      .values({ key: input.key, createdByEmployeeId: input.actorId, ...fields })
      .returning({ id: formDefinitions.id });
  }
  const [{ next }] = await tx.execute<{ next: number }>(
    sql`select coalesce(max(version), 0) + 1 as next from form_definition_versions where definition_id = ${def.id}`
  );
  const version = Number(next);
  const [row] = await tx
    .insert(formDefinitionVersions)
    .values({ definitionId: def.id, version, schema, flow, publishedByEmployeeId: input.actorId })
    .returning({ id: formDefinitionVersions.id });
  await tx
    .update(formDefinitions)
    .set({ ...fields, status: 'published', publishedVersionId: row.id, updatedAt: sql`now()`, version: sql`${formDefinitions.version} + 1` })
    .where(eq(formDefinitions.id, def.id));
  await recordAudit(tx, {
    actorEmployeeId: input.actorId,
    action: 'form_definition.published',
    entityType: 'form_definition',
    entityId: def.id,
    details: { key: input.key, version },
  });
  return { definitionId: def.id, versionId: row.id, version };
}
