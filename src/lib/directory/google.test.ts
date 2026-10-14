import { describe, expect, it } from 'vitest';
import {
  authorizationUrl,
  checkGrantedScopes,
  DIRECTORY_SCOPE,
  directoryConfig,
  DirectoryConfigError,
  directoryPageFetcher,
  exchangeCode,
  pkcePair,
  refreshAccessToken,
  type Fetch,
} from './google';
import { createHash } from 'node:crypto';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: Fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return Object.assign(fn, { calls });
}

const credentials = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' };

describe('directoryConfig', () => {
  const env = {
    GWS_DIRECTORY_CLIENT_ID: 'cid',
    GWS_DIRECTORY_CLIENT_SECRET: 'secret',
    GWS_DIRECTORY_REFRESH_TOKEN: 'token',
    GWS_CUSTOMER_ID: 'C03abc123',
    ALLOWED_GOOGLE_DOMAINS: 'Example.com, example.org',
  };

  it('reads the settings', () => {
    const c = directoryConfig(env);
    expect(c.scope).toEqual({ customerId: 'C03abc123', allowedDomains: ['example.com', 'example.org'] });
    expect(c.credentials.refreshToken).toBe('token');
  });

  it('names the missing settings without their values', () => {
    expect(() => directoryConfig({ ...env, GWS_DIRECTORY_REFRESH_TOKEN: '', GWS_CUSTOMER_ID: undefined })).toThrow(
      new DirectoryConfigError('missing settings: GWS_DIRECTORY_REFRESH_TOKEN, GWS_CUSTOMER_ID')
    );
  });

  it('refuses a customer ID that is not one (e.g. the my_customer alias)', () => {
    expect(() => directoryConfig({ ...env, GWS_CUSTOMER_ID: 'my_customer' })).toThrow(DirectoryConfigError);
  });
});

describe('checkGrantedScopes', () => {
  it.each([
    [DIRECTORY_SCOPE, null],
    [`${DIRECTORY_SCOPE} https://www.googleapis.com/auth/admin.directory.orgunit.readonly`, null],
    ['openid email', 'the token does not grant admin.directory.user.readonly'],
    [`${DIRECTORY_SCOPE} https://www.googleapis.com/auth/admin.directory.user`, expect.stringContaining('more than read-only')],
    [undefined, 'the token response has no scope'],
  ])('%s', (scope, expected) => {
    expect(checkGrantedScopes(scope)).toEqual(expected);
  });
});

describe('refreshAccessToken', () => {
  it('trades the refresh token for an access token', async () => {
    const f = fakeFetch(() => json(200, { access_token: 'at', expires_in: 3599, scope: DIRECTORY_SCOPE, token_type: 'Bearer' }));
    expect(await refreshAccessToken(f, credentials)).toEqual({ ok: true, accessToken: 'at' });
    const body = new URLSearchParams(String(f.calls[0].init?.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'refresh_token', client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtoken' });
    expect(f.calls[0].url).toBe('https://oauth2.googleapis.com/token');
  });

  it('refuses a token with broader scopes', async () => {
    const f = fakeFetch(() => json(200, { access_token: 'at', scope: `${DIRECTORY_SCOPE} https://mail.google.com/` }));
    const r = await refreshAccessToken(f, credentials);
    expect(r.ok).toBe(false);
  });

  it.each([
    [json(400, { error: 'invalid_grant' }), 'the refresh token was revoked or expired; run directory:authorize again'],
    [json(401, { error: 'invalid_client' }), 'the OAuth client ID / secret were rejected'],
    [json(503, {}), 'token endpoint HTTP 503'],
  ])('explains a refusal without echoing secrets', async (response, error) => {
    const r = await refreshAccessToken(fakeFetch(() => response), credentials);
    expect(r).toEqual({ ok: false, error });
    expect(JSON.stringify(r)).not.toMatch(/rtoken|csecret/);
  });

  it('reports a network failure', async () => {
    const r = await refreshAccessToken(
      fakeFetch(() => {
        throw new Error('ECONNREFUSED rtoken');
      }),
      credentials
    );
    expect(r).toEqual({ ok: false, error: 'token endpoint unreachable' });
  });
});

describe('directoryPageFetcher', () => {
  it('asks for one customer, the needed fields and the next page', async () => {
    const f = fakeFetch(() => json(200, { kind: 'admin#directory#users', users: [] }));
    const fetchPage = directoryPageFetcher(f, 'at', 'C03abc123');
    await fetchPage(null);
    await fetchPage('p2');
    const [first, second] = f.calls.map((c) => new URL(c.url));
    expect(first.origin + first.pathname).toBe('https://admin.googleapis.com/admin/directory/v1/users');
    expect(first.searchParams.get('customer')).toBe('C03abc123');
    expect(first.searchParams.get('fields')).toContain('users(id,primaryEmail');
    expect(first.searchParams.has('pageToken')).toBe(false);
    expect(second.searchParams.get('pageToken')).toBe('p2');
    expect(new Headers(f.calls[0].init?.headers).get('authorization')).toBe('Bearer at');
  });

  it('passes the status through and drops the body of an error', async () => {
    const r = await directoryPageFetcher(fakeFetch(() => json(403, { error: { message: 'x' } })), 'at', 'C1234')(null);
    expect(r).toEqual({ status: 403, body: null });
  });
});

describe('one-time authorization', () => {
  it('builds an offline, read-only, PKCE authorization request', () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    const url = new URL(authorizationUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5000/callback', state: 's', codeChallenge: challenge }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: DIRECTORY_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state: 's',
      redirect_uri: 'http://127.0.0.1:5000/callback',
    });
  });

  it('returns the refresh token of an exact read-only grant', async () => {
    const f = fakeFetch(() => json(200, { access_token: 'at', refresh_token: 'rt', scope: DIRECTORY_SCOPE }));
    const input = { clientId: 'cid', clientSecret: 'cs', code: 'c', redirectUri: 'http://127.0.0.1:1/callback', codeVerifier: 'v' };
    expect(await exchangeCode(f, input)).toEqual({ ok: true, refreshToken: 'rt' });
    expect(new URLSearchParams(String(f.calls[0].init?.body)).get('code_verifier')).toBe('v');
  });

  it.each([
    [json(200, { access_token: 'at', scope: DIRECTORY_SCOPE }), /no refresh token/],
    [json(200, { access_token: 'at', refresh_token: 'rt', scope: 'openid' }), /does not grant/],
    [json(400, { error: 'invalid_grant' }), /authorization refused \(invalid_grant\)/],
  ])('refuses an unusable grant', async (response, error) => {
    const r = await exchangeCode(fakeFetch(() => response), { clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r', codeVerifier: 'v' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(error);
  });
});
