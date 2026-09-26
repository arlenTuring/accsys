import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { LEGACY_SESSION_COOKIE, type AuthConfig } from '@/lib/auth/config';

export function newRequestId(): string {
  return randomUUID();
}

/** Client IP only from the header the trusted reverse proxy overwrites; never X-Forwarded-For as sent. */
export function clientIp(request: NextRequest, cfg: Pick<AuthConfig, 'clientIpHeader'>): string {
  if (!cfg.clientIpHeader) return 'unknown';
  const value = request.headers.get(cfg.clientIpHeader)?.trim();
  return value && /^[0-9a-f:.]{2,45}$/i.test(value) ? value : 'unknown';
}

/**
 * CSRF check for cookie-authenticated POST route handlers: the browser-supplied
 * Origin must be exactly the configured app origin (Sec-Fetch-Site as fallback
 * for browsers that omit Origin). Server Actions have Next's own origin check.
 */
export function isSameOriginRequest(request: NextRequest, appOrigin: string): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === appOrigin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export function redirectTo(cfg: Pick<AuthConfig, 'appOrigin'>, path: string): NextResponse {
  // Always the configured origin: Host / X-Forwarded-Host are never used.
  return NextResponse.redirect(new URL(path, cfg.appOrigin), 303);
}

export function loginErrorRedirect(cfg: Pick<AuthConfig, 'appOrigin'>, code: string): NextResponse {
  return redirectTo(cfg, `/login?error=${encodeURIComponent(code)}`);
}

export function setSessionCookie(res: NextResponse, cfg: AuthConfig, token: string): void {
  res.cookies.set(cfg.sessionCookieName, token, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(cfg.sessionTtlMs / 1000),
  });
}

export function setLoginCookie(res: NextResponse, cfg: AuthConfig, value: string): void {
  res.cookies.set(cfg.loginCookieName, value, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(cfg.loginStateTtlMs / 1000),
  });
}

export function clearCookie(res: NextResponse, cfg: AuthConfig, name: string): void {
  res.cookies.set(name, '', { httpOnly: true, secure: cfg.secureCookies, sameSite: 'lax', path: '/', maxAge: 0 });
}

export function clearAuthCookies(res: NextResponse, cfg: AuthConfig): void {
  clearCookie(res, cfg, cfg.sessionCookieName);
  clearCookie(res, cfg, cfg.loginCookieName);
  clearCookie(res, cfg, LEGACY_SESSION_COOKIE);
}

export function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
