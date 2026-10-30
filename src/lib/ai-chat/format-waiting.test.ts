import { describe, expect, it } from 'vitest';
import { formatWaitingDuration } from './approval-snapshot';

describe('formatWaitingDuration', () => {
  it('formats hours and days from waitingSince', () => {
    const now = new Date('2024-06-01T12:00:00.000Z');
    expect(formatWaitingDuration(new Date(now.getTime() - 30 * 60_000).toISOString(), now)).toBe('未滿 1 小時');
    expect(formatWaitingDuration(new Date(now.getTime() - 5 * 3_600_000).toISOString(), now)).toBe('5 小時');
    expect(formatWaitingDuration(new Date(now.getTime() - 72 * 3_600_000).toISOString(), now)).toBe('3 天');
  });
});
