/**
 * Ensure the latest travel-expense draft for 呂孟耿 has one tiny PNG attachment.
 */
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { and, desc, eq, sql } from 'drizzle-orm';

config({ path: resolve(process.cwd(), '.env.local') });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  const { getDb, getSql } = await import('../src/lib/db');
  const { employees, aiApplicationDrafts, aiDraftFileAttachments } = await import('../src/lib/db/schema');
  const { writeNew } = await import('../src/lib/attachments/storage');
  const { listDraftFiles } = await import('../src/lib/ai-chat/attach-staged');

  const db = getDb();
  const emp = (await db.select().from(employees).where(eq(employees.name, '呂孟耿')).limit(1))[0];
  if (!emp) throw new Error('employee missing');
  const [draft] = await db
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
  if (!draft) throw new Error('no draft');

  const existing = await listDraftFiles(draft.id, emp.id);
  let version = draft.version;
  if (existing.length === 0) {
    const fileId = randomUUID();
    const storagePath = `ai-draft-files/${draft.id}/${fileId}`;
    await writeNew(storagePath, PNG);
    await db.transaction(async (tx) => {
      await tx.insert(aiDraftFileAttachments).values({
        id: fileId,
        draftId: draft.id,
        fileName: 'smoke-pixel.png',
        mimeType: 'image/png',
        fileSizeBytes: PNG.length,
        storagePath,
        sha256: createHash('sha256').update(PNG).digest('hex'),
        attachedByEmployeeId: emp.id,
      });
      await tx
        .update(aiApplicationDrafts)
        .set({ version: sql`${aiApplicationDrafts.version} + 1`, updatedAt: sql`now()` })
        .where(eq(aiApplicationDrafts.id, draft.id));
    });
    version = draft.version + 1;
  }

  const after = await listDraftFiles(draft.id, emp.id);
  const report = {
    draftId: draft.id,
    conversationId: draft.conversationId,
    version,
    attachmentCount: after.length,
    openUrl: `http://127.0.0.1:3001/tools/ai-chat?draft=${encodeURIComponent(draft.id)}`,
  };
  writeFileSync(resolve('docs/evidence/seed-draft-attachment.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await getSql().end({ timeout: 2 }).catch(() => undefined);
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { getSql } = await import('../src/lib/db');
    await getSql().end({ timeout: 2 });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
