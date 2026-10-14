import { and, eq, ne } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { formCategories, formDefinitions } from '@/lib/db/schema';
import { abort, type Tx } from '@/lib/workflow/tx';
import { parseDefinition } from '../definition';
import { publishDefinition } from '../publish';
import type { MigratedForm } from './types';

/**
 * Installs one migrated form. 'draft' creates the definition unpublished
 * (users see no change until an admin checks it in the designer and
 * publishes, which retires the hard-coded form); 'publish' switches at once
 * (local seed, tests). Never touches a definition that already exists, so
 * reruns are safe and edits made in the designer are kept.
 */
export type InstallMode = 'draft' | 'publish';
export type InstallOutcome = { key: string; outcome: 'drafted' | 'published' | 'skipped'; note: string };

export async function installMigratedForm(tx: Tx, form: MigratedForm, actorId: string, mode: InstallMode): Promise<InstallOutcome> {
  const parsed = parseDefinition(form.schema, form.flow);
  if (!parsed.ok) abort('validation', `${form.key}：${parsed.errors.slice(0, 3).join('；')}`);

  const [claimed] = await tx
    .select({ key: formDefinitions.key })
    .from(formDefinitions)
    .where(and(eq(formDefinitions.legacyFormType, form.legacyFormType), ne(formDefinitions.key, form.key)));
  if (claimed) return { key: form.key, outcome: 'skipped', note: `表單 ${claimed.key} 已標示取代 ${form.legacyFormType}` };

  const [existing] = await tx
    .select({ status: formDefinitions.status, legacyFormType: formDefinitions.legacyFormType })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, form.key))
    .for('update');
  if (existing) {
    if (existing.legacyFormType !== form.legacyFormType) return { key: form.key, outcome: 'skipped', note: '表單代號已被其他表單使用' };
    return {
      key: form.key,
      outcome: 'skipped',
      note: existing.status === 'published' ? '已發佈（已切換）' : '已有草稿；請在表單設計器檢查後發佈',
    };
  }

  if (mode === 'publish') {
    const r = await publishDefinition(tx, { ...form, actorId });
    return { key: form.key, outcome: 'published', note: `v${r.version}` };
  }

  const [category] = await tx
    .select({ id: formCategories.id })
    .from(formCategories)
    .where(and(eq(formCategories.key, form.categoryKey), eq(formCategories.active, true)));
  if (!category) abort('validation', `${form.key}：入口分類 ${form.categoryKey} 不存在或已停用`);
  const [row] = await tx
    .insert(formDefinitions)
    .values({
      key: form.key,
      name: form.name,
      description: form.description,
      categoryId: category!.id,
      sortOrder: form.sortOrder,
      numberPrefix: form.numberPrefix,
      status: 'draft',
      draftSchema: parsed.schema,
      draftFlow: parsed.flow,
      legacyFormType: form.legacyFormType,
      createdByEmployeeId: actorId,
    })
    .returning({ id: formDefinitions.id });
  await recordAudit(tx, {
    actorEmployeeId: actorId,
    action: 'form_definition.created',
    entityType: 'form_definition',
    entityId: row.id,
    details: { key: form.key, migratedFrom: form.legacyFormType },
  });
  return { key: form.key, outcome: 'drafted', note: '草稿已建立' };
}
