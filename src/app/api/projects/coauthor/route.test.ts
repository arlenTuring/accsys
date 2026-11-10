import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { anchorDocumentSelection, type DocAnchor, type DocsDocument } from '@/lib/projects/doc-selection';

vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: vi.fn().mockResolvedValue({
    id: 'emp-1',
    name: 'Arlen',
    email: 'arlen@turing-drive.com',
    department: 'RD',
    role: 'admin',
  }),
}));

vi.mock('@/lib/ai-chat/config', () => ({
  loadAiChatConfig: vi.fn().mockReturnValue({
    projectId: 'test-project',
    location: 'global',
    model: 'gemini-2.5-flash',
  }),
}));

vi.mock('@/lib/ai-chat/auth', () => ({
  getVertexAccessToken: vi.fn().mockResolvedValue({
    token: 'vertex-mock-token',
  }),
}));

vi.mock('@/lib/projects/drive-doc-writer', () => ({
  getCandidateDriveWriteTokens: vi.fn().mockResolvedValue(['user-oauth-token']),
  ensureDriveDocSharedForViewer: vi.fn().mockResolvedValue({ shared: false }),
  ensureGoogleDocSectionHeadings: vi.fn().mockResolvedValue({ ok: false }),
  insertImageIntoDriveDocumentInPlace: vi.fn().mockResolvedValue({ inserted: false }),
  patchDriveDocumentInPlace: vi.fn().mockResolvedValue({ updated: false, liveStreaming: false }),
  prewarmGoogleDocParagraphCache: vi.fn().mockResolvedValue(undefined),
  resolveOrUploadDroppedDocument: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/projects/company-knowledge-graph', () => ({
  ingestNewFilesAndOptimizeGraph: vi.fn().mockReturnValue({ addedOrUpdated: 0 }),
  searchCompanyKnowledgeGraph: vi.fn().mockReturnValue({
    matchedFiles: [],
    matchedProjects: [],
    graphStats: { totalNodes: 10, totalEdges: 5, communitiesCount: 2 },
  }),
}));

import { POST } from './route';

const originalText = '原本的資安防護機制與存取控制規範說明文字段落。';
const makeDoc = (revisionId: string, body = originalText): DocsDocument => ({
  revisionId,
  body: {
    content: [
      {
        startIndex: 1,
        endIndex: 1 + body.length + 1,
        paragraph: { elements: [{ textRun: { content: `${body}\n` } }] },
      },
    ],
  },
});

const initialAnchorResult = anchorDocumentSelection('doc-test-1', makeDoc('rev-1'), originalText);
if (!initialAnchorResult.ok) {
  throw new Error('Failed to create initial anchor for test');
}
const baseAnchor: DocAnchor = initialAnchorResult.anchor;

function makeVertexResponse(payload: {
  intent: 'edit' | 'discuss';
  reply: string;
  operations: Array<Record<string, unknown>>;
}) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(payload) }],
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function makePostRequest(anchor: DocAnchor = baseAnchor) {
  return new NextRequest('http://localhost:3000/api/projects/coauthor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '請強化這邊的資安防護機制描述',
      scopeMode: 'target_region',
      activeDoc: {
        id: 'local-doc-1',
        driveItemId: anchor.docId,
        title: '測試計畫書',
        docType: 'word',
        projectCode: 'TD-TEST',
        projectName: '測試專案',
        selectedTargetId: 'sec-4',
        selectedTargetLabel: '4.後續改善作法',
        currentTargetContent: anchor.paragraphs[0]!.text,
        linkedSnippetText: anchor.paragraphs[0]!.text,
        selectionAnchor: anchor,
        userExplicitlyLockedTarget: true,
      },
    }),
  });
}

describe('POST /api/projects/coauthor anchored write branch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns status="applied" when Vertex generates valid rewrite and Docs API write succeeds', async () => {
    const rewrittenText = '強化後的零信任資安防護機制、端點加密與多因素驗證存取控制規範說明文字段落。';
    const fetchMock = vi
      .fn()
      // 1. Vertex AI structured call
      .mockResolvedValueOnce(
        makeVertexResponse({
          intent: 'edit',
          reply: rewrittenText,
          operations: [
            {
              kind: 'write_word_section',
              sectionId: 'sec-4',
              sectionTitle: '4.後續改善作法',
              content: rewrittenText,
              mode: 'replace',
            },
          ],
        })
      )
      // 2. Docs GET pre-check
      .mockResolvedValueOnce(new Response(JSON.stringify(makeDoc('rev-1')), { status: 200 }))
      // 3. Docs batchUpdate
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      // 4. Docs GET post-verify
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeDoc('rev-2', rewrittenText)), { status: 200 })
      );

    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.writeResult).toEqual({
      status: 'applied',
      reason: 'applied',
      message: '已更新文件。',
    });
    expect(data.driveFileUpdated).toBe(true);
    expect(data.selectionAnchor?.revisionId).toBe('rev-2');
  });

  it('returns reason="revision_conflict" when document paragraph has been modified in another tab before write', async () => {
    const rewrittenText = '強化後的零信任資安防護機制說明文字段落。';
    const fetchMock = vi
      .fn()
      // 1. Vertex AI structured call
      .mockResolvedValueOnce(
        makeVertexResponse({
          intent: 'edit',
          reply: rewrittenText,
          operations: [
            {
              kind: 'write_word_section',
              sectionId: 'sec-4',
              sectionTitle: '4.後續改善作法',
              content: rewrittenText,
              mode: 'replace',
            },
          ],
        })
      )
      // 2. Docs GET returns a newer revisionId with changed text
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeDoc('rev-other-tab', '他人已在另一個分頁完全改寫過的不同內容段落。')),
          { status: 200 }
        )
      );

    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.writeResult?.status).toBe('not_applied');
    expect(data.writeResult?.reason).toBe('revision_conflict');
    expect(data.writeResult?.message).toContain('文件版本已變更');
    expect(data.driveFileUpdated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns reason="auth_failed" and needsDriveOAuth=true when Google Docs API returns 401', async () => {
    const rewrittenText = '強化後的零信任資安防護機制說明文字段落。';
    const fetchMock = vi
      .fn()
      // 1. Vertex AI structured call
      .mockResolvedValueOnce(
        makeVertexResponse({
          intent: 'edit',
          reply: rewrittenText,
          operations: [
            {
              kind: 'write_word_section',
              sectionId: 'sec-4',
              sectionTitle: '4.後續改善作法',
              content: rewrittenText,
              mode: 'replace',
            },
          ],
        })
      )
      // 2. Docs GET returns 401 Unauthorized
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.writeResult?.status).toBe('needs_auth');
    expect(data.writeResult?.reason).toBe('auth_failed');
    expect(data.writeResult?.message).toContain('需要授權 Google 文件');
    expect(data.needsDriveOAuth).toBe(true);
    expect(data.driveFileUpdated).toBe(false);
  });

  it('retries once on paragraph_count_mismatch and returns paragraph_count_mismatch if retry still mismatches', async () => {
    const multiParagraphText = '第一段改寫內容。\n第二段多出來的段落內容。';
    const fetchMock = vi
      .fn()
      // 1. First Vertex AI call outputs 2 paragraphs for a 1-paragraph anchor
      .mockResolvedValueOnce(
        makeVertexResponse({
          intent: 'edit',
          reply: multiParagraphText,
          operations: [
            {
              kind: 'write_word_section',
              sectionId: 'sec-4',
              sectionTitle: '4.後續改善作法',
              content: multiParagraphText,
              mode: 'replace',
            },
          ],
        })
      )
      // 2. Retry Vertex AI call still outputs 2 paragraphs
      .mockResolvedValueOnce(
        makeVertexResponse({
          intent: 'edit',
          reply: multiParagraphText,
          operations: [
            {
              kind: 'write_word_section',
              sectionId: 'sec-4',
              sectionTitle: '4.後續改善作法',
              content: multiParagraphText,
              mode: 'replace',
            },
          ],
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.writeResult?.status).toBe('not_applied');
    expect(data.writeResult?.reason).toBe('paragraph_count_mismatch');
    expect(data.writeResult?.message).toContain('段落數與框選範圍不符');
    expect(data.driveFileUpdated).toBe(false);
    // Called twice: initial Vertex call + 1 automatic retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
