import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schemaFingerprint } from '../../scripts/lib/migrations';
import { resolveAdminDatabaseUrl } from './test-database-url';

/**
 * Migration drills against scratch databases on the disposable test server:
 * empty database, adoption of a database created by the legacy schema script
 * with data, re-runs, concurrent runs, tampering, drift and role privileges.
 * Every scratch database is named accsys_mig_<random>_test and dropped at the end.
 */

const run = promisify(execFile);
const ROOT = path.resolve(__dirname, '../..');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');
const PASSWORDS = {
  accsys_migrator: 'accsys_migrator_test',
  accsys_app: 'accsys_app_test',
  accsys_backup: 'accsys_backup_test',
} as const;
type LoginRole = keyof typeof PASSWORDS;

const LEGACY_TABLES: Record<string, { key: string; newColumns?: string[] }> = {
  departments: { key: 'id' },
  employees: { key: 'id', newColumns: ['access_enabled', 'disabled_at', 'disabled_reason'] },
  projects: { key: 'id' },
  budget_codes: { key: 'id' },
  suppliers: { key: 'id' },
  procurement_cases: { key: 'id' },
  case_number_counters: { key: 'year_month' },
  purchase_requests: { key: 'id' },
  purchase_request_items: { key: 'id' },
  purchase_orders: { key: 'id' },
  purchase_order_items: { key: 'id' },
  acceptances: { key: 'id' },
  acceptance_items: { key: 'id' },
  expense_requests: { key: 'id' },
  expense_request_items: { key: 'id' },
  approval_steps: { key: 'id' },
  notifications: { key: 'id' },
  attachments: { key: 'id' },
};

const admin = resolveAdminDatabaseUrl(process.env);
if (!admin.ok) throw new Error(admin.error);
const adminUrl = admin.url;

function urlFor(db: string, role?: LoginRole): string {
  const url = new URL(adminUrl);
  url.pathname = `/${db}`;
  if (role) {
    url.username = role;
    url.password = PASSWORDS[role];
  }
  return url.toString();
}

const created: string[] = [];
const clients: Sql[] = [];
let adminSql: Sql;

function connect(db: string, role?: LoginRole): Sql {
  const sql = postgres(urlFor(db, role), { max: 1, onnotice: () => {} });
  clients.push(sql);
  return sql;
}

async function createDatabase(): Promise<string> {
  const name = `accsys_mig_${randomBytes(4).toString('hex')}_test`;
  await adminSql.unsafe(`create database "${name}"`);
  created.push(name);
  const db = connect(name);
  await db.file(path.join(ROOT, 'db/roles.sql'));
  return name;
}

async function runScript(script: 'db-migrate' | 'db-baseline', db: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: urlFor(db, 'accsys_migrator') };
  delete env.DATABASE_URL; // migrations must never fall back to the runtime URL
  try {
    const { stdout, stderr } = await run(TSX, [path.join(ROOT, `scripts/${script}.ts`)], { env, cwd: ROOT });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

async function appliedCount(db: Sql): Promise<number> {
  const [{ exists }] = await db`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!exists) return 0;
  const [{ n }] = await db`select count(*)::int as n from drizzle.__drizzle_migrations`;
  return n;
}

/** Row-level digest of every legacy table, ignoring columns added by migrations. */
async function dataSnapshot(db: Sql): Promise<Record<string, { rows: number; digest: string }>> {
  const out: Record<string, { rows: number; digest: string }> = {};
  for (const [table, { key, newColumns = [] }] of Object.entries(LEGACY_TABLES)) {
    const strip = newColumns.map((c) => ` - '${c}'`).join('');
    const [row] = await db.unsafe(
      `select count(*)::int as rows,
              coalesce(md5(string_agg((to_jsonb(t)${strip})::text, '|' order by t.${key}::text)), '') as digest
         from ${table} t`
    );
    out[table] = { rows: row.rows, digest: row.digest };
  }
  return out;
}

async function buildLegacyDatabase(): Promise<{ name: string; db: Sql }> {
  const name = `accsys_mig_${randomBytes(4).toString('hex')}_test`;
  await adminSql.unsafe(`create database "${name}"`);
  created.push(name);
  const db = connect(name);
  // Exactly how pre-migration databases were created: the full DDL script run
  // by the bootstrap superuser, then data.
  await db.file(path.join(ROOT, 'db/legacy/schema-v0.sql'));
  await db.file(path.join(ROOT, 'tests/integration/fixtures/base.sql'));
  await db.file(path.join(ROOT, 'tests/integration/fixtures/legacy-forms.sql'));
  await db.file(path.join(ROOT, 'db/roles.sql'));
  return { name, db };
}

beforeAll(async () => {
  adminSql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await adminSql.file(path.join(ROOT, 'db/roles.sql'));
  for (const [role, password] of Object.entries(PASSWORDS)) {
    await adminSql.unsafe(`alter role ${role} password '${password}'`);
  }
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end({ timeout: 5 })));
  for (const name of created) {
    await adminSql.unsafe(`drop database if exists "${name}" with (force)`);
  }
  await adminSql.end();
});

describe('migrations on an empty database', () => {
  it('creates the full schema, and a re-run is a no-op', async () => {
    const name = await createDatabase();
    const db = connect(name);

    const first = await runScript('db-migrate', name);
    expect(first.code, first.out).toBe(0);
    expect(await appliedCount(db)).toBe(4);
    const before = await schemaFingerprint(db);
    expect(before).toContain('extension pgcrypto');
    expect(before.some((l) => l.startsWith('column audit_events.details'))).toBe(true);

    const second = await runScript('db-migrate', name);
    expect(second.code, second.out).toBe(0);
    expect(second.out).toContain('Up to date (4 migrations applied)');
    expect(await appliedCount(db)).toBe(4);
    expect(await schemaFingerprint(db)).toEqual(before);
  });

  it('serializes concurrent runs so each migration is applied exactly once', async () => {
    const name = await createDatabase();
    const results = await Promise.all([runScript('db-migrate', name), runScript('db-migrate', name)]);
    for (const r of results) expect(r.code, r.out).toBe(0);
    const db = connect(name);
    const rows = await db`select hash, count(*)::int as n from drizzle.__drizzle_migrations group by hash`;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.n === 1)).toBe(true);
  });

  it('refuses to run when an applied migration no longer matches its file', async () => {
    const name = await createDatabase();
    expect((await runScript('db-migrate', name)).code).toBe(0);
    const db = connect(name);
    await db`update drizzle.__drizzle_migrations set hash = 'tampered'
             where created_at = (select min(created_at) from drizzle.__drizzle_migrations)`;
    const result = await runScript('db-migrate', name);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('modified after it was applied');
  });
});

describe('adopting a database created by the legacy schema script', () => {
  it('upgrades a copy with data without changing ids, amounts, rows or foreign keys', async () => {
    const { name, db } = await buildLegacyDatabase();
    const before = await dataSnapshot(db);
    expect(before.expense_requests.rows).toBe(2);

    // Plain migrate must refuse: it would otherwise try to CREATE existing tables.
    const refused = await runScript('db-migrate', name);
    expect(refused.code).not.toBe(0);
    expect(refused.out).toContain('db:baseline');
    expect(await appliedCount(db)).toBe(0);

    const adopted = await runScript('db-baseline', name);
    expect(adopted.code, adopted.out).toBe(0);
    expect(await appliedCount(db)).toBe(2);
    const again = await runScript('db-baseline', name);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('Nothing to do');

    const upgraded = await runScript('db-migrate', name);
    expect(upgraded.code, upgraded.out).toBe(0);
    expect(upgraded.out).toContain('0002_identity_sessions_audit, 0003_audit_append_only');
    expect(await appliedCount(db)).toBe(4);

    expect(await dataSnapshot(db)).toEqual(before);
    const [{ invalid }] = await db`
      select count(*)::int as invalid from pg_constraint
       where connamespace = 'public'::regnamespace and not convalidated`;
    expect(invalid).toBe(0);
    const [{ sum }] = await db`select sum(total_amount)::text as sum from expense_requests`;
    expect(sum).toBe('31235.06');

    // Existing employees keep access; no login identity is inferred from email.
    const [{ disabled }] = await db`select count(*)::int as disabled from employees where not access_enabled`;
    expect(disabled).toBe(0);
    const [{ identities }] = await db`select count(*)::int as identities from employee_identities`;
    expect(identities).toBe(0);

    // The migrated legacy database is structurally identical to a fresh one.
    const fresh = await createDatabase();
    expect((await runScript('db-migrate', fresh)).code).toBe(0);
    expect(await schemaFingerprint(db)).toEqual(await schemaFingerprint(connect(fresh)));

    const rerun = await runScript('db-migrate', name);
    expect(rerun.out).toContain('Up to date');
    expect(await dataSnapshot(db)).toEqual(before);
  });

  it('stops without writing anything when the live schema has drifted', async () => {
    const { name, db } = await buildLegacyDatabase();
    await db`alter table suppliers add column local_note text`;
    const result = await runScript('db-baseline', name);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('+ column suppliers.local_note');
    expect(await appliedCount(db)).toBe(0);
  });
});

describe('database role privileges after migration', () => {
  let name: string;
  let app: Sql;

  beforeAll(async () => {
    name = await createDatabase();
    expect((await runScript('db-migrate', name)).code).toBe(0);
    await connect(name).file(path.join(ROOT, 'tests/integration/fixtures/base.sql'));
    app = connect(name, 'accsys_app');
  });

  it('runtime role is not a superuser and has server-side timeouts', async () => {
    const [role] = await app`select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    const [{ statement_timeout }] = await app`show statement_timeout`;
    expect(statement_timeout).toBe('30s');
  });

  it('runtime role can read and write business tables', async () => {
    await app`update suppliers set notes = 'ok' where id = '50000000-0000-0000-0000-000000000001'`;
    const [{ case_number }] = await app`select next_case_number() as case_number`;
    expect(case_number).toMatch(/^CP\d{9}$/);
  });

  it.each([
    ['create table', 'create table evil (id int)'],
    ['alter table', 'alter table employees add column evil text'],
    ['drop table', 'drop table notifications'],
    ['truncate', 'truncate notifications'],
    ['create function', 'create function evil() returns int language sql as $$ select 1 $$'],
    ['read migration history', 'select * from drizzle.__drizzle_migrations'],
  ])('runtime role cannot %s', async (_label, statement) => {
    await expect(app.unsafe(statement)).rejects.toMatchObject({ code: '42501' });
  });

  it('audit_events is append-only for the runtime role and the owner', async () => {
    await app`insert into audit_events (actor_type, action, entity_type) values ('system', 'test.insert', 'test')`;
    await expect(app`update audit_events set action = 'x'`).rejects.toMatchObject({ code: '42501' });
    await expect(app`delete from audit_events`).rejects.toMatchObject({ code: '42501' });
    // Even the owning role (via the migrator) hits the trigger.
    const migrator = connect(name, 'accsys_migrator');
    await migrator`set role accsys_owner`;
    await expect(migrator`delete from audit_events`).rejects.toMatchObject({ code: '42501' });
    await expect(migrator`truncate audit_events`).rejects.toMatchObject({ code: '42501' });
  });

  it('backup role can read but not write', async () => {
    const backup = connect(name, 'accsys_backup');
    const [{ n }] = await backup`select count(*)::int as n from employees`;
    expect(n).toBeGreaterThan(0);
    await expect(backup`update suppliers set notes = 'x'`).rejects.toMatchObject({ code: '25006' });
  });

  it('employee_identities rejects a second binding of the same Google subject', async () => {
    const insert = (employeeId: string) => app`
      insert into employee_identities (employee_id, provider, issuer, subject, email)
      values (${employeeId}, 'google', 'https://accounts.google.com', 'sub-123', 'a@example.test')`;
    await insert('20000000-0000-0000-0000-000000000001');
    await expect(insert('20000000-0000-0000-0000-000000000002')).rejects.toMatchObject({ code: '23505' });
  });

  it('app_sessions only accepts a SHA-256 hex token hash', async () => {
    await expect(app`
      insert into app_sessions (token_hash, employee_id, expires_at)
      values ('plain-token', '20000000-0000-0000-0000-000000000001', now() + interval '8 hours')`).rejects.toMatchObject({
      code: '23514',
    });
  });
});
