import { NextResponse, type NextRequest } from 'next/server';
import { AuthConfigError, getAuthConfig } from '@/lib/auth/config';
import { clientIp, loginErrorRedirect, noStore, setLoginCookie } from '@/lib/auth/http';
import { startLogin } from '@/lib/auth/login-state';
import { buildAuthorizationUrl, GoogleNotConfigured } from '@/lib/auth/oidc';
import { safeReturnTo } from '@/lib/auth/redirect';
import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let cfg;
  try {
    cfg = getAuthConfig();
  } catch (err) {
    console.error('[auth] login unavailable:', err instanceof AuthConfigError ? err.message : err);
    return NextResponse.redirect(new URL('/login?error=auth_unavailable', request.nextUrl.origin), 303);
  }

  const limit = await hitRateLimit(`login-start:${clientIp(request, cfg)}`, RATE_LIMITS.loginStartPerIp);
  if (!limit.allowed) return noStore(loginErrorRedirect(cfg, 'rate_limited'));

  try {
    const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'), cfg.appOrigin);
    const { checks, cookieValue } = await startLogin(cfg, returnTo);
    const url = await buildAuthorizationUrl(cfg, checks);
    const res = NextResponse.redirect(url, 303);
    setLoginCookie(res, cfg, cookieValue);
    return noStore(res);
  } catch (err) {
    if (err instanceof GoogleNotConfigured) return noStore(loginErrorRedirect(cfg, 'google_not_configured'));
    console.error('[auth] could not start login:', err instanceof Error ? err.message : err);
    return noStore(loginErrorRedirect(cfg, 'auth_unavailable'));
  }
}
