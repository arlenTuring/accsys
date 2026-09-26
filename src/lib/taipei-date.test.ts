import { describe, expect, it } from 'vitest';
import { taipeiToday } from './taipei-date';

describe('taipeiToday', () => {
  it('uses the Taipei calendar across the UTC day boundary', () => {
    expect(taipeiToday(new Date('2026-07-31T15:59:59Z'))).toBe('2026-07-31');
    expect(taipeiToday(new Date('2026-07-31T16:00:00Z'))).toBe('2026-08-01');
    expect(taipeiToday(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });
});
