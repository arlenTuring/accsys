/**
 * Google Workspace directory sync — dry run from a fixture (P6, first stage).
 *
 *   DATABASE_URL=... ALLOWED_GOOGLE_DOMAINS=example.com \
 *     npx tsx scripts/directory-sync.ts --fixture path/to/users-pages.json
 *
 * The fixture is a JSON array of Directory `users.list` response bodies, in
 * page order. The command reads ACCSYS bindings and prints what a sync would
 * change; it writes nothing. Applying needs the live Directory source, which
 * waits for the company's approval of a read-only sync account
 * (admin.directory.user.readonly); until then `--apply` is refused.
 */
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db';
import { runDirectorySync } from '../src/lib/directory/service';
import { collectDirectory, type FetchPage } from '../src/lib/directory/users';
import { loadSecretFiles } from '../src/lib/secret-files';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fixtureSource(file: string): FetchPage {
  const pages: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(pages)) throw new Error('fixture must be a JSON array of users.list pages');
  let next = 0;
  return async () => (next < pages.length ? { status: 200, body: pages[next++] } : { status: 404, body: null });
}

async function main() {
  loadSecretFiles();
  if (process.argv.includes('--apply')) {
    throw new Error('--apply is not available yet: it needs the live Directory source (company approval pending). Use the dry run.');
  }
  const fixture = arg('fixture');
  if (!fixture) throw new Error('usage: directory-sync.ts --fixture <users-pages.json>');
  const allowedDomains = (process.env.ALLOWED_GOOGLE_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (allowedDomains.length === 0) throw new Error('ALLOWED_GOOGLE_DOMAINS is required');
  const scope = { allowedDomains, customerId: process.env.GWS_CUSTOMER_ID?.trim() || null };

  const listing = await collectDirectory(fixtureSource(fixture), scope);
  if (!listing.ok) throw new Error(`directory listing rejected: ${listing.error}`);
  const issuer = process.env.OIDC_ISSUER?.trim() || 'https://accounts.google.com';
  const outcome = await runDirectorySync(listing.users, { issuer, apply: false });
  if (!outcome.ok) throw new Error(`sync refused: ${outcome.error}`);
  const { plan } = outcome;

  console.log(`Directory: ${plan.directoryCount} accounts (${plan.activeCount} active) in ${listing.pages} page(s). DRY RUN — nothing written.`);
  console.log(plan.blocked ? `Applying would be REFUSED: ${plan.blocked}` : 'Applying would be allowed.');
  console.log(`\nBindings that would be revoked (suspended / archived): ${plan.revoke.length}`);
  for (const r of plan.revoke) console.log(`  ${r.employeeCode}  ${r.email ?? ''}  (${r.reason})`);
  console.log(`\nBinding emails that would follow the directory: ${plan.emailChanges.length}`);
  for (const c of plan.emailChanges) console.log(`  ${c.employeeCode}  ${c.from ?? '(none)'} -> ${c.to}`);
  console.log(`\nBound accounts missing from the listing (checked one by one before any action): ${plan.missing.length}`);
  for (const m of plan.missing) console.log(`  ${m.employeeCode}  ${m.email ?? ''}`);
  console.log(`\nActive accounts without a binding (admin approves on /admin/accounts): ${plan.unbound.length}`);
  for (const u of plan.unbound) console.log(`  ${u.email}  ${u.fullName}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
