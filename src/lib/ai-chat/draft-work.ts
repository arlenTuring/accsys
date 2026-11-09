import { and, asc, eq, inArray } from 'drizzle-orm';
import { activateDueScheduled, listVisibleAnnouncements } from '@/lib/announcements/service';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { getPickerOptions, type PickerOptions } from '@/lib/custom-forms/queries';
import { allFields, isDisplayOnly, type FieldDef, type FormSchema } from '@/lib/custom-forms/schema';
import { getDb } from '@/lib/db';
import {
  assets,
  budgetCodes,
  companyAnnouncementReads,
  companySurveyResponses,
  departments,
  employees,
  formCategories,
  formDefinitions,
  formDefinitionVersions,
  projects,
} from '@/lib/db/schema';
import { activateDueSurveys, listSurveysForViewer } from '@/lib/surveys/service';
import { taipeiToday } from '@/lib/taipei-date';
import { recordAudit } from '@/lib/audit/record';
import {
  createApplicationDraft,
  getDraftForOwner,
  isDraftInConversation,
  listConversationDrafts,
  loadDraftFormContext,
  patchApplicationDraft,
  resolvePublishedForm,
  type ApplicationDraft,
} from './drafts';
import { displayValue, draftStatus, planFill, relaxSchema, ROW_ID_KEY, type FillIssue, type FillRequest } from './draft-fill';
import { validateSubmission } from '@/lib/custom-forms/validate';
import { recordProjectUsage } from './projects';

/**
 * Server-side draft operations for the assistant, built on the existing
 * draft table and form schema: create-and-fill, fill, the per-turn work state
 * the model reads instead of its own earlier replies, and the compact field
 * specification. Every result reports what the database now holds.
 */

export type DraftFillResult =
  | {
      ok: true;
      draftId: string;
      formKey: string;
      formName: string;
      version: number;
      created: boolean;
      /** Fields whose stored value changed in this operation, as stored. */
      saved: { field: string; label: string; value: string }[];
      rejected: FillIssue[];
      missing: { field: string; label: string }[];
      invalid: { field: string; label: string; message: string }[];
      readyToSubmit: boolean;
      tables: Record<string, { rows: Record<string, unknown>[]; total: unknown }>;
    }
  | { ok: false; error: string; message: string; draftId?: string; version?: number };

export type FillOptions = {
  /** Test-only fault injection; ignored in production. */
  failWrite?: boolean;
};

function faultRequested(opts?: FillOptions): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return Boolean(opts?.failWrite) || process.env.AI_FAULT_INJECT === 'draft_write';
}

type FormCtx = { schema: FormSchema; picker: PickerOptions; name: string; today: string };

/** Published schema + legal reference choices for a form the employee may file. */
export async function loadFilableForm(formKey: string, ownerEmployeeId: string) {
  const published = await resolvePublishedForm(formKey, ownerEmployeeId);
  if (!published) return null;
  const [ver] = await getDb()
    .select({ schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
    .from(formDefinitionVersions)
    .where(eq(formDefinitionVersions.id, published.versionId))
    .limit(1);
  if (!ver) return null;
  const parsed = parseDefinition(ver.schema, ver.flow);
  if (!parsed.ok) return null;
  const picker = await getPickerOptions(parsed.schema, { definitionId: published.definitionId, applicantId: ownerEmployeeId });
  return { ...published, schema: parsed.schema, picker, today: taipeiToday() };
}

function tablesOf(schema: FormSchema, data: Record<string, unknown>) {
  const out: Record<string, { rows: Record<string, unknown>[]; total: unknown }> = {};
  for (const f of allFields(schema)) {
    if (f.type !== 'table') continue;
    const v = data[f.id] as { rows?: Record<string, unknown>[]; total?: unknown } | undefined;
    out[f.id] = { rows: (v?.rows ?? []).map((r, n) => ({ row_id: typeof r[ROW_ID_KEY] === 'string' ? r[ROW_ID_KEY] : `#${n + 1}`, ...r })), total: v?.total ?? null };
  }
  return out;
}

function report(form: FormCtx, draft: ApplicationDraft, created: boolean, changed: string[], rejected: FillIssue[]): DraftFillResult {
  const fields = new Map(allFields(form.schema).map((f) => [f.id, f]));
  const status = draftStatus(form.schema, draft.data, form.today);
  return {
    ok: true,
    draftId: draft.id,
    formKey: draft.formDefinitionKey,
    formName: form.name,
    version: draft.version,
    created,
    saved: changed.map((id) => ({ field: id, label: fields.get(id)?.label ?? id, value: displayValue(fields.get(id), draft.data[id], form.picker) })),
    rejected,
    missing: status.missing,
    invalid: status.invalid,
    readyToSubmit: status.readyToSubmit,
    tables: tablesOf(form.schema, draft.data),
  };
}

async function usage(ownerEmployeeId: string, schema: FormSchema, data: Record<string, unknown>) {
  for (const f of allFields(schema)) {
    if (f.type !== 'project' || typeof data[f.id] !== 'string') continue;
    try {
      await recordProjectUsage(ownerEmployeeId, data[f.id] as string);
    } catch {
      // best-effort
    }
  }
}

/** Always a new draft (a retry of the same turn returns the same one via the idempotency key). */
export async function createDraftWithFill(input: {
  conversationId: string;
  ownerEmployeeId: string;
  formKey: string;
  request: FillRequest;
  idempotencyKey: string | null;
  options?: FillOptions;
}): Promise<DraftFillResult> {
  const form = await loadFilableForm(input.formKey, input.ownerEmployeeId);
  if (!form) return { ok: false, error: 'form_not_filable', message: '此表單不存在或您不能填寫。' };
  const plan = planFill(form.schema, form.picker, {}, input.request, form.today);
  if (faultRequested(input.options)) return { ok: false, error: 'write_failed', message: '草稿儲存失敗（測試故障注入），沒有建立草稿。' };
  const { draft, created } = await createApplicationDraft({
    conversationId: input.conversationId,
    ownerEmployeeId: input.ownerEmployeeId,
    formDefinitionKey: form.key,
    data: plan.data,
    createIdempotencyKey: input.idempotencyKey,
  });
  if (created) {
    await usage(input.ownerEmployeeId, form.schema, draft.data);
    await recordAudit(getDb(), {
      actorEmployeeId: input.ownerEmployeeId,
      action: 'ai_draft.created',
      entityType: 'ai_application_draft',
      entityId: draft.id,
      details: { by: 'assistant', formKey: form.key, version: draft.version, fields: plan.changed, rejected: plan.rejected.map((r) => r.field) },
    });
  }
  const changed = created ? plan.changed : [];
  return report({ ...form }, draft, created, changed, created ? plan.rejected : []);
}

export async function fillDraft(input: {
  draftId: string;
  ownerEmployeeId: string;
  conversationId: string;
  expectedVersion: number;
  request: FillRequest;
  options?: FillOptions;
}): Promise<DraftFillResult> {
  const ctx = await loadDraftFormContext(input.draftId, input.ownerEmployeeId);
  if (!ctx || !(await isDraftInConversation(input.draftId, input.conversationId, input.ownerEmployeeId))) {
    return { ok: false, error: 'not_found_or_forbidden', message: '找不到這張草稿，或它不屬於本對話（可從草稿庫開啟後再修改）。' };
  }
  if (ctx.draft.status !== 'draft') {
    return { ok: false, error: 'not_editable', message: '這張草稿已送出或已放棄，不能再修改。', draftId: ctx.draft.id, version: ctx.draft.version };
  }
  if (ctx.draft.version !== input.expectedVersion) {
    return {
      ok: false,
      error: 'version_conflict',
      message: `草稿已被更新（目前版本 ${ctx.draft.version}，你用的是 ${input.expectedVersion}）。請依工作狀態中的最新內容重新判斷，不要覆蓋別人剛改的欄位。`,
      draftId: ctx.draft.id,
      version: ctx.draft.version,
    };
  }
  const form: FormCtx = { schema: ctx.schema, picker: ctx.options, name: ctx.name, today: ctx.today };
  const plan = planFill(ctx.schema, ctx.options, ctx.draft.data, input.request, ctx.today);
  if (plan.changed.length === 0) return report(form, ctx.draft, false, [], plan.rejected);
  if (faultRequested(input.options)) {
    return { ok: false, error: 'write_failed', message: '草稿儲存失敗（測試故障注入），草稿維持原版本，未寫入任何欄位。', draftId: ctx.draft.id, version: ctx.draft.version };
  }
  const written = await patchApplicationDraft({
    draftId: ctx.draft.id,
    ownerEmployeeId: input.ownerEmployeeId,
    expectedVersion: input.expectedVersion,
    patch: plan.data,
    replace: true,
  });
  if (!written.ok) {
    return {
      ok: false,
      error: 'version_conflict',
      message: `草稿剛被其他操作更新（目前版本 ${written.conflict.draft.version}），這次沒有寫入。`,
      draftId: ctx.draft.id,
      version: written.conflict.draft.version,
    };
  }
  await usage(input.ownerEmployeeId, ctx.schema, written.draft.data);
  await recordAudit(getDb(), {
    actorEmployeeId: input.ownerEmployeeId,
    action: 'ai_draft.updated',
    entityType: 'ai_application_draft',
    entityId: written.draft.id,
    details: { by: 'assistant', version: written.draft.version, fields: plan.changed, rejected: plan.rejected.map((r) => r.field) },
  });
  return report(form, written.draft, false, plan.changed, plan.rejected);
}

export type PanelSaveResult =
  | { ok: true; draft: ApplicationDraft; mergedFields?: string[] }
  | { ok: false; code: 'validation'; error: string; errors: Record<string, string> }
  | {
      ok: false;
      code: 'conflict';
      error: string;
      draft: ApplicationDraft;
      /** Fields both sides changed differently since the panel loaded. */
      conflicts: { field: string; label: string; mine: unknown; theirs: unknown }[];
    }
  | { ok: false; code: 'version_conflict' | 'not_found' | 'not_editable'; error: string; draft?: ApplicationDraft };

/**
 * Manual save from the draft panel, with the same validation and version
 * control as assistant writes. When the draft moved on since the panel loaded
 * (`baseData` at `expectedVersion`), changes to different fields are merged;
 * the same field changed on both sides is returned as a conflict for the
 * person to decide — never overwritten silently.
 */
export async function saveDraftFromPanel(input: {
  draftId: string;
  ownerEmployeeId: string;
  expectedVersion: number;
  data: Record<string, unknown>;
  baseData?: Record<string, unknown> | null;
}): Promise<PanelSaveResult> {
  const ctx = await loadDraftFormContext(input.draftId, input.ownerEmployeeId);
  if (!ctx) return { ok: false, code: 'not_found', error: '找不到草稿或無權限。' };
  if (ctx.draft.status !== 'draft') return { ok: false, code: 'not_editable', error: '草稿已送出，無法再修改。', draft: ctx.draft };
  const fields = new Map(allFields(ctx.schema).map((f) => [f.id, f]));
  // The form sends '' for untouched blanks; treat null / undefined / '' as the same empty value.
  const blank = (v: unknown) => (v === undefined || v === '' ? null : v);
  const same = (a: unknown, b: unknown) => JSON.stringify(blank(a)) === JSON.stringify(blank(b));

  let next = input.data;
  let mergedFields: string[] | undefined;
  if (ctx.draft.version !== input.expectedVersion) {
    if (!input.baseData) return { ok: false, code: 'version_conflict', error: '草稿已被其他操作更新，請重新載入後再儲存。', draft: ctx.draft };
    const base = input.baseData;
    const keys = new Set([...Object.keys(base), ...Object.keys(input.data), ...Object.keys(ctx.draft.data)]);
    const mine = [...keys].filter((k) => !same(input.data[k], base[k]));
    const conflicts = mine
      .filter((k) => !same(ctx.draft.data[k], base[k]) && !same(ctx.draft.data[k], input.data[k]))
      .map((k) => ({ field: k, label: fields.get(k)?.label ?? k, mine: input.data[k], theirs: ctx.draft.data[k] }));
    if (conflicts.length > 0) {
      return { ok: false, code: 'conflict', error: '同一欄位已被其他操作修改，請選擇要保留的值。', draft: ctx.draft, conflicts };
    }
    next = { ...ctx.draft.data };
    for (const k of mine) next[k] = input.data[k];
    mergedFields = mine;
  }

  const check = validateSubmission(relaxSchema(ctx.schema), next, ctx.today);
  if (!check.ok) return { ok: false, code: 'validation', error: '有欄位格式不正確，尚未儲存。', errors: check.errors };
  const changed = [...new Set([...Object.keys(next), ...Object.keys(ctx.draft.data)])].filter((k) => !same(next[k], ctx.draft.data[k]));
  // Nothing new (e.g. a repeated click): keep the version, report it as saved.
  if (changed.length === 0) return { ok: true, draft: ctx.draft, mergedFields };

  const written = await patchApplicationDraft({
    draftId: input.draftId,
    ownerEmployeeId: input.ownerEmployeeId,
    expectedVersion: ctx.draft.version,
    patch: next,
    replace: true,
  });
  if (!written.ok) return { ok: false, code: 'version_conflict', error: '草稿剛被其他操作更新，請再按一次儲存。', draft: written.conflict.draft };
  await recordAudit(getDb(), {
    actorEmployeeId: input.ownerEmployeeId,
    action: 'ai_draft.updated',
    entityType: 'ai_application_draft',
    entityId: input.draftId,
    details: { by: 'panel', version: written.draft.version, fields: changed, merged: mergedFields ?? null },
  });
  return { ok: true, draft: written.draft, mergedFields };
}

/**
 * One-line summaries (header fields such as dates, place, purpose) so drafts of
 * the same form can be told apart in the draft library and tabs.
 */
export async function summarizeDrafts(drafts: ApplicationDraft[]): Promise<Map<string, string>> {
  const versionIds = [...new Set(drafts.map((d) => d.formVersionId).filter((v): v is string => Boolean(v)))];
  const schemas = new Map<string, FormSchema>();
  if (versionIds.length) {
    const rows = await getDb()
      .select({ id: formDefinitionVersions.id, schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
      .from(formDefinitionVersions)
      .where(inArray(formDefinitionVersions.id, versionIds));
    for (const r of rows) {
      const parsed = parseDefinition(r.schema, r.flow);
      if (parsed.ok) schemas.set(r.id, parsed.schema);
    }
  }
  const out = new Map<string, string>();
  for (const d of drafts) {
    const schema = d.formVersionId ? schemas.get(d.formVersionId) : undefined;
    if (!schema) continue;
    const parts = allFields(schema)
      .filter((f) => f.showInHeader && ['date', 'datetime', 'text', 'textarea', 'money'].includes(f.type))
      .map((f) => {
        const v = d.data[f.id];
        if (v === undefined || v === null || v === '') return null;
        return f.type === 'datetime' ? String(v).replace('T', ' ') : f.type === 'money' ? `NT$${v}` : String(v).slice(0, 40);
      })
      .filter(Boolean);
    out.set(d.id, parts.length ? parts.join('｜') : '（尚未填寫）');
  }
  return out;
}

/** Compact, complete field specification the model fills from. */
export function formSpec(schema: FormSchema, picker: PickerOptions): Record<string, unknown>[] {
  const refHint = (type: string) => {
    const n =
      type === 'employee' ? picker.employees.length
      : type === 'project' ? picker.projects.length
      : type === 'department' ? picker.departments.length
      : type === 'budget_code' ? picker.budgetCodes.length
      : type === 'supplier' ? picker.suppliers.length
      : null;
    return n === null ? '名稱或代碼，後端比對' : `名稱或代碼，後端在 ${n} 個可選項中比對；不唯一時回傳候選`;
  };
  const describe = (f: FieldDef): Record<string, unknown> => {
    const base: Record<string, unknown> = { id: f.id, label: f.label, type: f.type, required: f.required };
    if (f.help) base.help = f.help;
    if (f.requiredWhen) base.requiredWhen = f.requiredWhen;
    if (f.visibleWhen) base.visibleWhen = f.visibleWhen;
    if (f.rules?.length) base.rules = f.rules.map((r) => r.message);
    switch (f.type) {
      case 'datetime':
        return { ...base, format: 'YYYY-MM-DDTHH:mm（台北時間，不含秒）' };
      case 'date':
        return { ...base, format: 'YYYY-MM-DD' };
      case 'money':
        return { ...base, format: '新臺幣數字，例如 120' };
      case 'text':
      case 'textarea':
        return { ...base, maxLength: f.maxLength };
      case 'select':
      case 'radio':
      case 'checkboxes':
        return { ...base, options: f.options.map((o) => o.label) };
      case 'table':
        return {
          ...base,
          howToEdit: '用 rows 操作：add（新增一列）／update、delete（需 row_id）。不要用 set 整批覆寫。',
          totalColumn: f.totalColumn,
          columns: f.columns.map((c) => ({
            id: c.id,
            label: c.label,
            type: c.type,
            required: c.required,
            ...(c.options ? { options: c.options.map((o) => o.label), default: c.default } : {}),
            ...(c.formula ? { computed: '系統計算，不可填' } : {}),
            ...(c.financeFill ? { computed: '財會填寫，不可填' } : {}),
            ...(c.rateFor ? { note: '新臺幣固定 1，可省略' } : {}),
          })),
        };
      case 'employee':
      case 'project':
      case 'department':
      case 'budget_code':
      case 'supplier':
      case 'asset':
      case 'source':
        return { ...base, value: refHint(f.type) };
      default:
        return base;
    }
  };
  return allFields(schema)
    .filter((f) => !isDisplayOnly(f))
    .map(describe);
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

type CachedFormEntry = {
  key: string;
  name: string;
  description: string;
  fieldLine: string;
};

let cachedFormsIndex: { entries: CachedFormEntry[]; expiresAt: number } | null = null;

/**
 * In-memory cached catalog of published forms.
 * L1 uses only `key=name` (~80 tokens total);
 * L2 selectively expands `fieldLine` ONLY for the 1-2 forms matching the user's message intent.
 */
async function getCompanyFormsIndex(): Promise<CachedFormEntry[]> {
  const now = Date.now();
  if (cachedFormsIndex && cachedFormsIndex.expiresAt > now) {
    return cachedFormsIndex.entries;
  }
  const db = getDb();
  const defs = await db
    .select({
      key: formDefinitions.key,
      name: formDefinitions.name,
      description: formDefinitions.description,
      versionId: formDefinitions.publishedVersionId,
    })
    .from(formDefinitions)
    .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId))
    .where(and(eq(formDefinitions.status, 'published'), eq(formCategories.active, true)))
    .orderBy(asc(formCategories.sortOrder), asc(formDefinitions.sortOrder), asc(formDefinitions.name));

  const verIds = defs.map((d) => d.versionId).filter((x): x is string => Boolean(x));
  const verRows = verIds.length
    ? await db
        .select({ id: formDefinitionVersions.id, schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
        .from(formDefinitionVersions)
        .where(inArray(formDefinitionVersions.id, verIds))
    : [];
  const verMap = new Map(verRows.map((v) => [v.id, v]));

  const entries: CachedFormEntry[] = defs.map((d) => {
    const ver = d.versionId ? verMap.get(d.versionId) : undefined;
    const parsed = ver ? parseDefinition(ver.schema, ver.flow) : null;
    if (!parsed?.ok) {
      return { key: d.key, name: d.name, description: d.description, fieldLine: `${d.key}（${d.name}）` };
    }
    const writable = allFields(parsed.schema).filter((f) => !isDisplayOnly(f));
    const fieldBriefs = writable.map((f) => {
      if (f.type === 'table') {
        const cols = f.columns
          .filter((c) => !c.formula && !c.financeFill)
          .map((c) => `${c.id}(${c.label}${c.options ? `:${c.options.map((o) => o.label).join('/')}` : ''})`)
          .join(', ');
        return `${f.id}[表格:${cols}]`;
      }
      if ('options' in f && f.options) {
        return `${f.id}(${f.label}:${f.options.map((o) => o.label).join('/')})`;
      }
      return `${f.id}(${f.label})`;
    });
    return {
      key: d.key,
      name: d.name,
      description: d.description,
      fieldLine: `form_key="${d.key}"（${d.name}）欄位：${fieldBriefs.join('、')}`,
    };
  });

  cachedFormsIndex = { entries, expiresAt: now + 60_000 };
  return entries;
}

/** Immediately clear the in-memory form catalog cache when forms or schemas are published/updated. */
export function invalidateAiCatalogCache(): void {
  cachedFormsIndex = null;
}

/** Match user query to relevant form_keys so we only inject field schemas for relevant forms (saves ~85% tokens). */
function matchRelevantFormKeys(msg: string, entries: CachedFormEntry[]): Set<string> {
  const q = msg.toLowerCase();
  const matched = new Set<string>();
  if (!q.trim()) return matched;

  const rules: Array<{ re: RegExp; keys: string[] }> = [
    { re: /資產|財產|設備|轉給|轉移|移交|保管人|借出|報廢|macbook|dell|螢幕|筆電|光達|電腦/, keys: ['asset-transfer'] },
    { re: /公出|出差申請|差旅申請|拜訪客戶|外出/, keys: ['business-trip'] },
    { re: /旅費|出差報支|差旅報支|高鐵|機票|住宿|油資|車資/, keys: ['travel-expense'] },
    { re: /採購|請購|買|報價|廠商|供應商/, keys: ['general-procurement', 'small-purchase'] },
    { re: /報支|請款|核銷|發票|收據|費用|代墊/, keys: ['expense-reimbursement', 'travel-expense'] },
    { re: /用印|蓋章|大小章|合約用印|印鑑/, keys: ['seal-request'] },
  ];
  for (const r of rules) {
    if (r.re.test(q)) {
      for (const k of r.keys) matched.add(k);
    }
  }
  for (const e of entries) {
    if (q.includes(e.key.toLowerCase()) || q.includes(e.name.toLowerCase().replace(/申請單|單$/, ''))) {
      matched.add(e.key);
    }
  }
  return matched;
}

/** Calendar anchor so relative dates (下週三、明天) resolve against the company calendar, not the model's guess. */
export function calendarContext(now: Date = new Date()): string {
  const today = taipeiToday(now);
  const base = new Date(`${today}T00:00:00Z`);
  const dow = base.getUTCDay();
  const day = (offset: number) => {
    const d = new Date(base.getTime() + offset * 86_400_000);
    return `${d.toISOString().slice(5, 10).replace('-', '/')}(${WEEKDAYS[d.getUTCDay()]})`;
  };
  const monday = dow === 0 ? -6 : 1 - dow;
  const week = (start: number) => Array.from({ length: 7 }, (_, i) => day(start + i)).join(' ');
  return [
    `今天 ${today}（星期${WEEKDAYS[dow]}），公司時區 Asia/Taipei。`,
    `本週：${week(monday)}`,
    `下週：${week(monday + 7)}`,
    '「下週X」指下週那一列的日期；年份未說明時用今天的年份，已過的月份視為明年前先向使用者確認。',
  ].join('\n');
}

/**
 * Authoritative state for this turn, generated by the server from the
 * database. The model reads drafts from here, not from its earlier replies.
 */
export async function buildWorkState(input: {
  conversationId: string;
  ownerEmployeeId: string;
  /** Draft open on the person's screen; listed first as the current draft. */
  focusDraftId?: string | null;
  /** Current user message for L2 intent-triggered context expansion. */
  userMessage?: string;
  now?: Date;
}): Promise<string> {
  const db = getDb();
  const msg = input.userMessage ?? '';
  const needsAssets = /資產|財產|設備|轉給|轉移|移交|保管|借出|報廢|macbook|dell|螢幕|筆電|光達|電腦/i.test(msg);
  const needsAnnouncements = /公告|消息|最新|置頂|重要|政策|福利|活動|announcement/i.test(msg);
  const needsSurveys = /問卷|調查|投票|意見|survey/i.test(msg);

  const formsIndex = await getCompanyFormsIndex();
  const matchedFormKeys = matchRelevantFormKeys(msg, formsIndex);
  const needsBudgets =
    matchedFormKeys.has('general-procurement') ||
    matchedFormKeys.has('small-purchase') ||
    matchedFormKeys.has('expense-reimbursement') ||
    matchedFormKeys.has('travel-expense');

  const [[empRow], myAssets, deptBudgets] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employees.name,
        employeeCode: employees.employeeCode,
        title: employees.title,
        departmentId: employees.departmentId,
        departmentName: departments.name,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.id, input.ownerEmployeeId))
      .limit(1),
    needsAssets
      ? db
          .select({
            tag: assets.tag,
            name: assets.name,
            location: assets.location,
            status: assets.status,
          })
          .from(assets)
          .where(eq(assets.custodianEmployeeId, input.ownerEmployeeId))
          .orderBy(asc(assets.tag))
          .limit(20)
      : Promise.resolve([]),
    needsBudgets
      ? db
          .select({
            code: budgetCodes.code,
            category: budgetCodes.category,
            departmentId: budgetCodes.departmentId,
            projectName: projects.name,
          })
          .from(budgetCodes)
          .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
          .orderBy(asc(budgetCodes.code))
          .limit(20)
      : Promise.resolve([]),
  ]);

  await Promise.all([activateDueScheduled().catch(() => {}), activateDueSurveys().catch(() => {})]);
  const [visibleAnnouncements, readRows, visibleSurveys, surveyRespRows] = await Promise.all([
    listVisibleAnnouncements({
      employeeId: input.ownerEmployeeId,
      departmentId: empRow?.departmentId ?? null,
      manage: false,
    }).catch(() => []),
    db
      .select()
      .from(companyAnnouncementReads)
      .where(eq(companyAnnouncementReads.employeeId, input.ownerEmployeeId))
      .catch(() => []),
    listSurveysForViewer({
      employeeId: input.ownerEmployeeId,
      departmentId: empRow?.departmentId ?? null,
      manage: false,
    }).catch(() => []),
    db
      .select()
      .from(companySurveyResponses)
      .where(eq(companySurveyResponses.employeeId, input.ownerEmployeeId))
      .catch(() => []),
  ]);

  const readMap = new Map(readRows.map((r) => [r.announcementId, r]));
  const surveyRespMap = new Map(surveyRespRows.map((r) => [r.surveyId, r]));

  const publishedAnnouncements = visibleAnnouncements.filter((a) => a.status === 'published');
  const unreadAnnouncementCount = publishedAnnouncements.filter((a) => !readMap.get(a.id)?.readAt).length;
  const openSurveys = visibleSurveys.filter((s) => s.status === 'open');
  const pendingSurveyCount = openSurveys.filter((s) => surveyRespMap.get(s.id)?.status !== 'submitted').length;

  // L1 (Always-On, ~150 tokens): Employee's own identity card + 1-line form directory + 1-line announcement/survey index
  const actorLine = empRow
    ? `當前登入員工（本人／申請人／預設原保管人）：${empRow.name}（工號：${empRow.employeeCode}｜部門：${empRow.departmentName}${empRow.title ? `｜職稱：${empRow.title}` : ''}）`
    : '';
  const l1FormDirectory = `公司可填表單目錄（form_key=名稱）：${formsIndex.map((f) => `${f.key}=${f.name}`).join('｜')}`;
  const l1AnnouncementsIndex =
    publishedAnnouncements.length > 0
      ? `公司公告目錄（共 ${publishedAnnouncements.length} 則發布中，未讀 ${unreadAnnouncementCount} 則；頁面 /announcements）：${publishedAnnouncements
          .slice(0, 8)
          .map(
            (a) =>
              `${a.pinned ? '[置頂]' : ''}${!readMap.get(a.id)?.readAt ? '[未讀]' : '[已讀]'}${a.title}（分類：${a.category || '一般'}）`
          )
          .join('｜')}`
      : '公司公告目錄：目前無發布中之公司公告。';
  const l1SurveysIndex =
    openSurveys.length > 0
      ? `公司問卷目錄（共 ${openSurveys.length} 份開放中，待填 ${pendingSurveyCount} 份；頁面 /surveys）：${openSurveys
          .slice(0, 6)
          .map((s) => `${surveyRespMap.get(s.id)?.status === 'submitted' ? '[已填]' : '[待填]'}${s.title}`)
          .join('｜')}`
      : '';

  // L2 (Intent-Triggered Working Set): Only expand schemas, assets, announcements & surveys relevant to this message
  const l2FormSchemas = formsIndex
    .filter((f) => matchedFormKeys.has(f.key))
    .map((f) => `【本回合相關表單欄位規格】${f.fieldLine}`);

  const l2AnnouncementDetails =
    needsAnnouncements && publishedAnnouncements.length > 0
      ? [
          `【本回合相關：公司公告完整內容（共 ${publishedAnnouncements.length} 則，未讀 ${unreadAnnouncementCount} 則｜注意：此為全公司／部門正式公告，與個人單據簽核通知無關）】`,
          ...publishedAnnouncements.slice(0, 12).map((a, idx) => {
            const rd = readMap.get(a.id);
            const readStateLabel = rd?.acknowledgedAt
              ? '已讀且已確認'
              : rd?.readAt
                ? '已讀'
                : '未讀';
            const priorityLabel =
              a.priority === 'urgent' ? '緊急' : a.priority === 'important' ? '重要' : '一般';
            const dateStr = (a.publishedAt ?? a.publishAt ?? a.createdAt)
              ? taipeiToday(a.publishedAt ?? a.publishAt ?? a.createdAt)
              : '';
            const cleanBody = a.body.replace(/\s+/g, ' ').trim().slice(0, 500);
            return `${idx + 1}. ${a.pinned ? '📌[置頂] ' : ''}[${priorityLabel}｜分類：${a.category || '一般'}｜${readStateLabel}｜發布日：${dateStr}] 《${a.title}》（連結：/announcements?open=${a.id}）\n   內容：${cleanBody}`;
          }),
        ]
      : [];

  const l2SurveyDetails =
    needsSurveys && visibleSurveys.length > 0
      ? [
          `【本回合相關：公司問卷清單（共 ${visibleSurveys.length} 份）】`,
          ...visibleSurveys.slice(0, 10).map((s, idx) => {
            const resp = surveyRespMap.get(s.id);
            const fillLabel =
              resp?.status === 'submitted' ? '已填寫送出' : resp?.status === 'draft' ? '填寫草稿中' : '尚未填寫';
            const closeStr = s.closesAt ? taipeiToday(s.closesAt) : '無截止日';
            return `${idx + 1}. [${s.status === 'open' ? '開放中' : '已截止'}｜${fillLabel}｜截止：${closeStr}] 《${s.title}》（連結：/surveys/${s.id}）— ${(s.description || '').replace(/\s+/g, ' ').slice(0, 200)}`;
          }),
        ]
      : [];

  const assetLine = needsAssets
    ? myAssets.length > 0
      ? `【本人名下保管資產（共 ${myAssets.length} 筆）】${myAssets.map((a) => `${a.tag} ${a.name}（地點：${a.location}）`).join('；')}`
      : '【本人名下保管資產】目前無個人保管資產。'
    : '';

  const myDeptBudgets = empRow
    ? deptBudgets.filter((b) => b.departmentId === empRow.departmentId || b.projectName)
    : deptBudgets;
  const budgetLine =
    matchedFormKeys.size > 0 && myDeptBudgets.length > 0
      ? `【本人部門與專案常用預算代碼】${myDeptBudgets.slice(0, 10).map((b) => `${b.code}（${b.projectName || b.category}）`).join('、')}`
      : '';

  const lines: string[] = [
    '【系統工作狀態｜後端由資料庫產生，非使用者輸入；欄位與版本以此為準】',
    calendarContext(input.now),
    ...(actorLine ? [actorLine] : []),
    l1FormDirectory,
    l1AnnouncementsIndex,
    ...(l1SurveysIndex ? [l1SurveysIndex] : []),
    ...(assetLine ? [assetLine] : []),
    ...(budgetLine ? [budgetLine] : []),
    ...l2FormSchemas,
    ...l2AnnouncementDetails,
    ...l2SurveyDetails,
  ];
  const drafts = (await listConversationDrafts(input.conversationId, input.ownerEmployeeId))
    .filter((d) => d.status === 'draft')
    .sort((a, b) => Number(b.id === input.focusDraftId) - Number(a.id === input.focusDraftId));
  if (drafts.length === 0) {
    lines.push('本對話目前沒有進行中的草稿。');
    return lines.join('\n');
  }
  lines.push(
    drafts[0]?.id === input.focusDraftId
      ? '本對話進行中的草稿（第一張是使用者畫面上目前開啟的草稿，未指明時修改它）：'
      : '本對話進行中的草稿（第一張是最近更新的「目前草稿」）：'
  );
  for (const [i, d] of drafts.slice(0, 4).entries()) {
    const ctx = await loadDraftFormContext(d.id, input.ownerEmployeeId);
    if (!ctx) continue;
    const fields = allFields(ctx.schema).filter((f) => !isDisplayOnly(f));
    const filled = fields
      .filter((f) => f.type !== 'table' && d.data[f.id] !== undefined && d.data[f.id] !== null && d.data[f.id] !== '')
      .map((f) => `${f.id}（${f.label}）=${displayValue(f, d.data[f.id], ctx.options)}`);
    const status = draftStatus(ctx.schema, d.data, ctx.today);
    lines.push(
      `${i === 0 ? '▶ 目前草稿' : '・草稿'} draft_id=${d.id}｜${ctx.name}（${d.formDefinitionKey}）｜version=${d.version}`,
      `  已填：${filled.length ? filled.join('；') : '（無）'}`
    );
    for (const f of fields.filter((x): x is Extract<FieldDef, { type: 'table' }> => x.type === 'table')) {
      const t = d.data[f.id] as { rows?: Record<string, unknown>[]; total?: unknown } | undefined;
      const rows = (t?.rows ?? []).map((r, n) => {
        const cells = f.columns
          .filter((c) => r[c.id] !== null && r[c.id] !== undefined && r[c.id] !== '')
          .map((c) => `${c.label}=${String(r[c.id])}`)
          .join('、');
        return `    row_id=${typeof r[ROW_ID_KEY] === 'string' ? r[ROW_ID_KEY] : `#${n + 1}`}：${cells}`;
      });
      lines.push(`  明細 ${f.id}（${f.label}）${rows.length} 列${t?.total !== undefined && t?.total !== null ? `，合計 ${String(t.total)}` : ''}`, ...rows);
    }
    lines.push(`  尚缺必填：${status.missing.length ? status.missing.map((m) => `${m.field}（${m.label}）`).join('、') : '無'}`);
    if (status.invalid.length) lines.push(`  不合法：${status.invalid.map((x) => `${x.label}：${x.message}`).join('；')}`);
    if (i === 0) lines.push(`  欄位規格：${JSON.stringify(formSpec(ctx.schema, ctx.options))}`);
  }
  return lines.join('\n');
}

export { getDraftForOwner };
