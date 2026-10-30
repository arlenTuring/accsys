import { desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { attachmentAnalyses, attachmentConfirmations, attachments } from '@/lib/db/schema';
import { invoiceStatusNeedsConfirm } from '@/lib/attachments/invoice-reminder';

export type AttachmentPanelExtra = {
  analysisSummary?: string | null;
  confirmationNote?: string | null;
  analysisId?: string | null;
  overallStatus?: string | null;
  contentSha256?: string | null;
  companyProfileVersion?: number | null;
  /** Show「仍要夾帶」when analysis needs business confirm and none recorded yet. */
  needsConfirm?: boolean;
  confirmedAt?: string | null;
};

export async function loadAttachmentPanelExtras(
  attachmentIds: string[]
): Promise<Record<string, AttachmentPanelExtra>> {
  if (attachmentIds.length === 0) return {};
  const db = getDb();
  const rows = await db
    .select({ id: attachments.id, sha256: attachments.sha256 })
    .from(attachments)
    .where(inArray(attachments.id, attachmentIds));

  const analyses = await db
    .select()
    .from(attachmentAnalyses)
    .where(inArray(attachmentAnalyses.attachmentId, attachmentIds))
    .orderBy(desc(attachmentAnalyses.createdAt));

  const confirms = await db
    .select()
    .from(attachmentConfirmations)
    .where(inArray(attachmentConfirmations.attachmentId, attachmentIds))
    .orderBy(desc(attachmentConfirmations.confirmedAt));

  const out: Record<string, AttachmentPanelExtra> = {};
  for (const id of attachmentIds) {
    const row = rows.find((x) => x.id === id);
    const a = analyses.find((x) => x.attachmentId === id);
    const c = confirms.find((x) => x.attachmentId === id);
    const result = (a?.result ?? {}) as {
      summary?: string;
      overallStatus?: string;
      companyProfileVersion?: number;
    };
    const overallStatus =
      a?.status === 'failed' ? 'analysis_failed' : result.overallStatus ?? a?.status ?? null;
    const needsConfirm = Boolean(
      overallStatus && invoiceStatusNeedsConfirm(overallStatus) && !c
    );
    out[id] = {
      analysisSummary: a
        ? a.status === 'failed'
          ? `分析失敗：${a.error ?? 'unknown'}`
          : result.summary ?? `狀態 ${a.status}`
        : null,
      confirmationNote: c
        ? `${c.reminderSummary}（確認於 ${c.confirmedAt.toISOString()}）${
            c.userNote ? `；說明：${c.userNote}` : ''
          }`
        : null,
      analysisId: a?.id ?? null,
      overallStatus,
      contentSha256: row?.sha256 ?? null,
      companyProfileVersion: result.companyProfileVersion ?? c?.companyProfileVersion ?? null,
      needsConfirm,
      confirmedAt: c?.confirmedAt?.toISOString() ?? null,
    };
  }
  return out;
}

export async function latestAnalysisFor(attachmentId: string) {
  const [row] = await getDb()
    .select()
    .from(attachmentAnalyses)
    .where(eq(attachmentAnalyses.attachmentId, attachmentId))
    .orderBy(desc(attachmentAnalyses.createdAt))
    .limit(1);
  return row ?? null;
}
