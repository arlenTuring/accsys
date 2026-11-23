import { and, desc, eq } from 'drizzle-orm';
import { isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { formDrafts } from '@/lib/db/schema';

export type SavedFormDraft = {
  id: string;
  ownerEmployeeId: string;
  applicantEmployeeId: string | null;
  formType: string;
  formKey: string;
  formLabel: string;
  title: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

/** Extracts a concise summary title from arbitrary form values for display in draft lists. */
export function deriveDraftTitle(formLabel: string, data: Record<string, unknown>): string {
  const directKeys = [
    'purpose',
    'documentDescription',
    'counterpartyName',
    'buyerTitle',
    'reason',
    'title',
    'subject',
    'note',
  ];
  for (const k of directKeys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) {
      return v.trim().slice(0, 80);
    }
  }
  // Check table rows for first non-empty description / itemName / summary
  for (const val of Object.values(data)) {
    const rows =
      val && typeof val === 'object' && 'rows' in val && Array.isArray((val as { rows: unknown[] }).rows)
        ? (val as { rows: Record<string, unknown>[] }).rows
        : Array.isArray(val)
          ? (val as Record<string, unknown>[])
          : null;
    if (!rows || rows.length === 0) continue;
    const first = rows[0];
    if (!first || typeof first !== 'object') continue;
    for (const rk of ['description', 'itemName', 'summary', 'workContent', 'assetName', 'note']) {
      const rv = first[rk];
      if (typeof rv === 'string' && rv.trim()) {
        const suffix = rows.length > 1 ? ` 等 ${rows.length} 項` : '';
        return `${rv.trim().slice(0, 60)}${suffix}`;
      }
    }
  }
  return `${formLabel}（暫存草稿）`;
}

export async function saveFormDraftForOwner(input: {
  ownerEmployeeId: string;
  draftId?: string | null;
  applicantEmployeeId?: string | null;
  formType?: string;
  formKey: string;
  formLabel: string;
  title?: string;
  data: Record<string, unknown>;
}): Promise<{ ok: true; draft: SavedFormDraft } | { ok: false; error: string }> {
  const db = getDb();
  const cleanData =
    input.data && typeof input.data === 'object' && !Array.isArray(input.data)
      ? input.data
      : {};
  const computedTitle =
    (input.title?.trim() || deriveDraftTitle(input.formLabel, cleanData)).slice(0, 160);
  const applicantId =
    input.applicantEmployeeId && isUuid(input.applicantEmployeeId)
      ? input.applicantEmployeeId
      : input.ownerEmployeeId;

  if (input.draftId && isUuid(input.draftId)) {
    const [updated] = await db
      .update(formDrafts)
      .set({
        applicantEmployeeId: applicantId,
        formLabel: input.formLabel,
        title: computedTitle,
        data: cleanData,
      })
      .where(
        and(
          eq(formDrafts.id, input.draftId),
          eq(formDrafts.ownerEmployeeId, input.ownerEmployeeId)
        )
      )
      .returning();
    if (updated) {
      return { ok: true, draft: updated };
    }
  }

  const [inserted] = await db
    .insert(formDrafts)
    .values({
      ownerEmployeeId: input.ownerEmployeeId,
      applicantEmployeeId: applicantId,
      formType: input.formType || 'custom',
      formKey: input.formKey,
      formLabel: input.formLabel,
      title: computedTitle,
      data: cleanData,
    })
    .returning();

  return { ok: true, draft: inserted };
}

export async function getFormDraftForOwner(
  draftId: string,
  ownerEmployeeId: string
): Promise<SavedFormDraft | null> {
  if (!isUuid(draftId)) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(formDrafts)
    .where(and(eq(formDrafts.id, draftId), eq(formDrafts.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  return row ?? null;
}

export async function listFormDraftsForOwner(
  ownerEmployeeId: string,
  formKey?: string
): Promise<SavedFormDraft[]> {
  const db = getDb();
  const cond = formKey
    ? and(eq(formDrafts.ownerEmployeeId, ownerEmployeeId), eq(formDrafts.formKey, formKey))
    : eq(formDrafts.ownerEmployeeId, ownerEmployeeId);
  return db.select().from(formDrafts).where(cond).orderBy(desc(formDrafts.updatedAt)).limit(50);
}

export async function deleteFormDraftForOwner(
  draftId: string,
  ownerEmployeeId: string
): Promise<boolean> {
  if (!isUuid(draftId)) return false;
  const db = getDb();
  const deleted = await db
    .delete(formDrafts)
    .where(and(eq(formDrafts.id, draftId), eq(formDrafts.ownerEmployeeId, ownerEmployeeId)))
    .returning({ id: formDrafts.id });
  return deleted.length > 0;
}
