import { describe, expect, it } from 'vitest';
import { formatWaitingDuration } from './approval-snapshot';

describe('formatWaitingDuration', () => {
  it('formats hours, days, and date (>3 days) from waitingSince', () => {
    const now = new Date('2024-06-05T12:00:00.000Z');
    expect(formatWaitingDuration(new Date(now.getTime() - 30 * 60_000).toISOString(), now)).toBe('30 分鐘前');
    expect(formatWaitingDuration(new Date(now.getTime() - 5 * 3_600_000).toISOString(), now)).toBe('5 小時前');
    expect(formatWaitingDuration(new Date(now.getTime() - 72 * 3_600_000).toISOString(), now)).toBe('3 天前');
    expect(formatWaitingDuration(new Date(now.getTime() - 96 * 3_600_000).toISOString(), now)).toBe('6月1日');
  });
});
