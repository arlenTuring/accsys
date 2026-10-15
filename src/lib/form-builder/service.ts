import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { sanitizeSimFields, simulationInputs } from '@/lib/admin/org/sim-inputs';
import { simulateFlow, type Simulation } from '@/lib/approval/flow/simulate';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { publishDefinition } from '@/lib/custom-forms/publish';
import { parseVisibility } from '@/lib/custom-forms/visibility';
import {
  departments,
  employees,
  formCategories,
  formDefinitions,
  formDefinitionVersions,
  formNumberCounters,
  formSubmissions,
  jobRoles,
} from '@/lib/db/schema';
import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isIsoDate } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';
import { abort, runInTransaction, type ErrorCode, type Tx } from '@/lib/workflow/tx';
import { CATEGORY_LIMITS, copyKey, copyName, copyPrefix, emptyFlow, emptySchema, uniqueId } from './blank';
import { collectFieldTypes, fieldTypeConflicts } from './diff';
import { draftProblem, sourceFormKeys } from './draft';
import { parseSettings, type DefinitionSettings } from './settings';

/**
 * The form designer (/admin/form-builder): drafts, settings, publishing and
 * archiving of designer forms. Admin only, with a login in the last hour for
 * changes. Every change locks the definition row and checks the version the
 * editor loaded, so two admins cannot silently overwrite each other; all of
 * it is audited. Published versions stay immutable (database trigger); they
 * are deleted only together with a form nobody ever filled in.
 */

export type BuilderActor = { id: string; role: string; authenticatedAt: Date } | null;
export type BuilderFailure = { ok: false; code: ErrorCode | 'reauth_required' | 'rate_limited'; error: string };
export type BuilderResult<T extends object = object> = ({ ok: true } & T) | BuilderFailure;

export const BUILDER_RECENT_AUTH_MS = 60 * 60_000;

async function guard(actor: BuilderActor, requireRecentLogin = true): Promise<BuilderFailure | null> {
  if (!actor || actor.role !== 'admin') return { ok: false, code: 'forbidden', error: '只有系統管理員可以使用表單設計器' };
  if (requireRecentLogin && Date.now() - actor.authenticatedAt.getTime() > BUILDER_RECENT_AUTH_MS) {
    return { ok: false, code: 'reauth_required', error: '修改表單需要 1 小時內登入過，請重新登入後再試' };
  }
  const limit = await hitRateLimit(`form-builder:${actor.id}`, RATE_LIMITS.formBuilderActionPerEmployee);
  return limit.allowed ? null : { ok: false, code: 'rate_limited', error: '操作過於頻繁，請稍後再試' };
}

async function assertAdmin(tx: Tx, actorId: string) {
  const [me] = await tx.select({ role: employees.role, active: employees.accessEnabled }).from(employees).where(eq(employees.id, actorId));
  if (me?.role !== 'admin' || !me.active) abort('forbidden', '只有系統管理員可以使用表單設計器');
}

async function run<T extends object>(actor: BuilderActor, label: string, work: (tx: Tx, actorId: string) => Promise<T>): Promise<BuilderResult<T>> {
  const denied = await guard(actor);
  if (denied) return denied;
  return runInTransaction(`form_builder.${label}`, async (tx) => {
    await assertAdmin(tx, actor!.id);
    return { ok: true as const, ...(await work(tx, actor!.id)) };
  });
}

const audit = (tx: Tx, actorId: string, action: string, entityId: string, details: Record<string, unknown>) =>
  recordAudit(tx, { actorEmployeeId: actorId, action, entityType: 'form_definition', entityId, details });

type DefinitionRow = typeof formDefinitions.$inferSelect;

/** Locks the definition and checks it is still the version the editor loaded. */
async function lockDefinition(tx: Tx, id: unknown, expectedVersion: unknown): Promise<DefinitionRow> {
  if (!isUuid(id)) abort('not_found', '找不到這張表單');
  const [row] = await tx
    .select()
    .from(formDefinitions)
    .where(eq(formDefinitions.id, id as string))
    .for('update');
  if (!row || row.deletedAt) abort('not_found', '找不到這張表單');
  if (expectedVersion !== row!.version) abort('conflict', '這張表單剛被修改過（可能是其他管理員），請重新整理後再試');
  return row!;
}

function needSettings(raw: unknown): DefinitionSettings {
  const parsed = parseSettings(raw);
  if (!parsed.ok) abort('validation', parsed.error);
  return (parsed as Extract<typeof parsed, { ok: true }>).value;
}

async function categoryId(tx: Tx, key: string): Promise<string> {
  const [c] = await tx
    .select({ id: formCategories.id })
    .from(formCategories)
    .where(and(eq(formCategories.key, key), eq(formCategories.active, true)));
  if (!c) abort('validation', '入口分類不存在或已停用');
  return c!.id;
}

/** Departments and job roles a visibility rule names must exist and be active. */
async function assertVisibilityRefs(tx: Tx, s: DefinitionSettings) {
  const depts = s.visibility.departmentIds ?? [];
  if (depts.length > 0) {
    const found = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(inArray(departments.id, depts), eq(departments.active, true)));
    if (found.length !== depts.length) abort('validation', '可見範圍中的部門不存在或已停用');
  }
  const roles = s.visibility.jobRoles ?? [];
  if (roles.length > 0) {
    const found = await tx
      .select({ code: jobRoles.code })
      .from(jobRoles)
      .where(and(inArray(jobRoles.code, roles), eq(jobRoles.active, true)));
    if (found.length !== roles.length) abort('validation', '可見範圍中的職務類別不存在或已停用');
  }
}

async function assertKeyFree(tx: Tx, key: string, exceptId: string | null) {
  const [clash] = await tx.select({ id: formDefinitions.id, deletedAt: formDefinitions.deletedAt }).from(formDefinitions).where(eq(formDefinitions.key, key));
  if (clash && clash.id !== exceptId) {
    abort('conflict', clash.deletedAt ? '表單代號屬於已刪除的表單（舊單據仍使用），請換一個' : '表單代號已被使用，請換一個');
  }
}

/** Form numbers are unique across all forms (each counts its own serial), so two forms cannot share a prefix. */
const lockPrefixes = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('accsys.form_definitions.number_prefix'))`);

async function assertPrefixFree(tx: Tx, prefix: string, exceptId: string | null) {
  await lockPrefixes(tx);
  const [clash] = await tx
    .select({ name: formDefinitions.name, deletedAt: formDefinitions.deletedAt })
    .from(formDefinitions)
    .where(exceptId ? and(eq(formDefinitions.numberPrefix, prefix), ne(formDefinitions.id, exceptId)) : eq(formDefinitions.numberPrefix, prefix))
    .limit(1);
  if (clash) abort('conflict', `表單編號字首 ${prefix} 已被「${clash.name}」${clash.deletedAt ? '（已刪除）' : ''}使用，請換一個，以免單號重複`);
}

async function publishedVersion(tx: Tx, row: DefinitionRow) {
  if (!row.publishedVersionId) return null;
  const [v] = await tx
    .select({ schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
    .from(formDefinitionVersions)
    .where(eq(formDefinitionVersions.id, row.publishedVersionId));
  return v ?? null;
}

const settingsOf = (row: DefinitionRow, categoryKey: string) => ({
  key: row.key,
  name: row.name,
  description: row.description,
  categoryKey,
  sortOrder: row.sortOrder,
  numberPrefix: row.numberPrefix,
  visibility: row.visibility,
});

// ---------------------------------------------------------------------------

/** A new draft form, empty or copied from another form's working copy. */
export function createDefinition(actor: BuilderActor, raw: unknown) {
  return run(actor, 'create', async (tx, actorId) => {
    const s = needSettings(raw);
    await assertKeyFree(tx, s.key, null);
    await assertPrefixFree(tx, s.numberPrefix, null);
    const catId = await categoryId(tx, s.categoryKey);
    await assertVisibilityRefs(tx, s);
    let schema: unknown = emptySchema();
    let flow: unknown = emptyFlow();
    const copyFrom = (raw as { copyFrom?: unknown } | null)?.copyFrom;
    if (copyFrom !== undefined && copyFrom !== null && copyFrom !== '') {
      if (!isUuid(copyFrom)) abort('validation', '要複製的表單不存在');
      const [src] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, copyFrom as string));
      if (!src || src.deletedAt) abort('validation', '要複製的表單不存在');
      const published = await publishedVersion(tx, src!);
      schema = src!.draftSchema ?? published?.schema ?? schema;
      flow = src!.draftFlow ?? published?.flow ?? flow;
    }
    const [row] = await tx
      .insert(formDefinitions)
      .values({
        key: s.key,
        name: s.name,
        description: s.description,
        categoryId: catId,
        sortOrder: s.sortOrder,
        numberPrefix: s.numberPrefix,
        visibility: s.visibility,
        status: 'draft',
        draftSchema: schema,
        draftFlow: flow,
        createdByEmployeeId: actorId,
      })
      .returning({ id: formDefinitions.id });
    await audit(tx, actorId, 'form_definition.created', row.id, { ...s, copyFrom: copyFrom ?? null });
    return { id: row.id };
  });
}

/**
 * A draft copy of a form: same working copy (draft, else published version)
 * and settings, named 「…（複製）」. Key and number prefix must be unique, so
 * they get a suffix; it does not replace any hard-coded form.
 */
export function duplicateDefinition(actor: BuilderActor, id: unknown) {
  return run(actor, 'duplicate', async (tx, actorId) => {
    if (!isUuid(id)) abort('not_found', '找不到這張表單');
    const [src] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, id as string));
    if (!src || src.deletedAt) abort('not_found', '找不到這張表單');
    const published = await publishedVersion(tx, src!);
    await lockPrefixes(tx);
    const taken = await tx.select({ key: formDefinitions.key, prefix: formDefinitions.numberPrefix }).from(formDefinitions);
    const values = {
      key: copyKey(src!.key, taken.map((t) => t.key)),
      name: copyName(src!.name),
      description: src!.description,
      categoryId: src!.categoryId,
      sortOrder: src!.sortOrder,
      numberPrefix: copyPrefix(src!.numberPrefix, taken.map((t) => t.prefix)),
      visibility: src!.visibility,
    };
    const [row] = await tx
      .insert(formDefinitions)
      .values({
        ...values,
        status: 'draft',
        draftSchema: src!.draftSchema ?? published?.schema ?? emptySchema(),
        draftFlow: src!.draftFlow ?? published?.flow ?? emptyFlow(),
        createdByEmployeeId: actorId,
      })
      .returning({ id: formDefinitions.id });
    await audit(tx, actorId, 'form_definition.created', row.id, { key: values.key, name: values.name, numberPrefix: values.numberPrefix, copyFrom: src!.id });
    return { id: row.id, name: values.name, key: values.key, numberPrefix: values.numberPrefix };
  });
}

/** Stores the work in progress (incomplete drafts are fine; publishing checks everything). */
export function saveDraft(actor: BuilderActor, id: unknown, raw: unknown, expectedVersion: unknown) {
  return run(actor, 'draft.save', async (tx, actorId) => {
    const row = await lockDefinition(tx, id, expectedVersion);
    const r = (raw ?? {}) as { schema?: unknown; flow?: unknown };
    const problem = draftProblem(r.schema, r.flow);
    if (problem) abort('validation', problem);
    const [updated] = await tx
      .update(formDefinitions)
      .set({ draftSchema: r.schema, draftFlow: r.flow, updatedAt: sql`now()`, version: sql`${formDefinitions.version} + 1` })
      .where(eq(formDefinitions.id, row.id))
      .returning({ version: formDefinitions.version });
    await audit(tx, actorId, 'form_definition.draft_saved', row.id, { key: row.key });
    return { version: updated.version };
  });
}

/** Drops the draft; the editor goes back to the published version. */
export function discardDraft(actor: BuilderActor, id: unknown, expectedVersion: unknown) {
  return run(actor, 'draft.discard', async (tx, actorId) => {
    const row = await lockDefinition(tx, id, expectedVersion);
    if (!row.publishedVersionId) abort('validation', '尚未發佈過的表單沒有可以回復的版本');
    const [updated] = await tx
      .update(formDefinitions)
      .set({ draftSchema: null, draftFlow: null, updatedAt: sql`now()`, version: sql`${formDefinitions.version} + 1` })
      .where(eq(formDefinitions.id, row.id))
      .returning({ version: formDefinitions.version });
    await audit(tx, actorId, 'form_definition.draft_discarded', row.id, { key: row.key });
    return { version: updated.version };
  });
}

/**
 * Name, menu placement, numbering and visibility apply at once (also to a
 * published form). The key can change only until the first publish.
 */
export function saveSettings(actor: BuilderActor, id: unknown, raw: unknown, expectedVersion: unknown) {
  return run(actor, 'settings.save', async (tx, actorId) => {
    const row = await lockDefinition(tx, id, expectedVersion);
    const [cat] = await tx.select({ key: formCategories.key }).from(formCategories).where(eq(formCategories.id, row.categoryId));
    const before = settingsOf(row, cat?.key ?? '');
    const rawKey = (raw as { key?: unknown } | null)?.key;
    if (row.publishedVersionId && rawKey !== undefined && rawKey !== row.key) abort('validation', '表單發佈後代號不能修改（連結與通知都使用代號）');
    const s = needSettings({ ...(raw as object), key: row.publishedVersionId ? row.key : rawKey });
    if (s.key !== row.key) await assertKeyFree(tx, s.key, row.id);
    if (s.numberPrefix !== row.numberPrefix) await assertPrefixFree(tx, s.numberPrefix, row.id);
    const catId = s.categoryKey === before.categoryKey ? row.categoryId : await categoryId(tx, s.categoryKey);
    await assertVisibilityRefs(tx, s);
    const [updated] = await tx
      .update(formDefinitions)
      .set({
        key: s.key,
        name: s.name,
        description: s.description,
        categoryId: catId,
        sortOrder: s.sortOrder,
        numberPrefix: s.numberPrefix,
        visibility: s.visibility,
        updatedAt: sql`now()`,
        version: sql`${formDefinitions.version} + 1`,
      })
      .where(eq(formDefinitions.id, row.id))
      .returning({ version: formDefinitions.version });
    await audit(tx, actorId, 'form_definition.settings_updated', row.id, { before, after: s });
    return { version: updated.version };
  });
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * A new menu category for designer forms. It shows in the menus once a
 * published form uses it; the key is generated (titles are free text).
 */
export function createCategory(actor: BuilderActor, raw: unknown) {
  return run(actor, 'category.create', async (tx, actorId) => {
    const r = (raw ?? {}) as { title?: unknown; description?: unknown };
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    if (!title || title.length > CATEGORY_LIMITS.title || CONTROL_CHARS.test(title)) abort('validation', `分類名稱需為 1–${CATEGORY_LIMITS.title} 字`);
    if (description.length > CATEGORY_LIMITS.description || CONTROL_CHARS.test(description)) abort('validation', `分類說明最多 ${CATEGORY_LIMITS.description} 字`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('accsys.form_categories'))`);
    const all = await tx.select({ key: formCategories.key, title: formCategories.title, sortOrder: formCategories.sortOrder, active: formCategories.active }).from(formCategories);
    if (all.some((c) => c.active && c.title === title)) abort('conflict', '已有同名的入口分類');
    const key = uniqueId('custom_', all.map((c) => c.key));
    const sortOrder = Math.max(0, ...all.map((c) => c.sortOrder)) + 10;
    const [row] = await tx.insert(formCategories).values({ key, title, description, sortOrder }).returning({ id: formCategories.id });
    await recordAudit(tx, { actorEmployeeId: actorId, action: 'form_category.created', entityType: 'form_category', entityId: row.id, details: { key, title } });
    return { category: { key, title } };
  });
}

/** Publishes the draft as a new immutable version (all checks of publishDefinition, plus stable field types). */
export function publishDraft(actor: BuilderActor, id: unknown, expectedVersion: unknown) {
  return run(actor, 'publish', async (tx, actorId) => {
    const row = await lockDefinition(tx, id, expectedVersion);
    if (row.draftSchema === null && row.draftFlow === null) abort('conflict', '沒有尚未發佈的變更');
    const current = await publishedVersion(tx, row);
    const parsed = parseDefinition(row.draftSchema ?? current?.schema, row.draftFlow ?? current?.flow);
    if (!parsed.ok) abort('validation', `還有 ${parsed.errors.length} 個問題需要修正：${parsed.errors.slice(0, 3).join('；')}`);
    const { schema, flow } = parsed as Extract<typeof parsed, { ok: true }>;

    const history = await tx
      .select({ schema: formDefinitionVersions.schema })
      .from(formDefinitionVersions)
      .where(eq(formDefinitionVersions.definitionId, row.id))
      .orderBy(asc(formDefinitionVersions.version));
    const conflicts = fieldTypeConflicts(schema, collectFieldTypes(history.map((h) => h.schema)));
    if (conflicts.length > 0) abort('validation', conflicts[0]);

    const [cat] = await tx.select({ key: formCategories.key }).from(formCategories).where(eq(formCategories.id, row.categoryId));
    const visibility = parseVisibility(row.visibility);
    const published = await publishDefinition(tx, {
      ...settingsOf(row, cat?.key ?? ''),
      visibility: visibility.ok ? visibility.value : {},
      schema,
      flow,
      actorId,
    });
    const [updated] = await tx
      .update(formDefinitions)
      .set({ draftSchema: null, draftFlow: null })
      .where(eq(formDefinitions.id, row.id))
      .returning({ version: formDefinitions.version });
    return { published: published.version, version: updated.version };
  });
}

/** Archived forms leave the menus; open submissions keep being approved, edited and resubmitted. */
export function setArchived(actor: BuilderActor, id: unknown, archived: boolean, expectedVersion: unknown) {
  return run(actor, archived ? 'archive' : 'unarchive', async (tx, actorId) => {
    const row = await lockDefinition(tx, id, expectedVersion);
    if (archived && row.status !== 'published') abort('conflict', '只有已發佈的表單可以暫停');
    if (!archived && (row.status !== 'archived' || !row.publishedVersionId)) abort('conflict', '只有已暫停的表單可以重新發佈');
    const [updated] = await tx
      .update(formDefinitions)
      .set({ status: archived ? 'archived' : 'published', updatedAt: sql`now()`, version: sql`${formDefinitions.version} + 1` })
      .where(eq(formDefinitions.id, row.id))
      .returning({ version: formDefinitions.version });
    await audit(tx, actorId, archived ? 'form_definition.archived' : 'form_definition.unarchived', row.id, { key: row.key });
    return { version: updated.version };
  });
}

/** Names of other forms whose draft or published 關聯單據 names this key. */
async function sourceUsers(tx: Tx, row: DefinitionRow): Promise<string[]> {
  const others = await tx
    .select({ name: formDefinitions.name, draft: formDefinitions.draftSchema, published: formDefinitionVersions.schema })
    .from(formDefinitions)
    .leftJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
    .where(and(ne(formDefinitions.id, row.id), isNull(formDefinitions.deletedAt)));
  return others.filter((o) => sourceFormKeys(o.draft).includes(row.key) || sourceFormKeys(o.published).includes(row.key)).map((o) => o.name);
}

/**
 * Deletes a form from the designer. One nobody depends on (never filled in,
 * not replacing a hard-coded form, no other form's 關聯單據 source) is removed
 * with its versions. Otherwise its submissions need it (shown and validated
 * against their version; the database refuses removal), so a paused form is
 * hidden instead: gone from the designer and menus, kept for those records.
 */
export function deleteDefinition(actor: BuilderActor, id: unknown, expectedVersion: unknown) {
  return run(actor, 'delete', async (tx, actorId) => {
    const row = await lockDefinition(tx, id, expectedVersion);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(formSubmissions)
      .where(eq(formSubmissions.definitionId, row.id));
    const users = row.publishedVersionId ? await sourceUsers(tx, row) : [];
    const needed = [
      n > 0 ? `已有 ${n} 張單據` : null,
      row.legacyFormType && row.publishedVersionId ? '已取代舊版系統表單' : null,
      users.length > 0 ? `是「${users.join('」、「')}」的關聯單據來源` : null,
    ].filter((r): r is string => r !== null);

    if (needed.length > 0) {
      if (row.status !== 'archived') abort('conflict', `這張表單${needed.join('、')}，請先暫停再刪除`);
      await tx
        .update(formDefinitions)
        .set({ deletedAt: sql`now()`, deletedByEmployeeId: actorId, updatedAt: sql`now()`, version: sql`${formDefinitions.version} + 1` })
        .where(eq(formDefinitions.id, row.id));
      await audit(tx, actorId, 'form_definition.deleted', row.id, { key: row.key, name: row.name, mode: 'hidden', submissions: n, reasons: needed });
      return { hidden: true };
    }

    if (row.publishedVersionId) {
      await tx.update(formDefinitions).set({ publishedVersionId: null, status: 'draft' }).where(eq(formDefinitions.id, row.id));
    }
    const versions = await tx
      .delete(formDefinitionVersions)
      .where(eq(formDefinitionVersions.definitionId, row.id))
      .returning({ version: formDefinitionVersions.version });
    await tx.delete(formNumberCounters).where(eq(formNumberCounters.definitionId, row.id));
    await tx.delete(formDefinitions).where(eq(formDefinitions.id, row.id));
    await audit(tx, actorId, 'form_definition.deleted', row.id, { key: row.key, name: row.name, mode: 'removed', status: row.status, versions: versions.length });
    return { hidden: false };
  });
}

/** Who would sign the editor's current (unsaved) definition. Read-only; needs no recent login. */
export async function simulateDraft(actor: BuilderActor, raw: unknown): Promise<BuilderResult<{ simulation: Simulation }>> {
  const denied = await guard(actor, false);
  if (denied) return denied;
  const r = (raw ?? {}) as Record<string, unknown>;
  return runInTransaction('form_builder.simulate', async (tx) => {
    await tx.execute(sql`set transaction read only`);
    await assertAdmin(tx, actor!.id);
    if (draftProblem(r.schema, r.flow)) abort('validation', '表單內容格式不正確');
    const parsed = parseDefinition(r.schema, r.flow);
    if (!parsed.ok) abort('validation', `請先修正表單問題：${parsed.errors[0]}`);
    const { schema, flow } = parsed as Extract<typeof parsed, { ok: true }>;
    if (!isUuid(r.applicantId)) abort('validation', '請選擇模擬申請人');
    const today = r.date === undefined || r.date === '' ? taipeiToday() : r.date;
    if (!isIsoDate(today)) abort('validation', '日期格式不正確');
    const key = typeof r.key === 'string' && r.key.length <= 40 ? r.key : null;
    const [applicant] = await tx
      .select({ id: employees.id, departmentId: employees.departmentId })
      .from(employees)
      .where(and(eq(employees.id, r.applicantId as string), eq(employees.accessEnabled, true)));
    if (!applicant) abort('validation', '申請人不存在或已停用');
    const simulation = await simulateFlow(tx, flow, {
      applicantEmployeeId: applicant!.id,
      filerEmployeeId: applicant!.id,
      departmentId: applicant!.departmentId,
      formKey: key,
      today: today as string,
      fields: sanitizeSimFields(simulationInputs(schema, flow), r.fields),
    });
    return { ok: true as const, simulation };
  });
}
