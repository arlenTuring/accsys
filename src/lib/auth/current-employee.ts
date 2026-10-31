import { AsyncLocalStorage } from 'node:async_hooks';
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
  const scoped = sessionScope.getStore();
  if (scoped) return resolveSession(scoped);
  return resolveSession(await readSessionToken());
});

/**
 * Server-side scripts and integration tests (no HTTP request) run code "as" a
 * session by supplying its token. The session is still resolved against the
 * database (revocation, access and role checks apply), so this grants nothing a
 * real cookie would not. Never exposed to browsers.
 */
const sessionScope = new AsyncLocalStorage<string>();

export function runWithSessionToken<T>(token: string, fn: () => Promise<T>): Promise<T> {
  return sessionScope.run(token, fn);
}

/** For sensitive admin actions: the login behind this session must be recent. */
export function hasRecentAuthentication(employee: CurrentEmployee, maxAgeMs: number, now = Date.now()): boolean {
  return now - employee.authenticatedAt.getTime() <= maxAgeMs;
}
