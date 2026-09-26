/**
 * Re-scan attachments that are not yet cleared (see src/lib/attachments/rescan.ts).
 *   DATABASE_URL=... STORAGE_LOCAL_PATH=... ATTACHMENT_SCAN=clamav CLAMAV_HOST=... npx tsx scripts/attachments-rescan.ts
 */
import { rescanAttachments } from '../src/lib/attachments/rescan';
import { getSql } from '../src/lib/db';

rescanAttachments()
  .then((summary) => console.log(JSON.stringify(summary)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
