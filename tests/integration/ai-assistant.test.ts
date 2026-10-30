import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { taipeiToday } from '@/lib/taipei-date';
import { resolveAdminDatabaseUrl } from './test-database-url';

/**
 * AI assistant daily-nudge uniqueness against the disposable test DB.
 * Requires migrations through 0026_ai_assistant (applied by the test suite setup).
 */

const adminUrl = (() => {
  try {
    return resolveAdminDatabaseUrl();
  } catch {
    return null;
  }
})();

describe.skipIf(!adminUrl)('ai assistant nudge uniqueness', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(adminUrl!, { max: 1 });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('allows only one nudge row per formType+formId+Taipei businessDate', async () => {
    const tables = await sql`
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = 'ai_nudge_events' limit 1`;
    if (tables.length === 0) {
      // Migration not applied on this scratch DB yet.
      return;
    }

    const [emp] = await sql`
      select id from employees where access_enabled = true limit 1`;
    if (!emp) return;

    const formId = randomUUID();
    const day = taipeiToday();
    const actorId = emp.id as string;
    const formType = 'custom';

    await sql`
      insert into ai_nudge_events (form_type, form_id, business_date, actor_employee_id, recipients, status)
      values (${formType}, ${formId}, ${day}::date, ${actorId}, '[]'::jsonb, 'notified')`;

    await expect(
      sql`
        insert into ai_nudge_events (form_type, form_id, business_date, actor_employee_id, recipients, status)
        values (${formType}, ${formId}, ${day}::date, ${actorId}, '[]'::jsonb, 'queued')`
    ).rejects.toThrow(/unique|duplicate/i);

    await sql`delete from ai_nudge_events where form_id = ${formId}`;
  });
});
