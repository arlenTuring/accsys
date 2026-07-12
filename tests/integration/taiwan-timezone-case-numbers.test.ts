import { describe, expect, it } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('next_case_number Taiwan timezone', () => {
  it('uses the Asia/Taipei calendar date, not the UTC date, for the year-month component', async () => {
    const supabase = createServiceRoleTestClient();
    const { data: taipeiNow, error } = await supabase.rpc('taipei_now');
    expect(error).toBeNull();
    const taipeiDate = new Date(taipeiNow as string);
    const expectedYearMonth =
      String(taipeiDate.getUTCFullYear() - 1911).padStart(3, '0') +
      String(taipeiDate.getUTCMonth() + 1).padStart(2, '0');

    const { data: caseNumber, error: caseNumError } = await supabase.rpc('next_case_number');
    expect(caseNumError).toBeNull();
    expect((caseNumber as string).slice(0, 7)).toBe('CP' + expectedYearMonth);
  });
});
