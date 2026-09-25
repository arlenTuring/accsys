import { describe, expect, it } from 'vitest';
import { getSql } from '@/lib/db';

// Was: compared against a Supabase-only taipei_now() helper that never existed
// in the plain-Postgres schema. The requirement is that the case-number month
// follows the Asia/Taipei calendar whatever the session TimeZone is.
describe('next_case_number Taiwan timezone', () => {
  it.each(['UTC', 'Asia/Taipei', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    'uses the Asia/Taipei year-month when the session time zone is %s',
    async (zone) => {
      const rows = await getSql().begin(async (tx) => {
        await tx.unsafe(`set local time zone '${zone}'`);
        return tx<{ expected: string; case_number: string }[]>`
          select 'CP' || lpad((extract(year from now() at time zone 'Asia/Taipei')::int - 1911)::text, 3, '0')
                      || to_char(now() at time zone 'Asia/Taipei', 'MM') as expected,
                 next_case_number() as case_number`;
      });
      expect(rows[0].case_number.slice(0, 7)).toBe(rows[0].expected);
      expect(rows[0].case_number).toMatch(/^CP\d{5}\d{4}$/);
    }
  );
});
