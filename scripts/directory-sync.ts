/**
 * Google Workspace directory sync (P6).
 *
 *   # dry run from a saved listing (no Google access, writes nothing)
 *   DATABASE_URL=... ALLOWED_GOOGLE_DOMAINS=example.com \
 *     npx tsx scripts/directory-sync.ts --fixture tests/fixtures/directory/users-pages.json
 *
 *   # live listing: dry run, then apply (systemd timer runs the second form)
 *   npx tsx scripts/directory-sync.ts --live
 *   npx tsx scripts/directory-sync.ts --live --apply
 *
 * The live source needs GWS_DIRECTORY_CLIENT_ID, GWS_DIRECTORY_CLIENT_SECRET(_FILE),
 * GWS_DIRECTORY_REFRESH_TOKEN(_FILE) (from `npm run directory:authorize`),
 * GWS_CUSTOMER_ID and ALLOWED_GOOGLE_DOMAINS. Only the sync job gets these;
 * the web app never does.
 *
 * Applying revokes the bindings and sessions of suspended / archived accounts,
 * follows email renames and refreshes the snapshot the admin reviews on
 * /admin/org/directory. Nothing is created, restored or re-enabled. A fixture
 * listing is never applied. Exit code 1 on any failure or refusal.
 */
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db';
import { directoryConfig, directoryPageFetcher, refreshAccessToken } from '../src/lib/directory/google';
import { directoryIssuer, recordFailedRun, runDirectorySync } from '../src/lib/directory/service';
import { collectDirectory, type DirectoryScope, type FetchPage } from '../src/lib/directory/users';
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

function fixtureScope(): DirectoryScope {
  const allowedDomains = (process.env.ALLOWED_GOOGLE_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (allowedDomains.length === 0) throw new Error('ALLOWED_GOOGLE_DOMAINS is required');
  return { allowedDomains, customerId: process.env.GWS_CUSTOMER_ID?.trim() || null };
}

async function main() {
  loadSecretFiles();
  const live = process.argv.includes('--live');
  const apply = process.argv.includes('--apply');
  const fixture = arg('fixture');
  if (live === Boolean(fixture)) throw new Error('usage: directory-sync.ts (--fixture <users-pages.json> | --live [--apply])');
  if (apply && !live) throw new Error('--apply needs the live listing (--live); a fixture is only ever a dry run');

  const startedAt = new Date();
  let fetchPage: FetchPage;
  let scope: DirectoryScope;
  if (live) {
    const config = directoryConfig();
    scope = config.scope;
    const token = await refreshAccessToken(fetch, config.credentials);
    if (!token.ok) {
      if (apply) await recordFailedRun('directory', token.error, startedAt);
      throw new Error(`cannot get a directory access token: ${token.error}`);
    }
    fetchPage = directoryPageFetcher(fetch, token.accessToken, scope.customerId!);
  } else {
    scope = fixtureScope();
    fetchPage = fixtureSource(fixture!);
  }

  const listing = await collectDirectory(fetchPage, scope);
  if (!listing.ok) {
    if (apply) await recordFailedRun('directory', `listing rejected: ${listing.error}`, startedAt);
    throw new Error(`directory listing rejected: ${listing.error}`);
  }
  const issuer = directoryIssuer();
  const outcome = await runDirectorySync(listing.users, { issuer, apply, source: live ? 'directory' : 'fixture', pages: listing.pages, startedAt });
  if (!outcome.ok && !outcome.plan) throw new Error(`sync refused: ${outcome.error}`);
  const plan = outcome.plan!;

  console.log(`Directory: ${plan.directoryCount} accounts (${plan.activeCount} active) in ${listing.pages} page(s). ${apply ? 'APPLY' : 'DRY RUN — nothing written.'}`);
  if (apply) console.log(outcome.ok ? 'Applied.' : `REFUSED: ${plan.blocked}`);
  else console.log(plan.blocked ? `Applying would be REFUSED: ${plan.blocked}` : 'Applying would be allowed.');
  console.log(`\nBindings ${apply ? '' : 'that would be '}revoked (suspended / archived): ${plan.revoke.length}`);
  for (const r of plan.revoke) console.log(`  ${r.employeeCode}  ${r.email ?? ''}  (${r.reason})`);
  console.log(`\nBinding emails ${apply ? 'updated' : 'that would follow the directory'}: ${plan.emailChanges.length}`);
  for (const c of plan.emailChanges) console.log(`  ${c.employeeCode}  ${c.from ?? '(none)'} -> ${c.to}`);
  console.log(`\nBound accounts missing from the listing (review on /admin/org/directory): ${plan.missing.length}`);
  for (const m of plan.missing) console.log(`  ${m.employeeCode}  ${m.email ?? ''}`);
  console.log(`\nActive accounts without a binding (review on /admin/org/directory): ${plan.unbound.length}`);
  for (const u of plan.unbound) console.log(`  ${u.email}  ${u.fullName}`);
  if (!outcome.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
