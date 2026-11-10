import { describe, expect, it } from 'vitest';
import type { DocParagraph } from './doc-selection';
import { classifyClipboardSelection, clipboardClassificationMessage, isHeadingLike } from './clipboard-selection';

const heading = '1、申請創新實驗計畫之緣由';
const p1 =
  '近年來智慧城市發展核心，已從傳統的基礎建設部署，逐步轉向以解決民眾真實出行需求為導向。在智慧交通領域，配合中央「智慧運輸系統發展建設計畫」與國家淨零排放路徑，以及地方政府推動綠色低碳運輸與智慧移動服務之政策方針。';
const p2 = '綜觀國際發展趨勢，自動駕駛技術已邁向實地驗證階段。台灣在過去數年間累積了多項場域測試經驗與法規調適成果。';

function build(texts: Array<[string, boolean?]>): DocParagraph[] {
  let index = 1;
  return texts.map(([text, isHeading]) => {
    const p = { startIndex: index, endIndex: index + text.length + 1, text, heading: isHeading };
    index = p.endIndex;
    return p;
  });
}

const doc = build([['2、計畫緣起', true], [heading], [p1], [p2]]);

describe('classifyClipboardSelection', () => {
  it('links the exact paragraph copied from Google Docs and labels it with its section', () => {
    const result = classifyClipboardSelection(p1, doc);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.range.paragraphs).toEqual([doc[2]]);
    expect(result.range.sectionLabel).toBe(heading);
    expect(result.range.ordinalInSection).toBe(1);
    expect(result.range.partial).toBe(false);
  });

  it('treats an empty clipboard, whitespace, or a URL as "forgot to copy"', () => {
    expect(classifyClipboardSelection('', doc).kind).toBe('empty');
    expect(classifyClipboardSelection('   \n ', doc).kind).toBe('empty');
    expect(classifyClipboardSelection('https://docs.google.com/document/d/abc/edit', doc).kind).toBe('url');
  });

  it('reports stale clipboard content that is not in this document', () => {
    expect(classifyClipboardSelection('出場晚一點沒關係，記得把會議記錄寄給大家。謝謝各位今天的參與。', doc).kind).toBe('not_in_doc');
  });

  it('marks a single copied sentence as a partial selection of its paragraph', () => {
    const result = classifyClipboardSelection('在智慧交通領域，配合中央「智慧運輸系統發展建設計畫」與國家淨零排放路徑', doc);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.range.paragraphs).toEqual([doc[2]]);
      expect(result.range.partial).toBe(true);
    }
  });

  it('drops a copied numbered heading line and keeps the body paragraph', () => {
    const result = classifyClipboardSelection(`${heading}\n${p1}`, doc);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.range.paragraphs).toEqual([doc[2]]);
  });

  it('detects that the clipboard still holds the previously linked paragraph', () => {
    const result = classifyClipboardSelection(p1, doc, { startIndex: doc[2].startIndex, text: p1 });
    expect(result.kind).toBe('same_as_last');
  });

  it('after an edit, the old clipboard text no longer matches and is reported as not copied', () => {
    const edited = build([['2、計畫緣起', true], [heading], ['近年來智慧城市發展核心已全面改寫，新增 2025-2028 智慧運輸計畫與 2050 淨零路徑之運具電動化策略，並結合數位韌性。'], [p2]]);
    expect(classifyClipboardSelection(p1, edited, { startIndex: edited[2].startIndex, text: edited[2].text }).kind).toBe('not_in_doc');
  });

  it('reports duplicated text as ambiguous', () => {
    const dup = build([[heading], [p1], [p2], [p1]]);
    expect(classifyClipboardSelection(p1, dup).kind).toBe('ambiguous');
  });

  it('rejects selections over the size limits', () => {
    const many = build(Array.from({ length: 10 }, (_, i) => [`第${i}段：建立資安事件通報流程並定期演練，確保人員可以及時應變處理${i}。`] as [string]));
    expect(classifyClipboardSelection(many.map((p) => p.text).join('\n'), many).kind).toBe('too_large');
    expect(classifyClipboardSelection('字'.repeat(3001), doc).kind).toBe('too_large');
  });

  it('recognises numbered heading lines', () => {
    expect(isHeadingLike({ startIndex: 1, endIndex: 2, text: heading })).toBe(true);
    expect(isHeadingLike({ startIndex: 1, endIndex: 2, text: '（一）系統架構' })).toBe(true);
    expect(isHeadingLike({ startIndex: 1, endIndex: 2, text: p1 })).toBe(false);
  });

  it('builds user-facing messages with the platform copy key', () => {
    expect(clipboardClassificationMessage('not_in_doc', '⌘C')).toContain('可能忘了按 ⌘C');
    expect(clipboardClassificationMessage('denied', 'Ctrl+C')).toContain('Ctrl+V');
  });
});
