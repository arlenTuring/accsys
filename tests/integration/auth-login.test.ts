import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as callbackRoute } from '@/app/auth/callback/route';
import { GET as startRoute } from '@/app/auth/google/route';
import { __setOidcFetchForTests } from '@/lib/auth/oidc';
import { resolveSession } from '@/lib/auth/sessions';
import { getDb } from '@/lib/db';
import { auditEvents, employeeIdentities, employees, identityLinkRequests } from '@/lib/db/schema';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_ISSUER, FakeOidcProvider } from './helpers/fake-oidc';

const APP = 'https://accsys.test';
const SESSION_COOKIE = '__Host-accsys_sid';
const LOGIN_COOKIE = '__Host-accsys_login';
const RD_DEPARTMENT = '10000000-0000-0000-0000-000000000001';

let idp: FakeOidcProvider;

beforeAll(async () => {
  Object.assign(process.env, {
    APP_ORIGIN: APP,
    AUTH_MODE: 'manual',
    OIDC_ISSUER: FAKE_ISSUER,
    GOOGLE_CLIENT_ID: FAKE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: FAKE_CLIENT_SECRET,
    ALLOWED_GOOGLE_DOMAINS: 'example.test',
    SESSION_SECRET: 'integration-test-session-secret-0123456789',
    TRUSTED_CLIENT_IP_HEADER: 'x-test-ip',
  });
  idp = await FakeOidcProvider.create();
  __setOidcFetchForTests(idp.fetch);
});

afterAll(() => __setOidcFetchForTests(undefined));

function ip() {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function newEmployee(overrides: Partial<typeof employees.$inferInsert> = {}) {
  const code = `T-${randomUUID().slice(0, 8)}`;
  const [row] = await getDb()
    .insert(employees)
    .values({ employeeCode: code, name: `測試 ${code}`, departmentId: RD_DEPARTMENT, googleEmail: `${code}@example.test`.toLowerCase(), ...overrides })
    .returning();
  return row;
}

async function bind(employeeId: string, subject: string, email: string) {
  const [row] = await getDb()
    .insert(employeeIdentities)
    .values({ employeeId, provider: 'google', issuer: FAKE_ISSUER, subject, email })
    .returning();
  return row;
}

type Flow = {
  start: Response;
  callback: Response;
  sessionToken: string | undefined;
  location: URL;
};

/**
 * Drives /auth/google -> fake provider -> /auth/callback. `claims` may be a
 * function of the authorization request (to use its nonce).
 */
async function login(options: {
  sub: string;
  email: string;
  claims?: (auth: URL) => Record<string, unknown>;
  signWith?: 'provider' | 'attacker';
  returnTo?: string;
  mutateCallback?: (url: URL, cookies: Record<string, string>) => void;
  cookies?: Record<string, string>;
  host?: string;
  clientIp?: string;
}): Promise<Flow> {
  const clientIp = options.clientIp ?? ip();
  const startUrl = new URL('/auth/google', options.host ? `https://${options.host}` : APP);
  if (options.returnTo) startUrl.searchParams.set('returnTo', options.returnTo);
  const start = await startRoute(new NextRequest(startUrl, { headers: { 'x-test-ip': clientIp } }));
  const auth = new URL(start.headers.get('location')!);
  const loginCookie = (start as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get(
    LOGIN_COOKIE
  )?.value;

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: FAKE_ISSUER,
    aud: FAKE_CLIENT_ID,
    sub: options.sub,
    email: options.email,
    email_verified: true,
    hd: 'example.test',
    name: 'Test User',
    nonce: auth.searchParams.get('nonce'),
    iat: now,
    exp: now + 300,
    ...(options.claims?.(auth) ?? {}),
  };
  const code = idp.issueCode(auth, claims, { signWith: options.signWith });

  const cb = new URL('/auth/callback', options.host ? `https://${options.host}` : APP);
  cb.searchParams.set('code', code);
  cb.searchParams.set('state', auth.searchParams.get('state')!);
  const cookies: Record<string, string> = { ...(options.cookies ?? {}) };
  if (loginCookie) cookies[LOGIN_COOKIE] = loginCookie;
  options.mutateCallback?.(cb, cookies);

  const callback = await callbackRoute(
    new NextRequest(cb, {
      headers: {
        cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
        'x-test-ip': clientIp,
        ...(options.host ? { host: options.host } : {}),
      },
    })
  );
  const setCookies = (callback as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies;
  const sessionToken = setCookies.get(SESSION_COOKIE)?.value || undefined;
  return { start, callback, sessionToken, location: new URL(callback.headers.get('location')!) };
}

const errorOf = (flow: Flow) => flow.location.searchParams.get('error');

describe('Google login: success paths', () => {
  it('signs in a bound identity and redirects to a safe returnTo on the app origin', async () => {
    const emp = await newEmployee();
    const sub = `sub-${randomUUID()}`;
    await bind(emp.id, sub, emp.googleEmail!);

    const flow = await login({ sub, email: emp.googleEmail!, returnTo: '/requests?tab=mine' });

    expect(flow.callback.status).toBe(303);
    expect(flow.location.href).toBe(`${APP}/requests?tab=mine`);
    expect(flow.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const session = await resolveSession(flow.sessionToken);
    expect(session?.id).toBe(emp.id);
    // PKCE verifier, client secret and the fixed redirect_uri reached the token endpoint.
    const tokenRequest = idp.tokenRequests.at(-1)!;
    expect(tokenRequest.get('redirect_uri')).toBe(`${APP}/auth/callback`);
    expect(tokenRequest.get('code_verifier')).toBeTruthy();
    // Login cookie is single-use.
    const cleared = (flow.callback as unknown as { cookies: { get(n: string): { value: string } } }).cookies.get(LOGIN_COOKIE);
    expect(cleared?.value).toBe('');
    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'auth.login_succeeded'), eq(auditEvents.actorEmployeeId, emp.id)));
    expect(audit).toHaveLength(1);
  });

  it('keeps the same employee when the Google account changes its email (same sub)', async () => {
    const emp = await newEmployee();
    const sub = `sub-${randomUUID()}`;
    const identity = await bind(emp.id, sub, emp.googleEmail!);
    const before = await getDb().$count(employees);

    const flow = await login({ sub, email: `renamed-${emp.employeeCode.toLowerCase()}@example.test` });

    expect((await resolveSession(flow.sessionToken))?.id).toBe(emp.id);
    expect(await getDb().$count(employees)).toBe(before);
    const [after] = await getDb().select().from(employeeIdentities).where(eq(employeeIdentities.id, identity.id));
    expect(after.email).toBe(`renamed-${emp.employeeCode.toLowerCase()}@example.test`);
  });

  it('replaces (revokes) a session the browser already had', async () => {
    const emp = await newEmployee();
    const sub = `sub-${randomUUID()}`;
    await bind(emp.id, sub, emp.googleEmail!);
    const first = await login({ sub, email: emp.googleEmail! });
    const second = await login({ sub, email: emp.googleEmail!, cookies: { [SESSION_COOKIE]: first.sessionToken! } });
    expect(await resolveSession(second.sessionToken)).not.toBeNull();
    expect(await resolveSession(first.sessionToken)).toBeNull();
  });
});

describe('Google login: identity binding rules', () => {
  it('does not bind an unknown account by email; it waits for admin approval', async () => {
    const emp = await newEmployee();
    const sub = `sub-${randomUUID()}`;

    const flow = await login({ sub, email: emp.googleEmail! });

    expect(errorOf(flow)).toBe('pending_approval');
    expect(flow.sessionToken).toBeUndefined();
    const identities = await getDb().select().from(employeeIdentities).where(eq(employeeIdentities.subject, sub));
    expect(identities).toHaveLength(0);
    const [request] = await getDb().select().from(identityLinkRequests).where(eq(identityLinkRequests.subject, sub));
    expect(request).toMatchObject({ status: 'pending', email: emp.googleEmail, conflictReason: null });
  });

  it('refuses an email address reused by a different Google account and flags the conflict', async () => {
    const emp = await newEmployee();
    await bind(emp.id, `sub-${randomUUID()}`, emp.googleEmail!);
    const intruder = `sub-${randomUUID()}`;

    const flow = await login({ sub: intruder, email: emp.googleEmail! });

    expect(errorOf(flow)).toBe('identity_conflict');
    expect(flow.sessionToken).toBeUndefined();
    const [request] = await getDb().select().from(identityLinkRequests).where(eq(identityLinkRequests.subject, intruder));
    expect(request.conflictReason).toBe('email_bound_to_other_identity');
    const identities = await getDb().select().from(employeeIdentities).where(eq(employeeIdentities.subject, intruder));
    expect(identities).toHaveLength(0);
  });

  it('denies a disabled employee even with a valid binding', async () => {
    const emp = await newEmployee({ accessEnabled: false, disabledAt: new Date(), disabledReason: 'left' });
    const sub = `sub-${randomUUID()}`;
    await bind(emp.id, sub, emp.googleEmail!);
    const flow = await login({ sub, email: emp.googleEmail! });
    expect(errorOf(flow)).toBe('access_disabled');
    expect(flow.sessionToken).toBeUndefined();
  });

  it('denies a revoked binding', async () => {
    const emp = await newEmployee();
    const sub = `sub-${randomUUID()}`;
    const identity = await bind(emp.id, sub, emp.googleEmail!);
    await getDb().update(employeeIdentities).set({ revokedAt: new Date() }).where(eq(employeeIdentities.id, identity.id));
    const flow = await login({ sub, email: emp.googleEmail! });
    expect(errorOf(flow)).toBe('identity_revoked');
  });
});

describe('Google login: token and protocol validation', () => {
  let emp: Awaited<ReturnType<typeof newEmployee>>;
  let sub: string;

  beforeAll(async () => {
    emp = await newEmployee();
    sub = `sub-${randomUUID()}`;
    await bind(emp.id, sub, emp.googleEmail!);
  });

  const cases: [string, Parameters<typeof login>[0]['claims'], string, ('provider' | 'attacker')?][] = [
    ['wrong audience', () => ({ aud: 'someone-else' }), 'auth_failed'],
    ['wrong issuer', () => ({ iss: 'https://evil.test' }), 'auth_failed'],
    ['expired token', () => ({ exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 900 }), 'auth_failed'],
    ['wrong nonce', () => ({ nonce: 'not-the-nonce' }), 'auth_failed'],
    ['missing nonce', () => ({ nonce: undefined }), 'auth_failed'],
    ['forged signature', undefined, 'auth_failed', 'attacker'],
    ['unverified email', () => ({ email_verified: false }), 'email_unverified'],
    ['email_verified missing', () => ({ email_verified: undefined }), 'email_unverified'],
    ['consumer account without hd', () => ({ hd: undefined }), 'domain_not_allowed'],
    ['other Workspace domain', () => ({ hd: 'other.test' }), 'domain_not_allowed'],
    ['email outside the allowed domain', () => ({ email: 'x@gmail.com' }), 'domain_not_allowed'],
  ];

  it.each(cases)('rejects %s without creating a session', async (_label, claims, expected, signWith) => {
    const flow = await login({ sub, email: emp.googleEmail!, claims, signWith });
    expect(errorOf(flow)).toBe(expected);
    expect(flow.sessionToken).toBeUndefined();
  });

  it('rejects a callback whose state does not match the login cookie', async () => {
    const flow = await login({
      sub,
      email: emp.googleEmail!,
      mutateCallback: (url) => url.searchParams.set('state', 'forged-state'),
    });
    expect(errorOf(flow)).toBe('login_expired');
    expect(flow.sessionToken).toBeUndefined();
  });

  it('rejects a callback without the login cookie (e.g. started in another browser)', async () => {
    const flow = await login({
      sub,
      email: emp.googleEmail!,
      mutateCallback: (_url, cookies) => delete cookies[LOGIN_COOKIE],
    });
    expect(errorOf(flow)).toBe('login_expired');
  });

  it('rejects a replayed callback even with the original cookie', async () => {
    let replay: { url: URL; cookie: string } | undefined;
    const first = await login({
      sub,
      email: emp.googleEmail!,
      mutateCallback: (url, cookies) => {
        replay = { url: new URL(url), cookie: `${LOGIN_COOKIE}=${cookies[LOGIN_COOKIE]}` };
      },
    });
    expect(first.sessionToken).toBeDefined();
    const again = await callbackRoute(new NextRequest(replay!.url, { headers: { cookie: replay!.cookie } }));
    expect(new URL(again.headers.get('location')!).searchParams.get('error')).toBe('login_expired');
  });

  it('reports a provider-side error without contacting the token endpoint', async () => {
    const flow = await login({
      sub,
      email: emp.googleEmail!,
      mutateCallback: (url) => {
        url.searchParams.delete('code');
        url.searchParams.set('error', 'access_denied');
      },
    });
    expect(errorOf(flow)).toBe('auth_cancelled');
  });

  it('ignores a malicious Host header: redirects and redirect_uri stay on APP_ORIGIN', async () => {
    const flow = await login({ sub, email: emp.googleEmail!, host: 'evil.test' });
    const auth = new URL(flow.start.headers.get('location')!);
    expect(auth.searchParams.get('redirect_uri')).toBe(`${APP}/auth/callback`);
    expect(flow.location.origin).toBe(APP);
    expect(idp.tokenRequests.at(-1)!.get('redirect_uri')).toBe(`${APP}/auth/callback`);
    expect(await resolveSession(flow.sessionToken)).not.toBeNull();
  });

  it.each(['//evil.test/x', 'https://evil.test/x', '/\\evil.test', '/auth/logout', 'javascript:alert(1)'])(
    'turns returnTo=%s into the default page (no open redirect)',
    async (returnTo) => {
      const flow = await login({ sub, email: emp.googleEmail!, returnTo });
      expect(flow.location.href).toBe(`${APP}/dashboard`);
    }
  );

  it('rate-limits login starts per client IP', async () => {
    const clientIp = ip();
    let last: Response | undefined;
    for (let i = 0; i < 31; i += 1) {
      last = await startRoute(new NextRequest(`${APP}/auth/google`, { headers: { 'x-test-ip': clientIp } }));
    }
    expect(new URL(last!.headers.get('location')!).searchParams.get('error')).toBe('rate_limited');
    const other = await startRoute(new NextRequest(`${APP}/auth/google`, { headers: { 'x-test-ip': ip() } }));
    expect(new URL(other.headers.get('location')!).origin).toBe(FAKE_ISSUER);
  });
});
