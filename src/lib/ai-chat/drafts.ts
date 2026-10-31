import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit/record';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as customService from '@/lib/custom-forms/service';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { getPickerOptions } from '@/lib/custom-forms/queries';
import { allFields, isDisplayOnly, type FormSchema } from '@/lib/custom-forms/schema';
import { validateSubmission } from '@/lib/custom-forms/validate';
import { canFile, parseVisibility } from '@/lib/custom-forms/visibility';
import { getDb } from '@/lib/db';
import {
  aiApplicationDrafts,
  aiConversationDraftLinks,
  aiConversations,
  employeeJobRoles,
  employees,
  formDefinitionVersions,
  formDefinitions,
  formSubmissions,
  jobRoles,
} from '@/lib/db/schema';
import { taipeiToday } from '@/lib/taipei-date';
import { recordProjectUsage } from './projects';

export type ApplicationDraft = {
  id: string;
  conversationId: string;
  ownerEmployeeId: string;
  formDefinitionKey: string;
  formVersionId: string | null;
  title: string;
  data: Record<string, unknown>;
  version: number;
  status: 'draft' | 'submitted' | 'abandoned';
  submissionId: string | null;
  createIdempotencyKey: string | null;
  /** 補件: the returned submission this draft revises. */
  resubmitOfSubmissionId: string | null;
  resubmitBaseVersion: number | null;
  updatedAt: Date;
};

export type DraftConflict = {
  code: 'version_conflict';
  draft: ApplicationDraft;
};

function asData(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

async function assertConversationOwner(conversationId: string, ownerEmployeeId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!row) throw new Error('conversation_forbidden');
}

export async function getDraftForOwner(
  draftId: string,
  ownerEmployeeId: string
): Promise<ApplicationDraft | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiApplicationDrafts)
    .where(and(eq(aiApplicationDrafts.id, draftId), eq(aiApplicationDrafts.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!row) return null;
  return mapDraft(row);
}

/** Drafts of a conversation: those it created plus those linked into it from elsewhere. */
export async function listConversationDrafts(
  conversationId: string,
  ownerEmployeeId: string
): Promise<ApplicationDraft[]> {
  await assertConversationOwner(conversationId, ownerEmployeeId);
  const db = getDb();
  const rows = await db
    .select()
    .from(aiApplicationDrafts)
    .where(
      and(
        eq(aiApplicationDrafts.ownerEmployeeId, ownerEmployeeId),
        or(
          eq(aiApplicationDrafts.conversationId, conversationId),
          inArray(
            aiApplicationDrafts.id,
            db
              .select({ id: aiConversationDraftLinks.draftId })
              .from(aiConversationDraftLinks)
              .where(eq(aiConversationDraftLinks.conversationId, conversationId))
          )
        )
      )
    )
    .orderBy(desc(aiApplicationDrafts.updatedAt))
    .limit(10);
  return rows.map(mapDraft);
}

/** True when the owner's draft belongs to, or was linked into, this conversation. */
export async function isDraftInConversation(draftId: string, conversationId: string, ownerEmployeeId: string): Promise<boolean> {
  const draft = await getDraftForOwner(draftId, ownerEmployeeId);
  if (!draft) return false;
  if (draft.conversationId === conversationId) return true;
  const [link] = await getDb()
    .select({ id: aiConversationDraftLinks.draftId })
    .from(aiConversationDraftLinks)
    .where(and(eq(aiConversationDraftLinks.conversationId, conversationId), eq(aiConversationDraftLinks.draftId, draftId)))
    .limit(1);
  return Boolean(link);
}

/**
 * Continue the owner's draft in another of the owner's conversations. Both
 * must belong to the same employee; only open drafts can be linked. Audited.
 */
export async function bindDraftToConversation(input: {
  conversationId: string;
  draftId: string;
  ownerEmployeeId: string;
}): Promise<{ ok: true; draft: ApplicationDraft; linked: boolean } | { ok: false; error: 'not_found' | 'not_editable' }> {
  await assertConversationOwner(input.conversationId, input.ownerEmployeeId);
  const draft = await getDraftForOwner(input.draftId, input.ownerEmployeeId);
  if (!draft) return { ok: false, error: 'not_found' };
  if (draft.status !== 'draft') return { ok: false, error: 'not_editable' };
  if (draft.conversationId === input.conversationId) return { ok: true, draft, linked: false };
  const db = getDb();
  const inserted = await db
    .insert(aiConversationDraftLinks)
    .values({ conversationId: input.conversationId, draftId: input.draftId, ownerEmployeeId: input.ownerEmployeeId })
    .onConflictDoNothing()
    .returning({ id: aiConversationDraftLinks.draftId });
  if (inserted.length > 0) {
    await recordAudit(db, {
      actorEmployeeId: input.ownerEmployeeId,
      action: 'ai_draft.linked',
      entityType: 'ai_application_draft',
      entityId: input.draftId,
      details: { conversationId: input.conversationId, originConversationId: draft.conversationId },
    });
  }
  return { ok: true, draft, linked: inserted.length > 0 };
}

export async function listDraftLibrary(input: {
  ownerEmployeeId: string;
  query?: string;
  status?: 'draft' | 'submitted' | 'abandoned' | 'all';
  limit?: number;
  offset?: number;
}): Promise<{ items: ApplicationDraft[]; total: number }> {
  const db = getDb();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const offset = Math.max(input.offset ?? 0, 0);
  const clauses = [eq(aiApplicationDrafts.ownerEmployeeId, input.ownerEmployeeId)];
  if (input.status && input.status !== 'all') {
    clauses.push(eq(aiApplicationDrafts.status, input.status));
  } else {
    // Library default: active drafts + submitted (not abandoned)
    clauses.push(sql`${aiApplicationDrafts.status} in ('draft', 'submitted')`);
  }
  if (input.query?.trim()) {
    const q = `%${input.query.trim().slice(0, 80)}%`;
    clauses.push(
      sql`(${aiApplicationDrafts.title} ilike ${q} OR ${aiApplicationDrafts.formDefinitionKey} ilike ${q})`
    );
  }
  const where = and(...clauses);
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiApplicationDrafts)
    .where(where);
  const rows = await db
    .select()
    .from(aiApplicationDrafts)
    .where(where)
    .orderBy(desc(aiApplicationDrafts.updatedAt))
    .limit(limit)
    .offset(offset);
  return { items: rows.map(mapDraft), total: countRow?.n ?? 0 };
}

/** Explicit abandon only — closing a tab / archiving a conversation must not call this. */
export async function abandonDraft(draftId: string, ownerEmployeeId: string): Promise<ApplicationDraft | null> {
  const existing = await getDraftForOwner(draftId, ownerEmployeeId);
  if (!existing || existing.status !== 'draft') return null;
  const db = getDb();
  const [row] = await db
    .update(aiApplicationDrafts)
    .set({ status: 'abandoned', updatedAt: sql`now()` })
    .where(and(eq(aiApplicationDrafts.id, draftId), eq(aiApplicationDrafts.ownerEmployeeId, ownerEmployeeId)))
    .returning();
  return row ? mapDraft(row) : null;
}

export function mapDraft(row: {
  id: string;
  conversationId: string;
  ownerEmployeeId: string;
  formDefinitionKey: string;
  formVersionId: string | null;
  title?: string | null;
  data: unknown;
  version: number;
  status: string;
  submissionId: string | null;
  createIdempotencyKey?: string | null;
  resubmitOfSubmissionId?: string | null;
  resubmitBaseVersion?: number | null;
  updatedAt: Date;
}): ApplicationDraft {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ownerEmployeeId: row.ownerEmployeeId,
    formDefinitionKey: row.formDefinitionKey,
    formVersionId: row.formVersionId,
    title: row.title?.trim() || row.formDefinitionKey,
    data: asData(row.data),
    version: row.version,
    status: row.status as ApplicationDraft['status'],
    submissionId: row.submissionId,
    createIdempotencyKey: row.createIdempotencyKey ?? null,
    resubmitOfSubmissionId: row.resubmitOfSubmissionId ?? null,
    resubmitBaseVersion: row.resubmitBaseVersion ?? null,
    updatedAt: row.updatedAt,
  };
}

/** Resolve published form key → version id the given employee may file (no request cookies). */
export async function resolvePublishedForm(
  formKey: string,
  ownerEmployeeId: string
): Promise<{
  key: string;
  name: string;
  versionId: string;
  definitionId: string;
} | null> {
  if (typeof formKey !== 'string' || formKey.length < 1 || formKey.length > 40) return null;
  if (typeof ownerEmployeeId !== 'string' || !ownerEmployeeId) return null;
  const db = getDb();
  const [emp] = await db
    .select({ id: employees.id, departmentId: employees.departmentId })
    .from(employees)
    .where(eq(employees.id, ownerEmployeeId))
    .limit(1);
  if (!emp) return null;
  const roleRows = await db
    .select({ code: jobRoles.code })
    .from(employeeJobRoles)
    .innerJoin(jobRoles, eq(jobRoles.id, employeeJobRoles.jobRoleId))
    .where(eq(employeeJobRoles.employeeId, ownerEmployeeId));
  const [row] = await db
    .select({
      definitionId: formDefinitions.id,
      versionId: formDefinitions.publishedVersionId,
      name: formDefinitions.name,
      key: formDefinitions.key,
      visibility: formDefinitions.visibility,
    })
    .from(formDefinitions)
    .where(and(eq(formDefinitions.key, formKey), eq(formDefinitions.status, 'published')))
    .limit(1);
  if (!row?.versionId) return null;
  const visibility = parseVisibility(row.visibility);
  if (
    !visibility.ok ||
    !canFile(visibility.value, { departmentId: emp.departmentId, jobRoles: roleRows.map((r) => r.code) })
  ) {
    return null;
  }
  return { key: row.key, name: row.name, versionId: row.versionId, definitionId: row.definitionId };
}

export async function createApplicationDraft(input: {
  conversationId: string;
  ownerEmployeeId: string;
  formDefinitionKey: string;
  data?: Record<string, unknown>;
  /** Same key + owner reuses the draft (model/request retry). Different explicit creates use different keys. */
  createIdempotencyKey?: string | null;
  title?: string | null;
}): Promise<{ draft: ApplicationDraft; created: boolean }> {
  await assertConversationOwner(input.conversationId, input.ownerEmployeeId);
  const published = await resolvePublishedForm(input.formDefinitionKey, input.ownerEmployeeId);
  if (!published) throw new Error('form_not_filable');

  const db = getDb();
  const idem =
    typeof input.createIdempotencyKey === 'string' && input.createIdempotencyKey.trim()
      ? input.createIdempotencyKey.trim().slice(0, 120)
      : null;

  if (idem) {
    const [existing] = await db
      .select()
      .from(aiApplicationDrafts)
      .where(
        and(
          eq(aiApplicationDrafts.ownerEmployeeId, input.ownerEmployeeId),
          eq(aiApplicationDrafts.createIdempotencyKey, idem)
        )
      )
      .limit(1);
    if (existing) return { draft: mapDraft(existing), created: false };
  }

  const title = (input.title?.trim() || published.name || published.key).slice(0, 160);
  try {
    const [row] = await db
      .insert(aiApplicationDrafts)
      .values({
        conversationId: input.conversationId,
        ownerEmployeeId: input.ownerEmployeeId,
        formDefinitionKey: published.key,
        formVersionId: published.versionId,
        title,
        data: input.data ?? {},
        version: 1,
        status: 'draft',
        createIdempotencyKey: idem,
      })
      .returning();
    return { draft: mapDraft(row), created: true };
  } catch (err) {
    // Race on unique idempotency key — return the winner.
    if (idem) {
      const [existing] = await db
        .select()
        .from(aiApplicationDrafts)
        .where(
          and(
            eq(aiApplicationDrafts.ownerEmployeeId, input.ownerEmployeeId),
            eq(aiApplicationDrafts.createIdempotencyKey, idem)
          )
        )
        .limit(1);
      if (existing) return { draft: mapDraft(existing), created: false };
    }
    throw err;
  }
}

/** Compact field map for the model — ids, types, labels; never invent unknown ids. */
export function describeDraftFields(schema: FormSchema): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const f of allFields(schema)) {
    if (isDisplayOnly(f)) continue;
    if (f.type === 'table') {
      out.push({
        id: f.id,
        type: 'table',
        label: f.label,
        shape: '{ rows: [ { colId: value, ... } ], total: null }',
        columns: f.columns.map((c) => ({
          id: c.id,
          type: c.type,
          label: c.label,
          required: c.required,
          ...(c.options ? { options: c.options.map((o) => o.value) } : {}),
        })),
      });
    } else {
      out.push({
        id: f.id,
        type: f.type,
        label: f.label,
        required: 'required' in f ? Boolean(f.required) : false,
      });
    }
  }
  return out;
}

function allowedFieldIds(schema: FormSchema): Set<string> {
  return new Set(
    allFields(schema)
      .filter((f) => !isDisplayOnly(f))
      .map((f) => f.id)
  );
}

/**
 * Patch draft fields with optimistic version check.
 * Returns conflict when expectedVersion does not match.
 */
export async function patchApplicationDraft(input: {
  draftId: string;
  ownerEmployeeId: string;
  expectedVersion: number;
  /** Partial field map — merged into existing data (shallow). */
  patch: Record<string, unknown>;
  /** When true, replace data entirely (manual save from form). */
  replace?: boolean;
}): Promise<{ ok: true; draft: ApplicationDraft } | { ok: false; conflict: DraftConflict }> {
  const current = await getDraftForOwner(input.draftId, input.ownerEmployeeId);
  if (!current) throw new Error('draft_not_found');
  if (current.status !== 'draft') throw new Error('draft_not_editable');
  if (current.version !== input.expectedVersion) {
    return { ok: false, conflict: { code: 'version_conflict', draft: current } };
  }

  // Reject unknown field ids when we can load the schema (AI patches).
  if (!input.replace) {
    const ctx = await loadDraftFormContext(input.draftId, input.ownerEmployeeId);
    if (ctx) {
      const allowed = allowedFieldIds(ctx.schema);
      for (const key of Object.keys(input.patch)) {
        if (!allowed.has(key)) throw new Error(`unknown_field:${key}`);
      }
    }
  }

  const nextData = input.replace ? asData(input.patch) : { ...current.data, ...input.patch };
  const db = getDb();
  const [row] = await db
    .update(aiApplicationDrafts)
    .set({
      data: nextData,
      version: sql`${aiApplicationDrafts.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(aiApplicationDrafts.id, input.draftId),
        eq(aiApplicationDrafts.ownerEmployeeId, input.ownerEmployeeId),
        eq(aiApplicationDrafts.version, input.expectedVersion),
        eq(aiApplicationDrafts.status, 'draft')
      )
    )
    .returning();

  if (!row) {
    const again = await getDraftForOwner(input.draftId, input.ownerEmployeeId);
    if (!again) throw new Error('draft_not_found');
    return { ok: false, conflict: { code: 'version_conflict', draft: again } };
  }

  const projectId = typeof nextData.projectId === 'string' ? nextData.projectId : null;
  if (projectId) {
    try {
      await recordProjectUsage(input.ownerEmployeeId, projectId);
    } catch {
      // usage is best-effort
    }
  }

  return {
    ok: true,
    draft: mapDraft(row),
  };
}

export async function loadDraftFormContext(draftId: string, ownerEmployeeId: string) {
  const draft = await getDraftForOwner(draftId, ownerEmployeeId);
  if (!draft) return null;

  const published = await resolvePublishedForm(draft.formDefinitionKey, ownerEmployeeId);
  // A correction stays on the version the submission was filed under.
  const versionMismatch =
    !draft.resubmitOfSubmissionId && Boolean(draft.formVersionId && published?.versionId && draft.formVersionId !== published.versionId);

  // Prefer pinned version schema for editing; submit path re-checks published.
  const db = getDb();
  let schemaFlow: { schema: unknown; flow: unknown; name: string; description: string | null } | null =
    null;
  if (draft.formVersionId) {
    const [ver] = await db
      .select({
        schema: formDefinitionVersions.schema,
        flow: formDefinitionVersions.flow,
        name: formDefinitions.name,
        description: formDefinitions.description,
      })
      .from(formDefinitionVersions)
      .innerJoin(formDefinitions, eq(formDefinitions.id, formDefinitionVersions.definitionId))
      .where(eq(formDefinitionVersions.id, draft.formVersionId))
      .limit(1);
    if (ver) schemaFlow = ver;
  }

  // Prefer the draft's pinned version; fall back to currently published definition.
  // Do not call getNewFormContext here — it requires request cookies and breaks
  // script / non-request callers; ownership was already checked above.
  let schema: FormSchema | null = null;
  let name = draft.formDefinitionKey;
  let description: string | null = null;
  let definitionId: string | null = published?.definitionId ?? null;

  if (schemaFlow) {
    const parsed = parseDefinition(schemaFlow.schema, schemaFlow.flow);
    if (parsed.ok) {
      schema = parsed.schema;
      name = schemaFlow.name;
      description = schemaFlow.description;
    }
  }

  if (!schema) {
    const [pub] = await db
      .select({
        definitionId: formDefinitions.id,
        name: formDefinitions.name,
        description: formDefinitions.description,
        schema: formDefinitionVersions.schema,
        flow: formDefinitionVersions.flow,
      })
      .from(formDefinitions)
      .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
      .where(and(eq(formDefinitions.key, draft.formDefinitionKey), eq(formDefinitions.status, 'published')))
      .limit(1);
    if (!pub) return null;
    const parsed = parseDefinition(pub.schema, pub.flow);
    if (!parsed.ok) return null;
    schema = parsed.schema;
    name = pub.name;
    description = pub.description;
    definitionId = pub.definitionId;
  }

  if (!definitionId) {
    const [def] = await db
      .select({ id: formDefinitions.id })
      .from(formDefinitions)
      .where(eq(formDefinitions.key, draft.formDefinitionKey))
      .limit(1);
    definitionId = def?.id ?? null;
  }

  const options = definitionId
    ? await getPickerOptions(schema, { definitionId, applicantId: ownerEmployeeId })
    : {
        employees: [],
        departments: [],
        budgetCodes: [],
        projects: [],
        suppliers: [],
        assets: [],
        sources: [],
      };

  return {
    draft,
    formKey: draft.formDefinitionKey,
    name,
    description,
    schema,
    options,
    currentEmployeeId: ownerEmployeeId,
    publishedVersionId: published?.versionId ?? null,
    versionMismatch,
    today: taipeiToday(),
  };
}

/**
 * Formal submit: validate draft, require matching published version, call createSubmission.
 * Idempotency key is derived from draft id + version so retries collapse.
 */
/** 補件: revise the returned submission in place, under its own number. */
async function resubmitDraft(draft: ApplicationDraft, actorId: string, newFileCount: number) {
  const submissionId = draft.resubmitOfSubmissionId!;
  const [before] = await getDb()
    .select({ formNumber: formSubmissions.formNumber })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  const done = await customService.reviseSubmission({ id: actorId }, submissionId, 'resubmit', {
    data: draft.data,
    expectedVersion: draft.resubmitBaseVersion ?? -1,
    newFileCount,
  });
  if (!done.ok) return { ok: false as const, message: done.error };
  return { ok: true as const, submissionId, formNumber: before?.formNumber ?? '', replayed: false };
}

export async function submitApplicationDraft(input: {
  draftId: string;
  ownerEmployeeId: string;
  expectedVersion: number;
  files?: File[];
}): Promise<
  | { ok: true; submissionId: string; formNumber: string; formKey: string; replayed?: boolean; copyFailures?: number }
  | { ok: false; error: string; code?: string; draft?: ApplicationDraft }
> {
  const employee = await getCurrentEmployee();
  if (!employee || employee.id !== input.ownerEmployeeId) {
    return { ok: false, error: '請先登入。', code: 'unauthenticated' };
  }

  const draft = await getDraftForOwner(input.draftId, input.ownerEmployeeId);
  if (!draft) return { ok: false, error: '找不到草稿。', code: 'not_found' };
  if (draft.status === 'submitted' && draft.submissionId) {
    // Idempotent: already submitted.
    const db = getDb();
    const [sub] = await db
      .select({ formNumber: formSubmissions.formNumber })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, draft.submissionId))
      .limit(1);
    return {
      ok: true,
      submissionId: draft.submissionId,
      formNumber: sub?.formNumber ?? '',
      formKey: draft.formDefinitionKey,
      replayed: true,
    };
  }
  if (draft.status !== 'draft') return { ok: false, error: '草稿無法送出。', code: 'conflict' };
  if (draft.version !== input.expectedVersion) {
    return { ok: false, error: '草稿已被更新，請重新確認後再送出。', code: 'version_conflict', draft };
  }

  if (!draft.resubmitOfSubmissionId) {
    const published = await resolvePublishedForm(draft.formDefinitionKey, input.ownerEmployeeId);
    if (!published) {
      return { ok: false, error: '此表單目前不可填寫或已下架。', code: 'form_unavailable' };
    }
    if (draft.formVersionId && draft.formVersionId !== published.versionId) {
      return {
        ok: false,
        error: '表單已發布新版本。請重新整理草稿後再確認送出。',
        code: 'form_version_changed',
        draft,
      };
    }
  }

  const ctx = await loadDraftFormContext(draft.id, input.ownerEmployeeId);
  if (!ctx) return { ok: false, error: '無法載入表單定義。', code: 'unavailable' };

  const check = validateSubmission(ctx.schema, draft.data, ctx.today);
  if (!check.ok) {
    return { ok: false, error: '請先修正草稿欄位錯誤後再送出。', code: 'validation' };
  }

  const files = input.files ?? [];
  const { listDraftSnapshots } = await import('./attach-approved');
  const { listDraftFiles, readDraftFileBytes } = await import('./attach-staged');
  const snaps = await listDraftSnapshots(draft.id, input.ownerEmployeeId);
  const draftFiles = await listDraftFiles(draft.id, input.ownerEmployeeId);

  // Files already on the draft count towards a required 附件 field: they are
  // copied onto the submission right after it exists.
  const newFiles = files.length + snaps.length + draftFiles.length;
  const result = draft.resubmitOfSubmissionId
    ? await resubmitDraft(draft, employee.id, newFiles)
    : await customService.createSubmission({ id: employee.id }, draft.formDefinitionKey, {
        data: draft.data,
        idempotencyKey: `ai-draft:${draft.id}:v${draft.version}`,
        fileCount: newFiles,
      });
  if (!result.ok) {
    // A double click on 重新送出: the first request won and already marked the draft.
    const now = await getDraftForOwner(draft.id, input.ownerEmployeeId);
    if (now?.status === 'submitted' && now.submissionId) {
      return { ok: true, submissionId: now.submissionId, formNumber: '', formKey: now.formDefinitionKey, replayed: true };
    }
    return { ok: false, error: 'error' in result ? result.error : result.message, code: 'submit_failed' };
  }
  try {
    revalidatePath('/approvals');
    revalidatePath('/f', 'layout');
  } catch {
    // No request scope (scripts): nothing to revalidate.
  }

  // Mark the draft first: once the formal submission exists the draft must not
  // look editable, even if copying attachments below fails.
  const db = getDb();
  await db
    .update(aiApplicationDrafts)
    .set({
      status: 'submitted',
      submissionId: result.submissionId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(aiApplicationDrafts.id, draft.id),
        eq(aiApplicationDrafts.ownerEmployeeId, input.ownerEmployeeId)
      )
    );

  // Copy linked approved PDF snapshots + draft files onto the formal submission.
  let copyFailures = 0;
  if (!result.replayed) {
    const { readSnapshotBytes } = await import('./approved-pdf');
    const { readEditOutput } = await import('./file-edits');
    const { uploadAttachmentFor } = await import('@/lib/attachments/service');
    const actor = { id: input.ownerEmployeeId, role: employee.role };
    const put = async (file: File) => {
      try {
        const r = await uploadAttachmentFor(actor, 'custom', result.submissionId, file);
        if (!r.ok) copyFailures += 1;
      } catch (err) {
        copyFailures += 1;
        console.error('[ai-chat] copy draft attachment failed', err instanceof Error ? err.message : err);
      }
    };
    for (const f of files) await put(f);
    for (const s of snaps) {
      const file = await readSnapshotBytes(s.snapshotId);
      if (file) await put(new File([new Uint8Array(file.bytes)], s.fileName, { type: 'application/pdf' }));
      else copyFailures += 1;
    }
    for (const meta of draftFiles) {
      const file = await readDraftFileBytes(draft.id, meta.id);
      if (!file) {
        copyFailures += 1;
        continue;
      }
      // Copies, so later edits of the draft cannot change what was submitted.
      const edited = file.activeEditId ? await readEditOutput(file.activeEditId, input.ownerEmployeeId) : null;
      if (edited) {
        const ext = edited.mimeType === 'image/png' ? 'png' : 'jpg';
        const name = `${file.fileName.replace(/\.[^.]+$/, '')}（編輯版）.${ext}`;
        await put(new File([new Uint8Array(edited.bytes)], name, { type: edited.mimeType }));
      }
      await put(new File([new Uint8Array(file.bytes)], file.fileName, { type: file.mimeType }));
    }
  }

  return {
    ok: true,
    submissionId: result.submissionId,
    formNumber: result.formNumber ?? '',
    formKey: draft.formDefinitionKey,
    replayed: result.replayed,
    copyFailures,
  };
}
