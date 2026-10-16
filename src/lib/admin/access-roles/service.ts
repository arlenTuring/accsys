import { and, count, eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { actorHas } from '@/lib/authz/access';
import { isUuid } from '@/lib/authz/forms';
import { ALL_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { accessRolePermissions, accessRoles, employees } from '@/lib/db/schema';
import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { abort, runInTransaction, type ErrorCode, type Tx } from '@/lib/workflow/tx';
import { parseAccessRole, type Parsed } from './validate';

/**
 * Access roles (權限角色): named permission bundles assigned via employees.role.
 * Distinct from job roles. Creating/editing requires org.access_roles; the
 * built-in admin role is locked to every permission.
 */

export type AccessRoleActor = { id: string; role: string; permissions?: readonly string[]; authenticatedAt: Date } | null;
export type AccessRoleFailure = { ok: false; code: ErrorCode | 'reauth_required' | 'rate_limited'; error: string };
export type AccessRoleResult<T extends object = object> = ({ ok: true } & T) | AccessRoleFailure;

const RECENT_MS = 60 * 60_000;

async function guard(actor: AccessRoleActor): Promise<AccessRoleFailure | null> {
  if (!actor) return { ok: false, code: 'forbidden', error: '只有具「權限角色」權限的管理員可以修改' };
  if (!(await actorHas(actor, 'org.access_roles'))) {
    return { ok: false, code: 'forbidden', error: '只有具「權限角色」權限的管理員可以修改' };
  }
  if (Date.now() - actor.authenticatedAt.getTime() > RECENT_MS) {
    return { ok: false, code: 'reauth_required', error: '修改權限角色需要 1 小時內登入過，請重新登入後再試' };
  }
  const limit = await hitRateLimit(`access-roles:${actor.id}`, RATE_LIMITS.orgAdminActionPerEmployee);
  return limit.allowed ? null : { ok: false, code: 'rate_limited', error: '操作過於頻繁，請稍後再試' };
}

async function run<T extends object>(actor: AccessRoleActor, label: string, work: (tx: Tx, actorId: string) => Promise<T>): Promise<AccessRoleResult<T>> {
  const denied = await guard(actor);
  if (denied) return denied;
  return runInTransaction(`access_role.${label}`, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('accsys.access_roles'))`);
    const [me] = await tx.select({ role: employees.role, active: employees.accessEnabled }).from(employees).where(eq(employees.id, actor!.id));
    if (!me?.active) abort('forbidden', '只有具「權限角色」權限的管理員可以修改');
    // Re-check inside the transaction against the DB role (permissions may have changed).
    if (me.role !== 'admin') {
      const [mine] = await tx
        .select({ id: accessRoles.id })
        .from(accessRoles)
        .innerJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessRoles.id))
        .where(and(eq(accessRoles.code, me.role), eq(accessRoles.active, true), eq(accessRolePermissions.permission, 'org.access_roles')))
        .limit(1);
      if (!mine) abort('forbidden', '只有具「權限角色」權限的管理員可以修改');
    }
    return { ok: true as const, ...(await work(tx, actor!.id)) };
  });
}

function need<T>(p: Parsed<T>): T {
  if (!p.ok) abort('validation', p.error);
  return (p as { ok: true; value: T }).value;
}

function needId(v: unknown): string {
  if (!isUuid(v)) abort('not_found', '找不到這個權限角色');
  return v as string;
}

async function lockRole(tx: Tx, id: string, expectedVersion: unknown) {
  const [row] = await tx.select().from(accessRoles).where(eq(accessRoles.id, id)).for('update');
  if (!row) abort('not_found', '找不到這個權限角色');
  const version = typeof expectedVersion === 'number' ? expectedVersion : Number(expectedVersion);
  if (!Number.isInteger(version) || row.version !== version) abort('conflict', '這個角色已被其他人修改，請重新整理後再試');
  return row;
}

async function replacePermissions(tx: Tx, roleId: string, permissions: string[]) {
  await tx.delete(accessRolePermissions).where(eq(accessRolePermissions.roleId, roleId));
  if (permissions.length === 0) return;
  await tx.insert(accessRolePermissions).values(permissions.map((permission) => ({ roleId, permission })));
}

const audit = (tx: Tx, actorId: string, action: string, entityId: string, details: Record<string, unknown>) =>
  recordAudit(tx, { actorEmployeeId: actorId, action, entityType: 'access_role', entityId, details });

export function saveAccessRole(actor: AccessRoleActor, id: unknown, raw: unknown, expectedVersion: unknown = 1) {
  const creating = id === null || id === undefined || id === '';
  return run(actor, creating ? 'create' : 'update', async (tx, actorId) => {
    const input = need(parseAccessRole(raw, creating));
    if (creating) {
      const [clash] = await tx.select({ id: accessRoles.id }).from(accessRoles).where(eq(accessRoles.code, input.code)).limit(1);
      if (clash) abort('conflict', '此代號已被使用，請換一個');
      const [row] = await tx
        .insert(accessRoles)
        .values({ code: input.code, name: input.name, description: input.description, isSystem: false, active: true })
        .returning({ id: accessRoles.id, code: accessRoles.code });
      await replacePermissions(tx, row.id, input.permissions);
      await audit(tx, actorId, 'access_role.created', row.id, { code: row.code, name: input.name, permissions: input.permissions });
      return { id: row.id };
    }

    const row = await lockRole(tx, needId(id), expectedVersion);
    if (row.code === 'admin') abort('validation', '系統管理員的權限固定為全部，不能修改');
    const permissions = row.isSystem && row.code === 'admin' ? [...ALL_PERMISSIONS] : input.permissions;
    const before = await tx.select({ permission: accessRolePermissions.permission }).from(accessRolePermissions).where(eq(accessRolePermissions.roleId, row.id));
    await tx
      .update(accessRoles)
      .set({
        name: input.name,
        description: input.description,
        updatedAt: sql`now()`,
        version: sql`${accessRoles.version} + 1`,
      })
      .where(eq(accessRoles.id, row.id));
    await replacePermissions(tx, row.id, permissions);
    await audit(tx, actorId, 'access_role.updated', row.id, {
      code: row.code,
      before: { name: row.name, description: row.description, permissions: before.map((p) => p.permission) },
      after: { name: input.name, description: input.description, permissions },
    });
    return { id: row.id };
  });
}

export function setAccessRoleActive(actor: AccessRoleActor, id: unknown, active: boolean, expectedVersion: unknown) {
  return run(actor, active ? 'activate' : 'deactivate', async (tx, actorId) => {
    const row = await lockRole(tx, needId(id), expectedVersion);
    if (row.isSystem) abort('validation', '系統內建角色不能停用');
    if (row.active === active) abort('conflict', active ? '這個角色已是啟用狀態' : '這個角色已是停用狀態');
    if (!active) {
      const [{ n }] = await tx.select({ n: count() }).from(employees).where(eq(employees.role, row.code));
      if (n > 0) abort('conflict', `仍有 ${n} 位員工使用此角色，請先改派後再停用`);
    }
    await tx
      .update(accessRoles)
      .set({ active, updatedAt: sql`now()`, version: sql`${accessRoles.version} + 1` })
      .where(eq(accessRoles.id, row.id));
    await audit(tx, actorId, active ? 'access_role.activated' : 'access_role.deactivated', row.id, { code: row.code });
    return {};
  });
}

/** Permissions that should be stored for a system role after seed / reset. */
export function seedPermissionsFor(code: keyof typeof SYSTEM_ROLE_PERMISSIONS): readonly string[] {
  return SYSTEM_ROLE_PERMISSIONS[code];
}
