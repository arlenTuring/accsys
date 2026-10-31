/**
 * Scheduled cleanup of chat staging files (default: older than 7 days). Files
 * already added to a draft were copied there and are not touched.
 *
 *   npx tsx scripts/purge-staged-attachments.ts [days]
 */
import { purgeExpiredStaged } from '../src/lib/ai-chat/staged-images';
import { getSql } from '../src/lib/db';

purgeExpiredStaged(Math.max(1, Number(process.argv[2]) || 7))
  .then((n) => console.log(`purged ${n} staged file(s)`))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
