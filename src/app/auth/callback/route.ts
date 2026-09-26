import { type NextRequest } from 'next/server';
import { AuthConfigError, getAuthConfig, sessionCookieNames } from '@/lib/auth/config';
import {
  clearCookie,
  clientIp,
  loginErrorRedirect,
  newRequestId,
  noStore,
  redirectTo,
  setSessionCookie,
} from '@/lib/auth/http';
import { completeLogin } from '@/lib/auth/identity';
import { consumeLogin } from '@/lib/auth/login-state';
import { exchangeCode, LoginRejected } from '@/lib/auth/oidc';
import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let cfg;
  try {
    cfg = getAuthConfig();
  } catch (err) {
    console.error('[auth] login unavailable:', err instanceof AuthConfigError ? err.message : err);
    return NextResponse.redirect(new URL('/login?error=auth_unavailable', request.nextUrl.origin), 303);
  }
  const requestId = newRequestId();

  // The login transaction cookie is single-use: removed on every outcome.
  const fail = (code: string) => {
    const res = loginErrorRedirect(cfg, code);
    clearCookie(res, cfg, cfg.loginCookieName);
    return noStore(res);
  };

  const limit = await hitRateLimit(`login-callback:${clientIp(request, cfg)}`, RATE_LIMITS.loginCallbackPerIp);
  if (!limit.allowed) return fail('rate_limited');

  const params = request.nextUrl.searchParams;
  if (params.get('error')) return fail('auth_cancelled');

  const login = await consumeLogin(request.cookies.get(cfg.loginCookieName)?.value, params.get('state'));
  if (!login) return fail('login_expired');

  // Rebuild the callback URL on the configured origin; the Host header is ignored.
  const callbackUrl = new URL(`/auth/callback${request.nextUrl.search}`, cfg.appOrigin);

  let identity;
  try {
    identity = await exchangeCode(cfg, callbackUrl, login.checks);
  } catch (err) {
    if (err instanceof LoginRejected) return fail(err.code);
    console.error(`[auth] ref=${requestId} token exchange failed`);
    return fail('auth_failed');
  }

  const previousToken = sessionCookieNames()
    .map((name) => request.cookies.get(name)?.value)
    .find(Boolean);
  const outcome = await completeLogin(identity, { ttlMs: cfg.sessionTtlMs, previousToken, requestId });
  if (outcome.kind !== 'signed_in') {
    return fail(outcome.kind === 'denied' ? outcome.reason : outcome.kind);
  }

  const res = redirectTo(cfg, login.returnTo);
  clearCookie(res, cfg, cfg.loginCookieName);
  setSessionCookie(res, cfg, outcome.token);
  return noStore(res);
}
