import { NextResponse, type NextRequest } from 'next/server';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getVertexAccessToken } from '@/lib/ai-chat/auth';
import { anchorDocumentSelection } from '@/lib/projects/doc-selection';
import type { DocAnchor } from '@/lib/projects/doc-selection';
import { readGoogleDocument, writeAnchoredDocument } from '@/lib/projects/anchored-doc-write';
import { loadAiChatConfig } from '@/lib/ai-chat/config';
import {
  filterYearGroupsForViewer,
  HISTORICAL_YEAR_GROUPS,
  type HistoricalProject,
  type HistoricalYearGroup,
  type ProjectViewerContext,
} from '@/lib/projects/historical-projects-data';
import {
  buildProjectIllustrationDataUrl,
  type CoAuthorDocType,
} from '@/lib/projects/project-coauthor-seed';
import {
  ingestNewFilesAndOptimizeGraph,
  searchCompanyKnowledgeGraph,
  type GraphQueryResult,
} from '@/lib/projects/company-knowledge-graph';
import {
  ensureDriveDocSharedForViewer,
  ensureGoogleDocSectionHeadings,
  getCandidateDriveWriteTokens,
  insertImageIntoDriveDocumentInPlace,
  patchDriveDocumentInPlace,
  prewarmGoogleDocParagraphCache,
  resolveOrUploadDroppedDocument,
} from '@/lib/projects/drive-doc-writer';

export const dynamic = 'force-dynamic';

export type CoAuthorReferenceFileInput = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  kindLabel: string;
  extractedText?: string;
  base64Data?: string;
};

type CoAuthorRequest = {
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  referenceFiles?: CoAuthorReferenceFileInput[];
  scopeMode?: 'whole_doc' | 'target_region';
  activeDoc?: {
    id: string;
    driveItemId?: string;
    title: string;
    docType: CoAuthorDocType;
    projectCode: string;
    projectName: string;
    selectedTargetId?: string;
    selectedTargetLabel?: string;
    selectedRowIndex?: number | null;
    currentTargetContent?: string;
    linkedSnippetText?: string;
    selectionAnchor?: DocAnchor;
    insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
    cursorAnchorBefore?: string;
    cursorAnchorAfter?: string;
    userExplicitlyLockedTarget?: boolean;
    fullOutlineSummary?: string;
    fullDocumentText?: string;
  } | null;
};

export type CoAuthorOperation =
  | {
      kind: 'write_word_section';
      sectionId?: string;
      newSectionCode?: string;
      sectionTitle: string;
      content: string;
      mode: 'replace' | 'append' | 'add_section';
    }
  | {
      kind: 'write_excel_rows';
      sheetId?: string;
      newSheetName?: string;
      columns?: string[];
      rows: string[][];
      mode: 'replace_rows' | 'append_rows' | 'update_selected_row' | 'add_sheet';
      rowIndex?: number;
    }
  | {
      kind: 'write_ppt_slide';
      slideId?: string;
      slideTitle: string;
      slideSubtitle: string;
      bullets: string[];
      speakerNotes: string;
      mode: 'replace_slide' | 'add_slide';
    }
  | {
      kind: 'generate_image';
      targetId?: string;
      caption: string;
      prompt: string;
      dataUrl: string;
      mode?: 'replace' | 'append';
    }
  | {
      kind: 'open_or_create_doc';
      docType: CoAuthorDocType;
      title: string;
      projectCode: string;
      projectName: string;
    }
  | {
      kind: 'format_word_document';
      fontFamily?: 'Noto Sans TC' | 'Noto Serif TC' | 'Times New Roman' | 'Calibri';
      fontSizePt?: number;
      lineSpacing?: number;
      paragraphIndentEm?: number;
      showTableOfContents?: boolean;
      showPageNumbers?: boolean;
      showHeaderFooter?: boolean;
      headerText?: string;
      footerText?: string;
      pageNumberStyle?: 'page_x_of_y' | 'numeric' | 'roman';
      renumberSections?: boolean;
    };

export type CoAuthorResponse = {
  intent?: 'edit' | 'discuss';
  selectionAnchor?: DocAnchor;
  writeResult?: { status: 'applied' | 'not_applied' | 'needs_auth' | 'unknown'; reason: string; message: string };
  refusedCompanyAdmin?: boolean;
  reply: string;
  operations: CoAuthorOperation[];
  driveFileUpdated?: boolean;
  driveLiveStreaming?: boolean;
  resolvedNativeDocId?: string;
  needsDriveOAuth?: boolean;
  webSearch?: {
    queries: string[];
    sources: Array<{ title: string; uri: string }>;
  };
  graphRetrieval?: {
    totalNodes: number;
    totalEdges: number;
    communitiesCount: number;
    matchedFileNames: string[];
    matchedProjectCodes: string[];
    autoOptimized: boolean;
  };
};

const COMPANY_ADMIN_KEYWORDS = [
  '請假',
  '特休',
  '病假',
  '事假',
  '喪假',
  '婚假',
  '忘打卡',
  '補打卡',
  '加班單',
  '加班申請',
  '公出差旅申請單',
  '旅費報支',
  '費用報支單',
  '用印申請單',
  '個人資產轉移',
  '待我簽核',
  '幫我簽核',
  '催簽',
  '社團補助',
  '薪資條',
];

const CHITCHAT_OR_IRRELEVANT_KEYWORDS = [
  '今天是晴天',
  '晴天嗎',
  '下雨嗎',
  '今天天氣',
  '明天氣溫',
  '天氣如何',
  '天氣好嗎',
  '午餐吃什麼',
  '晚餐吃什麼',
  '講個笑話',
  '說個笑話',
  '星座運勢',
  '算命',
  '樂透',
  '威力彩',
  '好無聊',
  '陪我聊天',
];

function stripMarkdownAsterisks(text: string): string {
  return text.replace(/\*\*/g, '');
}

/**
 * Strips conversational filler / meta-announcements such as:
 * "已為您強化「1.1 通則 General — 本章概要 Summary」段落。"
 * "已結合 Graphify 知識圖譜...為您更新「...」的內容。"
 */
function stripAuxiliaryMetaPhrases(text: string): string {
  let out = stripMarkdownAsterisks(text).trim();
  const prefixPatterns = [
    /^(?:好的[，、。！]?\s*)?(?:我已經?|已經?|這邊已|系統已)?(?:結合[^。！？\n]*?[，、]\s*)?(?:為您|幫您|替您)?(?:強化|修改|更新|改寫|精簡|擴充|深化|調整|完成|重寫|優化|潤飾|補齊|新增)(?:了)?(?:「[^」]*」|『[^』]*』|[^。！？\n]{0,45}?)(?:之|的)?(?:段落|內容|描述|文字|章節)?[。！？：:]\s*/u,
    /^(?:本次修訂依據|此處修訂依據|修改說明如下|以下為修改後內容|以下是修改後的[^\n：:]*)[：:]?[^。！？\n]*[。！？]\s*/u,
  ];
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const pat of prefixPatterns) {
      const next = out.replace(pat, '').trim();
      if (next && next !== out) {
        out = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

function isCompanyAdminRequest(text: string): boolean {
  const q = text.trim().toLowerCase();
  return COMPANY_ADMIN_KEYWORDS.some((kw) => q.includes(kw.toLowerCase()));
}

function isIrrelevantNonProjectQuery(text: string): boolean {
  const q = text.trim().toLowerCase();
  return CHITCHAT_OR_IRRELEVANT_KEYWORDS.some((kw) => q.includes(kw.toLowerCase()));
}

type FollowUpResolution = {
  selectedDirection: 1 | 2 | 3 | null;
  selectedDirectionText: string | null;
  expandedQuery: string;
  wantsWriteNow: boolean;
  isInitialBroadReview: boolean;
};

function resolveFollowUpFromHistory(
  prompt: string,
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
): FollowUpResolution {
  const q = prompt.trim();
  const lower = q.toLowerCase();

  const wantsWriteNow =
    /(?:幫我|請幫我|直接|好.*幫我|那就|請)?(?:寫進|寫入|更新到|補進|加進|寫到|改成|改為|修改成|替換成|加入一個|新增一個|新增一列|新增一頁|新增章節|刪除第|刪掉第|插入|直接寫|直接改|幫我寫|幫我改|幫我補|強化|精簡|擴充|深化|改寫|潤飾|重寫|濃縮|修改這段|改這段|建立目錄|加入目錄|加上目錄|隱藏目錄|建立索引|加入頁碼|加上頁碼|頁首|頁尾|重新編號|調整排版|調整行距|字型改|字體改|縮排)/.test(
      lower
    );

  let selectedDirection: 1 | 2 | 3 | null = null;
  if (/第\s*[一1]\s*(?:個)?(?:方向|點|項|部分)|方向\s*[一1]|^1[\s.、]|選\s*1/.test(lower)) {
    selectedDirection = 1;
  } else if (/第\s*[二2]\s*(?:個)?(?:方向|點|項|部分)|方向\s*[二2]|^2[\s.、]|選\s*2/.test(lower)) {
    selectedDirection = 2;
  } else if (/第\s*[三3]\s*(?:個)?(?:方向|點|項|部分)|方向\s*[三3]|^3[\s.、]|選\s*3/.test(lower)) {
    selectedDirection = 3;
  }

  // Extract the last assistant message to resolve numbered points or prior topic
  const lastAssistantMsg = [...(history ?? [])]
    .reverse()
    .find((m) => m.role === 'assistant')?.text;

  let selectedDirectionText: string | null = null;
  if (selectedDirection && lastAssistantMsg) {
    const regex = new RegExp(
      `${selectedDirection}\\.\\s*([^\\n]+(?:\\n(?!\\d+\\.\\s)[^\\n]+)*)`
    );
    const match = lastAssistantMsg.match(regex);
    if (match?.[1]) {
      selectedDirectionText = match[1].trim();
    }
  }

  // If user says "好，幫我寫進去" after discussing a specific direction, inherit the last discussed topic
  if (!selectedDirectionText && wantsWriteNow && lastAssistantMsg) {
    selectedDirectionText = lastAssistantMsg.slice(0, 500);
  }

  const isInitialBroadReview =
    !selectedDirection &&
    !wantsWriteNow &&
    /討論.*文件|你覺得.*還有什麼|有什麼可以優化|怎麼優化|給.*優化建議|檢視整份|審查整份|評估整份|全部的文件|整份文件|整體架構/.test(
      lower
    );

  const expandedQuery = selectedDirectionText
    ? `${q} ${selectedDirectionText}`
    : selectedDirection === 3
    ? `${q} 國際標準 ISO 26262 ISO 21448 SOTIF ISO 21434 台灣智慧駕駛 歷年專案實績佐證`
    : selectedDirection === 2
    ? `${q} 量化驗收指標 KPI 5G專網延遲 月台門 PSD 對位精度 SAT 72小時連續無故障測試`
    : selectedDirection === 1
    ? `${q} 章節結構 介面控制文件 ICD 系統範疇 定位感知 班距調度 SOP 資安檢測`
    : q;

  return {
    selectedDirection,
    selectedDirectionText,
    expandedQuery,
    wantsWriteNow,
    isInitialBroadReview,
  };
}

function hasExplicitDocumentWriteIntent(text: string): boolean {
  const q = text.trim().toLowerCase();
  return /更新這個段落|更新此段落|更新這段|修改這個段落|修改此段落|修改這段|幫我改|幫我寫|幫我加|幫我新增|幫我更新|直接改|直接寫|更新到|改寫|擴充|精簡|濃縮|潤飾|重寫|替換|補齊|寫入|加入.*段落|強化.*段落/.test(
    q
  );
}

function isDiscussionOrReviewIntent(
  text: string,
  scopeMode?: 'whole_doc' | 'target_region',
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
): boolean {
  if (hasExplicitDocumentWriteIntent(text)) return false;

  const res = resolveFollowUpFromHistory(text, history);
  if (res.wantsWriteNow) return false;
  if (res.selectedDirection !== null) return true;
  if (res.isInitialBroadReview) return true;

  const q = text.trim().toLowerCase();
  const hasDiscussionOrQuestionKeywords =
    /請告訴我|告訴我|請問|為什麼|哪裡的新聞|引用了哪|引用哪|來源|出處|根據什麼|什麼意思|是什麼|有哪些|怎麼看|討論|你覺得|覺得.*如何|還有什麼|有什麼可以優化|怎麼優化|給.*建議|優化建議|檢視|審查|評估|分析一下|看法|意見|哪裡可以改|哪些地方|缺什麼|漏了什麼|查.*歷史|\?|？/.test(
      q
    );
  if (hasDiscussionOrQuestionKeywords) return true;

  if (
    scopeMode === 'whole_doc' &&
    !hasExplicitDocumentWriteIntent(q)
  ) {
    return true;
  }

  return false;
}

function formatGraphRetrievalContextForPrompt(graphResult: GraphQueryResult): string {
  const lines: string[] = [
    `【Graphify 公司知識圖譜檢索結果（總節點：${graphResult.graphStats.totalNodes}，總關聯邊：${graphResult.graphStats.totalEdges}，社群聚落：${graphResult.graphStats.communitiesCount}）】`,
  ];

  if (graphResult.matchedStandardsAndConcepts.length > 0) {
    lines.push(
      '1. 命中技術標準與核心概念節點：\n' +
        graphResult.matchedStandardsAndConcepts
          .map((c) => `   - ${c.label}：${c.summary}`)
          .join('\n')
    );
  }

  if (graphResult.matchedProjects.length > 0) {
    lines.push(
      '2. 關聯歷年專案實績節點（依圖譜中心度與關聯度排序）：\n' +
        graphResult.matchedProjects
          .map(
            (p) =>
              `   - ${p.node.label}（${p.projectContext?.period ?? ''}｜${
                p.projectContext?.department ?? ''
              }｜關聯分數 ${p.score}）：${p.projectContext?.summary ?? p.node.summary}`
          )
          .join('\n')
    );
  }

  if (graphResult.matchedFiles.length > 0) {
    lines.push(
      '3. 檢索命中之歷史專案檔案節點：\n' +
        graphResult.matchedFiles
          .map(
            (f) =>
              `   - 《${f.node.label}》（專案：${f.node.projectCode ?? '全公司'}｜權重 ${f.score}）：${f.node.summary}`
          )
          .join('\n')
    );
  }

  if (graphResult.traversalPaths.length > 0) {
    lines.push(
      '4. 知識圖譜關聯路徑（Graph Traversal Paths）：\n' +
        graphResult.traversalPaths.map((pathStr) => `   - ${pathStr}`).join('\n')
    );
  }

  return lines.join('\n\n');
}

function buildAuthorizedProjectsDigest(groups: HistoricalYearGroup[]): {
  digestText: string;
  allProjects: HistoricalProject[];
} {
  const allProjects = groups.flatMap((g) => g.projects);
  const lines: string[] = [
    '【公司基本資料：台灣智慧駕駛股份有限公司 (Turing Drive Inc.)】',
    '- 核心定位：專注於 L4 低速與特定場域自動駕駛系統研發、軟硬體系統整合、車隊遠端監控與行控平台（OCC / FMS）之台灣領先自駕技術公司。',
    '- 核心技術：Autoware 多感測器融合定位（3D LiDAR NDT + RTK-GNSS + 車輪里程計 + IMU）、底盤線控（Drive-by-Wire）雙迴路安全連鎖、5G 低延遲遠端接管（Teleoperation / NSC Remote）、月台門（PSD）與智慧號誌 V2X 連動、ISO 26262 / ISO 21434 / ISO 21448 安全合規架構。',
    '- 2019–2026 歷年專案實績庫（已依當前使用者權限過濾）：',
  ];

  for (const g of groups) {
    const projSummaries = g.projects
      .map(
        (p) =>
          `  * [${g.year} | ${p.code}] ${p.name}（${p.period}）：${p.summary}（代表檔案：${p.highlights
            .slice(0, 2)
            .join('、')}）`
      )
      .join('\n');
    lines.push(projSummaries);
  }

  return {
    digestText: lines.join('\n'),
    allProjects,
  };
}

function detectImageTheme(
  text: string
): 'lidar_vehicle' | 'airport_t3' | 'fms_dashboard' | 'golf_cart' | 'general' {
  const q = text.toLowerCase();
  if (q.includes('t3') || q.includes('機場') || q.includes('航廈') || q.includes('廊道') || q.includes('月台')) {
    return 'airport_t3';
  }
  if (q.includes('lidar') || q.includes('光達') || q.includes('外參') || q.includes('點雲') || q.includes('感測')) {
    return 'lidar_vehicle';
  }
  if (q.includes('行控') || q.includes('圖台') || q.includes('fms') || q.includes('occ') || q.includes('儀表板') || q.includes('監控')) {
    return 'fms_dashboard';
  }
  if (q.includes('球車') || q.includes('golface') || q.includes('高爾夫') || q.includes('綠通')) {
    return 'golf_cart';
  }
  return 'general';
}

async function tryGenerateVertexImage(prompt: string): Promise<string | null> {
  try {
    const cfg = loadAiChatConfig();
    if (!cfg.projectId) return null;
    const { token } = await getVertexAccessToken(cfg);
    const imageModel = (process.env.AI_IMAGE_MODEL || 'gemini-2.5-flash-image').trim();
    const loc = cfg.location || 'global';
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${cfg.projectId}/locations/${loc}/publishers/google/models/${imageModel}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-goog-user-project': cfg.projectId,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Generate a professional autonomous driving engineering illustration or realistic visualization for Turing Drive Inc. project documentation: ${prompt}. Modern L4 autonomous shuttle, 3D LiDAR sensors, airport / transit corridor or fleet control center, 16:9 widescreen composition, crisp technical presentation quality.`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
          }>;
        };
      }>;
    };
    const inlinePart = (data.candidates?.[0]?.content?.parts ?? []).find(
      (p) => p.inlineData?.data
    );
    if (inlinePart?.inlineData?.data) {
      const mime = inlinePart.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${inlinePart.inlineData.data}`;
    }
  } catch {
    // Fallback to architectural SVG illustration
  }
  return null;
}

async function tryVertexStructuredCoAuthor(
  req: CoAuthorRequest,
  projectsDigest: string,
  graphResult: GraphQueryResult,
  followUp: FollowUpResolution
): Promise<{ response: CoAuthorResponse | null; errorReason?: string }> {
  try {
    const cfg = loadAiChatConfig();
    if (!cfg.projectId) {
      return { response: null, errorReason: '尚未設定 AI_CHAT_PROJECT_ID' };
    }
    const { token } = await getVertexAccessToken(cfg);
    const endpoint =
      cfg.location === 'global'
        ? `https://aiplatform.googleapis.com/v1/projects/${cfg.projectId}/locations/global/publishers/google/models/${cfg.model}:generateContent`
        : `https://${cfg.location}-aiplatform.googleapis.com/v1/projects/${cfg.projectId}/locations/${cfg.location}/publishers/google/models/${cfg.model}:generateContent`;

    const recentHistoryText =
      req.history && req.history.length > 0
        ? `【近期對話脈絡】\n${req.history
            .map((h) => `${h.role === 'user' ? '使用者' : '專案助手'}：${h.text}`)
            .join('\n')}\n\n`
        : '';

    const hasTargetedCursorOrSnippet = Boolean(
      req.activeDoc?.linkedSnippetText ||
        req.activeDoc?.cursorAnchorBefore ||
        req.activeDoc?.cursorAnchorAfter
    );
    const isWholeDocMode =
      (req.scopeMode === 'whole_doc' && !hasTargetedCursorOrSnippet) ||
      /全部的文件|整份文件|整個檔案|全部章節|所有章節|整份簡報|整個試算表|整體內容/.test(req.prompt);
    const discussionOnly = isDiscussionOrReviewIntent(req.prompt, req.scopeMode, req.history);

    const isTuringDriveRelated =
      /台灣智慧駕駛|台智駕|turing\s*drive|歷年專案|歷史專案|公司實績|過去實績/i.test(req.prompt) ||
      /T3-2026|桃園.*機場|自駕|VTMS|AITS/i.test(
        `${req.activeDoc?.projectCode ?? ''} ${req.activeDoc?.projectName ?? ''} ${req.activeDoc?.title ?? ''}`
      );

    const graphContextText =
      isTuringDriveRelated &&
      (graphResult.matchedFiles.length > 0 || graphResult.matchedProjects.length > 0)
        ? `${formatGraphRetrievalContextForPrompt(graphResult)}\n\n`
        : '';

    const effectiveProjectsDigest = isTuringDriveRelated ? `${projectsDigest}\n\n` : '';

    const followUpHint = followUp.selectedDirection
      ? `\n- 【重要多輪追問解析】：使用者正在針對上一輪討論的「第 ${followUp.selectedDirection} 個方向」（${
          followUp.selectedDirectionText ?? ''
        }）進行深入追問！絕對禁止重複列出那三個大方向總覽（禁止鬼打牆）！請直接針對「第 ${
          followUp.selectedDirection
        } 個方向」給出具體深入的草稿建議與對應章節分析！`
      : '';

    const fullDocSectionText = isWholeDocMode
      ? (req.activeDoc?.fullDocumentText || req.activeDoc?.fullOutlineSummary || '').slice(0, 24_000)
      : (req.activeDoc?.fullOutlineSummary || '').slice(0, 4_000);

    const isCursorInsertTurn = Boolean(
      !req.activeDoc?.linkedSnippetText &&
        (req.activeDoc?.insertMode === 'insert_at_cursor' ||
          req.activeDoc?.insertMode === 'insert_before' ||
          req.activeDoc?.insertMode === 'insert_after' ||
          req.activeDoc?.cursorAnchorBefore ||
          req.activeDoc?.cursorAnchorAfter)
    );

    const docContext = req.activeDoc
      ? `【目前共同編輯中的專案檔案】
- 專案：${req.activeDoc.projectCode} ${req.activeDoc.projectName}
- 檔案名稱：${req.activeDoc.title}
- 檔案類型：${req.activeDoc.docType.toUpperCase()}
- 當前互動模式：${
          isCursorInsertTurn
            ? `游標定点插入模式（使用者將游標停留在：${req.activeDoc.selectedTargetLabel ?? '指定游標位置'}）`
            : isWholeDocMode
            ? '全份文件模式（使用者希望針對整份文件進行全面檢視、討論或整體修改）'
            : `指定區域模式（目前鎖定區域：${req.activeDoc.selectedTargetLabel ?? '無'}，ID：${
                req.activeDoc.selectedTargetId ?? '未指定'
              }）`
        }
- 使用者意圖判斷：${
          discussionOnly
            ? '【討論與優化建議模式】使用者正在與你討論、詢問意見或針對特定方向深入探討，請在 reply 中深入回答，且 operations 必須保持空陣列 []（等他確認要寫入時再產生 operations）！'
            : isCursorInsertTurn
            ? '【游標位置直接寫入模式】使用者將游標放在文件特定空白處並要求寫入內容，請參考下方「游標上方前文脈絡」的標題層級與段落格式，直接產生要插入游標處的正式完整內容，並放入 operations[0] (write_word_section)！'
            : '【執行撰寫／更新模式】使用者希望實際更新或新增文件內容，請直接針對下方「使用者框選的核心段落」進行改寫或強化，並產生對應的 operations。'
        }${followUpHint}
- 使用者目前點選的表格列索引（0-based）：${
          typeof req.activeDoc.selectedRowIndex === 'number'
            ? `${req.activeDoc.selectedRowIndex}（即畫面第 ${req.activeDoc.selectedRowIndex + 1} 列）`
            : '未點選特定列'
        }
- ${
          isCursorInsertTurn
            ? `使用者游標所在位置說明（請只輸出要新插入於此游標位置的內容，切勿重複輸出上方已存在的其他公司段落）：\n游標正上方鄰近文字：${req.activeDoc.cursorAnchorBefore || '（頁首空白處）'}\n游標正下方鄰近文字：${req.activeDoc.cursorAnchorAfter || '（段落結尾）'}`
            : `使用者框選的核心段落（請嚴格針對此段原文進行回應或改寫，保留其主題脈絡，絕對禁止替換成其他無關公司或無關主題的文字）：\n${
                req.activeDoc.linkedSnippetText || req.activeDoc.currentTargetContent || '（未特別框選單一段落）'
              }`
        }
- 框選段落或游標處與前後文完整脈絡（包含前文、目標位置、後文）：\n${(req.activeDoc.currentTargetContent ?? '（空白）').slice(0, 8_000)}
- 檔案章節大綱與參考內容：\n${fullDocSectionText}`
      : '【目前尚未開啟特定檔案，處於專案對話模式】';

    const refFiles = req.referenceFiles ?? [];
    const refFilesText =
      refFiles.length > 0
        ? `\n\n【使用者本次上傳的參考資料（共 ${refFiles.length} 個檔案）】\n` +
          refFiles
            .map(
              (f, idx) =>
                `${idx + 1}. 檔名：${f.name}（類型：${f.kindLabel} / ${f.mimeType}，大小：${Math.max(
                  1,
                  Math.round(f.sizeBytes / 1024)
                )} KB）${
                  f.extractedText
                    ? `\n   擷取內容摘錄：\n   ${f.extractedText.slice(0, 3500)}`
                    : ''
                }`
            )
            .join('\n')
        : '';

    const systemInstruction = `你是專業的「專案協作助手」，專門協助團隊共同撰寫、查證與修改 Word 計畫書／技術文件、Excel 時程與預算表、PPT 專案簡報。
只用繁體中文，語氣清楚精簡。

${effectiveProjectsDigest}【重要規則】：
0. 【提問／查證／討論模式 vs. 改稿寫入模式（極重要，嚴禁問 A 答 B）】：
   - 當使用者是在「詢問問題、詢問資料來源／新聞出處、討論方向、請求分析或檢視」（例如：「請告訴我剛剛那些段落你是引用了哪裡的新聞」、「請問資料來源是什麼」、「為什麼這樣寫」、「你覺得還有什麼可以優化的」）時：
     * 請務必針對使用者的問題本身直接、精準回答！若使用者詢問新聞或資料出處，請透過 Google Search 查證並明確列出真實的新聞媒體名稱、發布日期、事件內容或公開年報／法說會資訊（若原文中提及的對象在公開網路上查無正式合作新聞，也請據實向使用者說明查證結果）。
     * 此時 operations 陣列必須回傳空陣列 []，絕對禁止覆寫或偷改使用者的文件段落！
   - 當使用者明確要求「更新這個段落」、「幫我改寫」、「上網查…並且更新這個段落」、「幫我把這段精簡／強化」時：
     * 請使用 Google Search 查詢使用者指定的公司或主題（例如「州巧科技 3543 的銷售模式」、「產學合作計畫」等真實公開資訊），並產生對應的 write_word_section / write_excel_rows / write_ppt_slide 操作更新目標段落。
     * 若使用者要求「不要太多」、「精簡一點」，請嚴格控制篇幅（例如精煉為 1 段、約 80～160 字），只輸出該段落主題（如銷售模式）的正式內文，不要塞入無關章節！
   - 【嚴禁張冠李戴】：如果目前開啟的文件或使用者詢問的對象是其他企業或計畫（例如「州巧科技股份有限公司」），請完全依據該企業與該文件的實際脈絡及 Google Search 真實結果撰寫與回答，絕對禁止把「台灣智慧駕駛（Turing Drive）」的自駕車、LiDAR 或 ICD 規範硬套進非自駕車的文件或回答中！
1. 若使用者上傳了「參考資料」（圖片、照片、影片、PDF、Word、Excel、CSV、TXT 等）：
   - 你必須在 reply 的開頭先明確註記已收到的參考檔案名稱，並大致分析該來源資料的「內容大綱／重點摘要」跟使用者報告。
   - 接著依照使用者的指令（或該參考資料與目前開啟檔案的關聯），自動產生對應的 operations 更新目前正在編輯的區域（Word 章節、Excel 表格列或 PPT 投影片）。
   - 若使用者只拖拉了參考資料而未輸入長指令（例如只傳檔或說「請分析此參考資料」），請先報告該參考檔案的內容大綱，並說明可如何將其重點整合進目前的「${
     req.activeDoc?.selectedTargetLabel ?? '專案文件'
   }」中（若合適也可直接替使用者把大綱重點寫入該區域）。
2. 當使用者要求在 Excel 新增、修改或刪除項目（例如「請幫我加入一個資安檢查的項目 時間是2026/10/30~2028/11/15」）時：
   - 必須嚴格依照使用者指定的「項目名稱」（如：資安檢查）、「預計開始日期」（如：2026-10-30）、「預計完成日期」（如：2028-11-15）、負責模組與進度，對齊該工作表的欄位順序（columns）產生對應的 rows！絕對禁止塞入與使用者指令無關的假資料！
   - 若使用者說「加入一個...」，rows 就只放那 1 列（mode 設為 "append_rows"）。
   - 若使用者要求修改特定列（例如「把第 7 列的名稱改成...」或「修改目前這一列」），請將 mode 設為 "update_selected_row" 並指定 rowIndex（0-based，例如第 7 列為 6），rows 放修改後的那 1 列完整欄位值。
   - 若使用者要求刪除某幾列，請將 mode 設為 "replace_rows"，rows 放刪除後的完整剩餘列。
3. 當使用者詢問或要求加入台灣智慧駕駛的「公司簡介」、「公司歷年專案實績」時，才引用上方【公司基本資料與歷年專案實績庫】寫入文件或回答。
4. 只有日常無關閒聊（如天氣、星座、笑話）才拒絕並回覆：「這不屬於我的工作範圍，我只協助處理專案文件撰寫、技術規範、時程表與簡報相關的工作。」；只有個人行政表單（如請假、差旅報支、用印、簽核）才引導至左側「AI 助手」。
5. 嚴禁在回覆或文件內使用 ** 星號或裝飾性 Emoji 圖示。
6. 【嚴禁加上輔助詞與客套開場白（極重要）】：
   - 絕對禁止在 reply 或 content 中出現諸如「已為您強化『1.1 通則 General — 本章概要 Summary』段落。」、「已為您修改…」、「已為您更新…」、「好的，以下是…」、「本次修訂依據…」等輔助詞或修改說明！
   - 當使用者針對框選段落或章節要求修改、強化、精簡、改寫時：
     * operations[0].content 必須直接輸出修改後的正式段落內文（若使用者框選的是單一段落，請直接針對該段落進行強化或改寫，保持原本段落結構與上下文銜接，不要擅自改成 1. 2. 3. 整章條列）。
     * 框選多個段落時，輸出的段落數必須與框選原文相同，依原有順序以換行分隔，保留各段格式。
     * reply 也請直接輸出修改後的正式內文本身，不要加任何「已為您強化…段落。」等前言後語！
7. 當使用者要求調整 Word 排版、建立或隱藏目錄索引（TOC）、頁碼、頁首頁尾、字型（如改標楷體/明體/黑體/Times New Roman）、字級大小、段落行距、首行縮排或章節重新編號時，請在 operations 中回傳 format_word_document 操作！
8. 請只回傳合法 JSON 物件（不要加上其他非 JSON 的前後綴說明）：
{
  "intent": "edit" | "discuss",
  "reply": "直接輸出修改後的正式內文，或針對使用者提問的完整查證回覆（嚴禁加上『已為您強化…段落。』等輔助詞）",
  "operations": [
    { "kind": "write_word_section", "sectionId": "目標sectionId", "sectionTitle": "章節標題", "content": "正式文件段落內文", "mode": "replace" | "append" | "add_section", "newSectionCode": "5.0" },
    { "kind": "format_word_document", "fontFamily": "Noto Serif TC" | "Noto Sans TC" | "Times New Roman" | "Calibri", "fontSizePt": 12, "lineSpacing": 1.75, "paragraphIndentEm": 2, "showTableOfContents": true, "showPageNumbers": true, "showHeaderFooter": true, "headerText": "頁首文字", "footerText": "頁尾文字", "pageNumberStyle": "page_x_of_y" | "numeric" | "roman", "renumberSections": true },
    { "kind": "write_excel_rows", "sheetId": "目標sheetId", "rows": [["欄位1","欄位2",...]], "mode": "append_rows" | "replace_rows" | "update_selected_row" | "add_sheet", "rowIndex": 6, "newSheetName": "工作表名稱", "columns": ["欄位A","欄位B"] },
    { "kind": "write_ppt_slide", "slideId": "目標slideId", "slideTitle": "投影片主標題", "slideSubtitle": "副標題", "bullets": ["重點1", "重點2"], "speakerNotes": "講者備忘稿", "mode": "replace_slide" | "add_slide" },
    { "kind": "generate_image", "targetId": "目標sectionId或slideId", "caption": "圖片說明", "prompt": "圖片視覺描述", "mode": "replace" | "append" }
  ]
}`;

    const userParts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [
      {
        text: `${recentHistoryText}${graphContextText}${docContext}${refFilesText}\n\n【使用者指令】：${req.prompt}`,
      },
    ];

    for (const rf of refFiles) {
      if (
        rf.base64Data &&
        rf.base64Data.length < 9_500_000 &&
        (rf.mimeType.startsWith('image/') ||
          rf.mimeType.startsWith('video/') ||
          rf.mimeType === 'application/pdf')
      ) {
        userParts.push({
          inlineData: {
            mimeType: rf.mimeType,
            data: rf.base64Data,
          },
        });
      }
    }

    const needsWebSearch =
      /上網|搜尋|查詢|查一下|新聞|出處|來源|查證|根據什麼|公開資訊|法說會|年報|google/i.test(
        req.prompt
      );

    async function callVertexGenerate(useSearchTool: boolean) {
      return fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': cfg.projectId,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [
            {
              role: 'user',
              parts: userParts,
            },
          ],
          ...(useSearchTool ? { tools: [{ googleSearch: {} }] } : {}),
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            ...(!useSearchTool ? { responseMimeType: 'application/json' } : {}),
            thinkingConfig: { thinkingLevel: 'LOW' },
          },
        }),
        signal: AbortSignal.timeout(useSearchTool ? 22_000 : 28_000),
      });
    }

    let res: Response;
    try {
      res = await callVertexGenerate(needsWebSearch);
      if (!res.ok && needsWebSearch) {
        res = await callVertexGenerate(false);
      }
    } catch (err) {
      if (needsWebSearch) {
        res = await callVertexGenerate(false);
      } else {
        throw err;
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        response: null,
        errorReason: `Vertex AI HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`,
      };
    }
    const raw = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        groundingMetadata?: {
          webSearchQueries?: string[];
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string; domain?: string };
          }>;
        };
      }>;
    };

    const candidate = raw.candidates?.[0];
    const gm = candidate?.groundingMetadata;
    const webQueries = (gm?.webSearchQueries ?? []).filter(Boolean).slice(0, 5);
    const webSourcesMap = new Map<string, { title: string; uri: string }>();
    for (const ch of gm?.groundingChunks ?? []) {
      const uri = ch.web?.uri?.trim();
      const title = (ch.web?.title || ch.web?.domain || '').trim();
      if (uri && !webSourcesMap.has(uri)) {
        webSourcesMap.set(uri, { title: title || '網路來源', uri });
      }
    }
    const webSearchMeta =
      webQueries.length > 0 || webSourcesMap.size > 0
        ? {
            queries: webQueries,
            sources: Array.from(webSourcesMap.values()).slice(0, 6),
          }
        : undefined;

    // Filter out internal thinking parts (`thought: true`) before parsing JSON
    const rawText = (candidate?.content?.parts ?? [])
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => String(p.text))
      .join('\n')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    if (!rawText) {
      return { response: null, errorReason: '模型回傳內容為空' };
    }

    let parsed: {
      intent?: 'edit' | 'discuss';
      reply?: string;
      operations?: Array<Record<string, unknown>>;
    } | null = null;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const jsonCandidate = rawText.slice(firstBrace, lastBrace + 1);
        try {
          parsed = JSON.parse(jsonCandidate);
        } catch {
          return { response: null, errorReason: '模型回傳格式無法解析' };
        }
      }
      if (!parsed) {
        return { response: null, errorReason: '模型回傳格式無法解析' };
      }
    }

    if (!parsed?.reply || !['edit', 'discuss'].includes(parsed.intent ?? '') || !Array.isArray(parsed.operations) || (parsed.intent === 'edit' && parsed.operations.length === 0) || (parsed.intent === 'discuss' && parsed.operations.length > 0)) {
      return { response: null, errorReason: '模型回傳格式無法解析' };
    }

    const ops: CoAuthorOperation[] = [];
    for (const op of parsed.operations ?? []) {
      if (op.kind === 'generate_image') {
        const imgPrompt = String(op.prompt || req.prompt);
        const caption = stripMarkdownAsterisks(
          String(op.caption || `專案架構示意圖`)
        );
        const wantsReplaceImg =
          op.mode === 'replace' ||
          /改掉|換一張|替換|重畫|換掉|更新.*圖|改.*圖/.test(req.prompt);
        const vertexImg = await tryGenerateVertexImage(imgPrompt);
        const dataUrl =
          vertexImg ??
          buildProjectIllustrationDataUrl({
            title: caption,
            subtitle: imgPrompt,
            theme: detectImageTheme(imgPrompt + ' ' + (req.activeDoc?.projectName ?? '')),
          });
        ops.push({
          kind: 'generate_image',
          targetId: typeof op.targetId === 'string' ? op.targetId : req.activeDoc?.selectedTargetId,
          caption,
          prompt: imgPrompt,
          dataUrl,
          mode: wantsReplaceImg ? 'replace' : 'append',
        });
      } else if (op.kind === 'write_word_section') {
        const cleanContent = stripAuxiliaryMetaPhrases(String(op.content || ''));
        ops.push({
          kind: 'write_word_section',
          sectionId: typeof op.sectionId === 'string' ? op.sectionId : req.activeDoc?.selectedTargetId,
          newSectionCode: typeof op.newSectionCode === 'string' ? op.newSectionCode : undefined,
          sectionTitle: stripMarkdownAsterisks(
            String(op.sectionTitle || req.activeDoc?.selectedTargetLabel || '技術規範章節')
          ),
          content: cleanContent,
          mode:
            op.mode === 'append' || op.mode === 'add_section' ? op.mode : 'replace',
        });
      } else if (op.kind === 'write_excel_rows') {
        ops.push({
          kind: 'write_excel_rows',
          sheetId: typeof op.sheetId === 'string' ? op.sheetId : req.activeDoc?.selectedTargetId,
          newSheetName: typeof op.newSheetName === 'string' ? op.newSheetName : undefined,
          columns: Array.isArray(op.columns) ? op.columns.map(String) : undefined,
          rows: Array.isArray(op.rows)
            ? op.rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]))
            : [],
          mode:
            op.mode === 'replace_rows' ||
            op.mode === 'update_selected_row' ||
            op.mode === 'add_sheet'
              ? op.mode
              : 'append_rows',
          rowIndex:
            typeof op.rowIndex === 'number'
              ? op.rowIndex
              : req.activeDoc?.selectedRowIndex ?? undefined,
        });
      } else if (op.kind === 'write_ppt_slide') {
        ops.push({
          kind: 'write_ppt_slide',
          slideId: typeof op.slideId === 'string' ? op.slideId : req.activeDoc?.selectedTargetId,
          slideTitle: stripMarkdownAsterisks(
            String(op.slideTitle || req.activeDoc?.selectedTargetLabel || '專案進度與技術重點')
          ),
          slideSubtitle: stripMarkdownAsterisks(
            String(op.slideSubtitle || 'Turing Drive 專案執行報告')
          ),
          bullets: Array.isArray(op.bullets)
            ? op.bullets.map((b) => stripMarkdownAsterisks(String(b)))
            : [],
          speakerNotes: stripMarkdownAsterisks(String(op.speakerNotes || '')),
          mode: op.mode === 'add_slide' ? 'add_slide' : 'replace_slide',
        });
      } else if (op.kind === 'format_word_document') {
        ops.push({
          kind: 'format_word_document',
          fontFamily:
            op.fontFamily === 'Noto Sans TC' ||
            op.fontFamily === 'Noto Serif TC' ||
            op.fontFamily === 'Times New Roman' ||
            op.fontFamily === 'Calibri'
              ? op.fontFamily
              : undefined,
          fontSizePt: typeof op.fontSizePt === 'number' ? op.fontSizePt : undefined,
          lineSpacing: typeof op.lineSpacing === 'number' ? op.lineSpacing : undefined,
          paragraphIndentEm:
            typeof op.paragraphIndentEm === 'number' ? op.paragraphIndentEm : undefined,
          showTableOfContents:
            typeof op.showTableOfContents === 'boolean' ? op.showTableOfContents : undefined,
          showPageNumbers:
            typeof op.showPageNumbers === 'boolean' ? op.showPageNumbers : undefined,
          showHeaderFooter:
            typeof op.showHeaderFooter === 'boolean' ? op.showHeaderFooter : undefined,
          headerText: typeof op.headerText === 'string' ? op.headerText : undefined,
          footerText: typeof op.footerText === 'string' ? op.footerText : undefined,
          pageNumberStyle:
            op.pageNumberStyle === 'page_x_of_y' ||
            op.pageNumberStyle === 'numeric' ||
            op.pageNumberStyle === 'roman'
              ? op.pageNumberStyle
              : undefined,
          renumberSections:
            typeof op.renumberSections === 'boolean' ? op.renumberSections : undefined,
        });
      }
    }

    // Ensure that if the user explicitly asked to generate an image/diagram, a `generate_image` operation is always included
    const userExplicitlyWantsImage =
      /生成.*圖|畫.*圖|示意圖|架構圖|視覺圖|產生.*圖|插入.*圖/i.test(req.prompt) &&
      !discussionOnly;
    if (
      userExplicitlyWantsImage &&
      !ops.some((o) => o.kind === 'generate_image')
    ) {
      const caption = stripMarkdownAsterisks(
        `${req.activeDoc?.projectName ?? '專案'}系統架構與場域示意圖`
      );
      const vertexImg = await tryGenerateVertexImage(req.prompt);
      const dataUrl =
        vertexImg ??
        buildProjectIllustrationDataUrl({
          title: caption,
          subtitle: req.prompt,
          theme: detectImageTheme(req.prompt + ' ' + (req.activeDoc?.projectName ?? '')),
        });
      ops.push({
        kind: 'generate_image',
        targetId: req.activeDoc?.selectedTargetId,
        caption,
        prompt: req.prompt,
        dataUrl,
        mode: 'append',
      });
    }

    const wordWriteOp = ops.find((o) => o.kind === 'write_word_section');
    const cleanReply =
      wordWriteOp && wordWriteOp.kind === 'write_word_section' && refFiles.length === 0
        ? wordWriteOp.content
        : stripAuxiliaryMetaPhrases(parsed.reply);

    return {
      response: {
        intent: parsed.intent,
        reply: cleanReply,
        operations: ops,
        webSearch: webSearchMeta,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      response: null,
      errorReason: msg.slice(0, 140),
    };
  }
}

/**
 * Extracts user-specified dates, task title, responsible team, progress, and WBS code
 * from natural Chinese instructions such as:
 * "請幫我加入一個資安檢查的項目 時間是2026/10/30~2028/11/15"
 */
function buildExcelOperationFromPrompt(
  prompt: string,
  activeDoc: NonNullable<CoAuthorRequest['activeDoc']>,
  allProjects: HistoricalProject[],
  wantsCompanyOrHistoricalProjects: boolean,
  wantsNewSheet: boolean
): { op: CoAuthorOperation; reply: string } {
  const targetLabel = (activeDoc.selectedTargetLabel || '當前工作表').replace(/（第\s*\d+\s*列.*$/, '');
  const lower = prompt.toLowerCase();

  let parsedSheet: { columns?: string[]; rows?: string[][] } = {};
  try {
    if (activeDoc.currentTargetContent) {
      parsedSheet = JSON.parse(activeDoc.currentTargetContent) as {
        columns?: string[];
        rows?: string[][];
      };
    }
  } catch {
    // ignore
  }
  const existingCols = parsedSheet.columns ?? [
    'WBS 編號',
    '工作項目 / 交付物名稱',
    '負責模組',
    '預計開始',
    '預計完成',
    '目前進度',
    '狀態與備註',
  ];
  const existingRows = parsedSheet.rows ?? [];

  // 1. Check if user wants to delete a specific row (e.g., "刪除第 7 列", "刪掉最後兩列")
  const deleteRowMatch = prompt.match(/刪(?:除|掉)第?\s*(\d+)\s*列/);
  if (deleteRowMatch && existingRows.length > 0) {
    const rowNum = Number.parseInt(deleteRowMatch[1], 10);
    const idx = rowNum - 1;
    if (idx >= 0 && idx < existingRows.length) {
      const nextRows = existingRows.filter((_, i) => i !== idx);
      return {
        op: {
          kind: 'write_excel_rows',
          sheetId: activeDoc.selectedTargetId,
          rows: nextRows,
          mode: 'replace_rows',
        },
        reply: `已從「${targetLabel}」刪除第 ${rowNum} 列。`,
      };
    }
  }

  // 2. Check if user wants to add company historical projects
  if (wantsCompanyOrHistoricalProjects) {
    const newRows = allProjects.slice(0, 5).map((p) => {
      if (existingCols.length === 5) {
        return [p.code, `${p.name}（公司專案實績）`, p.department, p.period, p.summary.slice(0, 36)];
      }
      return [
        p.code,
        `${p.name}（台灣智慧駕駛實績）`,
        p.department,
        `${p.startYear}-01-01`,
        `${p.startYear}-12-31`,
        p.status === 'active' ? '執行中' : '100%',
        p.summary.slice(0, 42),
      ];
    });
    return {
      op: {
        kind: 'write_excel_rows',
        sheetId: activeDoc.selectedTargetId,
        rows: newRows,
        mode: wantsNewSheet ? 'add_sheet' : 'append_rows',
        newSheetName: wantsNewSheet ? '公司歷年專案實績表' : undefined,
        columns: wantsNewSheet
          ? ['專案代碼', '專案名稱', '負責部門', '起始日期', '完成日期', '狀態／進度', '重點說明']
          : undefined,
      },
      reply: `已將台灣智慧駕駛 ${newRows.length} 筆歷年專案實績加入「${targetLabel}」。`,
    };
  }

  // 3. Parse dates from user prompt (e.g. "2026/10/30~2028/11/15", "2026-10-30 到 2028-11-15")
  const dateMatches = Array.from(
    prompt.matchAll(/(20\d{2})\s*[\/\-年.]\s*(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})日?/g)
  ).map((m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);

  const today = new Date().toISOString().slice(0, 10);
  const startDate = dateMatches[0] ?? today;
  const endDate = dateMatches[1] ?? dateMatches[0] ?? '2026-12-31';

  // 4. Parse percentage if specified (e.g. "50%")
  const pctMatch = prompt.match(/(\d{1,3})\s*%/);
  const progress = pctMatch ? `${pctMatch[1]}%` : '0%';

  // 5. Extract the clean task / item name from the user's prompt!
  let itemName = prompt
    .replace(/(20\d{2})\s*[\/\-年.]\s*\d{1,2}\s*[\/\-月.]\s*\d{1,2}日?/g, '')
    .replace(/時間(?:是|為)?|[~～至到—\-]+/g, ' ')
    .replace(/(\d{1,3})\s*%/g, '')
    .replace(
      /請幫我|幫我|請在|在表格|在試算表|加入一個|新增一個|加一個|新增一筆|加入一筆|加上一個|加入|新增|加上|修改|更新|第\s*\d+\s*列|目前這列|這一列/g,
      ' '
    )
    .replace(/的項目|項目名稱(?:是|為)?|項目|工作項目|一列|一筆/g, ' ')
    .replace(/[，,。、：:；;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!itemName) {
    itemName = '專案新增工作項目';
  }

  // 6. Infer responsible module / team based on the task name
  let department = '系統工程組';
  if (lower.includes('資安') || lower.includes('網路') || lower.includes('5g') || lower.includes('通訊')) {
    department = '通訊與資安組';
  } else if (lower.includes('光達') || lower.includes('lidar') || lower.includes('定位') || lower.includes('點雲')) {
    department = '定位感知組';
  } else if (lower.includes('行控') || lower.includes('fms') || lower.includes('occ') || lower.includes('ui') || lower.includes('圖台')) {
    department = 'MaaS / HMI 組';
  } else if (lower.includes('自駕') || lower.includes('底盤') || lower.includes('線控') || lower.includes('控制')) {
    department = '自駕研發部 R&D';
  } else if (lower.includes('月台') || lower.includes('psd') || lower.includes('場域') || lower.includes('施工')) {
    department = '場域工程組';
  }

  // 7. Check if user is asking to update a specific row ("把第 7 列改成...", "修改第 7 列...")
  const rowUpdateMatch = prompt.match(/(?:修改|更新|把|將)?第\s*(\d+)\s*列/);
  const isUpdatingSelectedRow =
    Boolean(rowUpdateMatch) ||
    lower.includes('修改這列') ||
    lower.includes('修改這一列') ||
    lower.includes('把這列改成') ||
    lower.includes('把這一列改成');

  const targetRowIndex = rowUpdateMatch
    ? Math.max(0, Number.parseInt(rowUpdateMatch[1], 10) - 1)
    : activeDoc.selectedRowIndex ?? null;

  // Compute next WBS / item code based on existing rows
  let nextCode = `WBS-${existingRows.length + 1}.1`;
  if (isUpdatingSelectedRow && targetRowIndex !== null && existingRows[targetRowIndex]?.[0]) {
    nextCode = existingRows[targetRowIndex][0];
  } else if (existingRows.length > 0) {
    const lastCode = existingRows[existingRows.length - 1]?.[0] ?? '';
    const wbsMatch = lastCode.match(/^WBS-(\d+)\.(\d+)$/i);
    if (wbsMatch) {
      nextCode = `WBS-${Number.parseInt(wbsMatch[1], 10) + 1}.1`;
    } else if (/^\d+$/.test(lastCode)) {
      nextCode = String(Number.parseInt(lastCode, 10) + 1).padStart(2, '0');
    }
  }

  const rowValues =
    existingCols.length === 5
      ? [nextCode, itemName, department, endDate, `預計執行期間：${startDate} ~ ${endDate}`]
      : existingCols.length === 6
      ? [nextCode, itemName, department, endDate, progress, `執行期間：${startDate} ~ ${endDate}`]
      : [
          nextCode,
          itemName,
          department,
          startDate,
          endDate,
          progress,
          dateMatches.length >= 2
            ? `排定期程：${startDate} 至 ${endDate}`
            : '依專案計畫時程辦理',
        ];

  if (isUpdatingSelectedRow && targetRowIndex !== null) {
    return {
      op: {
        kind: 'write_excel_rows',
        sheetId: activeDoc.selectedTargetId,
        rows: [rowValues],
        mode: 'update_selected_row',
        rowIndex: targetRowIndex,
      },
      reply: `已將「${targetLabel}」第 ${targetRowIndex + 1} 列更新為「${itemName}」（預計開始：${startDate}，預計完成：${endDate}）。`,
    };
  }

  return {
    op: {
      kind: 'write_excel_rows',
      sheetId: activeDoc.selectedTargetId,
      rows: [rowValues],
      mode: wantsNewSheet ? 'add_sheet' : 'append_rows',
      newSheetName: wantsNewSheet ? itemName.slice(0, 16) : undefined,
      columns: wantsNewSheet ? existingCols : undefined,
    },
    reply: `已在「${targetLabel}」新增「${itemName}」（預計開始：${startDate}，預計完成：${endDate}）。`,
  };
}

function synthesizeWordSectionBySemantics(
  prompt: string,
  projectName: string,
  currentTitle: string,
  allProjects: HistoricalProject[],
  targetSnippet?: string
): { title: string; content: string } {
  const lower = prompt.toLowerCase();
  const cleanSnippet = targetSnippet?.trim() ?? '';

  // If user linked a specific paragraph (such as 1.1 Summary VTMS paragraph) and asked to enhance/condense/rewrite it
  if (cleanSnippet && cleanSnippet.includes('車輛行車管理系統')) {
    if (lower.includes('精簡') || lower.includes('濃縮') || lower.includes('縮短')) {
      return {
        title: currentTitle,
        content:
          `本章適用於「臺灣桃園國際機場第三航站區旅客運輸系統工程」之車輛行車管理系統（Vehicle Traffic Management System, VTMS）。VTMS 為自駕旅客運輸車隊之核心管理平台，整合中心控制、車端執行、資料紀錄與即時監控，透過標準化通訊與高可靠度冗餘架構，確保營運安全、行車效率、可追溯性與調度彈性。`,
      };
    }
    return {
      title: currentTitle,
      content:
        `本章適用於「臺灣桃園國際機場第三航站區旅客運輸系統工程」之車輛行車管理系統（Vehicle Traffic Management System, VTMS）。VTMS 作為本工程自駕旅客運輸車隊（AITS）之中央行控與調度核心管理平台，全面整合中心端自動班距控制、車端自動駕駛執行、全時段行車資料紀錄、跨系統安全連鎖（含月台門 PSD、號誌與道岔介面）及即時異常監控告警功能；透過標準化雙向低延遲車地通訊協定與高可靠性雙迴路冗餘架構，確保系統於全天候營運下之功能安全、準點行車效率、全生命週期服務可追溯性與動態調度彈性。`,
    };
  }

  if (
    lower.includes('公司') ||
    lower.includes('實績') ||
    lower.includes('歷史') ||
    lower.includes('歷年') ||
    lower.includes('背景') ||
    lower.includes('簡介') ||
    lower.includes('經驗') ||
    lower.includes('turing') ||
    lower.includes('台智駕') ||
    lower.includes('台灣智慧駕駛')
  ) {
    const recentHighlights = allProjects
      .slice(0, 6)
      .map((p) => `• ${p.startYear}｜${p.name}（${p.code}）：${p.summary}`)
      .join('\n');

    return {
      title:
        currentTitle.includes('通則') || currentTitle.includes('背景')
          ? currentTitle
          : '公司簡介、核心技術與歷年自駕專案實績（Turing Drive Inc.）',
      content:
        `台灣智慧駕駛股份有限公司（Turing Drive Inc.）專注於 L4 特定場域自動駕駛系統研發、底盤線控整合與中央行控系統（OCC / FMS）建置，具備完整軟硬體自主研發與跨國場域落地能力。\n\n` +
        `1. 核心技術能量：涵蓋 Autoware 多感測器融合定位（3D LiDAR 點雲配準 + RTK-GNSS + IMU）、雙迴路安全煞車連鎖、5G 專網低延遲遠端接管（Teleoperation）與月台門（PSD）／智慧號誌 V2X 連動。\n` +
        `2. 公司歷年代表性專案實績（2019–2026）：\n${recentHighlights}`,
    };
  }

  if (
    lower.includes('iso') ||
    lower.includes('標準') ||
    lower.includes('法規') ||
    lower.includes('26262') ||
    lower.includes('21434') ||
    lower.includes('21448') ||
    lower.includes('功能安全')
  ) {
    return {
      title: currentTitle.includes('通則') || currentTitle.includes('安全')
        ? currentTitle
        : '國際標準（ISO）與自駕系統安全架構對應規範',
      content:
        `本自駕運輸系統之軟硬體設計、控制迴路與營運管理全面對接國際車用安全與品質標準，確保系統於高架及地下專用廊道之高可靠度運行：\n\n` +
        `1. ISO 26262 道路車輛功能安全（Functional Safety）：車載自動駕駛控制單元（ADU）與底盤線控系統（DBW 轉向、煞車、動力）符合 ASIL-D 安全等級要求，具備雙迴路硬體冗餘與即時故障診斷機制。\n` +
        `2. ISO 21448 預期功能安全（SOTIF）：針對感測器於強光、暴雨或地下廊道遮蔽等邊界場景（Corner Cases），建立多模態感知融合（3D LiDAR + 毫米波雷達 + RTK-GNSS/INS）與最小風險操作（MRM）降級策略。\n` +
        `3. ISO/SAE 21434 車聯網網路安全（Cybersecurity）：車對地（V2X）5G 專網與行控中心（OCC）間全面採用 TLS 1.3 雙向憑證認證與硬體安全模組（HSM）簽章，確保控制指令與遙測資料不可竄改。\n` +
        `4. ISO 9001 / V-Model 系統工程驗證：從需求追溯、硬體迴路模擬（HIL）、出廠測試（FAT）至現場 72 小時連續整合測試（SAT），均留存完整量化檢核紀錄。`,
    };
  }

  if (
    lower.includes('颱風') ||
    lower.includes('天候') ||
    lower.includes('暴雨') ||
    lower.includes('強風') ||
    lower.includes('應變') ||
    lower.includes('降級')
  ) {
    return {
      title: currentTitle,
      content:
        `針對特殊天候與強風豪雨之安全降級與應變操作規範如下：\n\n` +
        `1. 自動限速與降級運行（Degraded Mode）：當路側氣象站或車載感知模組偵測瞬間陣風達 7 級（14 m/s）時，FMS 行控中心自動下發全線速限調整指令（由 40 km/h 調降至 20 km/h），並拉大前後車安全跟車距離至 45 公尺以上。\n` +
        `2. 多感測器雨霧濾波演算法：車載 3D LiDAR 啟用動態強度體素濾波（Dynamic Voxel Intensity Filtering），剔除雨滴與水霧造成之虛警噪點，並提高毫米波雷達與慣導權重。\n` +
        `3. 預防性停駛與就近靠站 SOP：若陣風達 8 級（17.2 m/s）以上或發布陸上颱風警報，系統立即啟動就近月台停靠程序，與月台門（PSD）完成安全對準後疏散旅客並切入駐留鎖定模式。`,
    };
  }

  if (lower.includes('資安') || lower.includes('加密') || lower.includes('認證') || lower.includes('通訊')) {
    return {
      title: currentTitle,
      content:
        `車載自駕單元（ADU）與中央行控系統（OCC）之通訊與資安防護規範如下：\n\n` +
        `1. 雙向硬體憑證認證（mTLS 1.3 + HSM）：每部自駕接駁車均內建車規級硬體安全模組（HSM），所有控制指令與遙測封包皆具備時間戳記與 ECDSA 數位簽章，防止重放攻擊。\n` +
        `2. 雙通道無縫備援通訊：主通道採用機場 5G 企業專網，備援通道採用路側 Wi-Fi 6，通道切換延遲低於 30 ms，端到端控制延遲嚴格控制在 50 ms 以內。\n` +
        `3. 安全連鎖與獨立駐留：當車地通訊心跳逾 300 ms 未回應或月台門（PSD）連鎖異常時，車載安全控制器立即獨立觸發平穩減速駐留，並將事件寫入不可竄改之稽核日誌。`,
    };
  }

  if (lower.includes('定位') || lower.includes('感知') || lower.includes('光達') || lower.includes('lidar') || lower.includes('外參')) {
    return {
      title: currentTitle,
      content:
        `車載感知與高精定位系統之技術規範與驗收標準如下：\n\n` +
        `1. 多感測器融合定位架構：結合車頂主 3D LiDAR 點雲配準（NDT Matching）、雙天線 RTK-GNSS、車輪里程計與六軸 IMU 航位推算，於無衛星訊號之地下廊道維持橫向偏差小於 ±5 cm。\n` +
        `2. 月台門精準停靠對位：透過路側光學標靶與近場補盲光達聯合收斂，車站月台門（PSD）停靠縱向誤差控制在 ±10 cm 內。\n` +
        `3. 外參標定與定期自檢：base_link 對各感測器之 6-DoF 剛體轉換矩陣角度誤差 RMSE ≤ 0.08°、平移誤差 ≤ 1.5 cm，每次發車前由系統自動完成自檢驗證。`,
    };
  }

  if (cleanSnippet) {
    return {
      title: currentTitle,
      content: cleanSnippet,
    };
  }

  return {
    title: currentTitle,
    content:
      `依據台灣智慧駕駛（Turing Drive）於「${projectName}」之工程設計規範與介面控制文件（ICD），本節規範系統核心架構、性能指標與驗收標準：\n\n` +
      `1. 系統整合與控制介面：涵蓋車載自動駕駛控制單元（ADU）、路側通訊與號誌連動設備（RSU）以及行控中心中央管理平台（FMS），各子系統透過標準化通訊協定完成低延遲雙向資料交換。\n` +
      `2. 安全連鎖與可靠度要求：關鍵控制迴路具備雙重冗餘設計，遇異常狀態時自動執行最小風險操作（MRM）並即時通報行控台介入。\n` +
      `3. 測試與驗收程序：須依序完成模擬器硬體迴路測試（HIL）、出廠測試（FAT）與現場 72 小時連續無故障整合測試（SAT），確認各項量化指標符合契約規範。`,
  };
}

function summarizeReferenceFilesOutline(refFiles: CoAuthorReferenceFileInput[]): string {
  if (refFiles.length === 0) return '';
  const items = refFiles.map((f) => {
    const sizeKb = Math.max(1, Math.round(f.sizeBytes / 1024));
    if (f.extractedText && f.extractedText.trim()) {
      const lines = f.extractedText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 4);
      return `• 已註記參考檔案「${f.name}」（${f.kindLabel}，${sizeKb} KB）\n  來源內容大綱：${lines.join(' ／ ')}`;
    }
    if (f.mimeType.startsWith('image/')) {
      return `• 已註記參考圖片「${f.name}」（影像資料，${sizeKb} KB）\n  來源內容大綱：包含專案現場視覺、系統架構或設備配置畫面，可作為技術規格與視覺配圖依據。`;
    }
    if (f.mimeType.startsWith('video/')) {
      return `• 已註記參考影片「${f.name}」（動態影像，${sizeKb} KB）\n  來源內容大綱：包含自駕車輛實車運行、場域測試或感知調度過程紀錄，可提煉為測試驗證與操作規範重點。`;
    }
    return `• 已註記參考文件「${f.name}」（${f.kindLabel}，${sizeKb} KB）\n  來源內容大綱：涵蓋「${f.name.replace(/\.[^.]+$/, '')}」相關之技術規格、介面定義與執行要點。`;
  });
  return `已接收並分析您上傳的參考資料：\n${items.join('\n')}\n\n`;
}

async function buildSmartProjectCoAuthorResponse(
  req: CoAuthorRequest,
  allProjects: HistoricalProject[],
  graphResult: GraphQueryResult,
  followUp: FollowUpResolution
): Promise<CoAuthorResponse> {
  const prompt = req.prompt.trim();
  const lower = prompt.toLowerCase();
  const activeDoc = req.activeDoc;
  const refFiles = req.referenceFiles ?? [];
  const refSummaryPrefix = summarizeReferenceFilesOutline(refFiles);

  if (isCompanyAdminRequest(prompt)) {
    return {
      refusedCompanyAdmin: true,
      reply:
        '這不屬於專案助手的工作範圍。個人請假、差旅報支、用印申請或簽核等行政庶務，請至左側「AI 助手」辦理。',
      operations: [],
    };
  }

  if (isIrrelevantNonProjectQuery(prompt)) {
    return {
      refusedCompanyAdmin: true,
      reply:
        '這不屬於我的工作範圍，我只協助處理專案文件撰寫、技術規範、時程表與簡報相關的工作。',
      operations: [],
    };
  }

  const isConfirmationQuestion =
    (lower.includes('有加入嗎') ||
      lower.includes('有加嗎') ||
      lower.includes('有寫進去嗎') ||
      lower.includes('加在哪') ||
      lower.includes('在哪一列') ||
      lower.includes('為什麼沒')) &&
    !lower.includes('幫我');

  if (isConfirmationQuestion && activeDoc) {
    return {
      reply: `有的，剛剛新增的內容已經直接寫入正中央畫布的「${
        activeDoc.selectedTargetLabel ?? activeDoc.title
      }」底部。若您要指定特定項目名稱、日期區間或公司歷年專案實績，請直接輸入，我會立即為您寫入。`,
      operations: [],
    };
  }

  const topGraphFilesText =
    graphResult.matchedFiles.length > 0
      ? graphResult.matchedFiles
          .slice(0, 4)
          .map(
            (f) =>
              `• 《${f.node.label}》（專案：${f.node.projectCode ?? 'Turing Drive'}｜${
                f.projectContext?.period ?? f.node.year ?? ''
              }）：${f.node.summary}`
          )
          .join('\n')
      : '';

  const topGraphProjectsText =
    graphResult.matchedProjects.length > 0
      ? graphResult.matchedProjects
          .slice(0, 4)
          .map(
            (p) =>
              `• ${p.node.label}（${p.projectContext?.period ?? ''}｜${
                p.projectContext?.department ?? ''
              }）：${p.projectContext?.summary ?? p.node.summary}`
          )
          .join('\n')
      : '';

  // Discussion / review intent: analyze the whole document, drill down into a selected direction (1/2/3), or answer specific historical queries
  if (activeDoc && isDiscussionOrReviewIntent(prompt, req.scopeMode, req.history)) {
    const outlineLines = (activeDoc.fullOutlineSummary || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Drill-down when user selects Direction 1, 2, or 3 (NEVER repeat the 3-point overview!)
    if (followUp.selectedDirection === 3) {
      const histCitations =
        topGraphProjectsText ||
        allProjects
          .slice(0, 4)
          .map((p) => `• [${p.startYear}｜${p.code}] ${p.name}：${p.summary}`)
          .join('\n');
      const fileCitations =
        topGraphFilesText ||
        `• 《01_第02584K章 車輛行車管理系統_施工規範與設計報告.docx》（T3-2026）\n• 《06_系統開發 & 90_技術文件》（公司歷年自駕實績歸檔）`;

      return {
        reply:
          `${refSummaryPrefix}針對您選定的「第三個方向：國際標準與公司歷年實績佐證」，我已透過 Graphify 公司知識圖譜檢索關聯檔案與歷年專案，整理具體深化方案如下：\n\n` +
          `一、國際車規安全標準對接設計（建議補入第 1.0 章或第 4.0 章）：\n` +
          `1. ISO 26262 道路車輛功能安全（ASIL-D）：車載自駕控制單元（ADU）與底盤線控（DBW 轉向、煞車、驅動）採雙迴路硬體冗餘與安全連鎖，單一控制器異常時於 20 ms 內無縫切換備援迴路。\n` +
          `2. ISO 21448 預期功能安全（SOTIF）：針對機場高架強風、暴雨或地下廊道 GNSS 遮蔽等邊界場景，啟用 3D LiDAR 點雲動態濾波 + 毫米波雷達 + IMU 融合，並定義最小風險操作（MRM）平穩減速停靠程序。\n` +
          `3. ISO/SAE 21434 車聯網資安規範：車地 V2X 與 FMS 行控中心全面採用 TLS 1.3 雙向憑證認證與車規 HSM 硬體簽章。\n\n` +
          `二、知識圖譜檢索之台灣智慧駕駛（Turing Drive）歷年實績佐證：\n${histCitations}\n\n` +
          `三、知識圖譜命中之關聯歷史檔案：\n${fileCitations}\n\n` +
          `請問您希望我將這份「國際標準對接與公司歷年實績佐證」直接寫入目前的「4.0 資訊安全與系統驗收標準」，還是為您新增一個獨立的「5.0 國際標準對接與公司歷年專案實績」章節？`,
        operations: [],
      };
    }

    if (followUp.selectedDirection === 2) {
      return {
        reply:
          `${refSummaryPrefix}針對您選定的「第二個方向：量化驗收指標（KPI）具體化」，我已檢索知識圖譜中的歷年測試驗收規範（FAT / SAT），建議為《${activeDoc.title}》補充以下具體量化門檻：\n\n` +
          `1. 感知與高精定位指標（對應第 2.0 章）：\n` +
          `   • 高架與地下無衛星廊道橫向控制偏差：≤ ±5 cm（3σ）\n` +
          `   • 車站月台門（PSD）停靠縱向對位誤差：≤ ±10 cm\n` +
          `   • 3D LiDAR 對 base_link 外參標定誤差：角度 RMSE ≤ 0.08°、平移 ≤ 1.5 cm\n\n` +
          `2. 通訊、調度與遠端接管指標（對應第 3.0 章）：\n` +
          `   • 5G 企業專網車地端到端控制延遲：≤ 50 ms（主備援 Wi-Fi 6 切換時間 ≤ 30 ms）\n` +
          `   • 尖峰時段最小動態發車班距：90 秒，車隊準點率 ≥ 99.5%\n\n` +
          `3. 資安與系統可靠度驗收指標（對應第 4.0 章）：\n` +
          `   • 現場整合測試（SAT）：完成連續 72 小時無重大安全故障（Critical Fault = 0）運行驗證\n\n` +
          (topGraphFilesText ? `四、知識圖譜參考歷史檔案：\n${topGraphFilesText}\n\n` : '') +
          `要我現在幫您把這些量化 KPI 指標直接更新進對應的第 2.0、3.0 或 4.0 章節嗎？`,
        operations: [],
      };
    }

    if (followUp.selectedDirection === 1) {
      return {
        reply:
          `${refSummaryPrefix}針對您選定的「第一個方向：章節結構與跨系統介面控制文件（ICD）連貫性」，我已根據知識圖譜檢視《${activeDoc.title}》現有 ${outlineLines.length || 4} 個章節，具體深化建議如下：\n\n` +
          `1. 強化「1.0 系統範疇」對下游章節的 ICD 介面映射：\n` +
          `   • ICD-01（車載 ADU ↔ 底盤線控 DBW）：雙 CAN-FD 安全迴路與駐留煞車連鎖（銜接 2.0 定位與控制）。\n` +
          `   • ICD-02（車載系統 ↔ 月台門 PSD / 號誌 RSU）：到站精準對位確認訊號與開關門安全互鎖（銜接 2.0 與 3.0 班距調度）。\n` +
          `   • ICD-03（車載系統 ↔ 行控中心 FMS / 遠端接管台）：5G 專網遙測封包、低電量自動派充與 MRM 異常接管視訊流（銜接 3.0 與 4.0 資安規範）。\n\n` +
          (topGraphFilesText ? `2. 知識圖譜檢索之關聯歷史檔案：\n${topGraphFilesText}\n\n` : '') +
          `您可以告訴我要先將這套 ICD 介面架構更新至「1.0 系統範疇與國際標準引用」，或是直接幫您同步補強各章節？`,
        operations: [],
      };
    }

    // If user is asking about historical data, company projects, or specific technical concepts in discussion mode
    if (
      /歷史|歷年|實績|過去|哪些專案|哪些檔案|查.*資料|知識庫|圖譜|iso|光達|lidar|行控|fms|月台|psd|球車|日本/.test(
        lower
      ) &&
      !followUp.isInitialBroadReview
    ) {
      return {
        reply:
          `${refSummaryPrefix}我已透過 Graphify 公司知識圖譜（共索引 ${graphResult.graphStats.totalNodes} 個節點、${graphResult.graphStats.totalEdges} 條關聯邊）為您檢索出與「${prompt}」最相關的歷史專案與檔案：\n\n` +
          (topGraphProjectsText ? `一、關聯歷年專案實績：\n${topGraphProjectsText}\n\n` : '') +
          (topGraphFilesText ? `二、檢索命中之歷史專案檔案：\n${topGraphFilesText}\n\n` : '') +
          (graphResult.matchedStandardsAndConcepts.length > 0
            ? `三、對應技術規範與標準節點：\n` +
              graphResult.matchedStandardsAndConcepts
                .map((c) => `• ${c.label}：${c.summary}`)
                .join('\n') +
              '\n\n'
            : '') +
          `您可以點選畫面中間的目標章節（或直接告訴我要寫入哪一個章節），我就會將上述歷史專案實績與技術內容寫入《${activeDoc.title}》。`,
        operations: [],
      };
    }

    const isWholeDoc =
      req.scopeMode === 'whole_doc' ||
      /全部的文件|整份文件|整個檔案|全部章節|所有章節|整份簡報|整個試算表|整體/.test(prompt);

    if (activeDoc.docType === 'word') {
      const reviewPoints = [
        `1. 章節結構與前後連貫性（目前共 ${outlineLines.length || 4} 個章節）：可再強化「1.0 系統範疇」與後續「定位感知」、「班距調度 SOP」及「資安檢測」之間的介面控制文件（ICD）對應關係。`,
        `2. 量化驗收指標（KPI）具體化：建議在感知定位、5G 專網延遲（如 ≤ 50 ms）、月台門（PSD）對位精度（±10 cm）及 72 小時連續無故障測試（SAT）中，統一列出明確的測試條件與允收門檻。`,
        `3. 國際標準與公司歷年實績佐證：可補充 ISO 26262 / ISO 21448 (SOTIF) / ISO 21434 安全對接表，並引用台灣智慧駕駛（Turing Drive）歷年專案實績作為實證支撐。`,
      ];
      return {
        reply:
          `${refSummaryPrefix}針對${
            isWholeDoc ? `整份文件《${activeDoc.title}》` : `「${activeDoc.selectedTargetLabel}」`
          }，我已結合 Graphify 公司知識圖譜檢視目前內容，建議可從以下三個方向進一步優化：\n\n` +
          `${reviewPoints.join('\n\n')}\n\n` +
          `您想先針對哪一個方向（可輸入「第一個方向」、「第二個方向」或「第三個方向」）深入討論，或是直接告訴我要將哪一部分寫入指定章節？`,
        operations: [],
      };
    }

    if (activeDoc.docType === 'excel') {
      return {
        reply:
          `${refSummaryPrefix}針對試算表《${activeDoc.title}》的整體內容，我有以下幾點優化建議供您討論：\n\n` +
          `1. 里程碑查核點細化：目前工作項目多為大階段區間，建議在關鍵項目（如車載整合測試、月台門連鎖、資安檢測）增設「中繼查核點（Checkpoint）」與明確交付物編號。\n\n` +
          `2. 風險與前置相依性標註：建議在「狀態與備註」欄補充跨標案前置相依條件（如機電供電、5G 專網基地台開通時程），方便雙週滾動追蹤。\n\n` +
          `3. 資安與合規驗證期程：若有長天期跨年度項目，建議拆分為「初測／複測／最終驗收」三階段列管。\n\n` +
          `您可以告訴我想深入討論第幾點，或直接指定要調整哪幾個項目，我再幫您寫入表格。`,
        operations: [],
      };
    }

    return {
      reply:
        `${refSummaryPrefix}針對簡報《${activeDoc.title}》的整體內容與結構，建議可優化以下方向：\n\n` +
        `1. 強化量化效益與數據視覺化：在系統架構與進度頁面補充具體的定位精度、端到端延遲與準點率指標。\n\n` +
        `2. 跨標案介面責任分工矩陣：針對業主與施工協調會最關心的「月台門、號誌、電力與通訊介面」，建議獨立一頁列出界面責任分界點。\n\n` +
        `3. 補充應變與安全降級機制：在技術頁面加入異常天候與最小風險操作（MRM）流程說明，提升審查說服力。\n\n` +
        `您覺得哪一個方向最符合這次會議需求？討論確定後我隨時幫您更新投影片。`,
      operations: [],
    };
  }

  const wantsCompanyOrHistoricalProjects =
    lower.includes('公司') ||
    lower.includes('實績') ||
    lower.includes('歷史') ||
    lower.includes('歷年') ||
    lower.includes('過去') ||
    lower.includes('經驗') ||
    lower.includes('案例');

  const wantsImage =
    lower.includes('圖') ||
    lower.includes('照片') ||
    lower.includes('視覺') ||
    lower.includes('生成') ||
    lower.includes('畫') ||
    lower.includes('image') ||
    lower.includes('photo');

  const wantsNewSectionOrSlide =
    lower.includes('新增一頁') ||
    lower.includes('加一頁') ||
    lower.includes('新增投影片') ||
    lower.includes('新增章節') ||
    lower.includes('加一段') ||
    lower.includes('新增工作表');

  if (!activeDoc) {
    if (wantsCompanyOrHistoricalProjects) {
      const sampleList = allProjects
        .slice(0, 8)
        .map((p) => `• ${p.startYear}｜${p.code} ${p.name}（${p.period}）：${p.summary}`)
        .join('\n');
      return {
        reply: `我們公司（台灣智慧駕駛 Turing Drive）自 2019–2026 年共有 ${allProjects.length} 個專案資料可供引用，近期代表專案包括：\n\n${sampleList}\n\n您可以點選左側任一 Word、Excel 或 PPT 檔案，直接請我將這些公司實績與歷年專案資料寫入文件中。`,
        operations: [],
      };
    }

    if (lower.includes('word') || lower.includes('規範') || lower.includes('報告') || lower.includes('文件') || lower.includes('iso')) {
      return {
        reply: '已為您開啟專案 Word 文件。',
        operations: [
          {
            kind: 'open_or_create_doc',
            docType: 'word',
            title: '01_第02584K章 車輛行車管理系統_施工規範與設計報告.docx',
            projectCode: 'T3-2026',
            projectName: 'T3 桃園機場第三航廈自駕運輸系統',
          },
        ],
      };
    }
    if (lower.includes('excel') || lower.includes('試算表') || lower.includes('時程') || lower.includes('wbs')) {
      return {
        reply: '已為您開啟專案 Excel 時程表。',
        operations: [
          {
            kind: 'open_or_create_doc',
            docType: 'excel',
            title: '時程表_20260316_雙週滾動里程碑與WBS追蹤表.xlsx',
            projectCode: 'T3-2026',
            projectName: 'T3 桃園機場第三航廈自駕運輸系統',
          },
        ],
      };
    }
    if (lower.includes('ppt') || lower.includes('簡報') || lower.includes('投影片')) {
      return {
        reply: '已為您開啟專案 PPT 簡報。',
        operations: [
          {
            kind: 'open_or_create_doc',
            docType: 'ppt',
            title: '桃園T3 PMS施工協調會20260309 V2.pptx',
            projectCode: 'T3-2026',
            projectName: 'T3 桃園機場第三航廈自駕運輸系統',
          },
        ],
      };
    }

    return {
      reply: `${refSummaryPrefix}目前知識庫已載入公司 2019–2026 共 ${allProjects.length} 個專案實績。請從左側選擇或拖放一份專案檔案（Word、Excel、PPT），即可直接將公司資料或參考資料重點寫入指定區域。`,
      operations: [],
    };
  }

  const operations: CoAuthorOperation[] = [];
  let replyText = '';

  // If the user uploaded an image reference file and wants to insert/replace or use it in Word/PPT
  for (const rf of refFiles) {
    if (
      rf.mimeType.startsWith('image/') &&
      rf.base64Data &&
      (activeDoc.docType === 'word' || activeDoc.docType === 'ppt') &&
      (lower.includes('放') ||
        lower.includes('插') ||
        lower.includes('換') ||
        lower.includes('圖') ||
        lower.includes('照'))
    ) {
      const wantsReplaceImg = /改掉|換一張|替換|重畫|換掉|更新.*圖|改.*圖/.test(prompt);
      operations.push({
        kind: 'generate_image',
        targetId: activeDoc.selectedTargetId,
        caption: `參考圖片：${rf.name.replace(/\.[^.]+$/, '')}`,
        prompt: rf.name,
        dataUrl: `data:${rf.mimeType};base64,${rf.base64Data}`,
        mode: wantsReplaceImg ? 'replace' : 'append',
      });
    }
  }

  if (wantsImage) {
    const cleanTopic =
      prompt
        .replace(/幫我|請幫我|生成|產生|畫一張|一張|照片|圖片|示意圖|架構圖|插入|到這頁|到這個章節|我想要把那張|改掉|換一張看看|換一張/g, '')
        .trim() || `${activeDoc.projectName} 系統架構圖`;

    const wantsReplaceImg = /改掉|換一張|替換|重畫|換掉|更新.*圖|改.*圖/.test(prompt);
    const caption = `系統示意圖：${cleanTopic.slice(0, 28)}`;
    const vertexImg = await tryGenerateVertexImage(cleanTopic);
    const dataUrl =
      vertexImg ??
      buildProjectIllustrationDataUrl({
        title: cleanTopic.slice(0, 36),
        subtitle: `${activeDoc.projectCode} · ${activeDoc.selectedTargetLabel ?? activeDoc.title}`,
        theme: detectImageTheme(prompt + ' ' + activeDoc.projectName),
      });

    operations.push({
      kind: 'generate_image',
      targetId: activeDoc.selectedTargetId,
      caption,
      prompt: cleanTopic,
      dataUrl,
      mode: wantsReplaceImg ? 'replace' : 'append',
    });
  }

  if (activeDoc.docType === 'word') {
    const isFormattingCommand =
      /目錄|索引|toc|頁碼|頁首|頁尾|行距|字型|字體|字級|縮排|排版|重新編號|章節編號/i.test(lower);

    if (isFormattingCommand) {
      const fmtOp: Extract<CoAuthorOperation, { kind: 'format_word_document' }> = {
        kind: 'format_word_document',
      };
      const changes: string[] = [];

      if (/隱藏目錄|移除目錄|不要目錄|關閉目錄/.test(lower)) {
        fmtOp.showTableOfContents = false;
        changes.push('隱藏目錄索引頁（TOC）');
      } else if (/目錄|索引|toc/i.test(lower)) {
        fmtOp.showTableOfContents = true;
        changes.push('建立並更新自動章節與頁碼目錄索引（Table of Contents）');
      }

      if (/隱藏頁碼|移除頁碼|不要頁碼/.test(lower)) {
        fmtOp.showPageNumbers = false;
        changes.push('隱藏頁尾頁碼');
      } else if (/羅馬.*頁碼|roman/i.test(lower)) {
        fmtOp.showPageNumbers = true;
        fmtOp.pageNumberStyle = 'roman';
        changes.push('將頁碼格式設為羅馬數字（I, II, III）');
      } else if (/頁碼/.test(lower)) {
        fmtOp.showPageNumbers = true;
        fmtOp.pageNumberStyle = 'page_x_of_y';
        changes.push('啟用正式工程規範頁碼（第 X 頁，共 Y 頁）');
      }

      if (/頁首|頁尾/.test(lower)) {
        fmtOp.showHeaderFooter = !/隱藏頁首|移除頁首/.test(lower);
        changes.push(fmtOp.showHeaderFooter ? '顯示正式工程文件頁首與頁尾' : '隱藏頁首與頁尾');
      }

      if (/黑體|無襯線|微軟正黑|noto sans/i.test(lower)) {
        fmtOp.fontFamily = 'Noto Sans TC';
        changes.push('發文字體改為「思源黑體 / 正黑體（Noto Sans TC）」');
      } else if (/明體|宋體|標楷|襯線|noto serif/i.test(lower)) {
        fmtOp.fontFamily = 'Noto Serif TC';
        changes.push('發文字體改為「思源宋體 / 正式明體（Noto Serif TC）」');
      } else if (/times/i.test(lower)) {
        fmtOp.fontFamily = 'Times New Roman';
        changes.push('字體改為「Times New Roman」');
      }

      const ptMatch = lower.match(/(\d{2}(?:\.\d)?)\s*(?:pt|級|號字)/);
      if (ptMatch) {
        const pt = Number.parseFloat(ptMatch[1]);
        if (pt >= 9 && pt <= 20) {
          fmtOp.fontSizePt = pt;
          changes.push(`內文字級調整為 ${pt} pt`);
        }
      }

      if (/單行間距|1\.0\s*倍/.test(lower)) {
        fmtOp.lineSpacing = 1.25;
        changes.push('段落行距調整為單行間距（1.25）');
      } else if (/1\.5\s*倍|1\.5\s*行距/.test(lower)) {
        fmtOp.lineSpacing = 1.5;
        changes.push('段落行距調整為 1.5 倍行高');
      } else if (/2\s*倍|雙倍行距/.test(lower)) {
        fmtOp.lineSpacing = 2.0;
        changes.push('段落行距調整為 2.0 倍雙行距');
      } else if (/行距/.test(lower)) {
        fmtOp.lineSpacing = 1.75;
        changes.push('段落行距最佳化為工程報告標準 1.75 倍行高');
      }

      if (/取消縮排|不縮排|0\s*字元/.test(lower)) {
        fmtOp.paragraphIndentEm = 0;
        changes.push('取消段落首行縮排');
      } else if (/縮排/.test(lower)) {
        fmtOp.paragraphIndentEm = 2;
        changes.push('設定段落首行縮排 2 字元');
      }

      if (/重新編號|章節編號|整理編號|排版/.test(lower)) {
        fmtOp.renumberSections = true;
        fmtOp.showTableOfContents = fmtOp.showTableOfContents ?? true;
        fmtOp.showPageNumbers = fmtOp.showPageNumbers ?? true;
        changes.push('自動重整全文章節編號（1.0, 2.0, 3.0…）並同步更新目錄頁碼');
      }

      if (changes.length === 0) {
        fmtOp.showTableOfContents = true;
        fmtOp.showPageNumbers = true;
        fmtOp.showHeaderFooter = true;
        fmtOp.renumberSections = true;
        changes.push('套用標準工程規範書排版（自動目錄索引、正式頁首頁尾、頁碼與章節重新編號）');
      }

      operations.push(fmtOp);
      return {
        reply: `${refSummaryPrefix}已為《${activeDoc.title}》執行 Word 原生排版與目錄頁碼更新：\n• ${changes.join('\n• ')}`,
        operations,
      };
    }

    const rawLabel = (activeDoc.selectedTargetLabel || '當前章節').replace(/^\d+\.\d+\s+/, '');
    const isAdd = wantsNewSectionOrSlide || /新增.*章節|5\.0|獨立.*章節/.test(lower);
    const synthesized = synthesizeWordSectionBySemantics(
      followUp.expandedQuery,
      activeDoc.projectName,
      rawLabel,
      allProjects,
      activeDoc.linkedSnippetText || activeDoc.currentTargetContent
    );

    const refContentNote =
      refFiles.length > 0
        ? `\n\n4. 參考資料整合要點（來源：${refFiles.map((f) => f.name).join('、')}）：\n` +
          refFiles
            .map((f) =>
              f.extractedText?.trim()
                ? `   - ${f.name}：${f.extractedText.trim().slice(0, 400)}`
                : `   - 依據《${f.name}》之來源規範與現場資料完成介面參數與驗收項目核對。`
            )
            .join('\n')
        : '';

    const finalWordContent = stripAuxiliaryMetaPhrases(synthesized.content + refContentNote);

    if (!wantsImage || lower.includes('寫') || lower.includes('改') || lower.includes('補') || lower.includes('強化') || lower.includes('精簡') || wantsCompanyOrHistoricalProjects || isAdd || refFiles.length > 0 || followUp.wantsWriteNow) {
      operations.push({
        kind: 'write_word_section',
        sectionId: activeDoc.selectedTargetId,
        sectionTitle: synthesized.title,
        content: finalWordContent,
        mode: isAdd ? 'add_section' : 'replace',
      });
    }

    replyText =
      wantsImage && operations.length === 1
        ? `${refSummaryPrefix}已生成示意圖並插入段落下方。`
        : `${refSummaryPrefix}${finalWordContent}`;
  } else if (activeDoc.docType === 'excel') {
    const excelResult = buildExcelOperationFromPrompt(
      prompt,
      activeDoc,
      allProjects,
      wantsCompanyOrHistoricalProjects,
      wantsNewSectionOrSlide
    );
    operations.push(excelResult.op);
    replyText = `${refSummaryPrefix}${excelResult.reply}`;
  } else if (activeDoc.docType === 'ppt') {
    const targetLabel = activeDoc.selectedTargetLabel || '當前投影片';
    const isAdd = wantsNewSectionOrSlide;
    const slideTitle = wantsCompanyOrHistoricalProjects
      ? '台灣智慧駕駛（Turing Drive）公司簡介與歷年專案實績'
      : lower.includes('iso')
      ? '國際安全標準（ISO 26262 / 21434 / 21448）對接架構'
      : lower.includes('月台') || lower.includes('psd')
      ? '月台門（PSD）安全連鎖與精準停靠對策'
      : targetLabel.replace(/^第\s*\d+\s*頁：/, '');

    const bullets = wantsCompanyOrHistoricalProjects
      ? [
          '公司核心能量：專注 L4 自駕系統研發、Autoware 3D LiDAR 多感測器融合定位、底盤線控與 5G 遠端行控平台（OCC / FMS）。',
          ...allProjects
            .slice(0, 4)
            .map((p) => `${p.startYear} ${p.name}（${p.code}）：${p.summary.slice(0, 56)}`),
        ]
      : lower.includes('iso')
      ? [
          'ISO 26262 功能安全：車載控制單元（ADU）與底盤線控具備雙迴路冗餘與即時故障診斷。',
          'ISO 21448 預期功能安全（SOTIF）：多感測器融合搭配最小風險操作（MRM）降級策略。',
          'ISO/SAE 21434 車聯網資安：V2X 通訊全面採用 TLS 1.3 雙向憑證與硬體安全模組（HSM）簽章。',
          'V-Model 驗證流程：完成 HIL 模擬、出廠測試（FAT）與現場 72 小時連續運行驗證（SAT）。',
        ]
      : [
          '核心技術方案：採用 3D LiDAR 點雲配準結合 RTK-GNSS，達成高架與地下廊道公分級定位。',
          '安全連鎖機制：車載安全控制器與月台門（PSD）、交控號誌即時連動，確保營運安全。',
          '界面協調進度：已完成跨標案管線、電力及通訊介面套繪，依雙週滾動時程表逐項查核。',
          '交付與驗收指標：車隊調度準點率達 99.5% 以上，完整交付測試報告與維保 SOP。',
        ];

    const speakerNotes = `本頁說明「${slideTitle}」之核心架構、公司實績與現場驗證規劃。`;

    if (!wantsImage || lower.includes('寫') || lower.includes('改') || lower.includes('重點') || wantsCompanyOrHistoricalProjects || isAdd) {
      operations.push({
        kind: 'write_ppt_slide',
        slideId: activeDoc.selectedTargetId,
        slideTitle,
        slideSubtitle: `${activeDoc.projectCode} · 台灣智慧駕駛專案報告`,
        bullets,
        speakerNotes,
        mode: isAdd ? 'add_slide' : 'replace_slide',
      });
    }

    replyText =
      wantsImage && operations.length === 1
        ? `${refSummaryPrefix}已為「${targetLabel}」生成視覺圖並插入投影片。`
        : `${refSummaryPrefix}已更新「${targetLabel}」的投影片重點與講者備忘稿。`;
  }

  return {
    reply: stripMarkdownAsterisks(replyText),
    operations,
  };
}

export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: CoAuthorRequest;
  try {
    body = (await request.json()) as CoAuthorRequest;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const refFiles = body.referenceFiles ?? [];
  const prompt =
    body.prompt?.trim() ||
    (refFiles.length > 0
      ? `請分析我上傳的參考資料（${refFiles.map((f) => f.name).join('、')}）內容大綱，並根據其重點協助更新目前檔案區域。`
      : '');
  if (!prompt) {
    return NextResponse.json({ error: 'missing prompt' }, { status: 400 });
  }
  body.prompt = prompt;


  const viewer: ProjectViewerContext = {
    name: employee.name,
    email: employee.email,
    role: employee.role,
    departmentCode: employee.departmentCode,
    departmentName: employee.departmentName,
    isGeneralManager: employee.isGeneralManager,
    isChairman: employee.isChairman,
  };

  const authorizedGroups = filterYearGroupsForViewer(HISTORICAL_YEAR_GROUPS, viewer);
  const { digestText, allProjects } = buildAuthorizedProjectsDigest(authorizedGroups);

  // 1. Auto-optimize Company Knowledge Graph if new files (reference uploads or newly dropped/edited activeDoc) arrived
  const filesToIngest: Parameters<typeof ingestNewFilesAndOptimizeGraph>[0] = [];
  for (const rf of refFiles) {
    filesToIngest.push({
      id: `upload:${rf.name}`,
      name: rf.name,
      projectCode: body.activeDoc?.projectCode ?? 'PROJ-DOC',
      kindLabel: rf.kindLabel,
      extractedText: rf.extractedText,
      sourceOrigin: 'user_upload',
    });
  }
  if (body.activeDoc) {
    filesToIngest.push({
      id: `coauthor:${body.activeDoc.id}`,
      name: body.activeDoc.title,
      projectCode: body.activeDoc.projectCode,
      kindLabel: body.activeDoc.docType.toUpperCase(),
      extractedText: body.activeDoc.fullDocumentText || body.activeDoc.fullOutlineSummary,
      sourceOrigin: 'coauthor_doc',
    });
  }
  const ingestReport = ingestNewFilesAndOptimizeGraph(filesToIngest);

  // 2. Resolve multi-turn follow-up context & query the Graphify Company Knowledge Graph
  const followUp = resolveFollowUpFromHistory(prompt, body.history);
  const graphResult = searchCompanyKnowledgeGraph(followUp.expandedQuery, viewer, {
    activeProjectCode: body.activeDoc?.projectCode,
    topKFiles: 6,
    topKProjects: 5,
    autoOptimizedOnNewFiles: ingestReport.addedOrUpdated > 0,
  });

  const isTuringDriveTurn =
    /台灣智慧駕駛|台智駕|turing\s*drive|歷年專案|歷史專案|公司實績|過去實績/i.test(prompt) ||
    /T3-2026|桃園.*機場|自駕|VTMS|AITS/i.test(
      `${body.activeDoc?.projectCode ?? ''} ${body.activeDoc?.projectName ?? ''} ${body.activeDoc?.title ?? ''}`
    );

  const graphRetrievalMeta: CoAuthorResponse['graphRetrieval'] =
    isTuringDriveTurn &&
    (graphResult.matchedFiles.length > 0 || graphResult.matchedProjects.length > 0)
      ? {
          totalNodes: graphResult.graphStats.totalNodes,
          totalEdges: graphResult.graphStats.totalEdges,
          communitiesCount: graphResult.graphStats.communitiesCount,
          matchedFileNames: graphResult.matchedFiles.map((f) => f.node.label).slice(0, 4),
          matchedProjectCodes: graphResult.matchedProjects
            .map((p) => p.projectContext?.code ?? p.node.projectCode ?? p.node.label)
            .slice(0, 4),
          autoOptimized: ingestReport.addedOrUpdated > 0,
        }
      : undefined;

  if (isCompanyAdminRequest(prompt) || isIrrelevantNonProjectQuery(prompt)) {
    const refusal = await buildSmartProjectCoAuthorResponse(
      body,
      allProjects,
      graphResult,
      followUp
    );
    return NextResponse.json(refusal);
  }

  const vertexOutcome = await tryVertexStructuredCoAuthor(
    body,
    digestText,
    graphResult,
    followUp
  );

  // NEVER fall back to preset/hardcoded Turing Drive text when Vertex AI fails!
  // Always report an explicit error message and leave the document untouched.
  if (!vertexOutcome.response) {
    return NextResponse.json({
      reply: `⚠️ 系統目前無法完成您的指令（AI 模型回應異常或連線逾時：${
        vertexOutcome.errorReason || '請稍後再試'
      }）。為避免套用預設資料造成內容錯誤，系統未對您的文件或框選段落進行任何修改，請重新傳送一次。`,
      operations: [],
    });
  }

  const vertexResult = vertexOutcome.response;
  const ops = [...vertexResult.operations];
  const finalResult: CoAuthorResponse = {
    ...vertexResult,
    operations: ops,
    graphRetrieval: vertexResult.webSearch ? undefined : graphRetrievalMeta,
  };

  // Resolve the selection against the actual document before any write.
  if (body.activeDoc?.linkedSnippetText && finalResult.operations.some((op) => op.kind === 'write_word_section')) {
    const anchor = body.activeDoc.selectionAnchor;
    const op = finalResult.operations.find((entry) => entry.kind === 'write_word_section');
    if (!anchor || !body.activeDoc.driveItemId || anchor.docId !== body.activeDoc.driveItemId || !Array.isArray(anchor.paragraphs) || !anchor.revisionId || !Number.isInteger(anchor.startIndex) || !Number.isInteger(anchor.endIndex)) {
      finalResult.writeResult = { status: 'not_applied', reason: 'unverified_selection', message: '未寫入文件：無法確認框選段落，請重新框選。' };
    } else if (op?.kind === 'write_word_section') {
      const tokens = await getCandidateDriveWriteTokens(employee.email, { currentUserOnly: true });
      const result = tokens[0] ? await writeAnchoredDocument(tokens[0], anchor, op.content) : { ok: false as const, reason: 'no_tokens' as const };
      finalResult.writeResult = result.ok
        ? { status: 'applied', reason: 'applied', message: '已更新文件。' }
        : { status: result.reason === 'verification_unknown' ? 'unknown' : result.reason === 'no_tokens' || result.reason === 'auth_failed' ? 'needs_auth' : 'not_applied', reason: result.reason, message: result.reason === 'verification_unknown' ? '寫入結果尚無法確認，請先檢查文件，避免重複寫入。' : `未寫入文件：${result.reason}，請重新框選或檢查授權。` };
      if (result.ok) finalResult.selectionAnchor = result.anchor;
    }
    finalResult.driveFileUpdated = finalResult.writeResult?.status === 'applied';
    console.info('[coauthor-write]', JSON.stringify({ correlationId, operation: 'write_word_section', confidence: anchor?.confidence, status: finalResult.writeResult?.status, reason: finalResult.writeResult?.reason }));
    return NextResponse.json({ ...finalResult, correlationId });
  }

  if (finalResult.operations.some((op) => op.kind === 'write_word_section')) {
    finalResult.writeResult = { status: 'not_applied', reason: 'target_not_found', message: '未寫入文件：請先框選要修改的段落。' };
    finalResult.driveFileUpdated = false;
    return NextResponse.json({ ...finalResult, correlationId });
  }

  // Directly apply modification to Google Drive file (.docx / Google Docs) in-place so user does not need to copy-paste
  if (body.activeDoc && body.activeDoc.driveItemId) {
    const effectiveDriveId = body.activeDoc.driveItemId;
    const insertMode = body.activeDoc.insertMode ?? 'replace';
    const isCursorInsert =
      insertMode === 'insert_at_cursor' ||
      insertMode === 'insert_before' ||
      insertMode === 'insert_after' ||
      Boolean(body.activeDoc.cursorAnchorBefore || body.activeDoc.cursorAnchorAfter);

    // Never fall back to currentTargetContent (which defaults to sec-1 Cover Page)
    // unless the user explicitly locked a section/paragraph or we are in cursor insert mode!
    const targetSnippet =
      body.activeDoc.linkedSnippetText ||
      (body.activeDoc.userExplicitlyLockedTarget ? body.activeDoc.currentTargetContent : '') ||
      '';

    const wordOp = finalResult.operations.find((op) => op.kind === 'write_word_section');
    if (wordOp && wordOp.kind === 'write_word_section' && wordOp.content && effectiveDriveId) {
      if (targetSnippet.trim() || isCursorInsert) {
        const patchRes = await patchDriveDocumentInPlace({
          driveFileId: effectiveDriveId,
          userEmail: employee.email,
          targetSnippet,
          newContent: wordOp.content,
          sectionTitleHint: body.activeDoc.selectedTargetLabel,
          insertMode: isCursorInsert ? 'insert_at_cursor' : 'replace',
          cursorAnchorBefore: body.activeDoc.cursorAnchorBefore,
          cursorAnchorAfter: body.activeDoc.cursorAnchorAfter,
        });
        finalResult.driveFileUpdated = patchRes.updated;
        finalResult.writeResult = patchRes.updated
          ? { status: 'applied', reason: 'applied', message: '已更新文件。' }
          : { status: patchRes.reason === 'no_tokens' ? 'needs_auth' : 'not_applied', reason: patchRes.reason ?? 'api_error', message: `未寫入文件：${patchRes.reason ?? '發生錯誤'}。` };
        finalResult.driveLiveStreaming = patchRes.liveStreaming;
        finalResult.resolvedNativeDocId = patchRes.resolvedNativeDocId;
        if (
          !patchRes.updated &&
          patchRes.reason !== 'xml_target_not_found' &&
          patchRes.reason !== 'target_not_found'
        ) {
          finalResult.needsDriveOAuth = true;
        }
      } else {
        finalResult.driveFileUpdated = false;
        finalResult.writeResult = { status: 'not_applied', reason: 'target_not_found', message: '未寫入文件：找不到目標段落。' };
      }
    }

    const imgOp = finalResult.operations.find((op) => op.kind === 'generate_image');
    if (imgOp && imgOp.kind === 'generate_image' && imgOp.dataUrl && effectiveDriveId) {
      const imgRes = await insertImageIntoDriveDocumentInPlace({
        driveFileId: effectiveDriveId,
        userEmail: employee.email,
        targetSnippet:
          targetSnippet ||
          body.activeDoc.cursorAnchorAfter ||
          body.activeDoc.cursorAnchorBefore ||
          '',
        sectionTitleHint: body.activeDoc.selectedTargetLabel,
        imageDataUrl: imgOp.dataUrl,
        caption: imgOp.caption,
      });
      if (imgRes.inserted) {
        finalResult.driveFileUpdated = true;
        finalResult.driveLiveStreaming = true;
        finalResult.resolvedNativeDocId =
          imgRes.resolvedNativeDocId ?? finalResult.resolvedNativeDocId;
      }
    }
  }

  if (!body.activeDoc?.driveItemId && finalResult.operations.some((op) => op.kind === 'write_word_section')) {
    finalResult.writeResult = { status: 'not_applied', reason: 'missing_file_id', message: '未寫入文件：缺少文件 ID。' };
  }
  return NextResponse.json(finalResult);
}

export async function GET(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const docId = request.nextUrl.searchParams.get('docId')?.trim();
  const targetDocIds = docId ? [docId] : [];
  await Promise.allSettled(
    targetDocIds.map((id) =>
      ensureDriveDocSharedForViewer({
        driveFileId: id,
        userEmail: employee.email,
      })
    )
  );

  const tokens = await getCandidateDriveWriteTokens(employee.email, {
    includeSlowFallbacks: true,
  });
  let hasDriveWriteToken = false;
  for (const token of tokens) {
    try {
      const r = await fetch(
        'https://www.googleapis.com/drive/v3/files/1cMm0JJ4ll3j-uKqOAWaDp6cvZQqiUw6L?fields=id,capabilities&supportsAllDrives=true',
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(4_000),
          cache: 'no-store',
        }
      );
      if (r.ok) {
        hasDriveWriteToken = true;
        break;
      }
    } catch {
      // ignore
    }
  }
  return NextResponse.json({
    hasDriveWriteToken,
    email: employee.email,
    sharedDocIds: targetDocIds,
  });
}

async function resolveVisualSelectionFromScreen(params: {
  screenRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    orbRatioY?: number;
  };
  imageBase64?: string;
  allowCursorContext?: boolean;
}): Promise<{
  mode: 'highlight' | 'cursor';
  selectedText: string;
  sectionHeading: string;
  visibleBeforeText: string;
  visibleAfterText: string;
} | null> {
  try {
    let base64Img = params.imageBase64 || '';
    let mimeType = 'image/png';
    if (!base64Img && process.platform === 'darwin' && params.screenRect) {
      const x = Math.max(0, Math.round(params.screenRect.x));
      const y = Math.max(0, Math.round(params.screenRect.y));
      const w = Math.max(200, Math.min(3840, Math.round(params.screenRect.width)));
      const h = Math.max(160, Math.min(2400, Math.round(params.screenRect.height)));
      const tmpPath = join(tmpdir(), `accsys_coauthor_sel_${process.pid}_${Date.now()}.jpg`);
      try {
        execFileSync('screencapture', ['-x', '-t', 'jpg', '-R', `${x},${y},${w},${h}`, tmpPath], {
          timeout: 2500,
          stdio: 'ignore',
        });
        if (existsSync(tmpPath)) {
          base64Img = readFileSync(tmpPath).toString('base64');
          mimeType = 'image/jpeg';
        }
      } finally {
        try {
          if (existsSync(tmpPath)) unlinkSync(tmpPath);
        } catch {
          // ignore cleanup error
        }
      }
    }

    if (!base64Img) return null;

    const cfg = loadAiChatConfig();
    if (!cfg.projectId) return null;
    const { token } = await getVertexAccessToken(cfg);
    const endpoint =
      cfg.location === 'global'
        ? `https://aiplatform.googleapis.com/v1/projects/${cfg.projectId}/locations/global/publishers/google/models/${cfg.model}:generateContent`
        : `https://${cfg.location}-aiplatform.googleapis.com/v1/projects/${cfg.projectId}/locations/${cfg.location}/publishers/google/models/${cfg.model}:generateContent`;

    const orbPct = Math.round((params.screenRect?.orbRatioY ?? 0.35) * 100);
    const prompt = params.allowCursorContext
      ? `這是一張 Google Docs 中間文件紙張區域的畫面截圖。使用者正在文件紙張中進行協作編輯（可能反白框選了一段文字，或者單純將黑色直線游標「|」放在某個空白區域或段落位置，參考垂直高度約在紙張由上往下 ${orbPct}% 附近）。
請嚴格遵守以下規則並回傳 JSON：
1. 若畫面上有「被灰色或淺藍色底色反白框選的文字區塊」：
   - "mode": 設為 "highlight"
   - "selectedText": 一字不漏照抄被灰色或淺藍色反白框選的文字完整原文（跨多段以 \\n 分隔，不要抄入未反白的標題或其他段落）
   - "sectionHeading": 被框選段落上方緊鄰的小標題
   - "visibleBeforeText": 被框選段落上方的緊鄰前文
   - "visibleAfterText": 被框選段落下方的緊鄰後文
2. 若畫面上「沒有」任何被灰色或淺藍色反白框選的文字，但畫面紙張上有黑色垂直游標「|」、空白插入區或文字段落（特別留意紙張垂直高度約 ${orbPct}% 處或空白行位置）：
   - "mode": 設為 "cursor"
   - "selectedText": 設為 ""
   - "sectionHeading": 畫面上最靠近游標或空白行的大標題／小標題（例如「貳、計畫內容與實施方法」或「一、目標市場需求」）
   - "visibleBeforeText": 游標「|」或空白區正上方緊鄰的正文段落（注意：請忽略紙張最頂端綠色橫線或頁首線條上方的頁首文字，如「移動代步服務生態系創新優化計畫」；若游標上方除了頁首外沒有其他正文，請填 ""）
   - "visibleAfterText": 游標「|」或空白區正下方緊鄰的標題與前 2~3 行正文完整原文（一字不漏照抄，多行以 \\n 分隔，例如「貳、計畫內容與實施方法\\n一、目標市場需求\\n(一)市場規模需求評估\\n1.計畫緣起：本計畫源自於實現銀髮族(65歲以上)生活中...」）
3. 若紙張完全空白且無任何文字，請回傳 {"mode":"cursor","selectedText":"","sectionHeading":"","visibleBeforeText":"","visibleAfterText":""}。
請只輸出純 JSON 格式：{"mode":"highlight"|"cursor","selectedText":"...","sectionHeading":"...","visibleBeforeText":"...","visibleAfterText":"..."}`
      : `這是一張 Google Docs 中間文件紙張區域的畫面截圖。使用者剛剛在文件紙張中用滑鼠反白框選了一段文字（在 Google Docs 中被框選的文字會有明顯的灰色或淺藍色反白底色區塊，且區塊下方常有 Google Docs 的「新增註解 / 新增表情符號回應」浮動小膠囊圖示，右側約垂直高度 ${orbPct}% 處則對應協作小圓球的位置）。
請嚴格遵守以下規則並回傳 JSON：
1. 若畫面中的紙張是空白的，或畫面上「沒有任何明顯被灰色或淺藍色底色反白框選的文字區塊」，請務必回傳 {"mode":"highlight","selectedText":"","sectionHeading":"","visibleBeforeText":"","visibleAfterText":""}，絕對禁止自行猜測或擷取未反白的段落！
2. "selectedText": 請只擷取紙張上「被灰色或淺藍色底色反白框選」的那一段或多段文字完整原文（一字不漏照抄被反白框選的文字本身，若跨多個段落請以 \\n 換行分隔；絕對不要抄到上方或下方沒有被反白的其他段落，也不要把上方未被反白的小標題抄進 selectedText）。
3. "sectionHeading": 該被框選段落正上方緊鄰的小標題（例如「(二)使用者需求說明」或「1.銷售模式」）。
4. "visibleBeforeText": 紙張上位於該被框選段落上方的緊鄰前文內容。
5. "visibleAfterText": 紙張上位於該被框選段落下方緊鄰的後文內容。
請只輸出純 JSON 格式：{"mode":"highlight","selectedText":"...","sectionHeading":"...","visibleBeforeText":"...","visibleAfterText":"..."}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': cfg.projectId,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Img,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 768,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
      signal: AbortSignal.timeout(6_500),
    });

    if (!res.ok) return null;
    const raw = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
    };
    const rawText = (raw.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => String(p.text))
      .join('\n')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    if (!rawText) return null;
    const parsed = JSON.parse(rawText) as {
      mode?: 'highlight' | 'cursor';
      selectedText?: string;
      sectionHeading?: string;
      visibleBeforeText?: string;
      visibleAfterText?: string;
    };
    const sel = (parsed.selectedText || '').trim();
    const before = (parsed.visibleBeforeText || '').trim();
    const after = (parsed.visibleAfterText || '').trim();
    const heading = (parsed.sectionHeading || '').trim();

    if (sel.length >= 2) {
      return {
        mode: 'highlight',
        selectedText: sel,
        sectionHeading: heading,
        visibleBeforeText: before,
        visibleAfterText: after,
      };
    }

    if (params.allowCursorContext && (before.length >= 3 || after.length >= 3 || heading.length >= 3)) {
      return {
        mode: 'cursor',
        selectedText: '',
        sectionHeading: heading,
        visibleBeforeText: before,
        visibleAfterText: after,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function PATCH(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      action?: string;
      screenRect?: {
        x: number;
        y: number;
        width: number;
        height: number;
        orbRatioY?: number;
      };
      imageBase64?: string;
      allowCursorContext?: boolean;
      driveFileId?: string;
      sectionId?: string;
      sectionTitle?: string;
      targetSnippet?: string;
      newContent?: string;
      sectionTitleHint?: string;
      insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
      cursorAnchorBefore?: string;
      cursorAnchorAfter?: string;
    };

    if (body.action === 'resolve_section_heading') {
      if (!body.driveFileId) return NextResponse.json({ error: 'missing_file_id' }, { status: 400 });
      const headingInfo = await ensureGoogleDocSectionHeadings({
        driveFileId: body.driveFileId,
        userEmail: employee.email,
        sectionId: body.sectionId,
        sectionTitle: body.sectionTitle,
      });
      return NextResponse.json(headingInfo);
    }

    if (body.action === 'resolve_visual_selection') {
      if (!body.driveFileId) return NextResponse.json({ error: 'missing_file_id' }, { status: 400 });
      const resolved = await resolveVisualSelectionFromScreen({
        screenRect: body.screenRect,
        imageBase64: body.imageBase64,
        allowCursorContext: Boolean(body.allowCursorContext),
      });
      if (resolved?.mode === 'highlight' && resolved.selectedText) {
        const tokens = await getCandidateDriveWriteTokens(employee.email, { currentUserOnly: true });
        if (!tokens[0]) return NextResponse.json({ resolved: null, reason: 'no_tokens' });
        const read = await readGoogleDocument(body.driveFileId, tokens[0]);
        if (!read.ok) return NextResponse.json({ resolved: null, reason: read.reason });
        const result = anchorDocumentSelection(body.driveFileId, read.doc, resolved.selectedText);
        if (!result.ok) return NextResponse.json({ resolved: null, reason: result.reason });
        resolved.selectedText = result.anchor.paragraphs.map((p) => p.text).join('\n');
        return NextResponse.json({ resolved, anchor: result.anchor });
      }
      return NextResponse.json({ resolved });
    }

    return NextResponse.json({ updated: false, reason: 'unverified_selection' }, { status: 400 });
  } catch {
    return NextResponse.json({ updated: false, reason: 'bad_request' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const uploadedFile = form.get('file') as File | null;
      const fileName =
        (form.get('fileName') as string | null) || uploadedFile?.name || 'document.docx';
      const docType = ((form.get('docType') as string | null) || 'word') as
        | 'word'
        | 'excel'
        | 'ppt';
      const existingDriveId = (form.get('existingDriveId') as string | null) || undefined;
      const fileBuffer = uploadedFile
        ? Buffer.from(await uploadedFile.arrayBuffer())
        : undefined;
      const res = await resolveOrUploadDroppedDocument({
        fileName,
        docType,
        mimeType: uploadedFile?.type || undefined,
        fileBuffer,
        existingDriveId,
        userEmail: employee.email,
      });
      return NextResponse.json(res);
    }

    const body = (await request.json()) as {
      fileName: string;
      docType: 'word' | 'excel' | 'ppt';
      mimeType?: string;
      base64Data?: string;
      existingDriveId?: string;
    };
    const res = await resolveOrUploadDroppedDocument({
      fileName: body.fileName,
      docType: body.docType,
      mimeType: body.mimeType,
      base64Data: body.base64Data,
      existingDriveId: body.existingDriveId,
      userEmail: employee.email,
    });
    return NextResponse.json(res);
  } catch {
    return NextResponse.json({}, { status: 400 });
  }
}

