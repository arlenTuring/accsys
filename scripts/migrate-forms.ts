/**
 * Installs a migration batch: hard-coded forms rebuilt as designer
 * definitions (src/lib/custom-forms/migrated). By default each form is
 * created as a draft linked to the form it replaces; nothing changes for users
 * until an admin checks it in 表單設計器 (preview, flow simulation) and
 * publishes it, which switches the "new" entry over. Archiving it later
 * switches back. Existing definitions are never modified, so reruns are safe.
 *
 * Usage:
 *   npm run forms:migrate -- --batch 1                 drafts, local database
 *   npm run forms:migrate -- --batch 1 --publish       publish (switch) at once; drafts installed
 *                                                      earlier are published as they stand in the designer
 *   npm run forms:migrate -- --batch 1 --dry-run       only check the definitions
 *   npm run forms:migrate -- --batch 1 --actor a@x.com --allow-remote
 *       a database that is not on this machine (needs an active admin account)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

const LOCAL_DEV_ADMIN = '00000000-0000-0000-0000-000000000002';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const batch = Number(arg('batch'));
  const { MIGRATION_BATCHES } = await import('@/lib/custom-forms/migrated');
  const plan = MIGRATION_BATCHES[batch];
  if (!plan) {
    console.error(`Usage: npm run forms:migrate -- --batch <${Object.keys(MIGRATION_BATCHES).join('|')}> [--publish] [--dry-run]`);
    process.exit(1);
  }

  const { parseDefinition } = await import('@/lib/custom-forms/definition');
  let broken = false;
  for (const form of plan.forms) {
    const parsed = parseDefinition(form.schema, form.flow);
    if (!parsed.ok) {
      broken = true;
      console.error(`  ${form.key}: ${parsed.errors.join('；')}`);
    }
  }
  if (broken) process.exit(1);
  if (flag('dry-run')) {
    console.log(`Batch ${batch}（${plan.title}）: ${plan.forms.map((f) => f.key).join(', ')} — definitions OK (dry run, nothing written)`);
    return;
  }

  const url = process.env.DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const local = LOCAL_HOSTS.includes(host) && process.env.NODE_ENV !== 'production';
  const actorEmail = arg('actor');
  if (!local && !flag('allow-remote')) {
    console.error('forms:migrate only runs against a database on this machine unless --allow-remote (and --actor <admin email>) is given');
    process.exit(1);
  }
  if (!local && !actorEmail) {
    console.error('--actor <admin email> is required for a database that is not on this machine');
    process.exit(1);
  }

  const { getSql } = await import('@/lib/db');
  const { runInTransaction } = await import('@/lib/workflow/tx');
  const { installMigratedForm } = await import('@/lib/custom-forms/migrated/install');
  const { publishDraft } = await import('@/lib/form-builder/service');
  const sql = getSql();
  try {
    const [actor] = actorEmail
      ? await sql`select id from employees where lower(google_email) = lower(${actorEmail}) and access_enabled and role = 'admin'`
      : await sql`select id from employees where id = ${LOCAL_DEV_ADMIN} and access_enabled`;
    if (!actor) {
      console.error(actorEmail ? 'No active admin account with that email' : 'Local dev admin (db/seed-local-dev.sql) is missing; run ./start.sh first');
      process.exit(1);
    }
    const mode = flag('publish') ? 'publish' : 'draft';
    console.log(`Batch ${batch}（${plan.title}）, mode: ${mode}`);
    for (const form of plan.forms) {
      const result = await runInTransaction('forms.migrate', async (tx) => ({
        ok: true as const,
        ...(await installMigratedForm(tx, form, actor.id as string, mode)),
      }));
      if (!result.ok) {
        console.error(`  ${form.key}: ${result.error}`);
        process.exitCode = 1;
        continue;
      }
      const [draft] =
        mode === 'publish' && result.outcome === 'skipped'
          ? await sql`select id, version from form_definitions where key = ${form.key} and status = 'draft' and legacy_form_type = ${form.legacyFormType}`
          : [];
      if (!draft) {
        console.log(`  ${form.key}: ${result.outcome} — ${result.note}`);
        continue;
      }
      const published = await publishDraft({ id: actor.id as string, role: 'admin', authenticatedAt: new Date() }, draft.id, Number(draft.version));
      if (!published.ok) {
        console.error(`  ${form.key}: ${published.error}`);
        process.exitCode = 1;
      } else {
        console.log(`  ${form.key}: published — 既有草稿已發佈 v${published.published}（含設計器中的修改）`);
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
