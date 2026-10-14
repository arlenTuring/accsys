/**
 * Apply pending migrations from drizzle/ (run as a one-off job, never at web
 * startup). Uses MIGRATION_DATABASE_URL (accsys_migrator), creates objects as
 * accsys_owner, serializes concurrent runs with an advisory lock, and refuses
 * to run when applied migrations were edited or when the database already has
 * tables but no migration history (use `npm run db:baseline` for that).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import {
  MIGRATIONS_FOLDER,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  OWNER_ROLE,
  countPublicTables,
  loadMigrations,
  readApplied,
  requireMigrationUrl,
  verifyAppliedMigrations,
  withMigrationLock,
} from './lib/migrations';
import { loadSecretFiles } from '../src/lib/secret-files';

async function main() {
  loadSecretFiles();
  const sql = postgres(requireMigrationUrl(), {
    max: 1,
    onnotice: () => {},
    connection: { application_name: 'accsys-migrate' },
  });
  try {
    await withMigrationLock(sql, async () => {
      await sql.unsafe(`set role ${OWNER_ROLE}`);
      const journal = loadMigrations();
      const applied = (await readApplied(sql)) ?? [];

      if (applied.length === 0 && (await countPublicTables(sql)) > 0) {
        throw new Error(
          'Database already has tables but no migration history. Run `npm run db:baseline` ' +
            'to verify and adopt it; migrations will not re-create existing tables.'
        );
      }

      const check = verifyAppliedMigrations(journal, applied);
      if (!check.ok) throw new Error(check.error);
      if (check.pending.length === 0) {
        console.log(`Up to date (${applied.length} migrations applied).`);
        return;
      }

      console.log(`Applying ${check.pending.length} migration(s): ${check.pending.map((m) => m.tag).join(', ')}`);
      await migrate(drizzle(sql), {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: MIGRATIONS_SCHEMA,
        migrationsTable: MIGRATIONS_TABLE,
      });
      console.log('Done.');
    });
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`db:migrate failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
