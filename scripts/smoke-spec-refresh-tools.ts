/**
 * Smoke: remove_draft_attachments + search_trip_companion_candidates without Vertex.
 *
 *   npx tsx scripts/smoke-spec-refresh-tools.ts [--out docs/evidence/spec-refresh-tools-smoke.json]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { and, desc, eq } from 'drizzle-orm';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0 && process.argv[outIdx + 1]
      ? resolve(process.cwd(), process.argv[outIdx + 1])
      : resolve(process.cwd(), 'docs/evidence/spec-refresh-tools-smoke.json');

  const { getDb, getSql } = await import('../src/lib/db');
  const { aiApplicationDrafts, aiConversations, employees, departments } = await import('../src/lib/db/schema');
  const { executeAiChatTool } = await import('../src/lib/ai-chat/tools');
  const { listDraftFiles } = await import('../src/lib/ai-chat/attach-staged');
  const { getDraftForOwner } = await import('../src/lib/ai-chat/drafts');

  const db = getDb();

  // Prefer the logged-in GM used in browser smoke (呂孟耿).
  let emp =
    (await db.select().from(employees).where(eq(employees.name, '呂孟耿')).limit(1))[0] ?? null;
  if (!emp) {
    const [any] = await db
      .select({ id: aiApplicationDrafts.ownerEmployeeId })
      .from(aiApplicationDrafts)
      .where(and(eq(aiApplicationDrafts.formDefinitionKey, 'travel-expense'), eq(aiApplicationDrafts.status, 'draft')))
      .orderBy(desc(aiApplicationDrafts.updatedAt))
      .limit(1);
    if (!any) throw new Error('no travel-expense draft owner');
    emp = (await db.select().from(employees).where(eq(employees.id, any.id)).limit(1))[0] ?? null;
  }
  if (!emp) throw new Error('employee not found');

  const [dept] = await db.select().from(departments).where(eq(departments.id, emp.departmentId)).limit(1);

  const [draftRow] = await db
    .select()
    .from(aiApplicationDrafts)
    .where(
      and(
        eq(aiApplicationDrafts.ownerEmployeeId, emp.id),
        eq(aiApplicationDrafts.formDefinitionKey, 'travel-expense'),
        eq(aiApplicationDrafts.status, 'draft'),
      ),
    )
    .orderBy(desc(aiApplicationDrafts.updatedAt))
    .limit(1);
  if (!draftRow) throw new Error('no travel-expense draft');

  const conversationId = draftRow.conversationId;
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, conversationId)).limit(1);
  if (!conv) throw new Error('draft conversation missing');

  const actor = {
    id: emp.id,
    employeeCode: emp.employeeCode,
    name: emp.name,
    email: emp.googleEmail ?? '',
    title: emp.title,
    departmentId: emp.departmentId,
    departmentCode: dept?.code ?? '',
    departmentName: dept?.name ?? '',
    role: emp.role,
    permissions: [] as never[],
    isGeneralManager: Boolean(emp.isGeneralManager),
    isChairman: Boolean(emp.isChairman),
    sessionId: 'smoke-session',
    authenticatedAt: new Date(),
  };

  const ctx = { conversationId, ownerEmployeeId: emp.id, actor };

  const before = await listDraftFiles(draftRow.id, emp.id);
  const draftBefore = await getDraftForOwner(draftRow.id, emp.id);
  if (!draftBefore) throw new Error('draft forbidden');

  const companion = await executeAiChatTool(
    'search_trip_companion_candidates',
    { draft_id: draftRow.id, near_days: 3 },
    ctx,
  );

  const remove = await executeAiChatTool(
    'remove_draft_attachments',
    {
      draft_id: draftRow.id,
      expected_version: draftBefore.version,
      remove_all: true,
    },
    ctx,
  );

  const after = await listDraftFiles(draftRow.id, emp.id);

  const report = {
    at: new Date().toISOString(),
    employeeId: emp.id,
    employeeEmail: emp.googleEmail,
    draftId: draftRow.id,
    conversationId,
    attachmentsBefore: before.length,
    attachmentsAfter: after.length,
    companionOk: companion.ok,
    companionCandidates: Array.isArray((companion.response as { candidates?: unknown[] })?.candidates)
      ? (companion.response as { candidates: unknown[] }).candidates.length
      : null,
    companionMessage: String((companion.response as { message?: string })?.message ?? '').slice(0, 240),
    removeOk: remove.ok,
    removeCount: (remove.response as { removedCount?: number })?.removedCount ?? null,
    removeMessage: String((remove.response as { message?: string })?.message ?? '').slice(0, 240),
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  let failed = false;
  if (!companion.ok) failed = true;
  if (!remove.ok) failed = true;
  if (after.length !== 0) failed = true;
  await getSql().end({ timeout: 2 }).catch(() => undefined);
  if (failed) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    const { getSql } = await import('../src/lib/db');
    await getSql().end({ timeout: 2 });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
