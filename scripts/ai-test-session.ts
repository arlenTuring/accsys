/**
 * Test-only: mint a session for a fixture employee in the disposable `_test`
 * database and write the token to a file (never printed), for driving the UI
 * of a dev server pointed at the same database.
 *
 *   DATABASE_URL=postgres://...@127.0.0.1:25432/accsys_test \
 *     npx tsx scripts/ai-test-session.ts <out-file> [employeeId]
 */
import { writeFileSync } from 'node:fs';
import { createSession } from '../src/lib/auth/sessions';
import { getDb, getSql } from '../src/lib/db';

async function main() {
  const [out, employeeId = '20000000-0000-0000-0000-000000000001'] = process.argv.slice(2);
  if (!out) throw new Error('usage: ai-test-session.ts <out-file> [employeeId]');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  const { token } = await createSession(getDb(), { employeeId, identityId: null, ttlMs: 8 * 3600_000 });
  writeFileSync(out, token, { mode: 0o600 });
  console.log(`session written to ${out}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
