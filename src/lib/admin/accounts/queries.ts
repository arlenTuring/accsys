import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { departments, employeeIdentities, employees, identityLinkRequests } from '@/lib/db/schema';

export type LinkRequestRow = {
  id: string;
  email: string;
  displayName: string | null;
  status: 'pending' | 'rejected';
  conflictReason: string | null;
  attemptCount: number;
  lastAttemptAt: string;
  suggestedEmployeeId: string | null;
};

export type AccountRow = {
  id: string;
  employeeCode: string;
  name: string;
  departmentName: string;
  role: 'staff' | 'finance' | 'admin';
  recordEmail: string | null;
  accessEnabled: boolean;
  disabledReason: string | null;
  boundEmail: string | null;
};

/** Admin-only data; the caller must have checked the role. */
export async function getAccountsOverview(): Promise<{ requests: LinkRequestRow[]; accounts: AccountRow[] }> {
  const db = getDb();
  const [requests, accounts] = await Promise.all([
    db
      .select()
      .from(identityLinkRequests)
      .where(inArray(identityLinkRequests.status, ['pending', 'rejected']))
      .orderBy(desc(identityLinkRequests.lastAttemptAt))
      .limit(100),
    db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        name: employees.name,
        departmentName: departments.name,
        role: employees.role,
        recordEmail: employees.googleEmail,
        accessEnabled: employees.accessEnabled,
        disabledReason: employees.disabledReason,
        boundEmail: employeeIdentities.email,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(
        employeeIdentities,
        and(eq(employeeIdentities.employeeId, employees.id), isNull(employeeIdentities.revokedAt))
      )
      .orderBy(asc(employees.employeeCode)),
  ]);

  // Suggestion only (same address on the employee record); never applied automatically.
  const byEmail = new Map(
    accounts.filter((a) => a.recordEmail).map((a) => [a.recordEmail!.toLowerCase(), a.id] as const)
  );
  return {
    requests: requests.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      status: r.status as LinkRequestRow['status'],
      conflictReason: r.conflictReason,
      attemptCount: r.attemptCount,
      lastAttemptAt: new Date(r.lastAttemptAt).toISOString(),
      suggestedEmployeeId: byEmail.get(r.email) ?? null,
    })),
    accounts: accounts.map((a) => ({ ...a, role: a.role as AccountRow['role'] })),
  };
}
