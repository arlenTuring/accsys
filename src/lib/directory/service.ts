import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { revokeEmployeeSessions } from '@/lib/auth/sessions';
import { getDb } from '@/lib/db';
import { auditEvents, employeeIdentities, employees } from '@/lib/db/schema';
import { planDirectorySync, type LocalIdentity, type PlanLimits, type SyncPlan } from '@/lib/directory/plan';
import type { DirectoryUser } from '@/lib/directory/users';

const APPLIED = 'directory.sync_applied';
// pg advisory lock key: one sync at a time across processes and hosts sharing the DB.
const LOCK_KEY = sql`hashtext('accsys.directory_sync')`;

export type SyncOutcome =
  | { ok: true; applied: boolean; plan: SyncPlan }
  | { ok: false; error: 'busy' | 'blocked'; plan?: SyncPlan };

/**
 * Plans (and with `apply`, applies) one complete directory listing inside a
 * single transaction holding the sync lock. A dry run only reads.
 */
export async function runDirectorySync(
  users: DirectoryUser[],
  options: { issuer: string; apply: boolean; limits?: Omit<PlanLimits, 'previousActiveCount'> }
): Promise<SyncOutcome> {
  return getDb().transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`);
    if (!locked) return { ok: false, error: 'busy' } as const;

    const local: LocalIdentity[] = await tx
      .select({
        identityId: employeeIdentities.id,
        employeeId: employeeIdentities.employeeId,
        employeeCode: employees.employeeCode,
        subject: employeeIdentities.subject,
        email: employeeIdentities.email,
      })
      .from(employeeIdentities)
      .innerJoin(employees, eq(employees.id, employeeIdentities.employeeId))
      .where(
        and(eq(employeeIdentities.provider, 'google'), eq(employeeIdentities.issuer, options.issuer), isNull(employeeIdentities.revokedAt))
      );
    const [last] = await tx
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(eq(auditEvents.action, APPLIED))
      .orderBy(desc(auditEvents.id))
      .limit(1);
    const previous = (last?.details as { activeCount?: unknown } | undefined)?.activeCount;
    const plan = planDirectorySync(users, local, {
      ...options.limits,
      previousActiveCount: typeof previous === 'number' ? previous : null,
    });

    if (!options.apply) return { ok: true, applied: false, plan } as const;
    if (plan.blocked) {
      await recordAudit(tx, {
        actorEmployeeId: null,
        action: 'directory.sync_blocked',
        entityType: 'directory',
        details: { reason: plan.blocked, directoryCount: plan.directoryCount, activeCount: plan.activeCount },
      });
      return { ok: false, error: 'blocked', plan } as const;
    }

    let sessionsRevoked = 0;
    if (plan.revoke.length > 0) {
      await tx
        .update(employeeIdentities)
        .set({ revokedAt: sql`now()` })
        .where(and(inArray(employeeIdentities.id, plan.revoke.map((r) => r.identityId)), isNull(employeeIdentities.revokedAt)));
      for (const r of plan.revoke) sessionsRevoked += await revokeEmployeeSessions(tx, r.employeeId, `directory_${r.reason}`);
    }
    for (const change of plan.emailChanges) {
      await tx.update(employeeIdentities).set({ email: change.to }).where(eq(employeeIdentities.id, change.identityId));
    }
    await recordAudit(tx, {
      actorEmployeeId: null,
      action: APPLIED,
      entityType: 'directory',
      details: {
        directoryCount: plan.directoryCount,
        activeCount: plan.activeCount,
        revoked: plan.revoke.map((r) => ({ identityId: r.identityId, employeeCode: r.employeeCode, reason: r.reason })),
        sessionsRevoked,
        emailChanges: plan.emailChanges.length,
        missing: plan.missing.length,
        unbound: plan.unbound.length,
      },
    });
    return { ok: true, applied: true, plan } as const;
  });
}
