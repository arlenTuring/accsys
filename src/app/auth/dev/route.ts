import { NextResponse } from 'next/server';
import { getDevPersonaEmail, isDevLoginAllowed } from '@/lib/auth/dev-personas';
import { getSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (!isDevLoginAllowed()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const personaEmail = getDevPersonaEmail(url.searchParams.get('as'));
  const email = personaEmail ?? process.env.DEV_LOGIN_EMAIL?.trim();
  if (!email) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const session = await getSession();
  session.email = email;
  session.name = email.split('@')[0] ?? 'Dev User';
  session.isLoggedIn = true;
  await session.save();
  return NextResponse.redirect(`${origin}/dashboard`);
}
