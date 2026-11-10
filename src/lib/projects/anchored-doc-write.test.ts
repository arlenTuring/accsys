import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('streamed (typing) writes', () => {
  const original = '近年來智慧城市發展核心，已從傳統的基礎建設部署，逐步轉向以解決民眾真實出行需求為導向。';
  const replacementText = '近年來智慧城市發展核心，已從傳統基礎建設，轉向解決民眾出行需求，並配合 2050 淨零路徑，強化數位韌性。';
  const sleep = vi.fn(async () => undefined);
  const ok = (rev: string) => new Response(JSON.stringify({ writeControl: { requiredRevisionId: rev } }));
  const bodies = (mock: ReturnType<typeof vi.fn>) =>
    mock.mock.calls.filter((c) => String(c[0]).endsWith(':batchUpdate')).map((c) => JSON.parse(c[1].body));

  it('clears with requiredRevisionId, then types clause chunks chained by targetRevisionId', async () => {
    const anchor = anchorDocumentSelection('test-doc', makeDoc('r1', original), original);
    if (!anchor.ok) throw new Error('missing anchor');
    let n = 1;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith(':batchUpdate')) return ok(`r${++n}`);
      return new Response(JSON.stringify(n === 1 ? makeDoc('r1', original) : makeDoc(`r${n}`, replacementText)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await writeAnchoredDocument('test-token', anchor.anchor, replacementText, { stream: true, maxChunks: 4, sleep });
    expect(result.ok).toBe(true);
    const sent = bodies(fetchMock);
    expect(sent[0].writeControl).toEqual({ requiredRevisionId: 'r1' });
    expect(sent[0].requests).toEqual([{ deleteContentRange: { range: { startIndex: 1, endIndex: 1 + original.length } } }]);
    const typing = sent.slice(1);
    expect(typing.length).toBeGreaterThan(1);
    expect(typing.length).toBeLessThanOrEqual(4);
    expect(typing.map((b) => b.requests[0].insertText.text).join('')).toBe(replacementText);
    let expectedIndex = 1;
    typing.forEach((b, i) => {
      expect(b.writeControl).toEqual({ targetRevisionId: `r${i + 2}` });
      expect(b.requests[0].insertText.location.index).toBe(expectedIndex);
      expectedIndex += b.requests[0].insertText.text.length;
    });
  });

  it('finishes the remainder in one write after HTTP 429', async () => {
    const anchor = anchorDocumentSelection('test-doc', makeDoc('r1', original), original);
    if (!anchor.ok) throw new Error('missing anchor');
    let batch = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith(':batchUpdate')) {
        batch += 1;
        if (batch === 3) return new Response('{}', { status: 429 });
        return ok(`r${batch + 1}`);
      }
      return new Response(JSON.stringify(batch === 0 ? makeDoc('r1', original) : makeDoc('r9', replacementText)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await writeAnchoredDocument('test-token', anchor.anchor, replacementText, { stream: true, maxChunks: 6, sleep });
    expect(result.ok).toBe(true);
    const sent = bodies(fetchMock);
    const last = sent[sent.length - 1];
    const typedBefore = sent.slice(1, 2).map((b) => b.requests[0].insertText.text).join('');
    expect(last.requests).toHaveLength(1);
    expect(typedBefore + last.requests[0].insertText.text).toBe(replacementText);
    expect(last.requests[0].insertText.location.index).toBe(1 + typedBefore.length);
  });

  it('writes the original text back when typing fails midway', async () => {
    const anchor = anchorDocumentSelection('test-doc', makeDoc('r1', original), original);
    if (!anchor.ok) throw new Error('missing anchor');
    let batch = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith(':batchUpdate')) {
        batch += 1;
        if (batch === 3) return new Response('{}', { status: 500 });
        return ok(`r${batch + 1}`);
      }
      return new Response(JSON.stringify(makeDoc('r1', original)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await writeAnchoredDocument('test-token', anchor.anchor, replacementText, { stream: true, maxChunks: 6, sleep });
    expect(result).toEqual({ ok: false, reason: 'api_error', restored: true });
    const sent = bodies(fetchMock);
    const typed = sent[1].requests[0].insertText.text as string;
    const restore = sent[sent.length - 1].requests;
    expect(restore[0]).toEqual({ deleteContentRange: { range: { startIndex: 1, endIndex: 1 + typed.length } } });
    expect(restore[1]).toEqual({ insertText: { location: { index: 1 }, text: original } });
  });

  it('types multiple paragraphs top to bottom at the correct shifted indices', async () => {
    const first = '資安團隊定期執行帳號權限檢查並追蹤異常登入紀錄。';
    const second = '建立資安事故通報作業並定期演練系統復原程序。';
    const start2 = first.length + 2;
    const doc: DocsDocument = { revisionId: 'r1', body: { content: [
      { startIndex: 1, endIndex: start2, paragraph: { elements: [{ textRun: { content: first + '\n' } }] } },
      { startIndex: start2, endIndex: start2 + second.length + 1, paragraph: { elements: [{ textRun: { content: second + '\n' } }] } },
    ] } };
    const anchor = anchorDocumentSelection('test-doc', doc, `${first}\n${second}`);
    if (!anchor.ok) throw new Error('missing anchor');
    const newFirst = '資安團隊每月執行帳號權限盤點，並即時追蹤異常登入。';
    const newSecond = '建立資安事故通報機制，每季演練系統復原程序。';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith(':batchUpdate')) return ok('rx');
      const calls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(':batchUpdate')).length;
      if (calls === 0) return new Response(JSON.stringify(doc));
      return new Response(JSON.stringify({ revisionId: 'rz', body: { content: [
        { startIndex: 1, endIndex: newFirst.length + 2, paragraph: { elements: [{ textRun: { content: newFirst + '\n' } }] } },
        { startIndex: newFirst.length + 2, endIndex: newFirst.length + newSecond.length + 3, paragraph: { elements: [{ textRun: { content: newSecond + '\n' } }] } },
      ] } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await writeAnchoredDocument('test-token', anchor.anchor, `${newFirst}\n${newSecond}`, { stream: true, maxChunks: 4, sleep });
    expect(result.ok).toBe(true);
    const typing = bodies(fetchMock).slice(1).map((b) => b.requests[0].insertText);
    const secondStart = typing.findIndex((t) => newSecond.startsWith(t.text));
    expect(typing[0].location.index).toBe(1);
    expect(typing[secondStart].location.index).toBe(1 + newFirst.length + 1);
  });
});
