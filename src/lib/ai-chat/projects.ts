import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { aiProjectUsage, formSubmissions, projects } from '@/lib/db/schema';
import { projectUsableBy } from '@/lib/projects/access';

export type ProjectOption = {
  id: string;
  code: string;
  name: string;
  kind: string | null;
  source: 'recent_used' | 'recently_updated';
  lastUsedAt?: string;
  updatedAt?: string;
};

/**
 * Up to `limit` projects: prefer user recent usage that are still selectable,
 * then fill with recently updated projects. Never "first 5 by code".
 */
export async function listRecentProjectsForEmployee(
  employeeId: string,
  limit = 5
): Promise<ProjectOption[]> {
  const db = getDb();
  const used = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      kind: projects.kind,
      lastUsedAt: aiProjectUsage.lastUsedAt,
    })
    .from(aiProjectUsage)
    .innerJoin(projects, eq(projects.id, aiProjectUsage.projectId))
    .where(and(eq(aiProjectUsage.employeeId, employeeId), projectUsableBy(employeeId)))
    .orderBy(desc(aiProjectUsage.lastUsedAt))
    .limit(limit);

  const out: ProjectOption[] = used.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    source: 'recent_used' as const,
    lastUsedAt: r.lastUsedAt?.toISOString?.() ?? String(r.lastUsedAt),
  }));

  if (out.length >= limit) return out;

  const exclude = new Set(out.map((p) => p.id));
  // Derive additional "recent" from the user's own submissions' project_id when usage is thin.
  const fromSubs = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      kind: projects.kind,
      updatedAt: formSubmissions.createdAt,
    })
    .from(formSubmissions)
    .innerJoin(projects, eq(projects.id, formSubmissions.projectId))
    .where(
      and(
        or(
          eq(formSubmissions.applicantEmployeeId, employeeId),
          eq(formSubmissions.filedByEmployeeId, employeeId)
        ),
        sql`${formSubmissions.projectId} is not null`,
        projectUsableBy(employeeId)
      )
    )
    .orderBy(desc(formSubmissions.createdAt))
    .limit(limit * 3);

  for (const r of fromSubs) {
    if (exclude.has(r.id)) continue;
    out.push({
      id: r.id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      source: 'recent_used',
      lastUsedAt: r.updatedAt?.toISOString?.() ?? undefined,
    });
    exclude.add(r.id);
    if (out.length >= limit) return out;
  }

  // Fill with recently created master-data projects (no updated_at on projects; not code order).
  const recentUpdated = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      kind: projects.kind,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(projectUsableBy(employeeId))
    .orderBy(desc(projects.createdAt))
    .limit(limit * 2);

  for (const r of recentUpdated) {
    if (exclude.has(r.id)) continue;
    out.push({
      id: r.id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      source: 'recently_updated',
      updatedAt: r.createdAt?.toISOString?.() ?? undefined,
    });
    if (out.length >= limit) break;
  }

  return out;
}

export async function searchProjectsPaged(input: {
  query: string;
  /** Only projects this employee may use are returned. */
  employeeId: string;
  limit?: number;
  offset?: number;
}): Promise<{ projects: Array<{ id: string; code: string; name: string; kind: string | null }>; hasMore: boolean }> {
  const q = input.query.trim().slice(0, 80);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 25);
  const offset = Math.min(Math.max(input.offset ?? 0, 0), 500);
  if (q.length < 1) return { projects: [], hasMore: false };

  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  const db = getDb();
  const rows = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, kind: projects.kind })
    .from(projects)
    .where(and(or(ilike(projects.code, pattern), ilike(projects.name, pattern)), projectUsableBy(input.employeeId)))
    .orderBy(projects.code)
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return { projects: rows.slice(0, limit), hasMore };
}

export async function recordProjectUsage(employeeId: string, projectId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(employeeId) || !/^[0-9a-f-]{36}$/i.test(projectId)) return;
  const db = getDb();
  await db
    .insert(aiProjectUsage)
    .values({ employeeId, projectId, lastUsedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [aiProjectUsage.employeeId, aiProjectUsage.projectId],
      set: { lastUsedAt: sql`now()` },
    });
}
