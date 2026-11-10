import { describe, expect, it } from 'vitest';
import { countVisibleChars, diffSentences } from './sentence-diff';

describe('diffSentences', () => {
  it('keeps unchanged clauses and marks replaced clauses', () => {
    const before = '近年來智慧城市發展核心，已從傳統的基礎建設部署。在智慧交通領域，配合中央政策。';
    const after = '近年來智慧城市發展核心，已從傳統的基礎建設部署。在智慧交通領域，配合中央 2025-2028 計畫與 2050 淨零路徑。';
    const parts = diffSentences(before, after);
    expect(parts.map((p) => p.type)).toEqual(['same', 'removed', 'added']);
    expect(parts[1].text).toBe('配合中央政策。');
    expect(parts.filter((p) => p.type !== 'removed').map((p) => p.text).join('')).toBe(after);
    expect(parts.filter((p) => p.type !== 'added').map((p) => p.text).join('')).toBe(before);
  });

  it('reports identical text as one unchanged part', () => {
    expect(diffSentences('相同內容。', '相同內容。')).toEqual([{ type: 'same', text: '相同內容。' }]);
  });

  it('counts characters without whitespace', () => {
    expect(countVisibleChars('a b\nc')).toBe(3);
  });
});
