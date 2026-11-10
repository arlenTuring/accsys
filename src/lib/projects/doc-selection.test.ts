import { describe, expect, it } from 'vitest';
import { matchDocumentSelection, type DocParagraph } from './doc-selection';

const paragraphs: DocParagraph[] = [
  { startIndex: 1, endIndex: 30, text: '系統修正與復原部署作業已於完成測試後執行，並持續監控。' },
  { startIndex: 30, endIndex: 42, text: '4.後續改善作法', heading: true },
  { startIndex: 42, endIndex: 90, text: '強化帳號權限控管與異常登入監測，定期檢查系統安全。' },
  { startIndex: 90, endIndex: 140, text: '建立資安事件通報流程並定期演練，確保人員可以及時應變。' },
];

describe('document selection matching', () => {
  it('excludes a partial preceding paragraph and a heading', () => {
    const result = matchDocumentSelection(paragraphs, '並持續監控。 強化帳號權限控管與異常登入監測 定期檢查系統安全\n建立資安事件通報流程 並定期演練確保人員可以及時應變');
    expect(result.ok && result.match.paragraphs.map((p) => p.startIndex)).toEqual([42, 90]);
  });

  it('rejects repeated text at separate locations', () => {
    const duplicate = { ...paragraphs[2], startIndex: 200, endIndex: 248 };
    expect(matchDocumentSelection([...paragraphs, duplicate], paragraphs[2].text)).toEqual({ ok: false, reason: 'ambiguous_target' });
  });

  it('matches a single sentence within a longer paragraph even with OCR missing chars and extra whitespace', () => {
    const longParagraphs: DocParagraph[] = [
      { startIndex: 1, endIndex: 30, text: '系統修正與復原部署作業已於完成測試後執行，並持續監控。' },
      {
        startIndex: 42,
        endIndex: 180,
        text: '為確保平台整體穩定性，本團隊已先行完成主機漏洞修補與防火牆規則盤點。同時強化帳號權限控管與異常登入即時監測機制，並每季辦理滲透測試。後續亦將建立跨部門資安事件通報標準作業流程，定期舉辦攻防演練以維持人員應變能量。',
      },
      { startIndex: 180, endIndex: 230, text: '上述改善措施均已納入年度資訊安全稽核計畫追蹤辦理。' },
    ];
    // Only the middle sentence is selected, with an OCR dropped character ('即' missing) and extra spaces
    const ocrPartialSelection = '同時強化帳號權限控管  與異常登入時監測機制 ， 並每季辦理滲透測試';
    const result = matchDocumentSelection(longParagraphs, ocrPartialSelection);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match.paragraphs).toEqual([longParagraphs[1]]);
    }
  });

  it('ignores short numbering paragraphs (< 6 bigrams) so they do not cause false matches or ambiguous_target', () => {
    const numberedParagraphs: DocParagraph[] = [
      { startIndex: 1, endIndex: 5, text: '1.' },
      { startIndex: 5, endIndex: 11, text: '（一）' },
      { startIndex: 11, endIndex: 18, text: '項目一' },
      { startIndex: 18, endIndex: 75, text: '項目一：強化帳號權限控管與異常登入監測，定期檢查系統安全。' },
      { startIndex: 75, endIndex: 82, text: '（一）' },
      { startIndex: 82, endIndex: 89, text: '項目一' },
      { startIndex: 89, endIndex: 140, text: '建立資安事件通報流程並定期演練，確保人員可以及時應變。' },
    ];
    const result = matchDocumentSelection(
      numberedParagraphs,
      '（一） 項目一：強化帳號權限控管與異常登入監測，定期檢查系統安全。'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match.paragraphs).toEqual([numberedParagraphs[3]]);
    }
  });
});
