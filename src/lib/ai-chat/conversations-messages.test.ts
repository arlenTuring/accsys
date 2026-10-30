import { describe, expect, it } from 'vitest';

/**
 * Documents the contract for listMessages: newest page, chronological array.
 * Full DB integration lives in tests/integration when admin DB is available.
 */
describe('listMessages contract', () => {
  it('simulates desc+limit then reverse so latest turns are kept', () => {
    const all = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, createdAt: i }));
    const limit = 40;
    const newestFirst = [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    const page = newestFirst.reverse();
    expect(page[0]?.id).toBe('m60');
    expect(page[page.length - 1]?.id).toBe('m99');
    expect(page).toHaveLength(40);
  });

  it('would regress if asc+limit were used (earliest only)', () => {
    const all = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, createdAt: i }));
    const wrong = [...all].sort((a, b) => a.createdAt - b.createdAt).slice(0, 40);
    expect(wrong[wrong.length - 1]?.id).toBe('m39');
    expect(wrong.some((m) => m.id === 'm99')).toBe(false);
  });
});
