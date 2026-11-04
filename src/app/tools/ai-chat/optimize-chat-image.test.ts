import { describe, expect, it } from 'vitest';
import { formatSizeCompare } from './optimize-chat-image';

describe('formatSizeCompare (案例 2 大小對照)', () => {
  it('shows original → working with percent when smaller', () => {
    const note = formatSizeCompare(10_000_000, 2_500_000);
    expect(note).toContain('原始');
    expect(note).toContain('使用版本');
    expect(note).toContain('減少 75%');
  });

  it('keeps wording when no size win', () => {
    const note = formatSizeCompare(1000, 1000);
    expect(note).toContain('保留原大小');
  });
});
