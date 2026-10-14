/**
 * Publishes the sample designer forms (src/lib/custom-forms/samples.ts) on a
 * local database so /f/<key>/new can be tried before the designer exists.
 * Forms that already exist are left alone (versions are immutable).
 *
 * Usage: npm run seed:forms
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

const LOCAL_DEV_ADMIN = '00000000-0000-0000-0000-000000000002';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    console.error('seed:forms only runs against a database on this machine (localhost / 127.0.0.1)');
    process.exit(1);
  }

  const { getSql } = await import('@/lib/db');
  const { runInTransaction } = await import('@/lib/workflow/tx');
  const { publishDefinition } = await import('@/lib/custom-forms/publish');
  const { PURCHASE_ADMIN_SAMPLE } = await import('@/lib/custom-forms/samples');
  const sql = getSql();
  try {
    const [admin] = await sql`select id from employees where id = ${LOCAL_DEV_ADMIN}`;
    if (!admin) {
      console.error('Local dev admin (db/seed-local-dev.sql) is missing; run ./start.sh first');
      process.exit(1);
    }
    for (const sample of [PURCHASE_ADMIN_SAMPLE]) {
      const [existing] = await sql`select 1 from form_definitions where key = ${sample.key}`;
      if (existing) {
        console.log(`  ${sample.key}: already exists, skipped`);
        continue;
      }
      const result = await runInTransaction('seed.publish_form', async (tx) => ({
        ok: true as const,
        ...(await publishDefinition(tx, { ...JSON.parse(JSON.stringify(sample)), actorId: LOCAL_DEV_ADMIN })),
      }));
      if (!result.ok) {
        console.error(`  ${sample.key}: ${result.error}`);
        process.exitCode = 1;
      } else {
        console.log(`  ${sample.key}: published v${result.version} → /f/${sample.key}/new`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
