import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

export type RateLimitRule = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  loginStartPerIp: { limit: 30, windowSeconds: 600 },
  loginCallbackPerIp: { limit: 30, windowSeconds: 600 },
  adminActionPerEmployee: { limit: 60, windowSeconds: 600 },
} satisfies Record<string, RateLimitRule>;

/**
 * Counts one hit for `key` in the current fixed window (stored in PostgreSQL so
 * every app process shares it) and reports whether the limit is exceeded.
 * Windows expire on their own; nothing is locked permanently.
 */
export async function hitRateLimit(key: string, rule: RateLimitRule): Promise<{ allowed: boolean; hits: number }> {
  const db = getDb();
  const rows = await db.execute<{ hits: number }>(sql`
    insert into rate_limit_buckets (bucket_key, window_start, hits)
    values (${key}, date_bin(make_interval(secs => ${rule.windowSeconds}), now(), timestamptz 'epoch'), 1)
    on conflict (bucket_key, window_start) do update set hits = rate_limit_buckets.hits + 1
    returning hits`);
  const hits = Number(rows[0]?.hits ?? 0);
  if (Math.random() < 0.01) {
    await db.execute(sql`delete from rate_limit_buckets where window_start < now() - interval '1 day'`);
  }
  return { allowed: hits <= rule.limit, hits };
}
