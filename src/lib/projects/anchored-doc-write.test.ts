import { afterEach, expect, it, vi } from 'vitest';
import { anchorDocumentSelection, type DocsDocument } from './doc-selection';
import { writeAnchoredDocument } from './anchored-doc-write';

const text = '這是一段足夠長的資安保護措施說明，確保帳號權限安全。';
const makeDoc = (revisionId: string, body = text): DocsDocument => ({ revisionId, body: { content: [
  { startIndex: 1, endIndex: 1 + body.length + 1, paragraph: { elements: [{ textRun: { content: body + '\n' } }] } },
] } });
afterEach(() => vi.unstubAllGlobals());

it('uses revision control and verifies the changed document', async () => {
  const anchor = anchorDocumentSelection('test-doc', makeDoc('r1'), text);
  if (!anchor.ok) throw new Error('missing anchor');
  const updated = '強化資安防護，定期檢查帳號權限並監測異常。';
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(makeDoc('r1'))))
    .mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(new Response(JSON.stringify(makeDoc('r2', updated))));
  vi.stubGlobal('fetch', fetchMock);
  const result = await writeAnchoredDocument('test-token', anchor.anchor, updated);
  expect(result.ok).toBe(true);
  const body = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(body.writeControl.requiredRevisionId).toBe('r1');
  expect(body.requests).toHaveLength(2);
});

it('rejects a changed target after a revision conflict', async () => {
  const anchor = anchorDocumentSelection('test-doc', makeDoc('r1'), text);
  if (!anchor.ok) throw new Error('missing anchor');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(makeDoc('r2', '他人已經修改的完全不同內容')))));
  expect(await writeAnchoredDocument('test-token', anchor.anchor, '新內容')).toEqual({ ok: false, reason: 'revision_conflict' });
});

it('reports an unknown result if verification fails after the write', async () => {
  const anchor = anchorDocumentSelection('test-doc', makeDoc('r1'), text);
  if (!anchor.ok) throw new Error('missing anchor');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(makeDoc('r1'))))
    .mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('offline')));
  expect(await writeAnchoredDocument('test-token', anchor.anchor, '替換後的文件內容')).toEqual({ ok: false, reason: 'verification_unknown' });
});

it('refuses a replacement that changes the paragraph count', async () => {
  const anchor = anchorDocumentSelection('test-doc', makeDoc('r1'), text);
  if (!anchor.ok) throw new Error('missing anchor');
  expect(await writeAnchoredDocument('test-token', anchor.anchor, '第一段\n第二段')).toEqual({ ok: false, reason: 'paragraph_count_mismatch' });
});

it('replaces paragraphs in reverse order without deleting paragraph boundaries', async () => {
  const first = '資安團隊定期執行帳號權限檢查並追蹤異常登入紀錄。';
  const second = '建立資安事故通報作業並定期演練系統復原程序。';
  const start2 = first.length + 2;
  const doc: DocsDocument = { revisionId: 'r1', body: { content: [
    { startIndex: 1, endIndex: start2, paragraph: { elements: [{ textRun: { content: first + '\n' } }] } },
    { startIndex: start2, endIndex: start2 + second.length + 1, paragraph: { elements: [{ textRun: { content: second + '\n' } }] } },
  ] } };
  const anchor = anchorDocumentSelection('test-doc', doc, `${first}\n${second}`);
  if (!anchor.ok) throw new Error('missing anchor');
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(doc)))
    .mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetchMock);
  await writeAnchoredDocument('test-token', anchor.anchor, '改寫第一個段落\n改寫第二個段落');
  const requests = JSON.parse(fetchMock.mock.calls[1][1].body).requests;
  expect(requests[0].deleteContentRange.range).toEqual({ startIndex: start2, endIndex: start2 + second.length });
  expect(requests[2].deleteContentRange.range).toEqual({ startIndex: 1, endIndex: start2 - 1 });
});
