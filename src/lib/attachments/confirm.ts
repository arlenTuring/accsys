import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { canAttachToForm, isFormType, isUuid, type Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { attachmentAnalyses, attachmentConfirmations, attachments } from '@/lib/db/schema';
import { isServable } from '@/lib/attachments/service';

export type ConfirmAttachInput = {
  actor: Actor;
  attachmentId: string;
  draftId?: string | null;
  formType?: string | null;
  formId?: string | null;
  analysisId?: string | null;
  reminderCode:
    | 'tax_id_mismatch'
    | 'tax_id_missing'
    | 'unclear'
    | 'analysis_failed'
    | 'not_invoice'
    | 'company_unset'
    | 'other';
  reminderSummary: string;
  userNote?: string | null;
  corrections?: Record<string, unknown> | null;
  expectedContentSha256: string;
  companyProfileVersion?: number | null;
};

/**
 * Business confirmation to keep an attachment despite invoice reminders.
 * Does not bypass scan isolation — infected/pending files cannot be confirmed.
 */
export async function confirmAttachDespiteReminder(
  input: ConfirmAttachInput
): Promise<{ ok: true; confirmationId: string } | { ok: false; error: string }> {
  if (!isUuid(input.attachmentId)) return { ok: false, error: '附件無效' };
  const db = getDb();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, input.attachmentId)).limit(1);
  if (!row) return { ok: false, error: '找不到附件' };
  if (!isServable(row.scanStatus)) {
    return { ok: false, error: '安全檢查未通過，不能以業務確認繞過隔離' };
  }
  if (!row.sha256 || row.sha256 !== input.expectedContentSha256) {
    return { ok: false, error: '附件內容已變更，請重新檢查後再確認' };
  }

  if (input.formType && input.formId) {
    if (!isFormType(input.formType) || !isUuid(input.formId)) return { ok: false, error: '表單無效' };
    if (!(await canAttachToForm(input.actor, input.formType, input.formId))) {
      return { ok: false, error: '無權限確認此表單附件' };
    }
    if (row.formType !== input.formType || row.formId !== input.formId) {
      return { ok: false, error: '附件與目標表單不符' };
    }
  }

  if (input.analysisId) {
    const [analysis] = await db
      .select()
      .from(attachmentAnalyses)
      .where(and(eq(attachmentAnalyses.id, input.analysisId), eq(attachmentAnalyses.attachmentId, row.id)))
      .limit(1);
    if (!analysis) return { ok: false, error: '分析紀錄無效' };
  }

  const id = randomUUID();
  await db.insert(attachmentConfirmations).values({
    id,
    attachmentId: row.id,
    draftId: input.draftId ?? null,
    formType: input.formType ?? row.formType,
    formId: input.formId ?? row.formId,
    analysisId: input.analysisId ?? null,
    contentSha256: input.expectedContentSha256,
    companyProfileVersion: input.companyProfileVersion ?? null,
    reminderCode: input.reminderCode,
    reminderSummary: input.reminderSummary.slice(0, 500),
    userNote: input.userNote?.slice(0, 500) ?? null,
    corrections: input.corrections ?? null,
    confirmedByEmployeeId: input.actor.id,
  });
  await recordAudit(db, {
    actorEmployeeId: input.actor.id,
    action: 'attachment.confirm_despite_reminder',
    entityType: row.formType,
    entityId: row.formId,
    details: {
      attachmentId: row.id,
      confirmationId: id,
      reminderCode: input.reminderCode,
      analysisId: input.analysisId ?? null,
      corrections: input.corrections ?? null,
    },
  });
  return { ok: true, confirmationId: id };
}
