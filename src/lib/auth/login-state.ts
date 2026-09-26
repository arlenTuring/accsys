import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { sealData, unsealData } from 'iron-session';
import type { AuthConfig } from '@/lib/auth/config';
import { newLoginChecks, type LoginChecks } from '@/lib/auth/oidc';
import { constantTimeEqual, hashToken } from '@/lib/auth/tokens';
import { getDb } from '@/lib/db';
import { oidcLoginStates } from '@/lib/db/schema';
import { getRequiredEnv } from '@/lib/env';

type SealedLogin = { s: string; n: string; v: string; r: string };

export type StartedLogin = { checks: LoginChecks; cookieValue: string };
export type ConsumedLogin = { checks: LoginChecks; returnTo: string };

/**
 * Creates a login transaction: fresh state/nonce/PKCE verifier, sealed into a
 * short-lived cookie, plus a server-side record of the state so the callback
 * can be accepted only once.
 */
export async function startLogin(cfg: AuthConfig, returnTo: string): Promise<StartedLogin> {
  const checks = newLoginChecks();
  const db = getDb();
  await db.insert(oidcLoginStates).values({
    stateHash: hashToken(checks.state),
    expiresAt: sql`now() + make_interval(secs => ${cfg.loginStateTtlMs / 1000})`,
  });
  await db.delete(oidcLoginStates).where(lt(oidcLoginStates.expiresAt, sql`now() - interval '1 hour'`));

  const payload: SealedLogin = { s: checks.state, n: checks.nonce, v: checks.codeVerifier, r: returnTo };
  const cookieValue = await sealData(payload, {
    password: getRequiredEnv('SESSION_SECRET'),
    ttl: cfg.loginStateTtlMs / 1000,
  });
  return { checks, cookieValue };
}

/**
 * Validates the callback's `state` against the sealed cookie and atomically
 * consumes the server-side record. Returns null for a missing, tampered,
 * expired, mismatched or already used login transaction.
 */
export async function consumeLogin(
  cookieValue: string | undefined,
  stateParam: string | null
): Promise<ConsumedLogin | null> {
  if (!cookieValue || !stateParam) return null;
  let payload: Partial<SealedLogin>;
  try {
    payload = await unsealData<Partial<SealedLogin>>(cookieValue, { password: getRequiredEnv('SESSION_SECRET') });
  } catch {
    return null;
  }
  if (!payload.s || !payload.n || !payload.v || typeof payload.r !== 'string') return null;
  if (!constantTimeEqual(payload.s, stateParam)) return null;

  const consumed = await getDb()
    .update(oidcLoginStates)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(oidcLoginStates.stateHash, hashToken(stateParam)),
        isNull(oidcLoginStates.consumedAt),
        gt(oidcLoginStates.expiresAt, sql`now()`)
      )
    )
    .returning({ stateHash: oidcLoginStates.stateHash });
  if (consumed.length !== 1) return null;

  return { checks: { state: payload.s, nonce: payload.n, codeVerifier: payload.v }, returnTo: payload.r };
}
