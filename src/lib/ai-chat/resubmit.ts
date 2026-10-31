import { and, eq } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import { aiApplicationDrafts, formDefinitions, formSubmissions, procurementCases } from '@/lib/db/schema';
import { appendMessage, createConversation, renameConversation } from './conversations';
import { bindDraftToConversation, mapDraft, type ApplicationDraft } from './drafts';
import { withRowIds } from './draft-fill';
import { factsFor, loadFormFacts, loadReturnReason } from './form-facts';

/**
 * 補件: a returned submission continues as a draft in the assistant. The draft
 * stays on the submission's form version and, when sent, revises that same
 * submission: no second form number, the attachments already on it stay.
 */

export type ResubmissionResult =
  | { ok: true; draft: ApplicationDraft; conversationId: string; created: boolean; formNumber: string; formName: string; reason: string | null }
  | { ok: false; code: 'not_found' | 'not_returned'; error: string };

function rowsWithIds(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === 'object' && Array.isArray((v as { rows?: unknown }).rows)) out[k] = withRowIds(v as Parameters<typeof withRowIds>[0]);
  }
  return out;
}

export async function startResubmission(input: {
  ownerEmployeeId: string;
  submissionId: string;
  /** Continue in this conversation; without it a new one is opened for the correction. */
  conversationId?: string;
}): Promise<ResubmissionResult> {
  const db = getDb();
  const [s] = await db
    .select({
      id: formSubmissions.id,
      status: formSubmissions.status,
      version: formSubmissions.version,
      data: formSubmissions.data,
      formNumber: formSubmissions.formNumber,
      versionId: formSubmissions.versionId,
      applicantId: formSubmissions.applicantEmployeeId,
      filerId: formSubmissions.filedByEmployeeId,
      caseCreatorId: procurementCases.createdByEmployeeId,
      key: formDefinitions.key,
      name: formDefinitions.name,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .innerJoin(procurementCases, eq(procurementCases.id, formSubmissions.procurementCaseId))
    .where(eq(formSubmissions.id, input.submissionId))
    .limit(1);
  const owner = s && (s.applicantId === input.ownerEmployeeId || (s.filerId ?? s.caseCreatorId) === input.ownerEmployeeId);
  if (!owner) return { ok: false, code: 'not_found', error: '找不到這張單據，或您不是申請人。' };
  if (s.status !== 'returned') return { ok: false, code: 'not_returned', error: '這張單目前不是退回狀態，不能補件。' };

  const reason = await loadReturnReason({ formType: 'custom', formId: s.id });
  const reused = (draft: ApplicationDraft, conversationId: string, created: boolean): ResubmissionResult => ({
    ok: true,
    draft,
    conversationId,
    created,
    formNumber: s.formNumber,
    formName: s.name,
    reason,
  });

  const [open] = await db
    .select()
    .from(aiApplicationDrafts)
    .where(and(eq(aiApplicationDrafts.resubmitOfSubmissionId, s.id), eq(aiApplicationDrafts.status, 'draft')))
    .limit(1);
  if (open && open.ownerEmployeeId === input.ownerEmployeeId && open.resubmitBaseVersion === s.version) {
    if (input.conversationId) {
      await bindDraftToConversation({ conversationId: input.conversationId, draftId: open.id, ownerEmployeeId: input.ownerEmployeeId });
    }
    return reused(mapDraft(open), input.conversationId ?? open.conversationId, false);
  }
  // Left over from an earlier return: the form has moved on, the old copy is stale.
  if (open) await db.update(aiApplicationDrafts).set({ status: 'abandoned' }).where(eq(aiApplicationDrafts.id, open.id));

  const conversationId = input.conversationId ?? (await createConversation(input.ownerEmployeeId)).id;
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(aiApplicationDrafts)
      .values({
        conversationId,
        ownerEmployeeId: input.ownerEmployeeId,
        formDefinitionKey: s.key,
        formVersionId: s.versionId,
        title: `補件：${s.name}`.slice(0, 160),
        data: rowsWithIds((s.data ?? {}) as Record<string, unknown>),
        resubmitOfSubmissionId: s.id,
        resubmitBaseVersion: s.version,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await recordAudit(tx, {
        actorEmployeeId: input.ownerEmployeeId,
        action: 'ai_draft.resubmission_started',
        entityType: 'ai_application_draft',
        entityId: inserted.id,
        details: { submissionId: s.id, formNumber: s.formNumber, baseVersion: s.version },
      });
    }
    return inserted ?? null;
  });
  if (!row) {
    // Two tabs at once: the other one created it.
    const [other] = await db
      .select()
      .from(aiApplicationDrafts)
      .where(and(eq(aiApplicationDrafts.resubmitOfSubmissionId, s.id), eq(aiApplicationDrafts.status, 'draft')))
      .limit(1);
    if (!other) return { ok: false, code: 'not_found', error: '無法建立補件草稿，請重試。' };
    return reused(mapDraft(other), other.conversationId, false);
  }

  if (!input.conversationId) {
    await renameConversation(input.ownerEmployeeId, conversationId, `補件：${s.name}`);
    const facts = await loadFormFacts([{ formType: 'custom', formId: s.id }]);
    const f = factsFor(facts, { formType: 'custom', formId: s.id });
    await appendMessage({
      conversationId,
      ownerEmployeeId: input.ownerEmployeeId,
      role: 'model',
      contentText: `「${s.name}」${f?.what ? `（${f.what}）` : ''}已退回，退回原因：${(reason ?? '退回時未提供原因').replace(/[。.]+$/, '')}。\n已開好補件草稿，內容與原單相同。直接告訴我要改什麼，或在右側修改、補附件，完成後按「重新送出」；原單已有的附件會保留。`,
      blocks: [{ kind: 'draft_reference', id: `draft_${row.id}`, draftId: row.id, formKey: s.key, formName: s.name, version: 1, status: 'draft' }],
    });
  }
  return reused(mapDraft(row), conversationId, true);
}
