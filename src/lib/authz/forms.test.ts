import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getSql: vi.fn() }));

import { canReadForm, isUuid, maskAccount } from './forms';

describe('form authorization helpers', () => {
  it('rejects malformed ids and unknown form types without querying', async () => {
    const actor = { id: '20000000-0000-0000-0000-000000000001', role: 'admin' };
    expect(await canReadForm(actor, 'purchase_request', 'not-a-uuid')).toBe(false);
    expect(await canReadForm(actor, 'users; drop table x', '20000000-0000-0000-0000-000000000001')).toBe(false);
    expect(await canReadForm(null, 'purchase_request', '20000000-0000-0000-0000-000000000001')).toBe(false);
  });

  it('validates uuids strictly', () => {
    expect(isUuid('20000000-0000-0000-0000-000000000001')).toBe(true);
    expect(isUuid("20000000-0000-0000-0000-000000000001' or 1=1")).toBe(false);
  });

  it('masks account numbers to the last four characters', () => {
    expect(maskAccount('012-345 678 9012')).toBe('****9012');
    expect(maskAccount(null)).toBeNull();
  });
});
