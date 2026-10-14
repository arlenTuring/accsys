/**
 * Live Google Workspace Directory source (read-only). A refresh token from a
 * one-time offline authorization of a dedicated Workspace account is traded
 * for a short-lived access token on every run; tokens are never logged or
 * stored outside the secret file.
 * https://developers.google.com/identity/protocols/oauth2/native-app
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FetchPage } from '@/lib/directory/users';

export const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';
/** Scopes a sync token may carry; anything broader is refused. */
const ALLOWED_SCOPES = new Set([DIRECTORY_SCOPE, 'https://www.googleapis.com/auth/admin.directory.orgunit.readonly']);

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERS_ENDPOINT = 'https://admin.googleapis.com/admin/directory/v1/users';
const USER_FIELDS = 'kind,nextPageToken,users(id,primaryEmail,name/fullName,suspended,archived,orgUnitPath,customerId,phones,organizations,externalIds,relations)';
const TIMEOUT_MS = 30_000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type DirectoryCredentials = { clientId: string; clientSecret: string; refreshToken: string };
export type TokenResult = { ok: true; accessToken: string } | { ok: false; error: string };

export class DirectoryConfigError extends Error {}

/** Reads the live-source settings by name; values are never echoed back. */
export function directoryConfig(env: Record<string, string | undefined> = process.env) {
  const required = ['GWS_DIRECTORY_CLIENT_ID', 'GWS_DIRECTORY_CLIENT_SECRET', 'GWS_DIRECTORY_REFRESH_TOKEN', 'GWS_CUSTOMER_ID', 'ALLOWED_GOOGLE_DOMAINS'];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new DirectoryConfigError(`missing settings: ${missing.join(', ')}`);
  const customerId = env.GWS_CUSTOMER_ID!.trim();
  if (!/^C[0-9a-z]{4,20}$/i.test(customerId)) throw new DirectoryConfigError('GWS_CUSTOMER_ID is not a Workspace customer ID (C…)');
  return {
    credentials: {
      clientId: env.GWS_DIRECTORY_CLIENT_ID!.trim(),
      clientSecret: env.GWS_DIRECTORY_CLIENT_SECRET!.trim(),
      refreshToken: env.GWS_DIRECTORY_REFRESH_TOKEN!.trim(),
    } satisfies DirectoryCredentials,
    scope: {
      customerId,
      allowedDomains: env
        .ALLOWED_GOOGLE_DOMAINS!.split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    },
  };
}

/** Refuses a grant that is missing the directory scope or carries anything else. */
export function checkGrantedScopes(scope: unknown): string | null {
  if (typeof scope !== 'string') return 'the token response has no scope';
  const granted = scope.split(/\s+/).filter(Boolean);
  if (!granted.includes(DIRECTORY_SCOPE)) return 'the token does not grant admin.directory.user.readonly';
  const extra = granted.filter((s) => !ALLOWED_SCOPES.has(s));
  return extra.length > 0 ? `the token grants more than read-only directory access (${extra.join(' ')})` : null;
}

async function postToken(fetchImpl: Fetch, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
  const body = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, body: body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {} };
}

export async function refreshAccessToken(fetchImpl: Fetch, credentials: DirectoryCredentials): Promise<TokenResult> {
  let response;
  try {
    response = await postToken(fetchImpl, {
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    });
  } catch {
    return { ok: false, error: 'token endpoint unreachable' };
  }
  const { status, body } = response;
  if (status !== 200) {
    if (body.error === 'invalid_grant') return { ok: false, error: 'the refresh token was revoked or expired; run directory:authorize again' };
    if (body.error === 'invalid_client') return { ok: false, error: 'the OAuth client ID / secret were rejected' };
    return { ok: false, error: `token endpoint HTTP ${status}` };
  }
  if (typeof body.access_token !== 'string' || body.access_token === '') return { ok: false, error: 'the token response has no access token' };
  const scopeError = checkGrantedScopes(body.scope);
  if (scopeError) return { ok: false, error: scopeError };
  return { ok: true, accessToken: body.access_token };
}

/** One `users.list` page per call, for collectDirectory. */
export function directoryPageFetcher(fetchImpl: Fetch, accessToken: string, customerId: string): FetchPage {
  return async (pageToken) => {
    const url = new URL(USERS_ENDPOINT);
    url.searchParams.set('customer', customerId);
    url.searchParams.set('maxResults', '500');
    url.searchParams.set('orderBy', 'email');
    url.searchParams.set('projection', 'basic');
    url.searchParams.set('viewType', 'admin_view');
    url.searchParams.set('fields', USER_FIELDS);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    return { status: res.status, body: res.status === 200 ? await res.json().catch(() => null) : null };
  };
}

// --- one-time authorization (loopback flow with PKCE) -----------------------

export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizationUrl(input: { clientId: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string }) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DIRECTORY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
  return url.toString();
}

export type CodeResult = { ok: true; refreshToken: string } | { ok: false; error: string };

export async function exchangeCode(
  fetchImpl: Fetch,
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string }
): Promise<CodeResult> {
  let response;
  try {
    response = await postToken(fetchImpl, {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
  } catch {
    return { ok: false, error: 'token endpoint unreachable' };
  }
  const { status, body } = response;
  if (status !== 200) return { ok: false, error: typeof body.error === 'string' ? `authorization refused (${body.error})` : `token endpoint HTTP ${status}` };
  const scopeError = checkGrantedScopes(body.scope);
  if (scopeError) return { ok: false, error: scopeError };
  if (typeof body.refresh_token !== 'string' || body.refresh_token === '') {
    return { ok: false, error: 'Google returned no refresh token (remove the earlier grant for this client and try again)' };
  }
  return { ok: true, refreshToken: body.refresh_token };
}
