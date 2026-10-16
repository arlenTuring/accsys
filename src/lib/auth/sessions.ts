import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { hashToken, randomToken } from '@/lib/auth/tokens';
import { permissionsForRole } from '@/lib/authz/access';
import type { Permission } from '@/lib/authz/permissions';
import { getDb, type Db } from '@/lib/db';
import { appSessions, departments, employeeIdentities, employees } from '@/lib/db/schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Executor = Db | Tx;

export type SessionEmployee = {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  title: string | null;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  /** Access-role code (staff / finance / admin / custom). */
  role: string;
  /** Capabilities of the access role, resolved on every session lookup. */
  permissions: Permission[];
  isGeneralManager: boolean;
  isChairman: boolean;
  sessionId: string;
  /** When this session was created by a login. */
  authenticatedAt: Date;
};

/** Creates a session and returns the raw token for the cookie (only its hash is stored). */
export async function createSession(
  tx: Executor,
  input: { employeeId: string; identityId: string | null; ttlMs: number }
): Promise<{ token: string; sessionId: string }> {
  const token = randomToken();
  const [row] = await tx
    .insert(appSessions)
    .values({
      tokenHash: hashToken(token),
      employeeId: input.employeeId,
      identityId: input.identityId,
      expiresAt: sql`now() + make_interval(secs => ${Math.floor(input.ttlMs / 1000)})`,
    })
    .returning({ id: appSessions.id });
  return { token, sessionId: row.id };
}

/**
 * Looks up a session token. Valid only if the session is neither revoked nor
 * expired, the employee still has access, and (for Google logins) the identity
 * binding is still active. Role and profile are read fresh on every call.
 */
export async function resolveSession(token: string | undefined | null): Promise<SessionEmployee | null> {
  if (!token || token.length > 200) return null;
  const rows = await getDb()
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      email: employees.googleEmail,
      title: employees.title,
      departmentId: employees.departmentId,
      departmentCode: departments.code,
      departmentName: departments.name,
      role: employees.role,
      isGeneralManager: employees.isGeneralManager,
      isChairman: employees.isChairman,
      sessionId: appSessions.id,
      authenticatedAt: appSessions.createdAt,
      identityId: appSessions.identityId,
    })
    .from(appSessions)
    .innerJoin(employees, eq(employees.id, appSessions.employeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(employeeIdentities, eq(employeeIdentities.id, appSessions.identityId))
    .where(
      and(
        eq(appSessions.tokenHash, hashToken(token)),
        isNull(appSessions.revokedAt),
        gt(appSessions.expiresAt, sql`now()`),
        eq(employees.accessEnabled, true),
        or(isNull(appSessions.identityId), isNull(employeeIdentities.revokedAt))
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // Sessions without a Google identity only come from the development login.
  if (row.identityId === null && process.env.NODE_ENV === 'production') return null;
  const permissions = await permissionsForRole(row.role);
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    name: row.name,
    email: row.email ?? '',
    title: row.title,
    departmentId: row.departmentId,
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    role: row.role,
    permissions,
    isGeneralManager: row.isGeneralManager,
    isChairman: row.isChairman,
    sessionId: row.sessionId,
    authenticatedAt: new Date(row.authenticatedAt),
  };
}

export async function revokeSessionToken(tx: Executor, token: string, reason: string): Promise<string | null> {
  const rows = await tx
    .update(appSessions)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(appSessions.tokenHash, hashToken(token)), isNull(appSessions.revokedAt)))
    .returning({ employeeId: appSessions.employeeId });
  return rows[0]?.employeeId ?? null;
}

export async function revokeEmployeeSessions(tx: Executor, employeeId: string, reason: string): Promise<number> {
  const rows = await tx
    .update(appSessions)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(appSessions.employeeId, employeeId), isNull(appSessions.revokedAt)))
    .returning({ id: appSessions.id });
  return rows.length;
}
