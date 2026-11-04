import { and, eq, ne, sql } from 'drizzle-orm';
import type { ApplicationDraft } from '@/lib/ai-chat/drafts';
import { classifyCompanionMatch } from '@/lib/ai-chat/companion-match';
import { actorHas } from '@/lib/authz/access';
import { getDb } from '@/lib/db';
import { employees, formDefinitions, formSubmissions } from '@/lib/db/schema';

export type CompanionCandidate = {
  employeeId: string;
  employeeCode: string;
  name: string;
  tripStart: string;
  tripEnd: string;
  location: string;
  projectLabel: string | null;
  formNumber: string | null;
  approvalStatus: string;
  matchKind: 'full_overlap' | 'partial_overlap' | 'near' | 'same_dates_diff_project';
  reason: string;
  diff: string;
};

function asDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseDraftTrip(data: Record<string, unknown>): {
  start: string | null;
  end: string | null;
  location: string | null;
  project: string | null;
} {
  const start =
    asDate(data.tripStartDate) ||
    (typeof data.tripStartAt === 'string' ? asDate(data.tripStartAt) : null);
  const end =
    asDate(data.tripEndDate) ||
    (typeof data.tripEndAt === 'string' ? asDate(data.tripEndAt) : null);
  const location =
    typeof data.location === 'string'
      ? data.location.trim()
      : Array.isArray(data.reportItems)
        ? String((data.reportItems as Array<{ location?: string }>)[0]?.location ?? '').trim() || null
        : null;
  const project =
    typeof data.projectName === 'string'
      ? data.projectName
      : typeof data.purpose === 'string'
        ? data.purpose
        : null;
  return { start, end, location: location || null, project };
}

/**
 * Controlled companion candidate search — same department by default.
 * Actors with org.directory may see company-wide approved/pending business-trip headers.
 * Never returns full submission payloads; only authorised summary fields.
 */
export async function searchTripCompanionCandidates(input: {
  actorEmployeeId: string;
  draft: ApplicationDraft;
  query?: string;
  nearDays?: number;
}): Promise<{
  nearDays: number;
  target: { start: string | null; end: string | null; location: string | null };
  candidates: CompanionCandidate[];
  scopeNote: string;
}> {
  const nearDays = input.nearDays ?? 3;
  const target = parseDraftTrip(input.draft.data);
  const db = getDb();

  const [actor] = await db
    .select({ id: employees.id, departmentId: employees.departmentId, role: employees.role })
    .from(employees)
    .where(eq(employees.id, input.actorEmployeeId))
    .limit(1);
  if (!actor) {
    return { nearDays, target, candidates: [], scopeNote: '未登入' };
  }

  const wide = actor.role === 'admin' || (await actorHas({ id: actor.id, role: actor.role }, 'org.directory'));

  const [def] = await db
    .select({ id: formDefinitions.id })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, 'business-trip'))
    .limit(1);

  if (!def || !target.start || !target.end) {
    return {
      nearDays,
      target,
      candidates: [],
      scopeNote: !target.start || !target.end ? '目標草稿缺少出差起訖日期，無法搜尋同行候選。' : '系統尚無公出差旅表單定義。',
    };
  }

  const rows = await db
    .select({
      submissionId: formSubmissions.id,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      data: formSubmissions.data,
      applicantId: employees.id,
      applicantCode: employees.employeeCode,
      applicantName: employees.name,
      departmentId: employees.departmentId,
    })
    .from(formSubmissions)
    .innerJoin(employees, eq(employees.id, formSubmissions.applicantEmployeeId))
    .where(
      and(
        eq(formSubmissions.definitionId, def.id),
        ne(formSubmissions.applicantEmployeeId, input.actorEmployeeId),
        sql`${formSubmissions.status} in ('pending_approval', 'approved')`,
        wide ? sql`true` : eq(employees.departmentId, actor.departmentId)
      )
    )
    .limit(200);

  const q = input.query?.trim().toLowerCase() ?? '';
  const candidates: CompanionCandidate[] = [];

  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const start =
      asDate(data.tripStartAt) ||
      asDate(data.tripStartDate) ||
      asDate(typeof data.tripStartAt === 'string' ? data.tripStartAt.slice(0, 10) : null);
    const end =
      asDate(data.tripEndAt) ||
      asDate(data.tripEndDate) ||
      asDate(typeof data.tripEndAt === 'string' ? data.tripEndAt.slice(0, 10) : null);
    if (!start || !end) continue;

    const location = typeof data.location === 'string' ? data.location.trim() : '';
    const purpose = typeof data.purpose === 'string' ? data.purpose : '';
    if (q) {
      const hay = `${row.applicantName} ${row.applicantCode} ${location} ${purpose} ${row.formNumber}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const matched = classifyCompanionMatch({
      targetStart: target.start,
      targetEnd: target.end,
      targetLocation: target.location,
      candStart: start,
      candEnd: end,
      candLocation: location,
      nearDays,
    });
    if (matched.kind === 'skip') continue;

    candidates.push({
      employeeId: row.applicantId,
      employeeCode: row.applicantCode,
      name: row.applicantName,
      tripStart: start,
      tripEnd: end,
      location: location || '（未填地點）',
      projectLabel: purpose || null,
      formNumber: row.formNumber,
      approvalStatus: row.status === 'approved' ? 'approved' : 'pending_approval',
      matchKind: matched.kind,
      reason: matched.reason,
      diff: matched.diff,
    });
  }

  const rank = { full_overlap: 0, partial_overlap: 1, near: 2, same_dates_diff_project: 3 };
  candidates.sort((a, b) => rank[a.matchKind] - rank[b.matchKind] || a.name.localeCompare(b.name, 'zh-Hant'));

  return {
    nearDays,
    target,
    candidates: candidates.slice(0, 40),
    scopeNote: wide
      ? `搜尋範圍：全公司公出差旅（±${nearDays} 天；僅摘要欄位）。`
      : `搜尋範圍：同部門公出差旅（±${nearDays} 天；僅摘要欄位）。無權查看的人員不會出現。`,
  };
}
