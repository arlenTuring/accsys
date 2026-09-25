import { NextResponse, type NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';
import { getSessionOptions, type SessionData } from '@/lib/auth/session';
import { isPublicPath } from '@/lib/auth/public-paths';

export async function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request });
  const session = await getIronSession<SessionData>(request, response, getSessionOptions());

  if (!session.isLoggedIn || !session.email) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
