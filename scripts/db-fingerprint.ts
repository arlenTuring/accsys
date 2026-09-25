/**
 * Print the structural fingerprint of a database (read-only), e.g. to compare
 * a production schema snapshot with the repository:
 *   MIGRATION_DATABASE_URL=... npx tsx scripts/db-fingerprint.ts > live.json
 */
import postgres from 'postgres';
import { requireMigrationUrl, schemaFingerprint } from './lib/migrations';

async function main() {
  const sql = postgres(requireMigrationUrl(), { max: 1, onnotice: () => {} });
  try {
    console.log(JSON.stringify(await schemaFingerprint(sql), null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`db:fingerprint failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
