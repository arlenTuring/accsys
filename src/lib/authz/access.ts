import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { accessRolePermissions, accessRoles } from '@/lib/db/schema';
import {
  ALL_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  isPermission,
  type Permission,
  SYSTEM_ROLE_PERMISSIONS,
} from './permissions';

/**
 * Resolves the permission set for an access-role code.
 * System admin always has every permission (even if the table rows drift).
 */
export async function permissionsForRole(roleCode: string): Promise<Permission[]> {
  if (roleCode === 'admin') return [...ALL_PERMISSIONS];

  const db = getDb();
  const [role] = await db
    .select({ id: accessRoles.id, code: accessRoles.code, active: accessRoles.active, isSystem: accessRoles.isSystem })
    .from(accessRoles)
    .where(eq(accessRoles.code, roleCode))
    .limit(1);
  if (!role || !role.active) {
    // Unknown / inactive role: finance preset as a safety net for mid-migration sessions.
    if (roleCode === 'finance') return [...SYSTEM_ROLE_PERMISSIONS.finance];
    return [];
  }

  const rows = await db
    .select({ permission: accessRolePermissions.permission })
    .from(accessRolePermissions)
    .where(eq(accessRolePermissions.roleId, role.id));
  const held = rows.map((r) => r.permission).filter(isPermission);
  // Prefer DB rows; if a system finance row was wiped, fall back to the preset.
  if (held.length === 0 && role.isSystem && role.code === 'finance') return [...SYSTEM_ROLE_PERMISSIONS.finance];
  return held;
}

export type PermissionActor = {
  id: string;
  role: string;
  permissions?: readonly string[] | null;
} | null | undefined;

/** Uses session-cached permissions when present; otherwise loads by role code. */
export async function actorPermissions(actor: PermissionActor): Promise<Permission[]> {
  if (!actor) return [];
  if (actor.permissions) return actor.permissions.filter(isPermission);
  return permissionsForRole(actor.role);
}

export async function actorHas(actor: PermissionActor, permission: Permission): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (actor.permissions) return hasPermission(actor.permissions, permission);
  return hasPermission(await permissionsForRole(actor.role), permission);
}

export async function actorHasAny(actor: PermissionActor, permissions: readonly Permission[]): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (actor.permissions) return hasAnyPermission(actor.permissions, permissions);
  return hasAnyPermission(await permissionsForRole(actor.role), permissions);
}

export { ADMIN_NAV_PERMISSIONS, FINANCE_NAV_PERMISSIONS } from './permissions';
