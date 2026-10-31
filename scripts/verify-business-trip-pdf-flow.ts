/**
 * Isolation smoke: publish business-trip → submit → approve steps → PDF → attach.
 * npx tsx scripts/verify-business-trip-pdf-flow.ts
 */
import { and, asc, eq } from 'drizzle-orm';
import { getOrCreateApprovedPdfSnapshot, readSnapshotBytes } from '../src/lib/ai-chat/approved-pdf';
import { attachApprovedSnapshotToDraft } from '../src/lib/ai-chat/attach-approved';
import { createConversation } from '../src/lib/ai-chat/conversations';
import { createApplicationDraft } from '../src/lib/ai-chat/drafts';
import { BUSINESS_TRIP_FORM } from '../src/lib/custom-forms/migrated/business-trip';
import { installMigratedForm } from '../src/lib/custom-forms/migrated/install';
import * as customService from '../src/lib/custom-forms/service';
import { getDb } from '../src/lib/db';
import { approvalSteps, employees, formDefinitions, formSubmissions } from '../src/lib/db/schema';

async function main() {
  const db = getDb();
  const [actorEmp] = await db.select().from(employees).where(eq(employees.accessEnabled, true)).limit(1);
  if (!actorEmp) throw new Error('no employee');
  const actor = { id: actorEmp.id, role: actorEmp.role };

  await db.transaction(async (tx) => {
    await installMigratedForm(tx, BUSINESS_TRIP_FORM, actor.id, 'publish');
  });
  const [def] = await db.select().from(formDefinitions).where(eq(formDefinitions.key, 'business-trip')).limit(1);
  if (!def?.publishedVersionId) throw new Error('business-trip not published');
  console.log('form_published', def.key);

  const created = await customService.createSubmission(actor, 'business-trip', {
    data: {
      tripStartAt: '2026-10-28T10:00',
      tripEndAt: '2026-10-28T19:00',
      location: '台中',
      purpose: '客戶拜訪（驗證流程）',
      itinerary: '上午出發，下午會議',
      approvalProxyNote: '此欄僅備註，不啟用代理',
    },
    fileCount: 0,
    idempotencyKey: `verify-bt-${Date.now()}`,
  });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  const submissionId = created.submissionId;
  console.log('submitted', created.formNumber, submissionId);

  for (let i = 0; i < 15; i++) {
    const [fs] = await db
      .select({ version: formSubmissions.version, status: formSubmissions.status })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, submissionId))
      .limit(1);
    if (!fs) throw new Error('missing submission');
    if (fs.status === 'approved') break;

    const [pending] = await db
      .select({
        approverEmployeeId: approvalSteps.approverEmployeeId,
        stepOrder: approvalSteps.stepOrder,
      })
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.formType, 'custom'),
          eq(approvalSteps.formId, submissionId),
          eq(approvalSteps.status, 'pending')
        )
      )
      .orderBy(asc(approvalSteps.stepOrder))
      .limit(1);
    if (!pending?.approverEmployeeId) {
      console.warn('no pending approver; status=', fs.status);
      break;
    }
    const r = await customService.approveSubmissionStep(
      { id: pending.approverEmployeeId },
      submissionId,
      fs.version
    );
    console.log('approve', i, pending.stepOrder, r);
    if (!r.ok) {
      if (r.code === 'conflict') continue;
      throw new Error(JSON.stringify(r));
    }
  }

  const [final] = await db
    .select({
      status: formSubmissions.status,
      formNumber: formSubmissions.formNumber,
      version: formSubmissions.version,
    })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  console.log('final', final);
  if (final?.status !== 'approved') {
    console.error('VERIFY_BLOCKED: approval chain incomplete in this org (need managers in chain)');
    process.exit(2);
  }

  const snap = await getOrCreateApprovedPdfSnapshot({
    actor,
    formType: 'custom',
    formId: submissionId,
  });
  if (!snap.ok) throw new Error(snap.error);
  const file = await readSnapshotBytes(snap.snapshot.id);
  if (!file || file.bytes.length < 200) throw new Error('pdf_too_small');
  if (file.contentHash !== snap.snapshot.contentHash) throw new Error('hash_mismatch');
  console.log('pdf_ok', file.bytes.length, snap.snapshot.contentHash.slice(0, 12));

  const snap2 = await getOrCreateApprovedPdfSnapshot({
    actor,
    formType: 'custom',
    formId: submissionId,
  });
  if (!snap2.ok || !snap2.reused || snap2.snapshot.id !== snap.snapshot.id) {
    throw new Error('snapshot_reuse_failed');
  }

  const conv = await createConversation(actor.id, 'verify-trip-pdf');
  const { draft } = await createApplicationDraft({
    conversationId: conv.id,
    ownerEmployeeId: actor.id,
    formDefinitionKey: 'travel-expense',
    title: '報支驗證草稿',
  });
  const linked = await attachApprovedSnapshotToDraft({
    actor,
    draftId: draft.id,
    expectedVersion: draft.version,
    snapshotId: snap.snapshot.id,
  });
  if (!linked.ok || !linked.created) throw new Error('attach_failed');
  const again = await attachApprovedSnapshotToDraft({
    actor,
    draftId: draft.id,
    expectedVersion: linked.draft.version,
    snapshotId: snap.snapshot.id,
  });
  if (!again.ok || again.created) throw new Error('attach_not_idempotent');
  console.log('VERIFY_OK', final.formNumber, draft.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
