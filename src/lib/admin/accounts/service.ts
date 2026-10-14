import { and, eq, isNull, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { revokeEmployeeSessions } from '@/lib/auth/sessions';
import { isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { employeeIdentities, employees, identityLinkRequests } from '@/lib/db/schema';
import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export type AdminActor = { id: string; role: string; authenticatedAt: Date };

export type AccountActionError =
  | 'forbidden'
  | 'reauth_required'
  | 'rate_limited'
  | 'not_found'
  | 'invalid_state'
  | 'self_action'
  | 'employee_disabled'
  | 'employee_already_bound'
  | 'invalid_input';

export type AccountActionResult = { ok: true } | { ok: false; error: AccountActionError };

export const RECENT_AUTH_MS = 15 * 60_000;
const ROLES = ['staff', 'finance', 'admin'] as const;

async function guard(actor: AdminActor | null, now = Date.now()): Promise<AccountActionError | null> {
  if (!actor || actor.role !== 'admin') return 'forbidden';
  if (now - actor.authenticatedAt.getTime() > RECENT_AUTH_MS) return 'reauth_required';
  const limit = await hitRateLimit(`admin-action:${actor.id}`, RATE_LIMITS.adminActionPerEmployee);
  return limit.allowed ? null : 'rate_limited';
}

const fail = (error: AccountActionError): AccountActionResult => ({ ok: false, error });

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Account changes run one at a time, and the actor must still be an enabled
 * admin inside the transaction: otherwise two admins demoting or disabling
 * each other at the same moment would both succeed and leave none.
 */
async function lockAsAdmin(tx: Tx, actorId: string): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(4242002503)`);
  const [me] = await tx
    .select({ role: employees.role, accessEnabled: employees.accessEnabled })
    .from(employees)
    .where(eq(employees.id, actorId));
  return me?.role === 'admin' && me.accessEnabled;
}

/** Binds a pending (or previously rejected) Google account to an employee. */
export async function approveLinkRequest(
  actor: AdminActor | null,
  input: { requestId: string; employeeId: string }
): Promise<AccountActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  if (!isUuid(input?.requestId) || !isUuid(input.employeeId)) return fail('invalid_input');
  if (input.employeeId === actor!.id) return fail('self_action');

  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const [request] = await tx
      .select()
      .from(identityLinkRequests)
      .where(eq(identityLinkRequests.id, input.requestId))
      .for('update');
    if (!request) return fail('not_found');
    if (request.status === 'approved') return fail('invalid_state');

    const [employee] = await tx
      .select({ id: employees.id, accessEnabled: employees.accessEnabled, googleEmail: employees.googleEmail })
      .from(employees)
      .where(eq(employees.id, input.employeeId))
      .for('update');
    if (!employee) return fail('not_found');
    if (!employee.accessEnabled) return fail('employee_disabled');

    // Moving an employee to another Google account is two explicit steps:
    // revoke the current binding first, then approve the new one.
    const [active] = await tx
      .select({ id: employeeIdentities.id })
      .from(employeeIdentities)
      .where(
        and(
          eq(employeeIdentities.employeeId, employee.id),
          eq(employeeIdentities.provider, 'google'),
          isNull(employeeIdentities.revokedAt)
        )
      );
    if (active) return fail('employee_already_bound');

    const [identity] = await tx
      .insert(employeeIdentities)
      .values({
        employeeId: employee.id,
        provider: request.provider,
        issuer: request.issuer,
        subject: request.subject,
        email: request.email,
      })
      .onConflictDoUpdate({
        // A previously revoked binding of this same Google account is re-activated.
        target: [employeeIdentities.provider, employeeIdentities.issuer, employeeIdentities.subject],
        set: { employeeId: employee.id, email: request.email, revokedAt: null },
        setWhere: sql`${employeeIdentities.revokedAt} is not null`,
      })
      .returning({ id: employeeIdentities.id });
    if (!identity) return fail('invalid_state');

    await tx
      .update(identityLinkRequests)
      .set({
        status: 'approved',
        decidedAt: sql`now()`,
        decidedByEmployeeId: actor!.id,
        approvedEmployeeId: employee.id,
      })
      .where(eq(identityLinkRequests.id, request.id));
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: 'identity.linked',
      entityType: 'employee',
      entityId: employee.id,
      details: {
        identityId: identity.id,
        linkRequestId: request.id,
        email: request.email,
        emailMatchesEmployeeRecord: (employee.googleEmail ?? '').toLowerCase() === request.email,
        conflictReason: request.conflictReason,
      },
    });
    return { ok: true };
  });
}

export async function rejectLinkRequest(
  actor: AdminActor | null,
  input: { requestId: string }
): Promise<AccountActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  if (!isUuid(input?.requestId)) return fail('invalid_input');
  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const rows = await tx
      .update(identityLinkRequests)
      .set({ status: 'rejected', decidedAt: sql`now()`, decidedByEmployeeId: actor!.id })
      .where(and(eq(identityLinkRequests.id, input.requestId), eq(identityLinkRequests.status, 'pending')))
      .returning({ id: identityLinkRequests.id });
    if (rows.length === 0) return fail('invalid_state');
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: 'identity.link_rejected',
      entityType: 'identity_link_request',
      entityId: input.requestId,
    });
    return { ok: true };
  });
}

export async function revokeIdentity(
  actor: AdminActor | null,
  input: { employeeId: string }
): Promise<AccountActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  if (!isUuid(input?.employeeId)) return fail('invalid_input');
  if (input.employeeId === actor!.id) return fail('self_action');
  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const rows = await tx
      .update(employeeIdentities)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(employeeIdentities.employeeId, input.employeeId), isNull(employeeIdentities.revokedAt)))
      .returning({ id: employeeIdentities.id });
    if (rows.length === 0) return fail('invalid_state');
    const sessions = await revokeEmployeeSessions(tx, input.employeeId, 'identity_revoked');
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: 'identity.revoked',
      entityType: 'employee',
      entityId: input.employeeId,
      details: { identityIds: rows.map((r) => r.id), sessionsRevoked: sessions },
    });
    return { ok: true };
  });
}

export async function setEmployeeAccess(
  actor: AdminActor | null,
  input: { employeeId: string; enabled: boolean; reason?: string }
): Promise<AccountActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  if (!isUuid(input?.employeeId) || typeof input.enabled !== 'boolean') return fail('invalid_input');
  if (input.employeeId === actor!.id) return fail('self_action');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!input.enabled && (reason === '' || reason.length > 200)) return fail('invalid_input');

  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const rows = await tx
      .update(employees)
      .set(
        input.enabled
          ? { accessEnabled: true, disabledAt: null, disabledReason: null }
          : { accessEnabled: false, disabledAt: sql`now()`, disabledReason: reason }
      )
      .where(and(eq(employees.id, input.employeeId), eq(employees.accessEnabled, !input.enabled)))
      .returning({ id: employees.id });
    if (rows.length === 0) return fail('invalid_state');
    const sessions = input.enabled ? 0 : await revokeEmployeeSessions(tx, input.employeeId, 'access_disabled');
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: input.enabled ? 'employee.access_enabled' : 'employee.access_disabled',
      entityType: 'employee',
      entityId: input.employeeId,
      details: input.enabled ? {} : { reason, sessionsRevoked: sessions },
    });
    return { ok: true };
  });
}

export async function setEmployeeRole(
  actor: AdminActor | null,
  input: { employeeId: string; role: string }
): Promise<AccountActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  if (!isUuid(input?.employeeId)) return fail('invalid_input');
  if (input.employeeId === actor!.id) return fail('self_action');
  if (!(ROLES as readonly string[]).includes(input.role)) return fail('invalid_input');

  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const [before] = await tx
      .select({ role: employees.role })
      .from(employees)
      .where(eq(employees.id, input.employeeId))
      .for('update');
    if (!before) return fail('not_found');
    if (before.role === input.role) return { ok: true };
    await tx.update(employees).set({ role: input.role }).where(eq(employees.id, input.employeeId));
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: 'employee.role_changed',
      entityType: 'employee',
      entityId: input.employeeId,
      details: { from: before.role, to: input.role },
    });
    return { ok: true };
  });
}

/** Used by the bootstrap CLI to decide whether it may still run. */
export async function countActiveAdminBindings(): Promise<number> {
  const rows = await getDb()
    .select({ id: employeeIdentities.id })
    .from(employeeIdentities)
    .innerJoin(employees, eq(employees.id, employeeIdentities.employeeId))
    .where(
      and(isNull(employeeIdentities.revokedAt), eq(employees.role, 'admin'), eq(employees.accessEnabled, true))
    );
  return rows.length;
}


export type BootstrapResult =
  | { ok: true; employeeId: string }
  | { ok: false; error: 'admin_already_bound' | 'not_found' | 'not_admin' | 'employee_disabled' | 'invalid_state' };

/**
 * One-time bootstrap for the very first admin login, run from a server shell
 * (scripts/auth-bootstrap.ts). Refuses as soon as any enabled admin has an
 * active Google binding; from then on bindings go through the admin page.
 */
export async function bootstrapFirstAdminBinding(input: {
  requestId: string;
  employeeCode: string;
}): Promise<BootstrapResult> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4242002502)`);
    const [existing] = await tx
      .select({ id: employeeIdentities.id })
      .from(employeeIdentities)
      .innerJoin(employees, eq(employees.id, employeeIdentities.employeeId))
      .where(
        and(isNull(employeeIdentities.revokedAt), eq(employees.role, 'admin'), eq(employees.accessEnabled, true))
      )
      .limit(1);
    if (existing) return { ok: false, error: 'admin_already_bound' };

    const [employee] = await tx
      .select({ id: employees.id, role: employees.role, accessEnabled: employees.accessEnabled })
      .from(employees)
      .where(eq(employees.employeeCode, input.employeeCode));
    if (!employee) return { ok: false, error: 'not_found' };
    if (employee.role !== 'admin') return { ok: false, error: 'not_admin' };
    if (!employee.accessEnabled) return { ok: false, error: 'employee_disabled' };

    const [request] = await tx
      .select()
      .from(identityLinkRequests)
      .where(and(eq(identityLinkRequests.id, input.requestId), eq(identityLinkRequests.status, 'pending')))
      .for('update');
    if (!request) return { ok: false, error: 'not_found' };

    const [identity] = await tx
      .insert(employeeIdentities)
      .values({
        employeeId: employee.id,
        provider: request.provider,
        issuer: request.issuer,
        subject: request.subject,
        email: request.email,
      })
      .onConflictDoNothing()
      .returning({ id: employeeIdentities.id });
    if (!identity) return { ok: false, error: 'invalid_state' };

    await tx
      .update(identityLinkRequests)
      .set({ status: 'approved', decidedAt: sql`now()`, approvedEmployeeId: employee.id })
      .where(eq(identityLinkRequests.id, request.id));
    await recordAudit(tx, {
      actorEmployeeId: null,
      action: 'identity.bootstrap_admin_linked',
      entityType: 'employee',
      entityId: employee.id,
      details: { identityId: identity.id, linkRequestId: request.id, email: request.email },
    });
    return { ok: true, employeeId: employee.id };
  });
}
