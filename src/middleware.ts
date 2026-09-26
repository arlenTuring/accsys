import { NextResponse, type NextRequest } from 'next/server';
import { LEGACY_SESSION_COOKIE, sessionCookieNames } from '@/lib/auth/config';
import { isPublicPath } from '@/lib/auth/public-paths';

/**
 * Navigation helper only: sends visitors without a session cookie to /login.
 * It does not authorize anything -- every page, action and API route resolves
 * the session against the database itself.
 */
function appOrigin(request: NextRequest): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through; login itself reports the configuration error
    }
  }
  return request.nextUrl.origin;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let res: NextResponse;

  const hasSession = sessionCookieNames().some((name) => request.cookies.has(name));
  if (isPublicPath(pathname) || hasSession) {
    res = NextResponse.next();
  } else {
    // Fixed origin (not the Host header) so a forged Host cannot steer the redirect.
    const login = new URL('/login', appOrigin(request));
    login.searchParams.set('returnTo', `${pathname}${search}`);
    res = NextResponse.redirect(login);
  }

  // Pre-P2 cookies carried only an email; they are never honoured again.
  if (request.cookies.has(LEGACY_SESSION_COOKIE)) res.cookies.delete(LEGACY_SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|pdf.worker.min.mjs).*)'],
};
