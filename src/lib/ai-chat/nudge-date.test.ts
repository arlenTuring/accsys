import { describe, expect, it } from 'vitest';
import { taipeiToday } from '@/lib/taipei-date';

describe('Taipei business date for nudge', () => {
  it('uses Asia/Taipei calendar day', () => {
    // 2024-01-01 16:30 UTC = 2024-01-02 00:30 Taipei
    const justAfterMidnightTaipei = new Date('2024-01-01T16:30:00.000Z');
    expect(taipeiToday(justAfterMidnightTaipei)).toBe('2024-01-02');

    // 2024-01-01 15:30 UTC = 2024-01-01 23:30 Taipei
    const beforeMidnightTaipei = new Date('2024-01-01T15:30:00.000Z');
    expect(taipeiToday(beforeMidnightTaipei)).toBe('2024-01-01');
  });
});
