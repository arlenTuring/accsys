import { and, eq, isNull, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import type { VerifiedGoogleIdentity } from '@/lib/auth/oidc';
import { createSession, revokeSessionToken } from '@/lib/auth/sessions';
import { getDb } from '@/lib/db';
import { employeeIdentities, employees, identityLinkRequests } from '@/lib/db/schema';

export type LoginOutcome =
  | { kind: 'signed_in'; token: string; employeeId: string }
  | { kind: 'pending_approval' }
  | { kind: 'identity_conflict' }
  | { kind: 'denied'; reason: 'access_disabled' | 'identity_revoked' | 'link_rejected' };

/**
 * Maps a verified Google identity to an employee and opens a session, in one
 * transaction with its audit events. Only an existing, active binding of the
 * exact (issuer, subject) signs in. Anything else becomes a link request for an
 * admin; an email address is never enough to take over an employee record.
 */
export async function completeLogin(
  identity: VerifiedGoogleIdentity,
  options: { ttlMs: number; previousToken?: string; requestId?: string }
): Promise<LoginOutcome> {
  return getDb().transaction(async (tx) => {
    const [bound] = await tx
      .select()
      .from(employeeIdentities)
      .where(
        and(
          eq(employeeIdentities.provider, 'google'),
          eq(employeeIdentities.issuer, identity.issuer),
          eq(employeeIdentities.subject, identity.subject)
        )
      )
      .for('update');

    if (bound) {
      if (bound.revokedAt) {
        await recordAudit(tx, {
          actorEmployeeId: null,
          action: 'auth.login_denied',
          entityType: 'employee',
          entityId: bound.employeeId,
          requestId: options.requestId,
          details: { reason: 'identity_revoked', identityId: bound.id },
        });
        return { kind: 'denied', reason: 'identity_revoked' };
      }
      const [employee] = await tx
        .select({ id: employees.id, accessEnabled: employees.accessEnabled })
        .from(employees)
        .where(eq(employees.id, bound.employeeId))
        .for('update');
      if (bound.email !== identity.email) {
        // Same Google account (same sub) with a new address: same employee.
        await tx.update(employeeIdentities).set({ email: identity.email }).where(eq(employeeIdentities.id, bound.id));
        await recordAudit(tx, {
          actorEmployeeId: null,
          action: 'identity.email_changed',
          entityType: 'employee',
          entityId: bound.employeeId,
          requestId: options.requestId,
          details: { identityId: bound.id, from: bound.email, to: identity.email },
        });
      }
      if (!employee?.accessEnabled) {
        await recordAudit(tx, {
          actorEmployeeId: null,
          action: 'auth.login_denied',
          entityType: 'employee',
          entityId: bound.employeeId,
          requestId: options.requestId,
          details: { reason: 'access_disabled', identityId: bound.id },
        });
        return { kind: 'denied', reason: 'access_disabled' };
      }

      if (options.previousToken) await revokeSessionToken(tx, options.previousToken, 'replaced_by_login');
      const session = await createSession(tx, {
        employeeId: bound.employeeId,
        identityId: bound.id,
        ttlMs: options.ttlMs,
      });
      await recordAudit(tx, {
        actorEmployeeId: bound.employeeId,
        action: 'auth.login_succeeded',
        entityType: 'session',
        entityId: session.sessionId,
        requestId: options.requestId,
        details: { identityId: bound.id },
      });
      return { kind: 'signed_in', token: session.token, employeeId: bound.employeeId };
    }

    // Unbound account. Flag it when its email already belongs to another bound
    // Google account (e.g. a reassigned address) so the admin sees the conflict.
    const [emailOwner] = await tx
      .select({ employeeId: employeeIdentities.employeeId })
      .from(employeeIdentities)
      .where(and(sql`lower(${employeeIdentities.email}) = ${identity.email}`, isNull(employeeIdentities.revokedAt)))
      .limit(1);
    const conflictReason = emailOwner ? 'email_bound_to_other_identity' : null;

    const [request] = await tx
      .insert(identityLinkRequests)
      .values({
        provider: 'google',
        issuer: identity.issuer,
        subject: identity.subject,
        email: identity.email,
        displayName: identity.name,
        conflictReason,
      })
      .onConflictDoUpdate({
        target: [identityLinkRequests.provider, identityLinkRequests.issuer, identityLinkRequests.subject],
        set: {
          email: identity.email,
          displayName: identity.name,
          attemptCount: sql`${identityLinkRequests.attemptCount} + 1`,
          lastAttemptAt: sql`now()`,
          conflictReason: sql`case when ${identityLinkRequests.status} = 'pending' then ${conflictReason}::text
                                   else ${identityLinkRequests.conflictReason} end`,
        },
      })
      .returning({
        id: identityLinkRequests.id,
        status: identityLinkRequests.status,
        attemptCount: identityLinkRequests.attemptCount,
      });

    if (request.status === 'rejected') return { kind: 'denied', reason: 'link_rejected' };

    if (request.attemptCount === 1 || conflictReason) {
      await recordAudit(tx, {
        actorEmployeeId: null,
        action: conflictReason ? 'identity.link_conflict' : 'identity.link_requested',
        entityType: 'identity_link_request',
        entityId: request.id,
        requestId: options.requestId,
        details: conflictReason
          ? { reason: conflictReason, conflictingEmployeeId: emailOwner!.employeeId }
          : {},
      });
    }
    return conflictReason ? { kind: 'identity_conflict' } : { kind: 'pending_approval' };
  });
}
