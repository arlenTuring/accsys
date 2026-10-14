import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  approvalSteps,
  departments,
  directorySyncRuns,
  directoryUsers,
  employeeIdentities,
  employees,
  identityLinkRequests,
} from '@/lib/db/schema';
import { activeJobRoles, type JobRoleOption } from '@/lib/admin/employees/queries';
import { buildDirectoryReview, type DirectoryReview, type Leaver } from '@/lib/directory/review';
import { directoryIssuer } from '@/lib/directory/service';

export type SyncRunRow = {
  id: string;
  source: 'directory' | 'fixture';
  status: 'succeeded' | 'blocked' | 'failed';
  finishedAt: string;
  directoryCount: number | null;
  activeCount: number | null;
  error: string | null;
};

export type PendingStep = { id: string; formType: string; formId: string; stepLabel: string | null };
export type LeaverWithHandover = Leaver & { pendingSteps: PendingStep[] };

export type DirectoryPageData = Omit<DirectoryReview, 'leavers'> & {
  /** AUTH_MODE: only `manual` is supported today. */
  syncMode: string;
  runs: SyncRunRow[];
  lastSuccessAt: string | null;
  /** Latest run against the real Workspace listing; none means not authorized or not scheduled yet. */
  lastDirectoryRun: SyncRunRow | null;
  snapshotCount: number;
  leavers: LeaverWithHandover[];
  departments: { id: string; code: string; name: string }[];
  jobRoles: JobRoleOption[];
};

/** Admin-only data; the caller must have checked the role. */
export async function getDirectoryPageData(): Promise<DirectoryPageData> {
  const db = getDb();
  const issuer = directoryIssuer();
  const [runs, lastSuccess, lastDirectory, snapshot, employeeRows, identities, requests, departmentRows, jobRoleRows] = await Promise.all([
    db.select().from(directorySyncRuns).orderBy(desc(directorySyncRuns.finishedAt)).limit(10),
    db
      .select({ finishedAt: directorySyncRuns.finishedAt })
      .from(directorySyncRuns)
      .where(eq(directorySyncRuns.status, 'succeeded'))
      .orderBy(desc(directorySyncRuns.finishedAt))
      .limit(1),
    db.select().from(directorySyncRuns).where(eq(directorySyncRuns.source, 'directory')).orderBy(desc(directorySyncRuns.finishedAt)).limit(1),
    db.select().from(directoryUsers),
    db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        name: employees.name,
        googleEmail: employees.googleEmail,
        phone: employees.phone,
        extension: employees.extension,
        title: employees.title,
        departmentName: departments.name,
        accessEnabled: employees.accessEnabled,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId)),
    db
      .select({ employeeId: employeeIdentities.employeeId, subject: employeeIdentities.subject, revokedAt: employeeIdentities.revokedAt })
      .from(employeeIdentities)
      .where(and(eq(employeeIdentities.provider, 'google'), eq(employeeIdentities.issuer, issuer))),
    db
      .select({ id: identityLinkRequests.id, subject: identityLinkRequests.subject, email: identityLinkRequests.email })
      .from(identityLinkRequests)
      .where(
        and(
          eq(identityLinkRequests.provider, 'google'),
          eq(identityLinkRequests.issuer, issuer),
          eq(identityLinkRequests.status, 'pending')
        )
      ),
    db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .where(eq(departments.active, true))
      .orderBy(asc(departments.sortOrder), asc(departments.code)),
    activeJobRoles(db),
  ]);

  const review = buildDirectoryReview({
    snapshot: snapshot.map((d) => ({ ...d, removed: d.removedAt !== null })),
    employees: employeeRows,
    identities: identities.map((i) => ({ employeeId: i.employeeId, subject: i.subject, active: i.revokedAt === null })),
    linkRequests: requests,
  });

  const leaverIds = review.leavers.map((l) => l.employeeId);
  const pending = leaverIds.length
    ? await db
        .select({
          id: approvalSteps.id,
          employeeId: approvalSteps.approverEmployeeId,
          formType: approvalSteps.formType,
          formId: approvalSteps.formId,
          stepLabel: approvalSteps.stepLabel,
        })
        .from(approvalSteps)
        .where(and(eq(approvalSteps.status, 'pending'), inArray(approvalSteps.approverEmployeeId, leaverIds)))
        .orderBy(asc(approvalSteps.createdAt))
        .limit(1000)
    : [];

  return {
    ...review,
    leavers: review.leavers.map((l) => ({
      ...l,
      pendingSteps: pending
        .filter((p) => p.employeeId === l.employeeId)
        .map((p) => ({ id: p.id, formType: p.formType, formId: p.formId, stepLabel: p.stepLabel })),
    })),
    syncMode: process.env.AUTH_MODE?.trim() || 'manual',
    runs: runs.map(toRunRow),
    lastSuccessAt: lastSuccess[0] ? new Date(lastSuccess[0].finishedAt).toISOString() : null,
    lastDirectoryRun: lastDirectory[0] ? toRunRow(lastDirectory[0]) : null,
    snapshotCount: snapshot.length,
    departments: departmentRows,
    jobRoles: jobRoleRows,
  };
}

function toRunRow(r: typeof directorySyncRuns.$inferSelect): SyncRunRow {
  return {
    id: r.id,
    source: r.source as SyncRunRow['source'],
    status: r.status as SyncRunRow['status'],
    finishedAt: new Date(r.finishedAt).toISOString(),
    directoryCount: r.directoryCount,
    activeCount: r.activeCount,
    error: r.error,
  };
}
