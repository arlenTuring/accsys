/**
 * First-admin bootstrap (run once, from a shell on the server):
 *
 *   1. The future admin signs in with Google; the login page says the account
 *      is waiting for approval (a link request is recorded).
 *   2. DATABASE_URL=... npx tsx scripts/auth-bootstrap.ts --list
 *   3. DATABASE_URL=... npx tsx scripts/auth-bootstrap.ts --request <id> --employee <employee_code>
 *
 * The employee must already have role 'admin'. The command refuses once any
 * enabled admin has an active Google binding; later bindings are approved on
 * /admin/accounts by an admin. There is no web endpoint for this.
 */
import { desc, eq } from 'drizzle-orm';
import { bootstrapFirstAdminBinding } from '../src/lib/admin/accounts/service';
import { getDb, getSql } from '../src/lib/db';
import { identityLinkRequests } from '../src/lib/db/schema';
import { loadSecretFiles } from '../src/lib/secret-files';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadSecretFiles();
  if (process.argv.includes('--list')) {
    const rows = await getDb()
      .select({
        id: identityLinkRequests.id,
        email: identityLinkRequests.email,
        name: identityLinkRequests.displayName,
        lastAttemptAt: identityLinkRequests.lastAttemptAt,
        conflict: identityLinkRequests.conflictReason,
      })
      .from(identityLinkRequests)
      .where(eq(identityLinkRequests.status, 'pending'))
      .orderBy(desc(identityLinkRequests.lastAttemptAt))
      .limit(20);
    console.table(rows);
    return;
  }

  const requestId = arg('request');
  const employeeCode = arg('employee');
  if (!requestId || !employeeCode) {
    throw new Error('usage: auth-bootstrap.ts --list | --request <id> --employee <employee_code>');
  }
  const result = await bootstrapFirstAdminBinding({ requestId, employeeCode });
  if (!result.ok) throw new Error(`bootstrap refused: ${result.error}`);
  console.log(`Bound link request ${requestId} to admin ${employeeCode}. Sign in again with Google.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
