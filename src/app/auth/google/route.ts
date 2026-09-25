import { NextResponse } from 'next/server';
import { createPkce, getGoogleAuthUrl } from '@/lib/auth/google';
import { getSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.redirect(`${origin}/login?error=google_not_configured`);
  }

  const { verifier, challenge } = createPkce();
  const session = await getSession();
  session.email = undefined;
  session.isLoggedIn = false;
  session.oauthVerifier = verifier;
  await session.save();

  const url = getGoogleAuthUrl({
    redirectUri: `${origin}/auth/callback`,
    state: 'google',
    codeChallenge: challenge,
  });
  return NextResponse.redirect(url);
}
