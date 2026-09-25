/**
 * Adopt a database that was created from the pre-migration db/schema.sql
 * (now db/legacy/schema-v0.sql). Only touches migration metadata:
 *   1. refuse if the database already has migration history (no-op);
 *   2. compare the live structure with db/baseline-fingerprint.json and stop
 *      on any difference (nothing is written);
 *   3. record the baseline migrations as applied.
 * Afterwards `npm run db:migrate` applies everything newer.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import {
  BASELINE_TAGS,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  OWNER_ROLE,
  countPublicTables,
  diffLines,
  loadMigrations,
  readApplied,
  requireMigrationUrl,
  schemaFingerprint,
  withMigrationLock,
} from './lib/migrations';

const FINGERPRINT_FILE = path.resolve(__dirname, '../db/baseline-fingerprint.json');

async function main() {
  const sql = postgres(requireMigrationUrl(), {
    max: 1,
    onnotice: () => {},
    connection: { application_name: 'accsys-baseline' },
  });
  try {
    await withMigrationLock(sql, async () => {
      await sql.unsafe(`set role ${OWNER_ROLE}`);
      const applied = await readApplied(sql);
      if (applied && applied.length > 0) {
        console.log(`Already under migration control (${applied.length} applied). Nothing to do.`);
        return;
      }
      if ((await countPublicTables(sql)) === 0) {
        throw new Error('Database is empty; use `npm run db:migrate` instead of db:baseline.');
      }

      const expected = JSON.parse(readFileSync(FINGERPRINT_FILE, 'utf8')) as string[];
      const diff = diffLines(expected, await schemaFingerprint(sql));
      if (diff.length > 0) {
        console.error('Live schema differs from the baseline; nothing was changed:');
        for (const line of diff) console.error(`  ${line}`);
        throw new Error(`${diff.length} structural difference(s); resolve them before adopting`);
      }

      const baseline = loadMigrations().filter((m) => BASELINE_TAGS.includes(m.tag));
      if (baseline.length !== BASELINE_TAGS.length) {
        throw new Error('baseline migrations missing from drizzle/');
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(`create schema if not exists ${MIGRATIONS_SCHEMA}`);
        await tx.unsafe(`create table if not exists ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
          id serial primary key, hash text not null, created_at bigint)`);
        for (const m of baseline) {
          await tx`insert into ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)} (hash, created_at)
                   values (${m.hash}, ${m.folderMillis})`;
        }
      });
      console.log(`Adopted existing schema as ${BASELINE_TAGS.join(' + ')}. Now run npm run db:migrate.`);
    });
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`db:baseline failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
