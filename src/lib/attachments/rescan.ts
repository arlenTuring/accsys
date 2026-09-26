import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { scanBytes, scannerConfig } from '@/lib/attachments/scan';
import { settleScan } from '@/lib/attachments/service';
import { quarantineKey, readIfExists, removeKey } from '@/lib/attachments/storage';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';

export type RescanSummary = { scanned: number; clean: number; infected: number; failed: number; missing: number };

/**
 * Re-scans attachments that are not cleared: quarantined uploads ('pending'
 * older than a minute, 'scan_failed') and files stored before scanning existed
 * ('unscanned'). Requires a real scanner. Safe to run repeatedly (systemd timer).
 */
export async function rescanAttachments(limit = 200): Promise<RescanSummary> {
  const scanner = scannerConfig();
  if (scanner.mode !== 'clamav') throw new Error('rescan needs ATTACHMENT_SCAN=clamav');

  const rows = await getDb()
    .select({ id: attachments.id, key: attachments.storagePath, status: attachments.scanStatus })
    .from(attachments)
    .where(
      and(
        inArray(attachments.scanStatus, ['pending', 'scan_failed', 'unscanned']),
        lt(attachments.createdAt, sql`now() - interval '1 minute'`)
      )
    )
    .limit(limit);

  const summary: RescanSummary = { scanned: 0, clean: 0, infected: 0, failed: 0, missing: 0 };
  for (const row of rows) {
    const inQuarantine = row.status !== 'unscanned';
    const bytes = await readIfExists(inQuarantine ? quarantineKey(row.id) : row.key);
    if (!bytes) {
      summary.missing += 1;
      await getDb().update(attachments).set({ scanStatus: 'scan_failed' }).where(eq(attachments.id, row.id));
      continue;
    }
    summary.scanned += 1;
    const verdict = await scanBytes(bytes, scanner);
    if (verdict === 'unscanned') continue;
    if (inQuarantine) {
      await settleScan(row.id, row.key, verdict);
    } else {
      // Legacy file already at its final key: mark it, or remove it if infected.
      if (verdict === 'infected') await removeKey(row.key);
      await getDb()
        .update(attachments)
        .set({ scanStatus: verdict, scannedAt: sql`now()` })
        .where(eq(attachments.id, row.id));
    }
    if (verdict === 'clean') summary.clean += 1;
    else if (verdict === 'infected') summary.infected += 1;
    else summary.failed += 1;
  }
  return summary;
}
