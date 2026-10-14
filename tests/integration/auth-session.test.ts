import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as logoutRoute } from '@/app/auth/logout/route';
import { GET as devLoginRoute } from '@/app/auth/dev/route';
import {
  approveLinkRequest,
  bootstrapFirstAdminBinding,
  rejectLinkRequest,
  revokeIdentity,
  setEmployeeAccess,
  setEmployeeRole,
  type AdminActor,
} from '@/lib/admin/accounts/service';
import { createSession, resolveSession } from '@/lib/auth/sessions';
import { getDb } from '@/lib/db';
import { appSessions, auditEvents, employeeIdentities, employees, identityLinkRequests } from '@/lib/db/schema';
import { proxy } from '@/proxy';

// Server actions read the session cookie through next/headers; point it at a
// per-test token so real actions run against a real session.
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === '__Host-accsys_sid' && jar.token ? { name, value: jar.token } : undefined),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const APP = 'https://accsys.test';
const RD_DEPARTMENT = '10000000-0000-0000-0000-000000000001';
const HOURS_8 = 8 * 3600_000;

beforeAll(() => {
  Object.assign(process.env, {
    APP_ORIGIN: APP,
    AUTH_MODE: 'manual',
    OIDC_ISSUER: 'https://idp.test',
    GOOGLE_CLIENT_ID: 'c',
    GOOGLE_CLIENT_SECRET: 's',
    ALLOWED_GOOGLE_DOMAINS: 'example.test',
    SESSION_SECRET: 'integration-test-session-secret-0123456789',
  });
});

async function newEmployee(role: 'staff' | 'finance' | 'admin' = 'staff') {
  const code = `S-${randomUUID().slice(0, 8)}`;
  const [row] = await getDb()
    .insert(employees)
    .values({ employeeCode: code, name: code, departmentId: RD_DEPARTMENT, googleEmail: `${code.toLowerCase()}@example.test`, role })
    .returning();
  return row;
}

async function boundSession(employeeId: string) {
  const [identity] = await getDb()
    .insert(employeeIdentities)
    .values({ employeeId, provider: 'google', issuer: 'https://idp.test', subject: `sub-${randomUUID()}`, email: 'x@example.test' })
    .returning();
  const { token } = await createSession(getDb(), { employeeId, identityId: identity.id, ttlMs: HOURS_8 });
  return { token, identity };
}

function actorOf(employee: { id: string; role: string }, loginMinutesAgo = 1): AdminActor {
  return { id: employee.id, role: employee.role, authenticatedAt: new Date(Date.now() - loginMinutesAgo * 60_000) };
}

function logoutRequest(token: string | undefined, headers: Record<string, string>) {
  return new NextRequest(`${APP}/auth/logout`, {
    method: 'POST',
    headers: { ...(token ? { cookie: `__Host-accsys_sid=${token}` } : {}), ...headers },
  });
}

describe('sessions', () => {
  it('logout (same-origin POST) revokes the database session and clears cookies', async () => {
    const emp = await newEmployee();
    const { token } = await boundSession(emp.id);
    const res = await logoutRoute(logoutRequest(token, { origin: APP }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${APP}/login`);
    expect(res.cookies.get('__Host-accsys_sid')?.value).toBe('');
    expect(await resolveSession(token)).toBeNull();
  });

  it.each([
    ['a foreign Origin', { origin: 'https://evil.test' }],
    ['a cross-site request without Origin', { 'sec-fetch-site': 'cross-site' }],
    ['no Origin and no Sec-Fetch-Site', {}],
  ])('logout from %s is refused and the session stays valid', async (_label, headers) => {
    const emp = await newEmployee();
    const { token } = await boundSession(emp.id);
    const res = await logoutRoute(logoutRequest(token, headers as Record<string, string>));
    expect(res.status).toBe(403);
    expect(await resolveSession(token)).not.toBeNull();
  });

  it('logout is not reachable with GET', async () => {
    const mod = await import('@/app/auth/logout/route');
    expect('GET' in mod).toBe(false);
  });

  it('an expired session is rejected', async () => {
    const emp = await newEmployee();
    const { token } = await boundSession(emp.id);
    await getDb()
      .update(appSessions)
      .set({ createdAt: sql`now() - interval '9 hours'`, expiresAt: sql`now() - interval '1 hour'` })
      .where(eq(appSessions.employeeId, emp.id));
    expect(await resolveSession(token)).toBeNull();
  });

  it('a disabled employee loses access on the next request, even for a not-yet-revoked session', async () => {
    const emp = await newEmployee();
    const { token } = await boundSession(emp.id);
    await getDb()
      .update(employees)
      .set({ accessEnabled: false, disabledAt: new Date(), disabledReason: 'test' })
      .where(eq(employees.id, emp.id));
    expect(await resolveSession(token)).toBeNull();
  });

  it('a role change applies on the next request', async () => {
    const emp = await newEmployee('staff');
    const { token } = await boundSession(emp.id);
    expect((await resolveSession(token))?.role).toBe('staff');
    await getDb().update(employees).set({ role: 'finance' }).where(eq(employees.id, emp.id));
    expect((await resolveSession(token))?.role).toBe('finance');
  });

  it('a session of a revoked Google binding is rejected', async () => {
    const emp = await newEmployee();
    const { token, identity } = await boundSession(emp.id);
    await getDb().update(employeeIdentities).set({ revokedAt: new Date() }).where(eq(employeeIdentities.id, identity.id));
    expect(await resolveSession(token)).toBeNull();
  });

  it('garbage and unknown tokens resolve to nobody', async () => {
    expect(await resolveSession('not-a-token')).toBeNull();
    expect(await resolveSession('x'.repeat(500))).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });

  it('only a hash of the token is stored', async () => {
    const emp = await newEmployee();
    const { token } = await boundSession(emp.id);
    const rows = await getDb().select().from(appSessions).where(eq(appSessions.employeeId, emp.id));
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe('unauthenticated and unknown users', () => {
  it('server actions refuse to act without a valid session', async () => {
    jar.token = undefined;
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({} as never);
    expect(result.ok).toBe(false);
  });

  it('admin actions refuse a staff session', async () => {
    const staff = await newEmployee('staff');
    const { token } = await boundSession(staff.id);
    jar.token = token;
    const { setEmployeeRoleAction } = await import('@/lib/admin/accounts/actions');
    expect(await setEmployeeRoleAction(staff.id, 'admin')).toEqual({ ok: false, error: 'forbidden' });
    jar.token = undefined;
  });

  it('proxy sends visitors without a session cookie to /login and drops the legacy email cookie', () => {
    const res = proxy(new NextRequest(`${APP}/requests/123`, { headers: { cookie: 'accsys_session=legacy' } }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    expect(new URL(res.headers.get('location')!).searchParams.get('returnTo')).toBe('/requests/123');
    expect(res.cookies.get('accsys_session')?.value).toBe('');
  });

  it('proxy redirects to APP_ORIGIN even when the Host header is forged', () => {
    const res = proxy(new NextRequest('https://evil.test/dashboard', { headers: { host: 'evil.test' } }));
    expect(new URL(res.headers.get('location')!).origin).toBe(APP);
  });

  it('proxy keeps the sandbox CSP on attachment downloads and the page CSP elsewhere', () => {
    const cookie = { cookie: '__Host-accsys_sid=x' };
    const download = proxy(new NextRequest(`${APP}/api/attachments/${randomUUID()}`, { headers: cookie }));
    expect(download.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    const page = proxy(new NextRequest(`${APP}/dashboard`, { headers: cookie }));
    expect(page.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('development login is unavailable outside `next dev`', async () => {
    const res = await devLoginRoute(new NextRequest(`${APP}/auth/dev?as=admin`));
    expect(res.status).toBe(404);
  });
});

describe('admin account management', () => {
  async function pendingRequest(email = `req-${randomUUID().slice(0, 6)}@example.test`) {
    const [row] = await getDb()
      .insert(identityLinkRequests)
      .values({ provider: 'google', issuer: 'https://idp.test', subject: `sub-${randomUUID()}`, email })
      .returning();
    return row;
  }

  it('requires an admin whose login is recent', async () => {
    const staff = await newEmployee('staff');
    const admin = await newEmployee('admin');
    const req = await pendingRequest();
    const target = await newEmployee();
    expect(await approveLinkRequest(actorOf(staff), { requestId: req.id, employeeId: target.id })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await approveLinkRequest(null, { requestId: req.id, employeeId: target.id })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await approveLinkRequest(actorOf(admin, 30), { requestId: req.id, employeeId: target.id })).toEqual({
      ok: false,
      error: 'reauth_required',
    });
  });

  it('approves a link request, binding exactly that Google subject, with an audit event', async () => {
    const admin = await newEmployee('admin');
    const target = await newEmployee();
    const req = await pendingRequest();
    expect(await approveLinkRequest(actorOf(admin), { requestId: req.id, employeeId: target.id })).toEqual({ ok: true });

    const [identity] = await getDb().select().from(employeeIdentities).where(eq(employeeIdentities.employeeId, target.id));
    expect(identity).toMatchObject({ subject: req.subject, issuer: req.issuer, revokedAt: null });
    const [after] = await getDb().select().from(identityLinkRequests).where(eq(identityLinkRequests.id, req.id));
    expect(after).toMatchObject({ status: 'approved', approvedEmployeeId: target.id, decidedByEmployeeId: admin.id });
    const audit = await getDb().select().from(auditEvents).where(eq(auditEvents.entityId, target.id));
    expect(audit.map((a) => a.action)).toContain('identity.linked');
  });

  it('will not attach a second Google account to an already bound employee', async () => {
    const admin = await newEmployee('admin');
    const target = await newEmployee();
    await boundSession(target.id);
    const req = await pendingRequest(target.googleEmail!);
    expect(await approveLinkRequest(actorOf(admin), { requestId: req.id, employeeId: target.id })).toEqual({
      ok: false,
      error: 'employee_already_bound',
    });
  });

  it("refuses actions on the admin's own account", async () => {
    const admin = await newEmployee('admin');
    expect(await setEmployeeRole(actorOf(admin), { employeeId: admin.id, role: 'staff' })).toEqual({
      ok: false,
      error: 'self_action',
    });
    expect(await setEmployeeAccess(actorOf(admin), { employeeId: admin.id, enabled: false, reason: 'x' })).toEqual({
      ok: false,
      error: 'self_action',
    });
  });

  it('disabling requires a reason, revokes all sessions and is audited', async () => {
    const admin = await newEmployee('admin');
    const target = await newEmployee();
    const { token } = await boundSession(target.id);
    expect(await setEmployeeAccess(actorOf(admin), { employeeId: target.id, enabled: false })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(await setEmployeeAccess(actorOf(admin), { employeeId: target.id, enabled: false, reason: '離職' })).toEqual({
      ok: true,
    });
    const [session] = await getDb().select().from(appSessions).where(eq(appSessions.employeeId, target.id));
    expect(session.revokedReason).toBe('access_disabled');
    expect(await resolveSession(token)).toBeNull();
    // Re-enabling does not resurrect old sessions.
    expect(await setEmployeeAccess(actorOf(admin), { employeeId: target.id, enabled: true })).toEqual({ ok: true });
    expect(await resolveSession(token)).toBeNull();
  });

  it('revoking a binding logs the employee out everywhere', async () => {
    const admin = await newEmployee('admin');
    const target = await newEmployee();
    const { token } = await boundSession(target.id);
    expect(await revokeIdentity(actorOf(admin), { employeeId: target.id })).toEqual({ ok: true });
    expect(await resolveSession(token)).toBeNull();
  });

  it('role changes are validated and audited with before/after', async () => {
    const admin = await newEmployee('admin');
    const target = await newEmployee('staff');
    expect(await setEmployeeRole(actorOf(admin), { employeeId: target.id, role: 'superuser' })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(await setEmployeeRole(actorOf(admin), { employeeId: target.id, role: 'finance' })).toEqual({ ok: true });
    const [event] = await getDb()
      .select()
      .from(auditEvents)
      .where(sql`${auditEvents.entityId} = ${target.id} and ${auditEvents.action} = 'employee.role_changed'`);
    expect(event.details).toEqual({ from: 'staff', to: 'finance' });
  });

  it('two admins demoting each other at the same moment cannot both succeed', async () => {
    const a = await newEmployee('admin');
    const b = await newEmployee('admin');
    const results = await Promise.all([
      setEmployeeRole(actorOf(a), { employeeId: b.id, role: 'staff' }),
      setEmployeeRole(actorOf(b), { employeeId: a.id, role: 'staff' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'forbidden' }]);
    const roles = await getDb()
      .select({ role: employees.role })
      .from(employees)
      .where(sql`${employees.id} in (${a.id}, ${b.id})`);
    expect(roles.filter((r) => r.role === 'admin')).toHaveLength(1);
  });

  it('malformed ids are refused as invalid input, not database errors', async () => {
    const admin = await newEmployee('admin');
    expect(await setEmployeeRole(actorOf(admin), { employeeId: 'x', role: 'staff' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(await setEmployeeAccess(actorOf(admin), { employeeId: "1' or 1=1", enabled: false, reason: 'r' })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(await approveLinkRequest(actorOf(admin), { requestId: 'nope', employeeId: randomUUID() })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
  });

  it('rejected requests stay rejected', async () => {
    const admin = await newEmployee('admin');
    const req = await pendingRequest();
    expect(await rejectLinkRequest(actorOf(admin), { requestId: req.id })).toEqual({ ok: true });
    expect(await rejectLinkRequest(actorOf(admin), { requestId: req.id })).toEqual({ ok: false, error: 'invalid_state' });
  });

  it('first-admin bootstrap works once, only for an admin employee, then refuses', async () => {
    // Start from "no enabled admin has a Google binding" in the shared test DB.
    await getDb().execute(sql`
      update employee_identities set revoked_at = now()
       where revoked_at is null and employee_id in (select id from employees where role = 'admin')`);
    const staff = await newEmployee('staff');
    const admin = await newEmployee('admin');
    const req = await pendingRequest();

    expect(await bootstrapFirstAdminBinding({ requestId: req.id, employeeCode: staff.employeeCode })).toEqual({
      ok: false,
      error: 'not_admin',
    });
    expect(await bootstrapFirstAdminBinding({ requestId: req.id, employeeCode: admin.employeeCode })).toEqual({
      ok: true,
      employeeId: admin.id,
    });
    const second = await pendingRequest();
    const other = await newEmployee('admin');
    expect(await bootstrapFirstAdminBinding({ requestId: second.id, employeeCode: other.employeeCode })).toEqual({
      ok: false,
      error: 'admin_already_bound',
    });
  });
});
