import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { formDefinitions, formSubmissions } from '@/lib/db/schema';

export type MySubmissionHit = {
  formType: string;
  formId: string;
  formKey: string;
  formName: string;
  formNumber: string;
  status: string;
  summary: string;
  approvedAt: string | null;
  version: number;
  href?: string;
  totalAmount?: number | null;
  currentNodeLabel?: string | null;
  pendingApproverNames?: string[];
  returnReason?: string | null;
  returnedByName?: string | null;
};

/** Owner-scoped custom submissions for assistant tools / pickers. */
export async function searchMyCustomSubmissions(input: {
  ownerEmployeeId: string;
  formKey?: string;
  status?: string;
  query?: string;
  approvedOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: MySubmissionHit[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30);
  const offset = Math.max(input.offset ?? 0, 0);
  const db = getDb();
  const clauses = [eq(formSubmissions.applicantEmployeeId, input.ownerEmployeeId)];
  if (input.formKey) clauses.push(eq(formDefinitions.key, input.formKey));
  if (input.approvedOnly) clauses.push(eq(formSubmissions.status, 'approved'));
  else if (input.status) clauses.push(eq(formSubmissions.status, input.status));
  if (input.query?.trim()) {
    const q = `%${input.query.trim().slice(0, 80)}%`;
    clauses.push(
      or(
        ilike(formSubmissions.formNumber, q),
        ilike(formDefinitions.name, q),
        sql`(${formSubmissions.data}::text ilike ${q})`
      )!
    );
  }

  const rows = await db
    .select({
      id: formSubmissions.id,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      version: formSubmissions.version,
      data: formSubmissions.data,
      submittedAt: formSubmissions.submittedAt,
      updatedAt: formSubmissions.updatedAt,
      key: formDefinitions.key,
      name: formDefinitions.name,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .where(and(...clauses))
    .orderBy(desc(formSubmissions.updatedAt))
    .limit(limit + 1)
    .offset(offset);

  const page = rows.slice(0, limit);
  return {
    hasMore: rows.length > limit,
    items: page.map((r) => {
      const data = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
      const location = typeof data.location === 'string' ? data.location : '';
      const purpose = typeof data.purpose === 'string' ? data.purpose : '';
      const start = typeof data.tripStartAt === 'string' ? data.tripStartAt : '';
      const summary = [String(start ?? '').replace('T', ' '), location, purpose].filter(Boolean).join(' · ') || r.name;
      return {
        formType: 'custom' as const,
        formId: r.id,
        formKey: r.key,
        formName: r.name,
        formNumber: r.formNumber,
        status: r.status,
        summary: summary.slice(0, 240),
        approvedAt: r.status === 'approved' ? r.updatedAt.toISOString() : null,
        version: r.version,
      };
    }),
  };
}
