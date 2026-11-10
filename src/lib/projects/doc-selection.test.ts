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
});
