import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { notifyAiKnowledgeUpdated } from '@/lib/ai-chat/knowledge-sync';
import { recordAudit } from '@/lib/audit/record';
import { actorHas } from '@/lib/authz/access';
import { getDb } from '@/lib/db';
import { companyRegulations } from '@/lib/db/schema';
import {
  DEFAULT_COMPANY_REGULATIONS,
  getRegulationCategoryMeta,
  REGULATION_CATEGORIES,
  type RegulationCategoryKey,
} from '@/lib/regulations/seed-data';

export { REGULATION_CATEGORIES, getRegulationCategoryMeta, type RegulationCategoryKey };

export type RegulationActor = { id: string; role: string } | null;
export type RegulationStatus = 'draft' | 'published' | 'archived';

export type RegulationInput = {
  code: string;
  title: string;
  category?: string;
  versionLabel?: string;
  effectiveDate?: string;
  ownerDepartment?: string;
  approverTitle?: string;
  summary?: string;
  body: string;
  relatedForms?: string[];
  driveFileId?: string | null;
  driveUrl?: string | null;
  driveFileName?: string | null;
  status?: RegulationStatus;
  pinned?: boolean;
  sortOrder?: number;
};

let bootstrappedPromise: Promise<void> | null = null;

/**
 * Ensures the `company_regulations` and `company_regulation_attachments` tables exist
 * and seeds the initial Turing Drive regulations imported from Google Drive if empty.
 */
export async function ensureRegulationsReady(): Promise<void> {
  if (!bootstrappedPromise) {
    bootstrappedPromise = (async () => {
      const db = getDb();
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "company_regulations" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "code" text NOT NULL,
          "title" text NOT NULL,
          "category" text NOT NULL DEFAULT 'general',
          "version_label" text NOT NULL DEFAULT '1.0',
          "effective_date" text NOT NULL DEFAULT '',
          "owner_department" text NOT NULL DEFAULT '管理部',
          "approver_title" text NOT NULL DEFAULT '董事長',
          "summary" text NOT NULL DEFAULT '',
          "body" text NOT NULL,
          "related_forms" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "drive_file_id" text,
          "drive_url" text,
          "drive_file_name" text,
          "status" text NOT NULL DEFAULT 'published',
          "pinned" boolean NOT NULL DEFAULT false,
          "sort_order" integer NOT NULL DEFAULT 0,
          "revision_number" integer NOT NULL DEFAULT 1,
          "created_by_employee_id" uuid,
          "updated_by_employee_id" uuid,
          "published_at" timestamp with time zone DEFAULT now(),
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "company_regulations_status_cat_idx"
          ON "company_regulations" ("status", "category", "sort_order")
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "company_regulation_attachments" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "regulation_id" uuid NOT NULL REFERENCES "public"."company_regulations"("id") ON DELETE cascade,
          "uploaded_by_employee_id" uuid,
          "storage_path" text NOT NULL UNIQUE,
          "file_name" text NOT NULL,
          "mime_type" text NOT NULL,
          "file_size_bytes" bigint NOT NULL,
          "sha256" text,
          "scan_status" text NOT NULL DEFAULT 'clean',
          "scanned_at" timestamp with time zone,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "company_regulation_attachments_reg_idx"
          ON "company_regulation_attachments" ("regulation_id", "created_at")
      `);

      const existing = await db
        .select({ id: companyRegulations.id })
        .from(companyRegulations)
        .limit(1);

      if (existing.length === 0) {
        await seedDefaultRegulationsInternal();
      }
    })().catch((err) => {
      bootstrappedPromise = null;
      throw err;
    });
  }
  await bootstrappedPromise;
}

async function seedDefaultRegulationsInternal(): Promise<number> {
  const db = getDb();
  let inserted = 0;
  for (const item of DEFAULT_COMPANY_REGULATIONS) {
    const existing = await db
      .select({ id: companyRegulations.id })
      .from(companyRegulations)
      .where(eq(companyRegulations.code, item.code))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(companyRegulations).values({
      code: item.code,
      title: item.title,
      category: item.category,
      versionLabel: item.versionLabel,
      effectiveDate: item.effectiveDate,
      ownerDepartment: item.ownerDepartment,
      approverTitle: item.approverTitle,
      summary: item.summary,
      body: item.body,
      relatedForms: item.relatedForms,
      driveFileId: item.driveFileId,
      driveUrl: item.driveUrl,
      driveFileName: item.driveFileName,
      status: 'published',
      pinned: item.pinned,
      sortOrder: item.sortOrder,
      revisionNumber: 1,
      publishedAt: new Date(),
    });
    inserted += 1;
  }
  if (inserted > 0) {
    notifyAiKnowledgeUpdated('regulations', 'seed_google_drive_regulations');
  }
  return inserted;
}

export async function canManageRegulations(actor: RegulationActor): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (await actorHas(actor, 'company.regulations')) return true;
  return actorHas(actor, 'company.announcements');
}

export function sanitizeRegulationText(raw: string, max: number): string {
  return (raw ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, max)
    .trim();
}

export async function listRegulations(input?: {
  category?: string;
  query?: string;
  manage?: boolean;
}) {
  await ensureRegulationsReady();
  const db = getDb();
  const rows = await db
    .select()
    .from(companyRegulations)
    .where(input?.manage ? undefined : eq(companyRegulations.status, 'published'))
    .orderBy(
      desc(companyRegulations.pinned),
      asc(companyRegulations.sortOrder),
      asc(companyRegulations.code),
      desc(companyRegulations.updatedAt)
    )
    .limit(200);

  const cat = input?.category?.trim();
  const q = input?.query?.trim().toLowerCase();

  return rows.filter((r) => {
    if (cat && cat !== 'all' && r.category !== cat) return false;
    if (!q) return true;
    const haystack = [
      r.code,
      r.title,
      r.summary,
      r.ownerDepartment,
      r.body,
      ...(r.relatedForms ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every((token) => haystack.includes(token));
  });
}

export async function getRegulationById(input: { id: string; manage?: boolean }) {
  await ensureRegulationsReady();
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(companyRegulations)
    .where(eq(companyRegulations.id, input.id))
    .limit(1);
  if (!row) return null;
  if (!input.manage && row.status !== 'published') return null;
  return row;
}

export async function createRegulation(actor: RegulationActor, input: RegulationInput) {
  await ensureRegulationsReady();
  if (!(await canManageRegulations(actor)) || !actor) {
    return { ok: false as const, error: '沒有管理公司規章的權限' };
  }
  const title = sanitizeRegulationText(input.title, 200);
  const code = sanitizeRegulationText(input.code || 'TD-REG-NEW', 50);
  const body = sanitizeRegulationText(input.body, 200000);
  if (!title || !body) {
    return { ok: false as const, error: '請填寫規章名稱與完整條文內容' };
  }

  const status: RegulationStatus =
    input.status === 'draft' || input.status === 'archived' ? input.status : 'published';
  const relatedForms = (input.relatedForms ?? [])
    .map((s) => sanitizeRegulationText(s, 80))
    .filter(Boolean);

  const db = getDb();
  const [inserted] = await db
    .insert(companyRegulations)
    .values({
      code,
      title,
      category: sanitizeRegulationText(input.category || 'hr_attendance', 60),
      versionLabel: sanitizeRegulationText(input.versionLabel || '1.0', 30),
      effectiveDate: sanitizeRegulationText(input.effectiveDate || '', 40),
      ownerDepartment: sanitizeRegulationText(input.ownerDepartment || '管理部', 80),
      approverTitle: sanitizeRegulationText(input.approverTitle || '董事長', 60),
      summary: sanitizeRegulationText(input.summary || body.slice(0, 180), 600),
      body,
      relatedForms,
      driveFileId: input.driveFileId ? sanitizeRegulationText(input.driveFileId, 120) : null,
      driveUrl: input.driveUrl ? sanitizeRegulationText(input.driveUrl, 500) : null,
      driveFileName: input.driveFileName ? sanitizeRegulationText(input.driveFileName, 200) : null,
      status,
      pinned: Boolean(input.pinned),
      sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 50,
      revisionNumber: 1,
      createdByEmployeeId: actor.id,
      updatedByEmployeeId: actor.id,
      publishedAt: status === 'published' ? new Date() : null,
    })
    .returning();

  await recordAudit({
    actorEmployeeId: actor.id,
    action: 'company_regulation.create',
    targetType: 'company_regulation',
    targetId: inserted.id,
    after: { code: inserted.code, title: inserted.title, status: inserted.status },
  });

  notifyAiKnowledgeUpdated('regulations', `create:${inserted.code}`);
  return { ok: true as const, regulation: inserted };
}

export async function updateRegulation(
  actor: RegulationActor,
  id: string,
  input: RegulationInput
) {
  await ensureRegulationsReady();
  if (!(await canManageRegulations(actor)) || !actor) {
    return { ok: false as const, error: '沒有管理公司規章的權限' };
  }
  const existing = await getRegulationById({ id, manage: true });
  if (!existing) {
    return { ok: false as const, error: '找不到該筆規章' };
  }

  const title = sanitizeRegulationText(input.title, 200);
  const code = sanitizeRegulationText(input.code || existing.code, 50);
  const body = sanitizeRegulationText(input.body, 200000);
  if (!title || !body) {
    return { ok: false as const, error: '請填寫規章名稱與完整條文內容' };
  }

  const status: RegulationStatus =
    input.status === 'draft' || input.status === 'archived' || input.status === 'published'
      ? input.status
      : (existing.status as RegulationStatus);
  const relatedForms = (input.relatedForms ?? existing.relatedForms ?? [])
    .map((s) => sanitizeRegulationText(s, 80))
    .filter(Boolean);

  const db = getDb();
  const [updated] = await db
    .update(companyRegulations)
    .set({
      code,
      title,
      category: sanitizeRegulationText(input.category || existing.category, 60),
      versionLabel: sanitizeRegulationText(input.versionLabel || existing.versionLabel, 30),
      effectiveDate: sanitizeRegulationText(input.effectiveDate ?? existing.effectiveDate, 40),
      ownerDepartment: sanitizeRegulationText(
        input.ownerDepartment || existing.ownerDepartment,
        80
      ),
      approverTitle: sanitizeRegulationText(input.approverTitle || existing.approverTitle, 60),
      summary: sanitizeRegulationText(input.summary ?? existing.summary, 600),
      body,
      relatedForms,
      driveFileId:
        input.driveFileId !== undefined
          ? input.driveFileId
            ? sanitizeRegulationText(input.driveFileId, 120)
            : null
          : existing.driveFileId,
      driveUrl:
        input.driveUrl !== undefined
          ? input.driveUrl
            ? sanitizeRegulationText(input.driveUrl, 500)
            : null
          : existing.driveUrl,
      driveFileName:
        input.driveFileName !== undefined
          ? input.driveFileName
            ? sanitizeRegulationText(input.driveFileName, 200)
            : null
          : existing.driveFileName,
      status,
      pinned: input.pinned !== undefined ? Boolean(input.pinned) : existing.pinned,
      sortOrder:
        input.sortOrder !== undefined && Number.isFinite(input.sortOrder)
          ? Number(input.sortOrder)
          : existing.sortOrder,
      revisionNumber: existing.revisionNumber + 1,
      updatedByEmployeeId: actor.id,
      publishedAt:
        status === 'published' && !existing.publishedAt ? new Date() : existing.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(companyRegulations.id, id))
    .returning();

  await recordAudit({
    actorEmployeeId: actor.id,
    action: 'company_regulation.update',
    targetType: 'company_regulation',
    targetId: id,
    before: { code: existing.code, title: existing.title, status: existing.status },
    after: { code: updated.code, title: updated.title, status: updated.status },
  });

  notifyAiKnowledgeUpdated('regulations', `update:${updated.code}`);
  return { ok: true as const, regulation: updated };
}

export async function deleteRegulation(actor: RegulationActor, id: string) {
  await ensureRegulationsReady();
  if (!(await canManageRegulations(actor)) || !actor) {
    return { ok: false as const, error: '沒有管理公司規章的權限' };
  }
  const existing = await getRegulationById({ id, manage: true });
  if (!existing) return { ok: false as const, error: '找不到該筆規章' };

  const db = getDb();
  await db.delete(companyRegulations).where(eq(companyRegulations.id, id));

  await recordAudit({
    actorEmployeeId: actor.id,
    action: 'company_regulation.delete',
    targetType: 'company_regulation',
    targetId: id,
    before: { code: existing.code, title: existing.title },
  });

  notifyAiKnowledgeUpdated('regulations', `delete:${existing.code}`);
  return { ok: true as const };
}

export async function syncDefaultRegulationsActionHelper(actor: RegulationActor) {
  await ensureRegulationsReady();
  if (!(await canManageRegulations(actor)) || !actor) {
    return { ok: false as const, error: '沒有管理公司規章的權限' };
  }
  const inserted = await seedDefaultRegulationsInternal();
  notifyAiKnowledgeUpdated('regulations', 'manual_sync_google_drive');
  return { ok: true as const, inserted, totalDefaults: DEFAULT_COMPANY_REGULATIONS.length };
}

/**
 * Paragraph-level semantic/keyword retrieval for the AI assistant.
 * Extracts only the matching clauses/paragraphs so the AI gets exact policy numbers
 * and rules without bloating the context window.
 */
export async function searchRegulationsForAi(input: {
  query?: string;
  category?: string;
  limit?: number;
}) {
  await ensureRegulationsReady();
  const rows = await listRegulations({
    category: input.category,
    manage: false,
  });

  const rawQuery = (input.query ?? '').trim();
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);

  if (!rawQuery) {
    return rows.slice(0, limit).map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      category: r.category,
      categoryLabel: getRegulationCategoryMeta(r.category).label,
      versionLabel: r.versionLabel,
      effectiveDate: r.effectiveDate,
      summary: r.summary,
      relatedForms: r.relatedForms,
      matchedExcerpts: [r.body.slice(0, 600)],
      href: `/regulations/${r.id}`,
      driveUrl: r.driveUrl,
    }));
  }

  // Split query into keywords + 2-char CJK bigrams for fuzzy Chinese matching
  const tokens = new Set<string>();
  for (const part of rawQuery
    .toLowerCase()
    .split(/[\s,，、。？?！!／/（）()]+/)
    .filter(Boolean)) {
    tokens.add(part);
    if (part.length >= 2 && /[\u4e00-\u9fff]/.test(part)) {
      for (let i = 0; i <= part.length - 2; i++) {
        tokens.add(part.slice(i, i + 2));
      }
    }
  }

  const scored = rows.map((r) => {
    const titleLower = r.title.toLowerCase();
    const summaryLower = r.summary.toLowerCase();
    const bodyLower = r.body.toLowerCase();
    const formsLower = (r.relatedForms ?? []).join(' ').toLowerCase();

    let score = 0;
    for (const tk of tokens) {
      const weight = tk.length >= 3 ? 3 : 1;
      if (titleLower.includes(tk)) score += 8 * weight;
      if (formsLower.includes(tk)) score += 6 * weight;
      if (summaryLower.includes(tk)) score += 4 * weight;
      if (bodyLower.includes(tk)) score += 2 * weight;
    }

    // Extract top matching paragraphs from body
    const paragraphs = r.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const paraScored = paragraphs
      .map((p) => {
        const pLower = p.toLowerCase();
        let pScore = 0;
        for (const tk of tokens) {
          if (pLower.includes(tk)) pScore += tk.length >= 3 ? 3 : 1;
        }
        return { p, pScore };
      })
      .sort((a, b) => b.pScore - a.pScore);

    const bestParas = paraScored
      .filter((x) => x.pScore > 0)
      .slice(0, 3)
      .map((x) => x.p);

    return {
      row: r,
      score,
      excerpts: bestParas.length > 0 ? bestParas : [r.body.slice(0, 600)],
    };
  });

  const filtered = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const finalItems = filtered.length > 0 ? filtered : scored.slice(0, Math.min(3, limit));

  return finalItems.map(({ row: r, excerpts }) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    category: r.category,
    categoryLabel: getRegulationCategoryMeta(r.category).label,
    versionLabel: r.versionLabel,
    effectiveDate: r.effectiveDate,
    ownerDepartment: r.ownerDepartment,
    summary: r.summary,
    relatedForms: r.relatedForms,
    matchedExcerpts: excerpts,
    href: `/regulations/${r.id}`,
    driveUrl: r.driveUrl,
  }));
}
