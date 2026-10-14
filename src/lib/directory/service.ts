import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { revokeEmployeeSessions } from '@/lib/auth/sessions';
import { getDb } from '@/lib/db';
import { auditEvents, directorySyncRuns, directoryUsers, employeeIdentities, employees } from '@/lib/db/schema';
import { planDirectorySync, type LocalIdentity, type PlanLimits, type SyncPlan } from '@/lib/directory/plan';
import type { DirectoryUser } from '@/lib/directory/users';
import type { Tx } from '@/lib/workflow/tx';

const APPLIED = 'directory.sync_applied';
// pg advisory lock key: one sync at a time across processes and hosts sharing the DB.
const LOCK_KEY = sql`hashtext('accsys.directory_sync')`;

export type SyncOutcome =
  | { ok: true; applied: boolean; plan: SyncPlan }
  | { ok: false; error: 'busy' | 'blocked'; plan?: SyncPlan };

export type SyncSource = 'directory' | 'fixture';

const SNAPSHOT_CHUNK = 500;

async function writeSnapshot(tx: Tx, users: DirectoryUser[]) {
  for (let i = 0; i < users.length; i += SNAPSHOT_CHUNK) {
    const rows = users.slice(i, i + SNAPSHOT_CHUNK).map((u) => ({
      directoryUserId: u.id,
      customerId: u.customerId,
      primaryEmail: u.primaryEmail,
      fullName: u.fullName,
      suspended: u.suspended,
      archived: u.archived,
      orgUnitPath: u.orgUnitPath,
      ...u.profile,
    }));
    await tx
      .insert(directoryUsers)
      .values(rows)
      .onConflictDoUpdate({
        target: directoryUsers.directoryUserId,
        set: {
          customerId: sql`excluded.customer_id`,
          primaryEmail: sql`excluded.primary_email`,
          fullName: sql`excluded.full_name`,
          suspended: sql`excluded.suspended`,
          archived: sql`excluded.archived`,
          orgUnitPath: sql`excluded.org_unit_path`,
          phone: sql`excluded.phone`,
          title: sql`excluded.title`,
          department: sql`excluded.department`,
          employeeCode: sql`excluded.employee_code`,
          managerEmail: sql`excluded.manager_email`,
          lastSeenAt: sql`now()`,
          removedAt: null,
        },
      });
  }
  const listed = users.map((u) => u.id);
  await tx
    .update(directoryUsers)
    .set({ removedAt: sql`now()` })
    .where(and(isNull(directoryUsers.removedAt), listed.length > 0 ? notInArray(directoryUsers.directoryUserId, listed) : undefined));
}

/** Records a run whose listing could not be read completely (nothing else is written). */
export async function recordFailedRun(source: SyncSource, error: string, startedAt: Date) {
  await getDb().insert(directorySyncRuns).values({ source, startedAt, finishedAt: sql`clock_timestamp()`, status: 'failed', error: error.slice(0, 500) });
}

/**
 * Plans (and with `apply`, applies) one complete directory listing inside a
 * single transaction holding the sync lock. A dry run only reads. An applied
 * run also refreshes the directory snapshot and records a sync run.
 */
export async function runDirectorySync(
  users: DirectoryUser[],
  options: {
    issuer: string;
    apply: boolean;
    limits?: Omit<PlanLimits, 'previousActiveCount'>;
    source?: SyncSource;
    pages?: number;
    startedAt?: Date;
  }
): Promise<SyncOutcome> {
  const source = options.source ?? 'fixture';
  const startedAt = options.startedAt ?? new Date();
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
      await tx.insert(directorySyncRuns).values({
        source,
        startedAt,
        finishedAt: sql`clock_timestamp()`,
        status: 'blocked',
        pages: options.pages ?? null,
        directoryCount: plan.directoryCount,
        activeCount: plan.activeCount,
        error: plan.blocked.slice(0, 500),
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
    await writeSnapshot(tx, users);
    await tx.insert(directorySyncRuns).values({
      source,
      startedAt,
      finishedAt: sql`clock_timestamp()`,
      status: 'succeeded',
      pages: options.pages ?? null,
      directoryCount: plan.directoryCount,
      activeCount: plan.activeCount,
      summary: {
        revoked: plan.revoke.length,
        sessionsRevoked,
        emailChanges: plan.emailChanges.length,
        missing: plan.missing.length,
        unbound: plan.unbound.length,
      },
    });
    return { ok: true, applied: true, plan } as const;
  });
}
