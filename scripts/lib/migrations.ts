import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type { Sql } from 'postgres';

export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';
export const OWNER_ROLE = 'accsys_owner';
/** pg_advisory_lock key shared by db:migrate and db:baseline (arbitrary, fixed). */
export const MIGRATION_LOCK_KEY = '4242002501';
/** Journal tags that together reproduce db/legacy/schema-v0.sql exactly. */
export const BASELINE_TAGS = ['0000_baseline_tables', '0001_baseline_functions'];

export type JournalMigration = MigrationMeta & { tag: string };

export function loadMigrations(folder = MIGRATIONS_FOLDER): JournalMigration[] {
  const metas = readMigrationFiles({ migrationsFolder: folder });
  // readMigrationFiles keeps journal order; attach tags for readable errors.
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  return metas.map((m, i) => ({ ...m, tag: journal.entries[i].tag }));
}

export type AppliedMigration = { hash: string; createdAt: number };

/**
 * Refuses to proceed when the database and the repository disagree:
 * an applied migration was edited or removed, or a new migration was inserted
 * before one that is already applied (it would be silently skipped).
 */
export function verifyAppliedMigrations(
  journal: JournalMigration[],
  applied: AppliedMigration[]
): { ok: true; pending: JournalMigration[] } | { ok: false; error: string } {
  for (let i = 1; i < journal.length; i += 1) {
    if (journal[i].folderMillis <= journal[i - 1].folderMillis) {
      return { ok: false, error: `journal timestamps are not increasing at ${journal[i].tag}` };
    }
  }
  const byMillis = new Map(journal.map((m) => [m.folderMillis, m]));
  for (const row of applied) {
    const match = byMillis.get(row.createdAt);
    if (!match) {
      return {
        ok: false,
        error: `database has an applied migration (created_at=${row.createdAt}) that is not in drizzle/`,
      };
    }
    if (match.hash !== row.hash) {
      return {
        ok: false,
        error: `applied migration ${match.tag} was modified after it was applied (checksum mismatch)`,
      };
    }
  }
  const appliedMillis = new Set(applied.map((r) => r.createdAt));
  const lastApplied = applied.reduce((max, r) => Math.max(max, r.createdAt), 0);
  const skipped = journal.find((m) => !appliedMillis.has(m.folderMillis) && m.folderMillis < lastApplied);
  if (skipped) {
    return {
      ok: false,
      error: `migration ${skipped.tag} is older than the latest applied migration but was never applied`,
    };
  }
  return { ok: true, pending: journal.filter((m) => !appliedMillis.has(m.folderMillis)) };
}

export async function readApplied(sql: Sql): Promise<AppliedMigration[] | null> {
  const [{ exists }] = await sql<{ exists: boolean }[]>`
    select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) is not null as exists`;
  if (!exists) return null;
  const rows = await sql<{ hash: string; created_at: string }[]>`
    select hash, created_at from ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)} order by created_at`;
  return rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

export async function countPublicTables(sql: Sql): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_class
     where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')`;
  return n;
}

/**
 * Structural fingerprint of the public schema: columns, constraints, indexes,
 * non-extension functions, triggers and extensions. Ownership and grants are
 * excluded (they differ by environment and are handled by db/roles.sql).
 */
export async function schemaFingerprint(sql: Sql): Promise<string[]> {
  const rows = await sql<{ line: string }[]>`
    select 'extension ' || extname as line
      from pg_extension where extname <> 'plpgsql'
    union all
    select format('column %s.%s #%s %s%s%s%s', c.relname, a.attname, a.attnum,
                  format_type(a.atttypid, a.atttypmod),
                  case when a.attnotnull then ' not null' else '' end,
                  coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
                  case when a.attidentity <> '' then ' identity ' || a.attidentity::text else '' end)
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and a.attnum > 0 and not a.attisdropped
    union all
    select format('constraint %s.%s %s', conrelid::regclass, conname, pg_get_constraintdef(oid))
      from pg_constraint where connamespace = 'public'::regnamespace
    union all
    select 'index ' || indexdef from pg_indexes where schemaname = 'public'
    union all
    select format('function %s(%s) md5=%s', p.proname, pg_get_function_identity_arguments(p.oid),
                  md5(pg_get_functiondef(p.oid)))
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not exists (select from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    union all
    select 'trigger ' || pg_get_triggerdef(t.oid)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal`;
  // attnum is part of each column line, so column order differences are detected.
  return rows.map((r) => r.line).sort();
}

export function diffLines(expected: string[], actual: string[]): string[] {
  const exp = new Set(expected);
  const act = new Set(actual);
  return [
    ...expected.filter((l) => !act.has(l)).map((l) => `- ${l}`),
    ...actual.filter((l) => !exp.has(l)).map((l) => `+ ${l}`),
  ];
}

export async function withMigrationLock<T>(sql: Sql, fn: () => Promise<T>): Promise<T> {
  await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
  try {
    return await fn();
  } finally {
    await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
  }
}

export function requireMigrationUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.MIGRATION_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'MIGRATION_DATABASE_URL is required (the accsys_migrator account). ' +
        'Migrations never use the runtime DATABASE_URL.'
    );
  }
  return url;
}
