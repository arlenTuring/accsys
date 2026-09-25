import { NextResponse } from 'next/server';
import { getRequiredEnv } from '@/lib/env';
import { isAllowedEmail } from '@/lib/auth/allowed-domain';
import { exchangeGoogleCode } from '@/lib/auth/google';
import { getSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const session = await getSession();
  const verifier = session.oauthVerifier;

  if (!code || !verifier) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  try {
    const user = await exchangeGoogleCode({
      code,
      redirectUri: `${origin}/auth/callback`,
      codeVerifier: verifier,
    });

    const allowedDomain = getRequiredEnv('ALLOWED_GOOGLE_DOMAIN');
    if (!isAllowedEmail(user.email, allowedDomain)) {
      session.isLoggedIn = false;
      session.email = undefined;
      session.oauthVerifier = undefined;
      await session.save();
      return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
    }

    session.email = user.email;
    session.name = user.name;
    session.picture = user.picture;
    session.isLoggedIn = true;
    session.oauthVerifier = undefined;
    await session.save();
    return NextResponse.redirect(`${origin}/dashboard`);
  } catch {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }
}
