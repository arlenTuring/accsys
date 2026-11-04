import { describe, expect, it } from 'vitest';
import { intentHintsForUserMessage } from './intent-hints';

describe('intentHintsForUserMessage', () => {
  it('flags remove-all attachments', () => {
    const h = intentHintsForUserMessage('請幫我把全部附件刪除');
    expect(h.some((x) => x.includes('remove_draft_attachments'))).toBe(true);
    expect(h.some((x) => x.includes('禁止回覆無法透過對話刪除'))).toBe(true);
  });

  it('flags companion search', () => {
    const h = intentHintsForUserMessage('幫我找一下我這階段有其他同行者一起出差嗎？');
    expect(h.some((x) => x.includes('search_trip_companion_candidates'))).toBe(true);
  });

  it('ignores unrelated messages', () => {
    expect(intentHintsForUserMessage('請列出預算來源')).toEqual([]);
  });
});
