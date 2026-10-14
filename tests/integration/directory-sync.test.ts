import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DirectoryUser } from '@/lib/directory/users';

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();

describe('directory sync (fixture listing, disposable DB)', () => {
  let sql: Sql;
  const tag = `DS${Date.now()}`;
  // A per-run issuer keeps other tests' bindings out of the plan.
  const issuer = `https://directory-${tag.toLowerCase()}.invalid`;
  const ids = {} as Record<'a' | 'b' | 'c', string>;
  const identity = {} as Record<'a' | 'b' | 'c', string>;

  const dir = (id: string, email: string, flags: Partial<DirectoryUser> = {}): DirectoryUser => ({
    id,
    primaryEmail: email,
    fullName: id,
    suspended: false,
    archived: false,
    orgUnitPath: null,
    ...flags,
  });
  const sub = (n: number) => `${tag.replace(/\D/g, '')}${n}`;
  const listing = () => [
    dir(sub(1), `a-${tag}@example.test`.toLowerCase()),
    dir(sub(2), `b-${tag}@example.test`.toLowerCase(), { suspended: true }),
    dir(sub(3), `c-renamed-${tag}@example.test`.toLowerCase()),
    dir(sub(4), `new-${tag}@example.test`.toLowerCase()),
  ];
  const activeIdentity = async (employeeId: string) =>
    (await sql`select id, email from employee_identities where employee_id = ${employeeId} and revoked_at is null`)[0];

  beforeAll(async () => {
    sql = await loadSql();
    const [dept] = await sql`select id from departments limit 1`;
    for (const [key, n] of [['a', 1], ['b', 2], ['c', 3]] as const) {
      ids[key] = (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${key}`}, ${key}, ${dept.id}) returning id`)[0].id;
      identity[key] = (
        await sql`insert into employee_identities (employee_id, provider, issuer, subject, email)
          values (${ids[key]}, 'google', ${issuer}, ${sub(n)}, ${`${key}-${tag}@example.test`.toLowerCase()}) returning id`
      )[0].id;
    }
    await sql`insert into app_sessions (token_hash, employee_id, identity_id, expires_at)
      values (${randomBytes(32).toString('hex')}, ${ids.b}, ${identity.b}, now() + interval '1 hour')`;
  });

  afterAll(async () => {
    const all = Object.values(ids);
    await sql`delete from app_sessions where employee_id = any(${all}::uuid[])`;
    await sql`delete from employee_identities where employee_id = any(${all}::uuid[])`;
  });

  it('a dry run reports the changes and writes nothing', async () => {
    const { runDirectorySync } = await import('@/lib/directory/service');
    const outcome = await runDirectorySync(listing(), { issuer, apply: false });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.applied).toBe(false);
    expect(outcome.plan.revoke.map((r) => r.employeeId)).toEqual([ids.b]);
    expect(outcome.plan.emailChanges.map((c) => c.identityId)).toEqual([identity.c]);
    expect(outcome.plan.unbound.map((u) => u.subject)).toEqual([sub(4)]);
    expect(await activeIdentity(ids.b)).toBeDefined();
    const [s] = await sql`select count(*)::int as n from app_sessions where employee_id = ${ids.b} and revoked_at is null`;
    expect(s.n).toBe(1);
  });

  it('applying revokes the suspended binding and its sessions, and follows the email rename', async () => {
    const { runDirectorySync } = await import('@/lib/directory/service');
    const outcome = await runDirectorySync(listing(), { issuer, apply: true });
    expect(outcome).toMatchObject({ ok: true, applied: true });
    expect(await activeIdentity(ids.b)).toBeUndefined();
    const sessions = await sql`select revoked_reason from app_sessions where employee_id = ${ids.b}`;
    expect(sessions.map((s) => s.revoked_reason)).toEqual(['directory_suspended']);
    expect((await activeIdentity(ids.c)).email).toBe(`c-renamed-${tag}@example.test`.toLowerCase());
    expect(await activeIdentity(ids.a)).toBeDefined();
    const [audit] = await sql`select details from audit_events where action = 'directory.sync_applied' order by id desc limit 1`;
    expect(audit.details).toMatchObject({ activeCount: 3, sessionsRevoked: 1 });
  });

  it('a reactivated account is not restored, and a local suspension stays', async () => {
    const { runDirectorySync } = await import('@/lib/directory/service');
    await sql`update employees set access_enabled = false, disabled_at = now(), disabled_reason = '本地停權測試' where id = ${ids.a}`;
    const reactivated = listing().map((u) => (u.id === sub(2) ? { ...u, suspended: false } : u));
    const outcome = await runDirectorySync(reactivated, { issuer, apply: true });
    expect(outcome.ok).toBe(true);
    expect(await activeIdentity(ids.b)).toBeUndefined();
    if (outcome.ok) expect(outcome.plan.unbound.map((u) => u.subject)).toContain(sub(2));
    const [a] = await sql`select access_enabled from employees where id = ${ids.a}`;
    expect(a.access_enabled).toBe(false);
  });

  it('refuses to apply after a sharp drop in active accounts and changes nothing', async () => {
    const { runDirectorySync } = await import('@/lib/directory/service');
    const outcome = await runDirectorySync([dir(sub(1), `a-${tag}@example.test`.toLowerCase(), { suspended: true })], { issuer, apply: true });
    expect(outcome).toMatchObject({ ok: false, error: 'blocked' });
    expect(await activeIdentity(ids.a)).toBeDefined();
    const [audit] = await sql`select action from audit_events where entity_type = 'directory' order by id desc limit 1`;
    expect(audit.action).toBe('directory.sync_blocked');
  });

  it('refuses to run while another sync holds the lock', async () => {
    const { runDirectorySync } = await import('@/lib/directory/service');
    const holder = await sql.reserve();
    try {
      await holder`select pg_advisory_lock(hashtext('accsys.directory_sync'))`;
      expect(await runDirectorySync(listing(), { issuer, apply: false })).toEqual({ ok: false, error: 'busy' });
    } finally {
      await holder`select pg_advisory_unlock(hashtext('accsys.directory_sync'))`;
      holder.release();
    }
  });
});
