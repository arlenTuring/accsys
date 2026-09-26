import { cookies } from 'next/headers';
import { cache } from 'react';
import { sessionCookieNames } from '@/lib/auth/config';
import { resolveSession, type SessionEmployee } from '@/lib/auth/sessions';

export type CurrentEmployee = SessionEmployee;

export async function readSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  for (const name of sessionCookieNames()) {
    const value = jar.get(name)?.value;
    if (value) return value;
  }
  return undefined;
}

/**
 * The employee behind the current request's session, or null. Checked against
 * the database on every request (revocation, access and role changes apply
 * immediately); memoized only within a single request.
 */
export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  return resolveSession(await readSessionToken());
});

/** For sensitive admin actions: the login behind this session must be recent. */
export function hasRecentAuthentication(employee: CurrentEmployee, maxAgeMs: number, now = Date.now()): boolean {
  return now - employee.authenticatedAt.getTime() <= maxAgeMs;
}
