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

  it('flags unified expense claim & 30k purchase request threshold hints', () => {
    const h = intentHintsForUserMessage('幫我開一張費用申請單，研發部買辦公用品 25,000 元');
    expect(h.some((x) => x.includes('expense-claim'))).toBe(true);
    expect(h.some((x) => x.includes('30,000'))).toBe(true);
    expect(h.some((x) => x.includes('purchase-request'))).toBe(true);
  });

  it('flags budget request and budget change e-signature hints', () => {
    const h1 = intentHintsForUserMessage('幫我建立一張 115 年度研發部的預算申請單');
    expect(h1.some((x) => x.includes('budget-request'))).toBe(true);
    const h2 = intentHintsForUserMessage('我要追加預算 50,000 元，幫我開預算變更單');
    expect(h2.some((x) => x.includes('budget-change'))).toBe(true);
  });

  it('flags seal request hints (contract, general, invoice)', () => {
    const h = intentHintsForUserMessage('幫我開一張合約用印申請單，急件蓋公司大小章');
    expect(h.some((x) => x.includes('contract-seal'))).toBe(true);
    expect(h.some((x) => x.includes('general-seal'))).toBe(true);
    expect(h.some((x) => x.includes('invoice-seal'))).toBe(true);
  });

  it('flags asset inventory handover form dispatch & dual-confirmation hints', () => {
    const h = intentHintsForUserMessage('幫我發送一張財產清點單給 @阮振瑋，並確認同意現在位置與存在事實');
    expect(h.some((x) => x.includes('dispatch_inventory_handover_form'))).toBe(true);
    expect(h.some((x) => x.includes('confirm_inventory_handover_items'))).toBe(true);
    expect(h.some((x) => x.includes('list_inventory_handover_forms'))).toBe(true);
  });
});
