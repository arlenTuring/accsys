import type { DirectoryUser } from '@/lib/directory/users';

/**
 * Turns a complete directory listing into the changes ACCSYS would make.
 * Only two things are ever applied automatically:
 *   - a bound Google account that is suspended / archived loses its binding
 *     and its sessions (it can only come back through a new admin approval);
 *   - the email shown for a binding follows the directory.
 * Everything else (accounts missing from the list, active accounts without a
 * binding) is reported for an admin; nothing is restored, created or
 * re-enabled automatically, and roles / approvers are never taken from GWS.
 */

export type LocalIdentity = { identityId: string; employeeId: string; employeeCode: string; subject: string; email: string | null };

export type SyncPlan = {
  directoryCount: number;
  activeCount: number;
  revoke: (LocalIdentity & { reason: 'suspended' | 'archived' })[];
  emailChanges: { identityId: string; employeeCode: string; from: string | null; to: string }[];
  /** Bound but not in the listing: needs a per-account check (users.get) before anything happens. */
  missing: LocalIdentity[];
  /** Active directory accounts without a binding (new staff, or waiting for approval). */
  unbound: { subject: string; email: string; fullName: string }[];
  /** Why applying this plan is refused; null when it may be applied. */
  blocked: string | null;
};

export type PlanLimits = {
  /** Active accounts in the last applied run; null for the first run. */
  previousActiveCount: number | null;
  /** Refuse when the active count fell below this share of the previous run. */
  minActiveRatio?: number;
  /** Refuse when more bindings than this would be revoked in one run. */
  maxRevocations?: number;
};

export function planDirectorySync(users: DirectoryUser[], local: LocalIdentity[], limits: PlanLimits): SyncPlan {
  const bySubject = new Map(users.map((u) => [u.id, u]));
  const boundSubjects = new Set(local.map((l) => l.subject));
  const plan: SyncPlan = {
    directoryCount: users.length,
    activeCount: users.filter((u) => !u.suspended && !u.archived).length,
    revoke: [],
    emailChanges: [],
    missing: [],
    unbound: [],
    blocked: null,
  };

  for (const identity of local) {
    const user = bySubject.get(identity.subject);
    if (!user) {
      plan.missing.push(identity);
      continue;
    }
    if (user.suspended || user.archived) {
      plan.revoke.push({ ...identity, reason: user.suspended ? 'suspended' : 'archived' });
      continue;
    }
    if (user.primaryEmail !== (identity.email ?? '').toLowerCase()) {
      plan.emailChanges.push({ identityId: identity.identityId, employeeCode: identity.employeeCode, from: identity.email, to: user.primaryEmail });
    }
  }
  for (const user of users) {
    if (!user.suspended && !user.archived && !boundSubjects.has(user.id)) {
      plan.unbound.push({ subject: user.id, email: user.primaryEmail, fullName: user.fullName });
    }
  }

  const minRatio = limits.minActiveRatio ?? 0.8;
  const maxRevocations = limits.maxRevocations ?? Math.max(5, Math.ceil(local.length * 0.1));
  if (users.length === 0) {
    plan.blocked = 'the directory returned no accounts';
  } else if (limits.previousActiveCount !== null && plan.activeCount < limits.previousActiveCount * minRatio) {
    plan.blocked = `active accounts dropped from ${limits.previousActiveCount} to ${plan.activeCount}`;
  } else if (plan.revoke.length > maxRevocations) {
    plan.blocked = `${plan.revoke.length} bindings would be revoked at once (limit ${maxRevocations})`;
  }
  return plan;
}
