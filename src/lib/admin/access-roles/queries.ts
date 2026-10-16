import { asc, count, eq, sql } from 'drizzle-orm';
import { ALL_PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import { getDb } from '@/lib/db';
import { accessRolePermissions, accessRoles, employees } from '@/lib/db/schema';

export type AccessRoleListItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  active: boolean;
  version: number;
  permissions: Permission[];
  memberCount: number;
};

export async function listAccessRoles(): Promise<AccessRoleListItem[]> {
  const db = getDb();
  const roles = await db
    .select({
      id: accessRoles.id,
      code: accessRoles.code,
      name: accessRoles.name,
      description: accessRoles.description,
      isSystem: accessRoles.isSystem,
      active: accessRoles.active,
      version: accessRoles.version,
    })
    .from(accessRoles)
    .orderBy(asc(accessRoles.isSystem), asc(accessRoles.code));

  if (roles.length === 0) return [];

  const perms = await db.select({ roleId: accessRolePermissions.roleId, permission: accessRolePermissions.permission }).from(accessRolePermissions);
  const byRole = new Map<string, Permission[]>();
  for (const p of perms) {
    if (!(ALL_PERMISSIONS as string[]).includes(p.permission)) continue;
    const list = byRole.get(p.roleId) ?? [];
    list.push(p.permission as Permission);
    byRole.set(p.roleId, list);
  }

  const members = await db
    .select({ role: employees.role, n: count() })
    .from(employees)
    .groupBy(employees.role);
  const memberOf = new Map(members.map((m) => [m.role, Number(m.n)]));

  return roles.map((r) => ({
    ...r,
    description: r.description ?? '',
    permissions: r.code === 'admin' ? [...ALL_PERMISSIONS] : (byRole.get(r.id) ?? []),
    memberCount: memberOf.get(r.code) ?? 0,
  }));
}

/** Active roles for the accounts role picker. */
export async function listAssignableAccessRoles(): Promise<{ code: string; name: string; isSystem: boolean }[]> {
  return getDb()
    .select({ code: accessRoles.code, name: accessRoles.name, isSystem: accessRoles.isSystem })
    .from(accessRoles)
    .where(eq(accessRoles.active, true))
    .orderBy(
      sql`case ${accessRoles.code} when 'staff' then 0 when 'finance' then 1 when 'admin' then 2 else 3 end`,
      asc(accessRoles.name)
    );
}
