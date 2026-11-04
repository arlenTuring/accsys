import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { actorHas } from '@/lib/authz/access';
import { getDb } from '@/lib/db';
import {
  companyAnnouncementReads,
  companyAnnouncements,
  companyAnnouncementVersions,
  departments,
  employees,
} from '@/lib/db/schema';

export type AnnouncementActor = { id: string; role: string } | null;

export type AudienceType = 'company' | 'department' | 'employees';
export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'expired' | 'withdrawn';
export type AnnouncementPriority = 'normal' | 'important' | 'urgent';

export type AnnouncementInput = {
  title: string;
  body: string;
  category?: string;
  audienceType?: AudienceType;
  audienceDepartmentIds?: string[];
  audienceEmployeeIds?: string[];
  priority?: AnnouncementPriority;
  pinned?: boolean;
  publishAt?: string | null;
  expireAt?: string | null;
  expectedVersion?: number;
};

/** Strip control chars; body is plain text only (no HTML rendering). */
export function sanitizeAnnouncementText(raw: string, max: number): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, max)
    .trim();
}

export async function canManageAnnouncements(actor: AnnouncementActor): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return actorHas(actor, 'company.announcements');
}

function inAudience(
  row: {
    audienceType: string;
    audienceDepartmentIds: string[] | null;
    audienceEmployeeIds: string[] | null;
  },
  employeeId: string,
  departmentId: string | null
): boolean {
  if (row.audienceType === 'company') return true;
  if (row.audienceType === 'department') {
    const ids = row.audienceDepartmentIds ?? [];
    return !!departmentId && ids.includes(departmentId);
  }
  if (row.audienceType === 'employees') {
    return (row.audienceEmployeeIds ?? []).includes(employeeId);
  }
  return false;
}

export async function listVisibleAnnouncements(input: {
  employeeId: string;
  departmentId: string | null;
  includeDrafts?: boolean;
  manage?: boolean;
}) {
  const db = getDb();
  const rows = await db
    .select()
    .from(companyAnnouncements)
    .where(
      input.manage
        ? undefined
        : inArray(companyAnnouncements.status, ['published', 'scheduled', 'expired'])
    )
    .orderBy(desc(companyAnnouncements.pinned), desc(companyAnnouncements.publishedAt), desc(companyAnnouncements.createdAt))
    .limit(200);

  const now = Date.now();
  return rows.filter((r) => {
    if (input.manage) return true;
    if (!inAudience(r, input.employeeId, input.departmentId)) return false;
    if (r.status === 'withdrawn' || r.status === 'draft') return false;
    if (r.status === 'scheduled') {
      return !!(r.publishAt && r.publishAt.getTime() <= now);
    }
    if (r.status === 'published' || r.status === 'expired') return true;
    return false;
  });
}

export async function getAnnouncementForViewer(input: {
  id: string;
  employeeId: string;
  departmentId: string | null;
  manage: boolean;
}) {
  const db = getDb();
  const [row] = await db.select().from(companyAnnouncements).where(eq(companyAnnouncements.id, input.id)).limit(1);
  if (!row) return null;
  if (!input.manage) {
    if (row.status === 'draft' || row.status === 'withdrawn') return null;
    if (!inAudience(row, input.employeeId, input.departmentId)) return null;
    const now = Date.now();
    if (row.status === 'scheduled' && row.publishAt && row.publishAt.getTime() > now) return null;
  }
  return row;
}

function normalizeUuidList(raw: string[] | undefined): string[] {
  return [...new Set((raw ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
}

function validateAudience(
  audienceType: AudienceType,
  departmentIds: string[],
  employeeIds: string[]
): string | null {
  if (audienceType === 'department' && departmentIds.length === 0) return '請至少選擇一個部門';
  if (audienceType === 'employees' && employeeIds.length === 0) return '請至少選擇一位員工';
  return null;
}

/** Options for announcement / survey audience pickers (managers only). */
export async function listAudiencePickerOptions(actor: AnnouncementActor) {
  if (!(await canManageAnnouncements(actor)) || !actor) return null;
  const db = getDb();
  const [deptRows, empRows] = await Promise.all([
    db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .where(eq(departments.active, true))
      .orderBy(asc(departments.sortOrder), asc(departments.code)),
    db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        name: employees.name,
        departmentId: employees.departmentId,
      })
      .from(employees)
      .where(eq(employees.accessEnabled, true))
      .orderBy(asc(employees.employeeCode))
      .limit(2000),
  ]);
  return { departments: deptRows, employees: empRows };
}

export async function createAnnouncement(actor: AnnouncementActor, input: AnnouncementInput) {
  if (!(await canManageAnnouncements(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const title = sanitizeAnnouncementText(input.title, 200);
  const body = sanitizeAnnouncementText(input.body, 50000);
  if (!title || !body) return { ok: false as const, error: '標題與內文不可空白' };

  const audienceType = input.audienceType ?? 'company';
  const audienceDepartmentIds = normalizeUuidList(input.audienceDepartmentIds);
  const audienceEmployeeIds = normalizeUuidList(input.audienceEmployeeIds);
  const audienceError = validateAudience(audienceType, audienceDepartmentIds, audienceEmployeeIds);
  if (audienceError) return { ok: false as const, error: audienceError };

  const publishAt = input.publishAt ? new Date(input.publishAt) : null;
  const expireAt = input.expireAt ? new Date(input.expireAt) : null;
  const status: AnnouncementStatus =
    publishAt && publishAt.getTime() > Date.now() ? 'scheduled' : 'draft';

  const db = getDb();
  const [row] = await db
    .insert(companyAnnouncements)
    .values({
      title,
      body,
      category: (input.category ?? 'general').slice(0, 40),
      audienceType,
      audienceDepartmentIds: audienceType === 'department' ? audienceDepartmentIds : [],
      audienceEmployeeIds: audienceType === 'employees' ? audienceEmployeeIds : [],
      priority: input.priority ?? 'normal',
      pinned: !!input.pinned,
      status,
      publishAt,
      expireAt,
      createdByEmployeeId: actor.id,
      updatedByEmployeeId: actor.id,
    })
    .returning();

  await db.insert(companyAnnouncementVersions).values({
    announcementId: row.id,
    version: 1,
    title: row.title,
    body: row.body,
    snapshot: { status: row.status, audienceType: row.audienceType },
    createdByEmployeeId: actor.id,
  });

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'announcement.create',
    entityType: 'company_announcement',
    entityId: row.id,
    details: { title: row.title, status: row.status },
  });

  return { ok: true as const, announcement: row };
}

export async function updateAnnouncement(actor: AnnouncementActor, id: string, input: AnnouncementInput) {
  if (!(await canManageAnnouncements(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [existing] = await db.select().from(companyAnnouncements).where(eq(companyAnnouncements.id, id)).limit(1);
  if (!existing) return { ok: false as const, error: 'not_found' };
  if (input.expectedVersion != null && existing.version !== input.expectedVersion) {
    return { ok: false as const, error: 'version_conflict', version: existing.version };
  }

  const title = sanitizeAnnouncementText(input.title, 200);
  const body = sanitizeAnnouncementText(input.body, 50000);
  if (!title || !body) return { ok: false as const, error: '標題與內文不可空白' };

  const audienceType = input.audienceType ?? (existing.audienceType as AudienceType);
  const audienceDepartmentIds =
    input.audienceDepartmentIds !== undefined
      ? normalizeUuidList(input.audienceDepartmentIds)
      : existing.audienceDepartmentIds ?? [];
  const audienceEmployeeIds =
    input.audienceEmployeeIds !== undefined
      ? normalizeUuidList(input.audienceEmployeeIds)
      : existing.audienceEmployeeIds ?? [];
  const audienceError = validateAudience(audienceType, audienceDepartmentIds, audienceEmployeeIds);
  if (audienceError) return { ok: false as const, error: audienceError };

  const nextVersion = existing.version + 1;
  const [row] = await db
    .update(companyAnnouncements)
    .set({
      title,
      body,
      category: (input.category ?? existing.category).slice(0, 40),
      audienceType,
      audienceDepartmentIds: audienceType === 'department' ? audienceDepartmentIds : [],
      audienceEmployeeIds: audienceType === 'employees' ? audienceEmployeeIds : [],
      priority: input.priority ?? (existing.priority as AnnouncementPriority),
      pinned: input.pinned ?? existing.pinned,
      publishAt: input.publishAt !== undefined ? (input.publishAt ? new Date(input.publishAt) : null) : existing.publishAt,
      expireAt: input.expireAt !== undefined ? (input.expireAt ? new Date(input.expireAt) : null) : existing.expireAt,
      version: nextVersion,
      summaryCache: null,
      summarySourceVersion: null,
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
    })
    .where(eq(companyAnnouncements.id, id))
    .returning();

  await db.insert(companyAnnouncementVersions).values({
    announcementId: id,
    version: nextVersion,
    title: row.title,
    body: row.body,
    snapshot: { status: row.status },
    createdByEmployeeId: actor.id,
  });

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'announcement.update',
    entityType: 'company_announcement',
    entityId: id,
    details: { version: nextVersion },
  });

  return { ok: true as const, announcement: row };
}

export async function publishAnnouncement(actor: AnnouncementActor, id: string, expectedVersion: number) {
  if (!(await canManageAnnouncements(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [existing] = await db.select().from(companyAnnouncements).where(eq(companyAnnouncements.id, id)).limit(1);
  if (!existing) return { ok: false as const, error: 'not_found' };
  if (existing.version !== expectedVersion) return { ok: false as const, error: 'version_conflict', version: existing.version };

  const publishAt = existing.publishAt && existing.publishAt.getTime() > Date.now() ? existing.publishAt : new Date();
  const status: AnnouncementStatus = publishAt.getTime() > Date.now() ? 'scheduled' : 'published';

  const [row] = await db
    .update(companyAnnouncements)
    .set({
      status,
      publishAt,
      publishedAt: status === 'published' ? sql`now()` : existing.publishedAt,
      withdrawnAt: null,
      version: existing.version + 1,
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
    })
    .where(eq(companyAnnouncements.id, id))
    .returning();

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'announcement.publish',
    entityType: 'company_announcement',
    entityId: id,
    details: { status, version: row.version },
  });

  return { ok: true as const, announcement: row };
}

export async function withdrawAnnouncement(actor: AnnouncementActor, id: string, expectedVersion: number) {
  if (!(await canManageAnnouncements(actor)) || !actor) return { ok: false as const, error: 'forbidden' };
  const db = getDb();
  const [existing] = await db.select().from(companyAnnouncements).where(eq(companyAnnouncements.id, id)).limit(1);
  if (!existing) return { ok: false as const, error: 'not_found' };
  if (existing.version !== expectedVersion) return { ok: false as const, error: 'version_conflict', version: existing.version };

  const [row] = await db
    .update(companyAnnouncements)
    .set({
      status: 'withdrawn',
      withdrawnAt: sql`now()`,
      version: existing.version + 1,
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
    })
    .where(eq(companyAnnouncements.id, id))
    .returning();

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'announcement.withdraw',
    entityType: 'company_announcement',
    entityId: id,
    details: { version: row.version },
  });

  return { ok: true as const, announcement: row };
}

export async function markAnnouncementRead(employeeId: string, announcementId: string) {
  const db = getDb();
  await db
    .insert(companyAnnouncementReads)
    .values({ announcementId, employeeId, readAt: sql`now()` })
    .onConflictDoUpdate({
      target: [companyAnnouncementReads.announcementId, companyAnnouncementReads.employeeId],
      set: { readAt: sql`coalesce(${companyAnnouncementReads.readAt}, now())` },
    });
}

export async function acknowledgeAnnouncement(employeeId: string, announcementId: string) {
  const db = getDb();
  await db
    .insert(companyAnnouncementReads)
    .values({ announcementId, employeeId, readAt: sql`now()`, acknowledgedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [companyAnnouncementReads.announcementId, companyAnnouncementReads.employeeId],
      set: {
        readAt: sql`coalesce(${companyAnnouncementReads.readAt}, now())`,
        acknowledgedAt: sql`now()`,
      },
    });
  await recordAudit(db, {
    actorEmployeeId: employeeId,
    action: 'announcement.acknowledge',
    entityType: 'company_announcement',
    entityId: announcementId,
    details: {},
  });
}

export async function getReadState(employeeId: string, announcementId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companyAnnouncementReads)
    .where(
      and(
        eq(companyAnnouncementReads.announcementId, announcementId),
        eq(companyAnnouncementReads.employeeId, employeeId)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Plain-text summary for assistant; invalidated when version changes. */
export async function getOrBuildSummary(announcementId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select().from(companyAnnouncements).where(eq(companyAnnouncements.id, announcementId)).limit(1);
  if (!row) return null;
  if (row.summaryCache && row.summarySourceVersion === row.version) return row.summaryCache;

  const lines = row.body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const summary = `${row.title}：${lines.slice(0, 3).join(' ').slice(0, 280)}`;
  await db
    .update(companyAnnouncements)
    .set({ summaryCache: summary, summarySourceVersion: row.version })
    .where(eq(companyAnnouncements.id, announcementId));
  return summary;
}

/** Unread published announcements for assistant welcome / tools. */
export async function listUnreadForEmployee(input: {
  employeeId: string;
  departmentId: string | null;
  limit?: number;
}) {
  const visible = await listVisibleAnnouncements({
    employeeId: input.employeeId,
    departmentId: input.departmentId,
  });
  const published = visible.filter((a) => a.status === 'published' || (a.publishAt && a.publishAt.getTime() <= Date.now() && a.status !== 'withdrawn' && a.status !== 'draft'));
  const db = getDb();
  const reads = await db
    .select()
    .from(companyAnnouncementReads)
    .where(eq(companyAnnouncementReads.employeeId, input.employeeId));
  const readMap = new Map(reads.map((r) => [r.announcementId, r]));
  return published
    .filter((a) => !readMap.get(a.id)?.readAt)
    .slice(0, input.limit ?? 10)
    .map((a) => ({
      id: a.id,
      title: a.title,
      priority: a.priority,
      href: `/announcements/${a.id}`,
      summary: a.summaryCache && a.summarySourceVersion === a.version ? a.summaryCache : null,
    }));
}

export async function activateDueScheduled() {
  const db = getDb();
  await db
    .update(companyAnnouncements)
    .set({ status: 'published', publishedAt: sql`coalesce(${companyAnnouncements.publishedAt}, now())`, updatedAt: sql`now()` })
    .where(
      and(
        eq(companyAnnouncements.status, 'scheduled'),
        sql`${companyAnnouncements.publishAt} <= now()`
      )
    );
  await db
    .update(companyAnnouncements)
    .set({ status: 'expired', updatedAt: sql`now()` })
    .where(
      and(
        eq(companyAnnouncements.status, 'published'),
        sql`${companyAnnouncements.expireAt} is not null and ${companyAnnouncements.expireAt} < now()`
      )
    );
}
