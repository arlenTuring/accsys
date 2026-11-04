/**
 * Companion search against a temporary travel-expense data shape matching TEST seed dates.
 * Does not mutate DB drafts — wraps an in-memory draft view.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const { getDb, getSql } = await import('../src/lib/db');
  const { employees, aiApplicationDrafts } = await import('../src/lib/db/schema');
  const { searchTripCompanionCandidates } = await import('../src/lib/ai-chat/companion-candidates');
  const { getDraftForOwner } = await import('../src/lib/ai-chat/drafts');
  const { desc, and } = await import('drizzle-orm');

  const db = getDb();
  const emp = (await db.select().from(employees).where(eq(employees.name, '呂孟耿')).limit(1))[0];
  if (!emp) throw new Error('employee missing');
  const [row] = await db
    .select()
    .from(aiApplicationDrafts)
    .where(and(eq(aiApplicationDrafts.ownerEmployeeId, emp.id), eq(aiApplicationDrafts.status, 'draft')))
    .orderBy(desc(aiApplicationDrafts.updatedAt))
    .limit(1);
  if (!row) throw new Error('no draft');
  const owned = await getDraftForOwner(row.id, emp.id);
  if (!owned) throw new Error('forbidden');

  const synthetic = {
    ...owned,
    data: {
      ...owned.data,
      tripStartDate: '2026-11-10',
      tripEndDate: '2026-11-12',
      location: '台南',
      purpose: '測試專案 A',
    },
  };

  const result = await searchTripCompanionCandidates({
    actorEmployeeId: emp.id,
    draft: synthetic,
    nearDays: 3,
  });

  const report = {
    at: new Date().toISOString(),
    target: result.target,
    nearDays: result.nearDays,
    scopeNote: result.scopeNote,
    candidateCount: result.candidates.length,
    candidates: result.candidates.slice(0, 8).map((c) => ({
      code: c.employeeCode,
      name: c.name,
      kind: c.matchKind,
      diff: c.diff,
      reason: c.reason,
    })),
  };
  const out = resolve(process.cwd(), 'docs/evidence/companion-nov-smoke.json');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await getSql().end({ timeout: 2 }).catch(() => undefined);
  if (result.candidates.length < 1) process.exit(1);
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
