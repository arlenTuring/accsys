import type { SessionOptions } from 'iron-session';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { getRequiredEnv } from '@/lib/env';

export type SessionData = {
  email?: string;
  name?: string;
  picture?: string;
  isLoggedIn: boolean;
  oauthVerifier?: string;
};

export function getSessionOptions(): SessionOptions {
  return {
    password: getRequiredEnv('SESSION_SECRET'),
    cookieName: 'accsys_session',
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), getSessionOptions());
}
