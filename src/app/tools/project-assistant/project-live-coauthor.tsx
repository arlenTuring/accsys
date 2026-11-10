'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDriveEmbedPreviewUrl,
  type HistoricalDriveItem,
  type HistoricalYearGroup,
  type ProjectViewerContext,
} from '@/lib/projects/historical-projects-data';
import {
  buildProjectIllustrationDataUrl,
  DEFAULT_WORD_FORMAT,
  STARTER_COAUTHOR_DOCUMENTS,
  type CoAuthorDocType,
  type CoAuthorDocument,
  type DocImageItem,
  type WordDocumentFormat,
  type WordSection,
  type WordSubSection,
} from '@/lib/projects/project-coauthor-seed';
import type {
  CoAuthorOperation,
  CoAuthorReferenceFileInput,
  CoAuthorResponse,
} from '@/app/api/projects/coauthor/route';
import { ChatComposer } from '../ai-chat/chat-composer';

const PROJECT_QUICK_PROMPTS = [
  {
    id: 'review-doc',
    label: '💡 檢視文件並提出優化建議',
    prompt: '請幫我檢視目前這份專案文件的整體結構與內容，提出具體的優化建議與可以補強的方向。',
  },
  {
    id: 'toc-page-layout',
    label: '📑 建立目錄索引、頁碼與標準排版',
    prompt: '請幫我為這份文件建立自動目錄索引（TOC）、正式工程頁首頁尾與頁碼，並重新整理章節編號與段落行距排版。',
  },
  {
    id: 'tech-spec',
    label: '📐 強化技術規格與驗收標準',
    prompt: '請協助擴充並細化目前的技術規格、系統介面規範與量化驗收指標。',
  },
  {
    id: 'gen-visual',
    label: '🎨 生成專案架構示意配圖',
    prompt: '請依照目前的專案主題與內容，生成一張專業的專案系統架構與場域示意圖。',
  },
];

type StagedRefAttachment = CoAuthorReferenceFileInput & {
  id: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  targetBadge?: string;
  refusedCompanyAdmin?: boolean;
  attachments?: Array<{ name: string; kindLabel: string }>;
  webSearch?: CoAuthorResponse['webSearch'];
  graphRetrieval?: CoAuthorResponse['graphRetrieval'];
  linkedSnippet?: {
    label: string;
    text: string;
  };
  modifiedCopyText?: string;
  generatedImages?: Array<{
    caption: string;
    dataUrl: string;
    insertedInDoc?: boolean;
  }>;
};

type QueuedPromptItem = {
  id: string;
  text: string;
  timestamp: string;
  attachedRefs: StagedRefAttachment[];
  scopeMode: 'whole_doc' | 'target_region';
  linkedSelectionSnapshot: {
    sectionId?: string;
    label: string;
    snippetText: string;
    contextBefore?: string;
    contextAfter?: string;
    fullContextText?: string;
    blockIndex?: number;
    insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
    cursorAnchorBefore?: string;
    cursorAnchorAfter?: string;
  } | null;
  selectedRowIndexSnapshot?: number | null;
  targetIdSnapshot?: string;
  targetLabelSnapshot?: string;
};

type FloatingSelectionOrbState = {
  visible: boolean;
  topPx: number;
  leftPercent: number;
  linked: boolean;
  sectionId?: string;
  sectionLabel: string;
  snippetText: string;
  contextBefore?: string;
  contextAfter?: string;
  fullContextText?: string;
  blockIndex?: number;
};

type SemanticParagraphBlock = {
  sectionId: string;
  sectionCode: string;
  sectionTitle: string;
  sectionLabel: string;
  blockIndex: number;
  subHeading: string;
  snippetText: string;
  contextBefore: string;
  contextAfter: string;
  fullContextText: string;
};

function buildSemanticBlocksForWordSection(sec: {
  id: string;
  code: string;
  title: string;
  content: string;
}): SemanticParagraphBlock[] {
  const secLabel = cleanSectionLabel(sec.code, sec.title);
  const rawParas = (sec.content ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (rawParas.length === 0) {
    return [
      {
        sectionId: sec.id,
        sectionCode: sec.code,
        sectionTitle: sec.title,
        sectionLabel: secLabel,
        blockIndex: 0,
        subHeading: sec.title,
        snippetText: sec.title,
        contextBefore: '',
        contextAfter: '',
        fullContextText: sec.title,
      },
    ];
  }

  // Group short headings (e.g. "(四)產品銷售方式", "1.銷售模式", "(五)參與並獲得通過教育部產學攜手合作計畫2.0說明")
  // with their following substantive paragraph(s) and tables
  const grouped: Array<{ subHeading: string; bodyText: string; fullBlockText: string }> = [];
  let pendingHeadings: string[] = [];
  let lastMajorSubHeading = '';

  const isShortHeading = (line: string) => {
    const clean = line.trim();
    if (clean.length > 42 || clean.includes('｜')) return false;
    // Content items containing a colon followed by text (e.g. "1.核准設立日期： 89 年 6 月 9日" or "(1)安心友善的職場環境：...")
    // or ending with sentence punctuation are body lines, NOT standalone section headings
    if (/[：:].+/.test(clean) || /[。；！]$/.test(clean)) return false;
    return (
      /^[(（][一二三四五六七八九十\d]+[)）]/.test(clean) ||
      /^[一二三四五六七八九十]+、/.test(clean) ||
      /^\d+[.、]\s*[^\d]/.test(clean) ||
      /^[壹貳參肆伍陸柒捌玖拾]、/.test(clean)
    );
  };

  for (let i = 0; i < rawParas.length; i++) {
    const p = rawParas[i];
    // Skip redundant section title repeat at index 0 if there are more paragraphs
    if (i === 0 && rawParas.length > 1 && p === sec.title.trim()) {
      continue;
    }
    if (isShortHeading(p) && i < rawParas.length - 1) {
      if (/^[(（][一二三四五六七八九十]+[)）]|^[一二三四五六七八九十]+、/.test(p)) {
        lastMajorSubHeading = p;
      }
      pendingHeadings.push(p);
    } else {
      // If there are no new pendingHeadings and the previous group shares the same structural sub-heading
      // (for example, an intro sentence followed immediately by its table, or numbered items 1..4 under (一)公司簡介),
      // merge into the current sub-heading block so tables/captions don't fragment the section index.
      if (pendingHeadings.length === 0 && grouped.length > 0 && lastMajorSubHeading) {
        const prev = grouped[grouped.length - 1];
        prev.bodyText = `${prev.bodyText}\n${p}`;
        prev.fullBlockText = `${prev.fullBlockText}\n${p}`;
        continue;
      }

      const headingLabel =
        pendingHeadings[pendingHeadings.length - 1] ||
        lastMajorSubHeading ||
        p.slice(0, 24);
      const combinedText =
        pendingHeadings.length > 0 ? `${pendingHeadings.join('\n')}\n${p}` : p;
      grouped.push({
        subHeading: headingLabel,
        bodyText: p,
        fullBlockText: combinedText,
      });
      pendingHeadings = [];
    }
  }

  if (pendingHeadings.length > 0) {
    grouped.push({
      subHeading: pendingHeadings[pendingHeadings.length - 1] || pendingHeadings[0],
      bodyText: pendingHeadings.join('\n'),
      fullBlockText: pendingHeadings.join('\n'),
    });
  }

  return grouped.map((g, idx) => {
    const prevBlock = idx > 0 ? grouped[idx - 1].fullBlockText : '';
    const nextBlock = idx < grouped.length - 1 ? grouped[idx + 1].fullBlockText : '';
    const parts: string[] = [];
    if (prevBlock) parts.push(`【前文脈絡】\n${prevBlock}`);
    parts.push(`【框選段落（${g.subHeading}）】\n${g.bodyText}`);
    if (nextBlock) parts.push(`【後文脈絡】\n${nextBlock}`);

    return {
      sectionId: sec.id,
      sectionCode: sec.code,
      sectionTitle: sec.title,
      sectionLabel:
        g.subHeading && g.subHeading !== sec.title
          ? `${secLabel} · ${g.subHeading}`
          : secLabel,
      blockIndex: idx,
      subHeading: g.subHeading,
      snippetText: g.bodyText,
      contextBefore: prevBlock,
      contextAfter: nextBlock,
      fullContextText: parts.join('\n\n'),
    };
  });
}

function describeReferenceKind(file: File): string {
  const mime = (file.type || '').toLowerCase();
  const lower = file.name.toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|heic)$/i.test(lower)) {
    return '圖片／照片';
  }
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/i.test(lower)) {
    return '影片';
  }
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    return 'PDF 文件';
  }
  if (/\.(xlsx|xls|csv)$/i.test(lower)) {
    return '試算表資料';
  }
  if (/\.(pptx|ppt)$/i.test(lower)) {
    return '簡報資料';
  }
  return '參考文件';
}

function cleanSectionLabel(code: string, title: string): string {
  const cleanTitle = title.replace(new RegExp(`^${code}\\s+`), '').trim();
  return `${code} ${cleanTitle}`;
}

function stripClientAuxiliaryPhrases(raw: string): string {
  let out = raw.replace(/\*\*/g, '').trim();
  const patterns = [
    /^(?:好的[，、。！]?\s*)?(?:我已經?|已經?|這邊已|系統已)?(?:結合[^。！？\n]*?[，、]\s*)?(?:為您|幫您|替您)?(?:強化|修改|更新|改寫|精簡|擴充|深化|調整|完成|重寫|優化|潤飾|補齊|新增)(?:了)?(?:「[^」]*」|『[^』]*』|[^。！？\n]{0,45}?)(?:之|的)?(?:段落|內容|描述|文字|章節)?[。！？：:]\s*/u,
    /^(?:本次修訂依據|此處修訂依據|修改說明如下|以下為修改後內容|以下是修改後的[^\n：:]*)[：:]?[^。！？\n]*[。！？]\s*/u,
  ];
  for (let i = 0; i < 3; i++) {
    for (const p of patterns) {
      const next = out.replace(p, '').trim();
      if (next) out = next;
    }
  }
  return out;
}

function inferDocTypeFromFileName(name: string, kind?: string): CoAuthorDocType {
  const lower = name.toLowerCase();
  if (
    kind === 'spreadsheet' ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.csv')
  ) {
    return 'excel';
  }
  if (
    kind === 'presentation' ||
    lower.endsWith('.pptx') ||
    lower.endsWith('.ppt')
  ) {
    return 'ppt';
  }
  return 'word';
}

export function buildCoAuthorDocFromDriveItem(
  item: HistoricalDriveItem,
  projectCode: string,
  projectName: string,
  projectId: string
): CoAuthorDocument {
  const existing = STARTER_COAUTHOR_DOCUMENTS.find(
    (d) => d.driveItemId === item.id || d.title === item.name
  );
  if (existing) {
    return structuredClone(existing);
  }

  const docType = inferDocTypeFromFileName(item.name, item.kind);
  const now = item.updatedAt ?? new Date().toISOString().slice(0, 10);

  if (docType === 'excel') {
    return {
      id: `doc-${item.id}`,
      projectId,
      projectCode,
      projectName,
      title: item.name,
      docType: 'excel',
      driveItemId: item.id,
      driveUrl: item.driveUrl,
      updatedAt: now,
      excelSheets: [
        {
          id: 'sheet-1',
          name: '1_專案核心追蹤表',
          columns: ['項次', '工作項目 / 規範指標', '權責組別', '預計完成日', '進度', '檢核備註'],
          rows: [
            ['01', `${item.name} — 核心架構與介面定義`, '系統工程組', '2026-04-30', '100%', '已完成初版審查'],
            ['02', '子系統軟硬體聯測與數據紀錄', '自駕研發組', '2026-05-20', '70%', '進行場域實測中'],
            ['03', '業主審查意見回覆與驗收準備', '專案管理 PM', '2026-06-15', '35%', '持續滾動追蹤'],
          ],
        },
      ],
    };
  }

  if (docType === 'ppt') {
    return {
      id: `doc-${item.id}`,
      projectId,
      projectCode,
      projectName,
      title: item.name,
      docType: 'ppt',
      driveItemId: item.id,
      driveUrl: item.driveUrl,
      updatedAt: now,
      pptSlides: [
        {
          id: 'slide-1',
          slideNumber: 1,
          title: item.name.replace(/\.(pptx|ppt)$/i, ''),
          subtitle: `${projectCode} · ${projectName} 專案簡報`,
          bullets: [
            '專案背景與階段性交付目標總覽',
            '關鍵自駕技術指標、感測器配置與安全連鎖機制',
            '跨標案介面協調進度與後續里程碑規劃',
          ],
          speakerNotes: '本頁說明專案簡報之核心目標與三大報告主軸。',
          layout: 'visual_split',
          images: [
            {
              id: 'init-slide-img',
              caption: `${projectCode} 專案架構視覺圖`,
              prompt: `${projectName} 系統架構示意圖`,
              dataUrl: buildProjectIllustrationDataUrl({
                title: item.name.replace(/\.(pptx|ppt)$/i, '').slice(0, 32),
                subtitle: `${projectCode} · ${projectName}`,
                theme: 'general',
              }),
              createdAt: now,
            },
          ],
        },
        {
          id: 'slide-2',
          slideNumber: 2,
          title: '系統設計重點與界面檢核項目',
          subtitle: '車載控制單元 (ADU)、路側設備與行控中心 (OCC) 協同運作',
          bullets: [
            '定位與感知：結合 3D LiDAR 點雲與 RTK-GNSS，達成公分級定位精度',
            '通訊與資安：5G 專網低延遲雙向遙測，符合車聯網加密規範',
            '異常應變 SOP：自動觸發最小風險操作 (MRM) 與行控台遠端接管',
          ],
          speakerNotes: '說明技術架構細節與異常處理流程。',
          layout: 'title_content',
          images: [],
        },
      ],
    };
  }

  return {
    id: `doc-${item.id}`,
    projectId,
    projectCode,
    projectName,
    title: item.name,
    docType: 'word',
    driveItemId: item.id,
    driveUrl: item.driveUrl,
    updatedAt: now,
    wordSections: [
      {
        id: 'sec-1',
        code: '1.0',
        title: '文件目的與專案適用範圍',
        content: `本文件隸屬於「${projectName}（${projectCode}）」，檔案名稱為《${item.name}》。\n\n旨在定義自駕運輸系統相關之軟硬體介面、工程規範、測試驗證標準與交付檢核程序，供研發團隊、場域工程與業主審查使用。`,
        images: [],
      },
      {
        id: 'sec-2',
        code: '2.0',
        title: '系統技術架構與核心規格要求',
        content:
          '1. 車載自駕與控制模組：支援全天候感知融合與雙迴路安全煞車控制。\n2. 中央行控與派遣介面：提供即時車隊遙測、班距調度、異常告警與遠端接管能力。\n3. 驗收與品質保證：依循專案 WBS 查核點完成模擬測試與實車現場驗證。',
        images: [],
      },
    ],
  };
}

export function ProjectLiveCoAuthor({
  groups,
  viewer,
  externalDocToOpen,
  onClearExternalDoc,
  onSwitchToHistoryTab,
  onActiveDocChange,
}: {
  groups: HistoricalYearGroup[];
  viewer: ProjectViewerContext;
  externalDocToOpen?: CoAuthorDocument | null;
  onClearExternalDoc?: () => void;
  onSwitchToHistoryTab?: () => void;
  onActiveDocChange?: (hasActiveDoc: boolean) => void;
}) {
  const [documents, setDocuments] = useState<CoAuthorDocument[]>(() =>
    structuredClone(STARTER_COAUTHOR_DOCUMENTS)
  );
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  useEffect(() => {
    onActiveDocChange?.(Boolean(activeDocId));
  }, [activeDocId, onActiveDocChange]);

  // Selected target region inside the active document
  const [selectedSectionId, setSelectedSectionId] = useState<string>('sec-1');
  const [selectedSheetId, setSelectedSheetId] = useState<string>('sheet-wbs');
  const [selectedSlideId, setSelectedSlideId] = useState<string>('slide-1');
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

  // Drag and drop state for the left file sidebar (Mode A only)
  const [isDraggingFileOverSidebar, setIsDraggingFileOverSidebar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingDocState, setUploadingDocState] = useState<{
    fileName: string;
    docType: CoAuthorDocType;
    stepLabel: string;
    progressPercent: number;
  } | null>(null);
  const [isIframeLoading, setIsIframeLoading] = useState<boolean>(false);

  // Reference materials staged into the chat / sprite composer
  const [stagedRefFiles, setStagedRefFiles] = useState<StagedRefAttachment[]>([]);
  const [isDraggingOverChat, setIsDraggingOverChat] = useState(false);

  // Resizable width & layout mode for the Collaboration Assistant (協作助手)
  // - 'split' (圖三模式，預設): Codex-style seamless side-by-side split panel
  // - 'floating' (圖一模式): Codex-style floating card in the top-right corner (does not squeeze center canvas)
  const [spriteWidth, setSpriteWidth] = useState<number>(390);
  const [spriteFloatingHeight, setSpriteFloatingHeight] = useState<number>(420);
  const [spriteLayoutMode, setSpriteLayoutMode] = useState<'floating' | 'split'>('split');
  const [isResizingSprite, setIsResizingSprite] = useState<boolean>(false);

  // Scope mode: 'whole_doc' (default: discuss/review/edit whole document) vs 'target_region' (focus on selected block)
  const [scopeMode, setScopeMode] = useState<'whole_doc' | 'target_region'>('whole_doc');

  // Left Sidebar (上格：檔案資訊與儲存位置 ＋ 下格：當前檔案內容索引) expanded by default when viewing a file
  const [chapterIndexCollapsed, setChapterIndexCollapsed] = useState<boolean>(false);

  // Cloud Storage Location Picker Modal state ("修改儲存到雲端的哪個位置 / 新增資料夾")
  const [showLocationModal, setShowLocationModal] = useState<boolean>(false);
  const [locationLoading, setLocationLoading] = useState<boolean>(false);
  const [locationMoving, setLocationMoving] = useState<boolean>(false);
  const [locationAccountEmail, setLocationAccountEmail] = useState<string>(viewer.email || '');
  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [currentFolderPath, setCurrentFolderPath] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: '我的雲端硬碟 (My Drive)' },
  ]);
  const [browseFolderId, setBrowseFolderId] = useState<string>('root');
  const [browseFolderPath, setBrowseFolderPath] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: '我的雲端硬碟 (My Drive)' },
  ]);
  const [childFolders, setChildFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('root');
  const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [creatingFolder, setCreatingFolder] = useState<boolean>(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [locationFeedback, setLocationFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Google Drive / Docs Native Editor Account (`authuser` parameter) & Popup Login Handler
  const [driveAuthUser, setDriveAuthUser] = useState<string>(() => viewer.email || '');
  const [customAuthEmailInput, setCustomAuthEmailInput] = useState<string>(() => viewer.email || '');
  const [showAuthAccountPopover, setShowAuthAccountPopover] = useState<boolean>(false);
  const [iframeReloadSeq, setIframeReloadSeq] = useState<number>(0);
  const [hasDriveWriteToken, setHasDriveWriteToken] = useState<boolean>(true);
  const [trySilentAuthIframe, setTrySilentAuthIframe] = useState<boolean>(false);
  const pendingDrivePatchRef = useRef<{
    driveFileId: string;
    targetSnippet: string;
    newContent: string;
    sectionTitleHint?: string;
  } | null>(null);

  function openDriveWriteAuthPopup() {
    const hint = (driveAuthUser || viewer.email || '').trim();
    const authUrl = `/auth/google?returnTo=${encodeURIComponent(
      '/tools/project-assistant?driveAuthPopup=1'
    )}${hint ? `&loginHint=${encodeURIComponent(hint)}` : ''}`;
    const width = 500;
    const height = 620;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    window.open(
      authUrl,
      'accsys_drive_write_oauth',
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`
    );
  }

  const sharedDriveIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const currentDoc = documents.find((d) => d.id === activeDocId);
    const driveId = currentDoc?.driveItemId;
    const docIdParam = driveId ? `&docId=${encodeURIComponent(driveId)}` : '';
    fetch(`/api/projects/coauthor?check=1${docIdParam}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((res: { hasDriveWriteToken?: boolean; email?: string; sharedDocIds?: string[] }) => {
        if (cancelled) return;
        const ok = Boolean(res?.hasDriveWriteToken);
        setHasDriveWriteToken(ok);
        if (res?.email && res.email.includes('@')) {
          setDriveAuthUser(res.email.trim());
          setCustomAuthEmailInput(res.email.trim());
          try {
            window.localStorage.setItem('td_drive_auth_user', res.email.trim());
          } catch {
            // ignore
          }
        }
        if (
          driveId &&
          !sharedDriveIdsRef.current.has(driveId) &&
          res?.sharedDocIds?.includes(driveId)
        ) {
          sharedDriveIdsRef.current.add(driveId);
          setIframeReloadSeq((s) => s + 1);
        }
        if (!ok) {
          setTrySilentAuthIframe(true);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [activeDocId, documents]);

  useEffect(() => {
    function handleAuthPayload(data: { type?: string } | null) {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ACCSYS_DRIVE_AUTH_SILENT_FAILED') {
        setTrySilentAuthIframe(false);
      } else if (data.type === 'ACCSYS_DRIVE_AUTH_DONE') {
        setHasDriveWriteToken(true);
        setTrySilentAuthIframe(false);
        const pending = pendingDrivePatchRef.current;
        if (pending) {
          pendingDrivePatchRef.current = null;
          void fetch('/api/projects/coauthor', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(pending),
          })
            .then((r) => r.json())
            .then((res: { updated?: boolean; liveStreaming?: boolean }) => {
              if (res?.updated && !res?.liveStreaming) {
                setIframeReloadSeq((s) => s + 1);
              }
            })
            .catch(() => null);
        }
      }
    }

    function onMessage(ev: MessageEvent) {
      handleAuthPayload(ev.data as { type?: string } | null);
    }

    function onStorage(ev: StorageEvent) {
      if (ev.key === 'accsys_drive_auth_done' && ev.newValue) {
        handleAuthPayload({ type: 'ACCSYS_DRIVE_AUTH_DONE' });
      }
    }

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('accsys_drive_auth_channel');
      bc.onmessage = (ev) => handleAuthPayload(ev.data as { type?: string } | null);
    } catch {
      bc = null;
    }

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      if (bc) bc.close();
    };
  }, []);

  useEffect(() => {
    const loginEmail = (viewer.email || '').trim();
    if (loginEmail) {
      setDriveAuthUser(loginEmail);
      setCustomAuthEmailInput(loginEmail);
      try {
        window.localStorage.setItem('td_drive_auth_user', loginEmail);
      } catch {
        // ignore
      }
      return;
    }
    try {
      const saved = window.localStorage.getItem('td_drive_auth_user');
      if (saved !== null && saved.trim() !== '') {
        setDriveAuthUser(saved.trim());
        setCustomAuthEmailInput(saved.trim());
      }
    } catch {
      // ignore storage errors
    }
  }, [viewer.email]);

  function applyDriveAuthUser(nextUser: string) {
    const clean = nextUser.trim();
    setDriveAuthUser(clean);
    setCustomAuthEmailInput(clean);
    setIframeReloadSeq((n) => n + 1);
    setShowAuthAccountPopover(false);
    try {
      window.localStorage.setItem('td_drive_auth_user', clean);
    } catch {
      // ignore storage errors
    }
  }

  function openGoogleAccountLoginPopup(targetContinueUrl: string) {
    const chooserUrl = `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(
      targetContinueUrl
    )}&service=wise`;
    const width = 520;
    const height = 680;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const popup = window.open(
      chooserUrl,
      'td_google_account_login',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      window.open(chooserUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        setIframeReloadSeq((n) => n + 1);
      }
    }, 800);
  }

  // AI Co-authoring streaming state & prompt queue
  const [isAiWriting, setIsAiWriting] = useState(false);
  const [aiWritingTargetLabel, setAiWritingTargetLabel] = useState<string | null>(null);
  const [streamingSectionId, setStreamingSectionId] = useState<string | null>(null);
  const [promptQueue, setPromptQueue] = useState<QueuedPromptItem[]>([]);
  const isProcessingPromptRef = useRef(false);
  const [spriteMinimized, setSpriteMinimized] = useState(false);
  const [composerInput, setComposerInput] = useState('');
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Floating Selection Orb ("小球") & Linked Paragraph state
  const [selectionOrb, setSelectionOrb] = useState<FloatingSelectionOrbState>({
    visible: false,
    topPx: 260,
    leftPercent: 89,
    linked: false,
    sectionId: undefined,
    sectionLabel: '',
    snippetText: '',
  });
  const [linkedSelection, setLinkedSelection] = useState<{
    sectionId?: string;
    label: string;
    snippetText: string;
    contextBefore?: string;
    contextAfter?: string;
    fullContextText?: string;
    blockIndex?: number;
    insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
    cursorAnchorBefore?: string;
    cursorAnchorAfter?: string;
  } | null>(null);
  const [isResolvingVisualSelection, setIsResolvingVisualSelection] = useState(false);
  const [spriteSignalFlash, setSpriteSignalFlash] = useState(false);

  const inFlightVisualSelectionRef = useRef<{
    orbTopPx: number;
    allowCursorContext: boolean;
    startedAt: number;
    promise: Promise<{
      sectionId?: string;
      sectionLabel: string;
      snippetText: string;
      contextBefore: string;
      contextAfter: string;
      fullContextText: string;
      blockIndex?: number;
      insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
      cursorAnchorBefore?: string;
      cursorAnchorAfter?: string;
    } | null>;
  } | null>(null);
  const latestLinkedSelectionRef = useRef<typeof linkedSelection>(null);
  latestLinkedSelectionRef.current = linkedSelection;

  const editorViewportRef = useRef<HTMLDivElement | null>(null);
  const nativeIframeRef = useRef<HTMLIFrameElement | null>(null);
  const probeLayerRef = useRef<HTMLDivElement | null>(null);
  const isPointerInEditorRef = useRef(false);
  const lastHoverPosRef = useRef<{ x: number; y: number; xRatio: number; time: number } | null>(
    null
  );
  const iframeDragStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const iframeScrollTopRef = useRef<number>(0);
  const lastWheelAtRef = useRef<number>(0);
  const userLockedSectionInSidebarRef = useRef<boolean>(false);
  const sectionHeadingMapRef = useRef<Record<string, string>>({});
  const lastSidebarClickAtRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const lastHeadingJumpRef = useRef<{ headingId: string; time: number }>({
    headingId: '',
    time: 0,
  });
  const [expandedSectionIds, setExpandedSectionIds] = useState<Record<string, boolean>>({});

  function getSubSectionsForWordSection(
    sec: WordSection,
    secIdx: number
  ): WordSubSection[] {
    if (Array.isArray(sec.subSections) && sec.subSections.length > 0) {
      return sec.subSections.map((sub) => ({
        ...sub,
        headingId: sectionHeadingMapRef.current[sub.id] ?? sub.headingId,
      }));
    }

    // Client-side fallback sub-section parser for seed / custom sections
    const rawParas = (sec.content || '')
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (rawParas.length <= 1) return [];

    const subs: WordSubSection[] = [];
    let currentTitle = '';
    let currentLevel: 2 | 3 = 2;
    let currentLines: string[] = [];

    const isSubHeadingLine = (line: string): boolean => {
      const clean = line.replace(/[\u000b\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!clean || clean.length < 3 || clean.length > 56 || clean.includes('｜')) return false;
      if (/[。；！？]$/.test(clean)) return false;
      if (/^※\s*\S+/.test(clean)) return true;
      if (/^[一二三四五六七八九十]+、\s*\S+/.test(clean)) return true;
      if (/^[(（][一二三四五六七八九十\d]+[)）]\s*\S+/.test(clean)) return true;
      if (/^[1-9]\d*(?:\.\d+)+\.?\s*[^\d\s]/.test(clean) && !/次\/|%|公里|小時|萬元|千元/.test(clean)) return true;
      if (/^[1-9]\d*\.\s+\S+/.test(clean) && clean.length <= 42) return true;
      if (
        /^[\u4e00-\u9fff()（）/、，\s]{2,18}\s+[A-Z][A-Za-z0-9\s,&/()-]{3,42}[：:]?$/.test(
          clean
        )
      ) {
        return true;
      }
      return false;
    };

    for (let i = 0; i < rawParas.length; i++) {
      const p = rawParas[i];
      const firstLine = p.split('\n')[0].trim();
      if (isSubHeadingLine(firstLine)) {
        if (currentTitle && currentLines.length > 0) {
          const subIdx = subs.length + 1;
          const subId = `${sec.id}-sub-${subIdx}`;
          subs.push({
            id: subId,
            code: `${secIdx + 1}.${subIdx}`,
            title: currentTitle.slice(0, 48),
            content: currentLines.join('\n\n'),
            headingId: sectionHeadingMapRef.current[subId],
            level: currentLevel,
          });
        }
        currentTitle = firstLine.replace(/[\u000b\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        currentLevel =
          /^[(（][一二三四五六七八九十\d]+[)）]/.test(currentTitle) ||
          /^\d+\.\d+/.test(currentTitle)
            ? 3
            : 2;
        currentLines = [p];
      } else if (currentTitle) {
        currentLines.push(p);
      } else {
        // Check if a paragraph itself contains numbered list lines (1. ..., 2. ..., 3. ...)
        const innerLines = p
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const numberedLines = innerLines.filter((l) => /^[1-9]\d*[.、]\s*\S+/.test(l));
        if (numberedLines.length >= 2) {
          for (const nl of numberedLines) {
            const subIdx = subs.length + 1;
            const subId = `${sec.id}-sub-${subIdx}`;
            const shortLabel = nl.split(/[：:]/)[0].trim().slice(0, 42);
            subs.push({
              id: subId,
              code: `${secIdx + 1}.${subIdx}`,
              title: shortLabel,
              content: nl,
              headingId: sectionHeadingMapRef.current[subId],
              level: 3,
            });
          }
        }
      }
    }

    if (currentTitle && currentLines.length > 0) {
      const subIdx = subs.length + 1;
      const subId = `${sec.id}-sub-${subIdx}`;
      subs.push({
        id: subId,
        code: `${secIdx + 1}.${subIdx}`,
        title: currentTitle.slice(0, 48),
        content: currentLines.join('\n\n'),
        headingId: sectionHeadingMapRef.current[subId],
        level: currentLevel,
      });
    }

    return subs;
  }

  const defaultWelcomeMessage: ChatMessage = useMemo(
    () => ({
      id: 'welcome-msg',
      role: 'assistant',
      text: `您好 ${viewer.name}，我是專案助手。可協助撰寫與修改專案的 Word、Excel、PPT 檔案與生成專案配圖。請從左側選擇或拖放檔案開始，或直接輸入專案問題。`,
      timestamp: '剛剛',
    }),
    [viewer.name]
  );

  // Per-document / per-session conversation history
  const [messages, setMessages] = useState<ChatMessage[]>([defaultWelcomeMessage]);

  const spriteEndRef = useRef<HTMLDivElement | null>(null);
  const fullChatEndRef = useRef<HTMLDivElement | null>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId) ?? null,
    [documents, activeDocId]
  );

  const resolvedDocIdsRef = useRef<Set<string>>(new Set());
  const droppedFilesByDocIdRef = useRef<Map<string, File>>(new Map());

  // Open external document passed from "歷史文件" tab
  useEffect(() => {
    if (!externalDocToOpen) return;
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === externalDocToOpen.id);
      if (exists) return prev;
      return [externalDocToOpen, ...prev];
    });
    setActiveDocId(externalDocToOpen.id);
    setScopeMode('whole_doc');
    setSelectedCell(null);
    setLinkedSelection(null);
    setSelectionOrb((prev) => ({ ...prev, visible: false, linked: false }));
    if (externalDocToOpen.wordSections?.[0]) {
      setSelectedSectionId(externalDocToOpen.wordSections[0].id);
    }
    if (externalDocToOpen.excelSheets?.[0]) {
      setSelectedSheetId(externalDocToOpen.excelSheets[0].id);
    }
    if (externalDocToOpen.pptSlides?.[0]) {
      setSelectedSlideId(externalDocToOpen.pptSlides[0].id);
    }
    setMessages([
      {
        id: `open-${Date.now()}`,
        role: 'assistant',
        text: `已開啟「${externalDocToOpen.title}」。可直接討論整份文件，或點選區域鎖定改寫。`,
        timestamp: '剛剛',
      },
    ]);
    onClearExternalDoc?.();
  }, [externalDocToOpen, onClearExternalDoc]);

  // Automatically resolve native Google Doc ID & real document chapters for any active document
  useEffect(() => {
    if (!activeDoc) return;
    const alreadyFullyResolved =
      resolvedDocIdsRef.current.has(activeDoc.id) &&
      Boolean(activeDoc.driveItemId) &&
      (activeDoc.docType !== 'word' || (activeDoc.wordSections?.length ?? 0) > 1);
    if (alreadyFullyResolved) return;

    // Starter documents already have resolved native IDs and real sections
    if (
      activeDoc.id.startsWith('starter-') &&
      activeDoc.driveItemId &&
      (activeDoc.wordSections?.length ?? 0) > 2
    ) {
      resolvedDocIdsRef.current.add(activeDoc.id);
      return;
    }

    resolvedDocIdsRef.current.add(activeDoc.id);
    let cancelled = false;

    void fetch('/api/projects/coauthor', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: activeDoc.title,
        docType: activeDoc.docType,
        existingDriveId: activeDoc.driveItemId,
      }),
    })
      .then((r) => r.json())
      .then(
        (res: {
          driveItemId?: string;
          driveUrl?: string;
          wordSections?: Array<{ id: string; code: string; title: string; content: string }>;
        }) => {
          if (cancelled || !res?.driveItemId) return;
          setDocuments((prev) =>
            prev.map((d) => {
              if (d.id !== activeDoc.id) return d;
              const matchedMeta = findMatchingProjectAndDriveItem(d.title);
              const nextSections =
                res.wordSections && res.wordSections.length > 0
                  ? res.wordSections.map((s) => ({ ...s, images: [] }))
                  : d.wordSections;
              return {
                ...d,
                projectCode:
                  d.id.startsWith('upload-') ? matchedMeta.projectCode : d.projectCode,
                projectName:
                  d.id.startsWith('upload-') ? matchedMeta.projectName : d.projectName,
                driveItemId: res.driveItemId,
                driveUrl: res.driveUrl ?? d.driveUrl,
                wordSections: nextSections,
              };
            })
          );
          if (res.wordSections?.[0]) {
            setSelectedSectionId(res.wordSections[0].id);
          }
          setLinkedSelection((prev) =>
            prev && prev.label.includes('1.1 通則') && !activeDoc.title.includes('02584K')
              ? null
              : prev
          );
        }
      )
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [activeDoc]);

  // Pre-warm Google Docs section heading IDs (`#heading=h.xxxx`) so double-clicking any item in "當前檔案內容索引" jumps immediately in 0ms
  useEffect(() => {
    if (!activeDoc || activeDoc.docType !== 'word') return;
    const fid = getEffectiveActiveDriveFileId(activeDoc);
    if (!fid) return;

    const initialMap: Record<string, string> = {};
    for (const sec of activeDoc.wordSections ?? []) {
      if (sec.headingId) {
        initialMap[sec.id] = sec.headingId;
      }
      for (const sub of sec.subSections ?? []) {
        if (sub.headingId) {
          initialMap[sub.id] = sub.headingId;
        }
      }
    }
    if (Object.keys(initialMap).length > 0) {
      sectionHeadingMapRef.current = {
        ...sectionHeadingMapRef.current,
        ...initialMap,
      };
    }

    let cancelled = false;
    void fetch('/api/projects/coauthor', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'resolve_section_heading',
        driveFileId: fid,
      }),
    })
      .then((r) => r.json())
      .then(
        (data: {
          headingBySectionId?: Record<string, string>;
          wordSections?: Array<{
            id: string;
            code: string;
            title: string;
            content: string;
            headingId?: string;
            subSections?: WordSubSection[];
          }>;
        }) => {
          if (cancelled) return;
          if (data?.headingBySectionId) {
            sectionHeadingMapRef.current = {
              ...sectionHeadingMapRef.current,
              ...data.headingBySectionId,
            };
          }
          setDocuments((prev) =>
            prev.map((d) => {
              if (d.id !== activeDoc.id || !d.wordSections) return d;
              if (data?.wordSections && data.wordSections.length > 0) {
                return {
                  ...d,
                  wordSections: data.wordSections.map((ws, idx) => ({
                    ...ws,
                    headingId:
                      data.headingBySectionId?.[ws.id] ?? ws.headingId,
                    subSections: (ws.subSections ?? []).map((sub) => ({
                      ...sub,
                      headingId:
                        data.headingBySectionId?.[sub.id] ?? sub.headingId,
                    })),
                    images: d.wordSections?.[idx]?.images ?? [],
                  })),
                };
              }
              return {
                ...d,
                wordSections: d.wordSections.map((s) => ({
                  ...s,
                  headingId: data?.headingBySectionId?.[s.id] ?? s.headingId,
                  subSections: (s.subSections ?? []).map((sub) => ({
                    ...sub,
                    headingId:
                      data?.headingBySectionId?.[sub.id] ?? sub.headingId,
                  })),
                })),
              };
            })
          );
        }
      )
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [activeDoc?.id, activeDoc?.driveItemId, activeDoc?.docType]);

  function getEffectiveActiveDriveFileId(doc: CoAuthorDocument | null): string {
    if (!doc) return '';
    if (doc.driveItemId) return doc.driveItemId;
    const matched = findMatchingProjectAndDriveItem(doc.title).driveItem?.id;
    if (matched) return matched;
    if (doc.id.startsWith('upload-')) return '';
    return doc.docType === 'word'
      ? '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY'
      : doc.docType === 'excel'
      ? '1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9'
      : '1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B';
  }

  async function fetchDriveLocationData(fileId: string, targetBrowseId?: string) {
    setLocationLoading(true);
    try {
      const qs = new URLSearchParams();
      if (fileId) qs.set('fileId', fileId);
      if (targetBrowseId) qs.set('browseFolderId', targetBrowseId);
      const res = await fetch(`/api/projects/drive-location?${qs.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        accountEmail?: string;
        currentFolderId?: string;
        currentPath?: Array<{ id: string; name: string }>;
        browseFolderId?: string;
        browsePath?: Array<{ id: string; name: string }>;
        folders?: Array<{ id: string; name: string }>;
      };
      if (data.accountEmail) setLocationAccountEmail(data.accountEmail);
      if (data.currentFolderId) setCurrentFolderId(data.currentFolderId);
      if (data.currentPath && data.currentPath.length > 0) {
        setCurrentFolderPath(data.currentPath);
      }
      const nextBrowseId = data.browseFolderId || data.currentFolderId || 'root';
      setBrowseFolderId(nextBrowseId);
      setSelectedFolderId(nextBrowseId);
      if (data.browsePath && data.browsePath.length > 0) {
        setBrowseFolderPath(data.browsePath);
      }
      setChildFolders(data.folders ?? []);
    } catch {
      // ignore network error
    } finally {
      setLocationLoading(false);
    }
  }

  // Silently fetch current Drive folder path when switching documents so the button tooltip/label is accurate
  useEffect(() => {
    if (!activeDoc) return;
    const fid = getEffectiveActiveDriveFileId(activeDoc);
    if (!fid) return;
    let cancelled = false;
    fetch(`/api/projects/drive-location?fileId=${encodeURIComponent(fid)}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then(
        (data: {
          accountEmail?: string;
          currentFolderId?: string;
          currentPath?: Array<{ id: string; name: string }>;
        }) => {
          if (cancelled) return;
          if (data.accountEmail) setLocationAccountEmail(data.accountEmail);
          if (data.currentFolderId) setCurrentFolderId(data.currentFolderId);
          if (data.currentPath && data.currentPath.length > 0) {
            setCurrentFolderPath(data.currentPath);
          }
        }
      )
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [activeDoc?.id, activeDoc?.driveItemId]);

  function openDriveLocationModal() {
    if (!activeDoc) return;
    setLocationFeedback(null);
    setShowNewFolderInput(false);
    setNewFolderName('');
    setShowLocationModal(true);
    const fid = getEffectiveActiveDriveFileId(activeDoc);
    void fetchDriveLocationData(fid);
  }

  async function handleCreateDriveFolder() {
    const clean = newFolderName.trim();
    if (!clean || creatingFolder) return;
    setCreatingFolder(true);
    setLocationFeedback(null);
    try {
      const res = await fetch('/api/projects/drive-location', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create_folder',
          parentFolderId: browseFolderId || 'root',
          folderName: clean,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        createdFolder?: { id: string; name: string };
        browseFolderId?: string;
        browsePath?: Array<{ id: string; name: string }>;
        folders?: Array<{ id: string; name: string }>;
      };
      if (!res.ok || !data.ok) {
        setLocationFeedback({
          type: 'error',
          message: data.error || '建立資料夾失敗',
        });
        return;
      }
      setNewFolderName('');
      setShowNewFolderInput(false);
      if (data.browseFolderId) {
        setBrowseFolderId(data.browseFolderId);
      }
      if (data.createdFolder?.id) {
        setSelectedFolderId(data.createdFolder.id);
      } else if (data.browseFolderId) {
        setSelectedFolderId(data.browseFolderId);
      }
      if (data.browsePath) setBrowseFolderPath(data.browsePath);
      if (data.folders) setChildFolders(data.folders);
      setLocationFeedback({
        type: 'success',
        message: `已建立並選取資料夾「${data.createdFolder?.name ?? clean}」，點擊右下角「儲存至此位置」即可將檔案移入。`,
      });
    } catch {
      setLocationFeedback({ type: 'error', message: '建立資料夾時發生網路錯誤' });
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleDeleteDriveFolder(
    folderId: string,
    folderName: string,
    isCurrentBrowseFolder = false
  ) {
    if (!folderId || folderId === 'root' || deletingFolderId) return;
    setDeletingFolderId(folderId);
    setLocationFeedback(null);
    const fallbackParentId = isCurrentBrowseFolder
      ? browseFolderPath[browseFolderPath.length - 2]?.id || 'root'
      : browseFolderId || 'root';

    try {
      const res = await fetch('/api/projects/drive-location', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_folder',
          folderId,
          parentFolderId: fallbackParentId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        browseFolderId?: string;
        browsePath?: Array<{ id: string; name: string }>;
        folders?: Array<{ id: string; name: string }>;
      };
      if (!res.ok || !data.ok) {
        setLocationFeedback({
          type: 'error',
          message: data.error || `刪除資料夾「${folderName}」失敗`,
        });
        return;
      }

      const nextBrowseId = data.browseFolderId || fallbackParentId;
      setBrowseFolderId(nextBrowseId);
      if (selectedFolderId === folderId) {
        setSelectedFolderId(nextBrowseId);
      }
      if (data.browsePath) setBrowseFolderPath(data.browsePath);
      if (data.folders) {
        setChildFolders(data.folders);
      } else {
        setChildFolders((prev) => prev.filter((f) => f.id !== folderId));
      }
      setLocationFeedback({
        type: 'success',
        message: `已刪除雲端資料夾「${folderName}」`,
      });
    } catch {
      setLocationFeedback({
        type: 'error',
        message: `刪除資料夾「${folderName}」時發生網路錯誤`,
      });
    } finally {
      setDeletingFolderId(null);
    }
  }

  async function handleMoveFileToFolder() {
    if (!activeDoc || locationMoving) return;
    const fid = getEffectiveActiveDriveFileId(activeDoc);
    if (!fid) {
      setLocationFeedback({ type: 'error', message: '檔案尚未同步至雲端，請稍候再試' });
      return;
    }
    const targetId = selectedFolderId || browseFolderId || 'root';
    setLocationMoving(true);
    setLocationFeedback(null);
    try {
      const res = await fetch('/api/projects/drive-location', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'move_file',
          fileId: fid,
          targetFolderId: targetId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        currentFolderId?: string;
        currentPath?: Array<{ id: string; name: string }>;
      };
      if (!res.ok || !data.ok) {
        setLocationFeedback({
          type: 'error',
          message: data.error || '變更儲存位置失敗',
        });
        return;
      }
      if (data.currentFolderId) setCurrentFolderId(data.currentFolderId);
      if (data.currentPath && data.currentPath.length > 0) {
        setCurrentFolderPath(data.currentPath);
      }
      const folderLabel =
        data.currentPath?.[data.currentPath.length - 1]?.name ?? '指定資料夾';
      setLocationFeedback({
        type: 'success',
        message: `已成功將檔案儲存位置變更至「${folderLabel}」！`,
      });
      setTimeout(() => {
        setShowLocationModal(false);
      }, 900);
    } catch {
      setLocationFeedback({ type: 'error', message: '移動檔案位置時發生錯誤' });
    } finally {
      setLocationMoving(false);
    }
  }

  useEffect(() => {
    spriteEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    fullChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiWriting, promptQueue]);

  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    };
  }, []);

  // All semantic paragraph blocks (each with contextBefore / snippetText / contextAfter) across the active Word document
  const allDocSemanticBlocks = useMemo(() => {
    if (!activeDoc || activeDoc.docType !== 'word') return [];
    const out: Array<SemanticParagraphBlock & { globalIndex: number }> = [];
    let gIdx = 0;
    for (const sec of activeDoc.wordSections ?? []) {
      const blocks = buildSemanticBlocksForWordSection(sec);
      for (const b of blocks) {
        out.push({ ...b, globalIndex: gIdx++ });
      }
    }
    return out;
  }, [activeDoc]);

  /**
   * Strictly checks if a candidate text (from DOM selection, clipboard, or manual input)
   * actually exists inside the currently open document (`activeDoc`).
   * - If it does NOT exist in `activeDoc` (e.g. stale clipboard from another project like "出場晚一點..."),
   *   returns `null` so unrelated clipboard data is NEVER accepted.
   * - If it DOES exist in `activeDoc`, locates the exact paragraph block and returns it with its
   *   surrounding context (`contextBefore`, `contextAfter`, `fullContextText`).
   */
  function matchTextInActiveDocumentWithContext(
    candidateText?: string,
    headingHint?: string
  ): {
    sectionId?: string;
    sectionLabel: string;
    snippetText: string;
    contextBefore: string;
    contextAfter: string;
    fullContextText: string;
    blockIndex?: number;
  } | null {
    if (!activeDoc || !candidateText) return null;
    const raw = candidateText.trim();
    const normQuery = raw.replace(/[\s\u3000]+/g, '');
    if (normQuery.length < 4) return null;
    const normHeadingHint = (headingHint ?? '').replace(/[\s\u3000]+/g, '');

    if (activeDoc.docType === 'word') {
      const probeSlice = normQuery.slice(0, Math.min(28, normQuery.length));
      const midSlice =
        normQuery.length >= 12
          ? normQuery.slice(
              Math.floor(normQuery.length / 4),
              Math.floor(normQuery.length / 4) + 14
            )
          : probeSlice;
      const endSlice =
        normQuery.length >= 18
          ? normQuery.slice(Math.max(0, normQuery.length - 16))
          : probeSlice;

      let bestBlk: (SemanticParagraphBlock & { globalIndex: number }) | null = null;
      let bestScore = 0;

      for (const blk of allDocSemanticBlocks) {
        const normBody = blk.snippetText.replace(/[\s\u3000]+/g, '');
        const normFull = `${blk.subHeading}\n${blk.snippetText}`.replace(/[\s\u3000]+/g, '');
        if (!normFull) continue;

        let score = 0;
        if (normBody.includes(probeSlice) || normFull.includes(probeSlice)) {
          score += 100;
        }
        if (midSlice.length >= 6 && (normBody.includes(midSlice) || normFull.includes(midSlice))) {
          score += 50;
        }
        if (endSlice.length >= 8 && normBody.includes(endSlice)) {
          score += 40;
        }
        if (normBody.length >= 10 && normQuery.includes(normBody.slice(0, 18))) {
          score += 60;
        }
        if (
          normHeadingHint.length >= 4 &&
          blk.subHeading.replace(/[\s\u3000]+/g, '').includes(normHeadingHint.slice(0, 10))
        ) {
          // Only use heading hint as a bonus when body also matches, or when the selection itself is a short heading
          if (score > 0 || normQuery.length <= 24) {
            score += 30;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestBlk = blk;
        }
      }

      if (bestBlk && bestScore >= 50) {
        const isHeadingOnlySelection =
          raw.length <= 36 &&
          bestBlk.subHeading.replace(/[\s\u3000]+/g, '').includes(normQuery);
        const effectiveSnippet =
          !isHeadingOnlySelection && raw.length >= 8 ? raw : bestBlk.snippetText;
        const parts: string[] = [];
        if (bestBlk.contextBefore) parts.push(`【前文脈絡】\n${bestBlk.contextBefore}`);
        parts.push(`【框選段落（${bestBlk.sectionLabel}）】\n${effectiveSnippet}`);
        if (bestBlk.contextAfter) parts.push(`【後文脈絡】\n${bestBlk.contextAfter}`);
        return {
          sectionId: bestBlk.sectionId,
          sectionLabel: bestBlk.sectionLabel,
          snippetText: effectiveSnippet,
          contextBefore: bestBlk.contextBefore,
          contextAfter: bestBlk.contextAfter,
          fullContextText: parts.join('\n\n'),
          blockIndex: bestBlk.globalIndex,
        };
      }
      return null;
    }

    if (activeDoc.docType === 'excel') {
      for (const sheet of activeDoc.excelSheets ?? []) {
        for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
          const rowText = sheet.rows[rIdx].join(' ｜ ');
          const normRow = rowText.replace(/[\s\u3000]+/g, '');
          if (normRow.includes(normQuery.slice(0, Math.min(16, normQuery.length)))) {
            const beforeRow = rIdx > 0 ? sheet.rows[rIdx - 1].join(' ｜ ') : '';
            const afterRow = rIdx < sheet.rows.length - 1 ? sheet.rows[rIdx + 1].join(' ｜ ') : '';
            const fullParts = [
              beforeRow ? `【前一列】${beforeRow}` : '',
              `【框選列】${rowText}`,
              afterRow ? `【後一列】${afterRow}` : '',
            ].filter(Boolean);
            return {
              sectionId: sheet.id,
              sectionLabel: `${sheet.name}（第 ${rIdx + 1} 列）`,
              snippetText: rowText,
              contextBefore: beforeRow,
              contextAfter: afterRow,
              fullContextText: fullParts.join('\n'),
            };
          }
        }
      }
      return null;
    }

    for (const slide of activeDoc.pptSlides ?? []) {
      const slideText = `${slide.title}\n${slide.bullets.join('\n')}`;
      const normSlide = slideText.replace(/[\s\u3000]+/g, '');
      if (normSlide.includes(normQuery.slice(0, Math.min(16, normQuery.length)))) {
        return {
          sectionId: slide.id,
          sectionLabel: `Slide ${slide.slideNumber}：${slide.title}`,
          snippetText: slideText,
          contextBefore: slide.subtitle || '',
          contextAfter: slide.speakerNotes || '',
          fullContextText: slideText,
        };
      }
    }
    return null;
  }

  function matchCursorContextInActiveDocument(
    visibleBeforeText?: string,
    visibleAfterText?: string,
    headingHint?: string
  ): {
    sectionId?: string;
    sectionLabel: string;
    snippetText: string;
    contextBefore: string;
    contextAfter: string;
    fullContextText: string;
    blockIndex?: number;
    insertMode: 'insert_before' | 'insert_after';
    cursorAnchorBefore: string;
    cursorAnchorAfter: string;
  } | null {
    if (!activeDoc || activeDoc.docType !== 'word' || allDocSemanticBlocks.length === 0) {
      return null;
    }

    const cleanLines = (raw?: string): string[] =>
      (raw ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length >= 3 &&
            !/^\d{1,3}$/.test(l) &&
            !/^移動代步服務生態系創新優化計畫$/.test(l.replace(/\s+/g, ''))
        );

    const afterLines = cleanLines(visibleAfterText);
    const beforeLines = cleanLines(visibleBeforeText);

    // 1. Try matching `afterLines` (text immediately below the cursor on the visible page)
    if (afterLines.length > 0) {
      let matchedAfterBlk: (SemanticParagraphBlock & { globalIndex: number }) | null = null;
      for (const line of [...afterLines].sort((a, b) => b.length - a.length)) {
        const hit = matchTextInActiveDocumentWithContext(line, headingHint);
        if (hit && typeof hit.blockIndex === 'number') {
          matchedAfterBlk = allDocSemanticBlocks[hit.blockIndex] ?? null;
          if (matchedAfterBlk) break;
        }
      }
      if (!matchedAfterBlk && headingHint) {
        const normH = headingHint.replace(/[\s\u3000]+/g, '');
        matchedAfterBlk =
          allDocSemanticBlocks.find(
            (b) =>
              b.globalIndex > 0 &&
              (b.sectionTitle.replace(/[\s\u3000]+/g, '').includes(normH) ||
                b.subHeading.replace(/[\s\u3000]+/g, '').includes(normH))
          ) ?? null;
      }

      if (matchedAfterBlk) {
        const gIdx = matchedAfterBlk.globalIndex;
        // Pull up to 11 preceding semantic blocks (e.g. the entire preceding partner company section 5.35~5.45)
        // so when the cursor is right before a major heading like "貳、計畫內容與實施方法", AI sees the full "上方哇哇科技" format!
        const prevBlocks = allDocSemanticBlocks.slice(Math.max(0, gIdx - 11), gIdx);
        const richBefore =
          prevBlocks.length > 0
            ? prevBlocks
                .map((b) =>
                  b.subHeading && !b.snippetText.startsWith(b.subHeading)
                    ? `${b.subHeading}\n${b.snippetText}`
                    : b.snippetText
                )
                .join('\n\n')
            : beforeLines.join('\n');
        const richAfter = `${matchedAfterBlk.subHeading}\n${matchedAfterBlk.snippetText}`;
        const label = `${matchedAfterBlk.sectionLabel}（游標插入位置）`;

        return {
          sectionId: prevBlocks[prevBlocks.length - 1]?.sectionId ?? matchedAfterBlk.sectionId,
          sectionLabel: label,
          snippetText: '',
          contextBefore: richBefore,
          contextAfter: richAfter,
          fullContextText: [
            richBefore ? `【游標上方前文脈絡（請參考此處結構與格式）】\n${richBefore}` : '',
            `【目前游標插入位置】\n（位於「${matchedAfterBlk.sectionLabel}」正上方空白處）`,
            richAfter ? `【游標下方後文脈絡】\n${richAfter}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          blockIndex: gIdx,
          insertMode: 'insert_before',
          cursorAnchorBefore: beforeLines.join('\n'),
          cursorAnchorAfter: afterLines.join('\n'),
        };
      }
    }

    // 2. Try matching `beforeLines` (text immediately above the cursor on the visible page)
    if (beforeLines.length > 0) {
      const lastLine = beforeLines[beforeLines.length - 1];
      const hit = matchTextInActiveDocumentWithContext(lastLine, headingHint);
      if (hit && typeof hit.blockIndex === 'number') {
        const gIdx = hit.blockIndex;
        const prevBlocks = allDocSemanticBlocks.slice(Math.max(0, gIdx - 8), gIdx + 1);
        const richBefore = prevBlocks
          .map((b) =>
            b.subHeading && !b.snippetText.startsWith(b.subHeading)
              ? `${b.subHeading}\n${b.snippetText}`
              : b.snippetText
          )
          .join('\n\n');
        const nextBlk = allDocSemanticBlocks[gIdx + 1];
        const richAfter = nextBlk
          ? `${nextBlk.subHeading}\n${nextBlk.snippetText}`
          : afterLines.join('\n');
        return {
          sectionId: hit.sectionId,
          sectionLabel: `${hit.sectionLabel}（游標插入位置）`,
          snippetText: '',
          contextBefore: richBefore,
          contextAfter: richAfter,
          fullContextText: [
            richBefore ? `【游標上方前文脈絡（請參考此處結構與格式）】\n${richBefore}` : '',
            `【目前游標插入位置】\n（位於「${hit.sectionLabel}」正下方）`,
            richAfter ? `【游標下方後文脈絡】\n${richAfter}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          blockIndex: gIdx,
          insertMode: afterLines.length > 0 ? 'insert_before' : 'insert_after',
          cursorAnchorBefore: beforeLines.join('\n'),
          cursorAnchorAfter: afterLines.join('\n'),
        };
      }
    }

    if (afterLines.length > 0 || beforeLines.length > 0) {
      return {
        sectionId: undefined,
        sectionLabel: headingHint ? `${headingHint}（游標插入位置）` : '游標插入位置',
        snippetText: '',
        contextBefore: beforeLines.join('\n'),
        contextAfter: afterLines.join('\n'),
        fullContextText: [
          beforeLines.length > 0 ? `【游標上方前文脈絡】\n${beforeLines.join('\n')}` : '',
          `【目前游標插入位置】`,
          afterLines.length > 0 ? `【游標下方後文脈絡】\n${afterLines.join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        blockIndex: undefined,
        insertMode: afterLines.length > 0 ? 'insert_before' : 'insert_after',
        cursorAnchorBefore: beforeLines.join('\n'),
        cursorAnchorAfter: afterLines.join('\n'),
      };
    }

    return null;
  }

  // Determine the currently focused region label, content & full document text for AI context
  const currentTargetInfo = useMemo(() => {
    if (!activeDoc)
      return {
        id: undefined,
        label: undefined,
        content: undefined,
        outline: undefined,
        fullDocumentText: undefined,
      };

    if (activeDoc.docType === 'word') {
      const targetId = linkedSelection?.sectionId ?? selectedSectionId;
      const parentSecId = targetId.includes('-sub-')
        ? targetId.split('-sub-')[0]
        : targetId;
      const sec =
        activeDoc.wordSections?.find(
          (s) => s.id === targetId || s.id === parentSecId
        ) ?? activeDoc.wordSections?.[0];
      const matchedSub = sec?.subSections?.find((sub) => sub.id === targetId);
      const outline = (activeDoc.wordSections ?? [])
        .map((s) => {
          const base = cleanSectionLabel(s.code, s.title);
          const subLines = (s.subSections ?? [])
            .slice(0, 12)
            .map((sub) => `  - ${sub.code} ${sub.title}`)
            .join('\n');
          return subLines ? `${base}\n${subLines}` : base;
        })
        .join('\n');
      const fullDocumentText = (activeDoc.wordSections ?? [])
        .map(
          (s) =>
            `【${cleanSectionLabel(s.code, s.title)}】（sectionId: ${s.id}）\n${
              s.content || '（尚無內容）'
            }`
        )
        .join('\n\n');
      return {
        id: linkedSelection?.sectionId ?? matchedSub?.id ?? sec?.id,
        label:
          linkedSelection?.label ??
          (matchedSub
            ? cleanSectionLabel(matchedSub.code, matchedSub.title)
            : sec
            ? cleanSectionLabel(sec.code, sec.title)
            : 'Word 章節'),
        content:
          linkedSelection?.fullContextText ||
          linkedSelection?.snippetText ||
          matchedSub?.content ||
          sec?.content ||
          '',
        outline,
        fullDocumentText,
      };
    }

    if (activeDoc.docType === 'excel') {
      const sheet =
        activeDoc.excelSheets?.find((s) => s.id === selectedSheetId) ??
        activeDoc.excelSheets?.[0];
      const cellDesc =
        selectedCell && sheet
          ? `（第 ${selectedCell.row + 1} 列・${sheet.columns[selectedCell.col] ?? ''}）`
          : '';
      const outline = (activeDoc.excelSheets ?? []).map((s) => s.name).join(', ');
      const fullDocumentText = (activeDoc.excelSheets ?? [])
        .map(
          (sh) =>
            `【工作表：${sh.name}】（sheetId: ${sh.id}）\n欄位：${sh.columns.join(' | ')}\n` +
            sh.rows.map((r, idx) => `第 ${idx + 1} 列：${r.join(' | ')}`).join('\n')
        )
        .join('\n\n');
      return {
        id: linkedSelection?.sectionId ?? sheet?.id,
        label: linkedSelection?.label ?? `${sheet?.name ?? '工作表'}${cellDesc}`,
        content:
          linkedSelection?.fullContextText ||
          linkedSelection?.snippetText ||
          (sheet
            ? JSON.stringify({ columns: sheet.columns, rows: sheet.rows.slice(0, 15) })
            : ''),
        outline,
        fullDocumentText,
      };
    }

    const slide =
      activeDoc.pptSlides?.find((s) => s.id === selectedSlideId) ??
      activeDoc.pptSlides?.[0];
    const outline = (activeDoc.pptSlides ?? [])
      .map((s) => `P.${s.slideNumber} ${s.title}`)
      .join('\n');
    const fullDocumentText = (activeDoc.pptSlides ?? [])
      .map(
        (sl) =>
          `【第 ${sl.slideNumber} 頁：${sl.title}】（slideId: ${sl.id}）\n副標題：${
            sl.subtitle
          }\n重點：\n${sl.bullets.map((b) => `- ${b}`).join('\n')}`
      )
      .join('\n\n');
    return {
      id: linkedSelection?.sectionId ?? slide?.id,
      label:
        linkedSelection?.label ??
        (slide ? `第 ${slide.slideNumber} 頁：${slide.title}` : '投影片'),
      content:
        linkedSelection?.fullContextText ||
        linkedSelection?.snippetText ||
        (slide ? `${slide.title}\n${slide.bullets.join('\n')}` : ''),
      outline,
      fullDocumentText,
    };
  }, [
    activeDoc,
    selectedSectionId,
    selectedSheetId,
    selectedSlideId,
    selectedCell,
    linkedSelection,
  ]);

  function resolveParagraphAtPosition(_midY: number, _viewportHeight: number, explicitText?: string) {
    if (activeDoc && explicitText && explicitText.trim().length >= 4) {
      const matched = matchTextInActiveDocumentWithContext(explicitText);
      if (matched) {
        return matched;
      }
    }

    // Never guess or fabricate a default paragraph by Y-coordinate or default chapter!
    return {
      sectionId: undefined,
      sectionLabel: '',
      snippetText: '',
      contextBefore: '',
      contextAfter: '',
      fullContextText: '',
      blockIndex: undefined as number | undefined,
    };
  }

  function selectSemanticBlockByGlobalIndex(nextGlobalIdx: number) {
    const blk = allDocSemanticBlocks[nextGlobalIdx];
    if (!blk) return;
    if (activeDoc?.docType === 'word') {
      setSelectedSectionId(blk.sectionId);
    }
    setSelectionOrb((prev) => ({
      ...prev,
      sectionId: blk.sectionId,
      sectionLabel: blk.sectionLabel,
      snippetText: blk.snippetText,
      contextBefore: blk.contextBefore,
      contextAfter: blk.contextAfter,
      fullContextText: blk.fullContextText,
      blockIndex: blk.globalIndex,
    }));
    setLinkedSelection({
      sectionId: blk.sectionId,
      label: blk.sectionLabel,
      snippetText: blk.snippetText,
      contextBefore: blk.contextBefore,
      contextAfter: blk.contextAfter,
      fullContextText: blk.fullContextText,
      blockIndex: blk.globalIndex,
    });
    setScopeMode('target_region');
  }

  async function jumpToWordSectionInEditor(
    sectionId: string,
    sectionTitle?: string,
    explicitHeadingId?: string,
    parentSectionId?: string
  ) {
    if (!activeDoc || activeDoc.docType !== 'word') return;
    setSelectedSectionId(sectionId);
    const effectiveParentId =
      parentSectionId ||
      (sectionId.includes('-sub-') ? sectionId.split('-sub-')[0] : sectionId);
    if (effectiveParentId && effectiveParentId !== 'toc-index') {
      setExpandedSectionIds((prev) => ({ ...prev, [effectiveParentId]: true }));
    }

    // Estimate virtual scroll position without locking the section
    const sections = activeDoc.wordSections ?? [];
    const targetSecIdx = Math.max(
      0,
      sections.findIndex((s) => s.id === effectiveParentId)
    );
    iframeScrollTopRef.current = sectionId === 'toc-index' ? 0 : targetSecIdx * 1133;

    const fid = getEffectiveActiveDriveFileId(activeDoc);

    const applyHeadingHashToIframe = (headingId: string) => {
      const iframe = nativeIframeRef.current;
      if (!iframe || !headingId) return;
      const now = Date.now();
      // Deduplicate rapid click + click + dblclick sequence within 350ms so we don't interrupt Google Docs scroll
      if (
        lastHeadingJumpRef.current.headingId === headingId &&
        now - lastHeadingJumpRef.current.time < 350
      ) {
        return;
      }
      lastHeadingJumpRef.current = { headingId, time: now };

      const rawSrc = iframe.getAttribute('src') || iframe.src || '';
      const baseWithoutHash = rawSrc.split('#')[0];
      if (!baseWithoutHash) return;

      const targetUrl = `${baseWithoutHash}#heading=${headingId}`;

      if (!rawSrc.endsWith(`#heading=${headingId}`)) {
        iframe.src = targetUrl;
      } else {
        // User scrolled away and wants to jump back to the same heading:
        // Use a dummy non-existent heading (#heading=h.0) instead of # so Google Docs NEVER scrolls to Page 1!
        iframe.src = `${baseWithoutHash}#heading=h.0`;
        setTimeout(() => {
          if (nativeIframeRef.current) {
            nativeIframeRef.current.src = targetUrl;
          }
        }, 30);
      }
    };

    const cachedHeadingId =
      explicitHeadingId ||
      sectionHeadingMapRef.current[sectionId] ||
      (sectionId === 'toc-index'
        ? sectionHeadingMapRef.current['sec-4'] || sectionHeadingMapRef.current['sec-1']
        : undefined);

    if (cachedHeadingId) {
      applyHeadingHashToIframe(cachedHeadingId);
      return;
    }

    // Fallback: resolve headingId from backend if not yet cached
    if (!fid) return;
    try {
      const res = await fetch('/api/projects/coauthor', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_section_heading',
          driveFileId: fid,
          sectionId,
          sectionTitle,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        headingBySectionId?: Record<string, string>;
        targetHeadingId?: string;
        wordSections?: Array<{
          id: string;
          code: string;
          title: string;
          content: string;
          headingId?: string;
          subSections?: WordSubSection[];
        }>;
      };
      if (data.headingBySectionId) {
        sectionHeadingMapRef.current = {
          ...sectionHeadingMapRef.current,
          ...data.headingBySectionId,
        };
      }
      if (data.wordSections && data.wordSections.length > 0) {
        setDocuments((prev) =>
          prev.map((d) => {
            if (d.id !== activeDoc.id || !d.wordSections) return d;
            return {
              ...d,
              wordSections: data.wordSections!.map((ws, idx) => ({
                ...ws,
                headingId: data.headingBySectionId?.[ws.id] ?? ws.headingId,
                subSections: (ws.subSections ?? []).map((sub) => ({
                  ...sub,
                  headingId: data.headingBySectionId?.[sub.id] ?? sub.headingId,
                })),
                images: d.wordSections?.[idx]?.images ?? [],
              })),
            };
          })
        );
      }
      const resolvedHId =
        data.targetHeadingId ||
        data.headingBySectionId?.[sectionId] ||
        (effectiveParentId ? data.headingBySectionId?.[effectiveParentId] : undefined) ||
        (sectionId === 'toc-index'
          ? data.headingBySectionId?.['sec-4'] || data.headingBySectionId?.['sec-1']
          : undefined);
      if (resolvedHId) {
        applyHeadingHashToIframe(resolvedHId);
      }
    } catch {
      // ignore network error
    }
  }

  function handleLockSidebarItemWithAssistantOrb(params: {
    itemType: 'word' | 'excel' | 'ppt';
    itemId: string;
    codeLabel: string;
    titleLabel: string;
    contentText: string;
    headingId?: string;
  }) {
    const { itemType, itemId, codeLabel, titleLabel, contentText, headingId } = params;
    const isCurrentlyLocked =
      scopeMode === 'target_region' &&
      ((itemType === 'word' && selectedSectionId === itemId) ||
        (itemType === 'excel' && selectedSheetId === itemId && !selectedCell) ||
        (itemType === 'ppt' && selectedSlideId === itemId));

    // Toggle unlock if clicking the orb on an already-locked item
    if (isCurrentlyLocked) {
      userLockedSectionInSidebarRef.current = false;
      setScopeMode('whole_doc');
      latestLinkedSelectionRef.current = null;
      setLinkedSelection(null);
      setSelectionOrb((prev) => ({ ...prev, linked: false, visible: false }));
      return;
    }

    // Lock the item & link to Collaboration Assistant
    userLockedSectionInSidebarRef.current = true;
    setScopeMode('target_region');

    if (itemType === 'word') {
      setSelectedSectionId(itemId);
      void jumpToWordSectionInEditor(itemId, titleLabel, headingId);
    } else if (itemType === 'excel') {
      setSelectedSheetId(itemId);
      setSelectedCell(null);
    } else {
      setSelectedSlideId(itemId);
    }

    const cleanFullLabel = `${codeLabel} ${titleLabel}`.trim();
    const firstBlock =
      itemType === 'word'
        ? itemId === 'toc-index'
          ? allDocSemanticBlocks.find((b) => b.sectionTitle.includes('目錄')) ??
            allDocSemanticBlocks[0]
          : allDocSemanticBlocks.find((b) => b.sectionId === itemId)
        : undefined;

    const snippetText = (
      firstBlock?.snippetText ||
      contentText.trim().slice(0, 360) ||
      titleLabel
    ).trim();
    const contextBefore = firstBlock?.contextBefore ?? '';
    const contextAfter = firstBlock?.contextAfter ?? '';
    const fullContextText = firstBlock?.fullContextText || contentText || snippetText;

    const nextLinked = {
      sectionId: itemId,
      label: cleanFullLabel,
      snippetText,
      contextBefore,
      contextAfter,
      fullContextText,
      blockIndex: firstBlock?.globalIndex,
    };

    latestLinkedSelectionRef.current = nextLinked;
    setLinkedSelection(nextLinked);
    setSpriteMinimized(false);
    setSpriteSignalFlash(true);
    setTimeout(() => setSpriteSignalFlash(false), 2600);

    // Trigger proactive prompt message in Collaboration Assistant
    setMessages((prev) => [
      ...prev,
      {
        id: `orb-sidebar-lock-${Date.now()}`,
        role: 'assistant',
        text: `已鎖定「${cleanFullLabel}」。請問您希望我針對此章節進行什麼協助？（可直接輸入修改需求，例如：擴寫細節、潤飾專業語氣、整理表格數據或生成配圖）`,
        timestamp: '剛剛',
        linkedSnippet: {
          label: cleanFullLabel,
          text: snippetText.slice(0, 220),
        },
      },
    ]);

    requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
  }

  // Non-blocking Micro-Probe for detecting drag-selection ("框選文字") and scroll inside the native editor viewport
  useEffect(() => {
    if (!activeDoc) return;
    const interval = setInterval(() => {
      if (!isPointerInEditorRef.current) return;
      const probe = probeLayerRef.current;
      if (!probe) return;
      probe.style.pointerEvents = 'auto';
      setTimeout(() => {
        if (probeLayerRef.current) {
          probeLayerRef.current.style.pointerEvents = 'none';
        }
      }, 14);
    }, 95);
    return () => clearInterval(interval);
  }, [activeDoc]);

  // Native DOM text selection listener (when selecting text in any overlay/workbench surface)
  useEffect(() => {
    if (!activeDoc) return;
    function handleDomMouseUp() {
      const sel = window.getSelection();
      const rawText = sel?.toString().trim() ?? '';
      if (!rawText || rawText.length < 2 || !sel || sel.rangeCount === 0) return;
      const viewport = editorViewportRef.current;
      if (!viewport) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const vpRect = viewport.getBoundingClientRect();
      if (
        rect.bottom < vpRect.top ||
        rect.top > vpRect.bottom ||
        rect.right < vpRect.left ||
        rect.left > vpRect.right
      ) {
        return;
      }
      const midY = Math.min(
        Math.max(135, Math.round(rect.top - vpRect.top + rect.height / 2)),
        vpRect.height - 75
      );
      const resolved = resolveParagraphAtPosition(midY, vpRect.height, rawText);
      setSelectionOrb({
        visible: true,
        topPx: midY,
        leftPercent: 89,
        linked: false,
        sectionId: resolved.sectionId,
        sectionLabel: resolved.sectionLabel,
        snippetText: resolved.snippetText,
        contextBefore: resolved.contextBefore,
        contextAfter: resolved.contextAfter,
        fullContextText: resolved.fullContextText,
        blockIndex: resolved.blockIndex,
      });
    }
    document.addEventListener('mouseup', handleDomMouseUp);
    return () => document.removeEventListener('mouseup', handleDomMouseUp);
  }, [activeDoc, selectedSectionId, selectedSheetId, selectedSlideId, allDocSemanticBlocks]);

  function startVisualSelectionResolution(
    orbTopPx: number,
    allowCursorContext = false
  ): Promise<{
    sectionId?: string;
    sectionLabel: string;
    snippetText: string;
    contextBefore: string;
    contextAfter: string;
    fullContextText: string;
    blockIndex?: number;
    insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
    cursorAnchorBefore?: string;
    cursorAnchorAfter?: string;
  } | null> {
    const existing = inFlightVisualSelectionRef.current;
    if (
      existing &&
      (!allowCursorContext || existing.allowCursorContext) &&
      Math.abs(existing.orbTopPx - orbTopPx) <= 28 &&
      Date.now() - existing.startedAt < 4500
    ) {
      return existing.promise;
    }

    const promise = (async () => {
      let verifiedExplicitText: string | undefined;
      let visualMode: 'highlight' | 'cursor' | undefined;
      let visualHeadingHint: string | undefined;
      let visualBeforeFallback: string | undefined;
      let visualAfterFallback: string | undefined;

      // 1. Check DOM selection in parent window first
      const domSelected = window.getSelection()?.toString().trim();
      if (
        domSelected &&
        domSelected.length >= 4 &&
        matchTextInActiveDocumentWithContext(domSelected)
      ) {
        verifiedExplicitText = domSelected;
        visualMode = 'highlight';
      }

      // 2. Capture live visual selection (or cursor position when allowCursorContext is true)
      //    from the editor viewport on screen so cross-origin Google Docs highlights & cursor positions are extracted accurately
      if (!verifiedExplicitText && editorViewportRef.current) {
        try {
          const vp = editorViewportRef.current;
          const rect = vp.getBoundingClientRect();
          const chromeTop = Math.max(0, window.outerHeight - window.innerHeight);
          const chromeLeft = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
          const topToolbarOffset = 92;
          const paperHeight = Math.max(160, Math.round(rect.height - topToolbarOffset - 24));
          const orbInPaperY = Math.max(10, orbTopPx - topToolbarOffset);
          const screenRect = {
            x: Math.max(0, Math.round(window.screenX + chromeLeft + rect.left + rect.width * 0.08)),
            y: Math.max(0, Math.round(window.screenY + chromeTop + rect.top + topToolbarOffset)),
            width: Math.max(240, Math.round(rect.width * 0.78)),
            height: paperHeight,
            orbRatioY: Math.max(0.05, Math.min(0.95, orbInPaperY / Math.max(1, paperHeight))),
          };
          const res = await fetch('/api/projects/coauthor', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'resolve_visual_selection',
              driveFileId: activeDoc?.driveItemId,
              screenRect,
              allowCursorContext,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              resolved?: {
                mode?: 'highlight' | 'cursor';
                selectedText?: string;
                sectionHeading?: string;
                visibleBeforeText?: string;
                visibleAfterText?: string;
              } | null;
            };
            visualMode = data.resolved?.mode;
            visualHeadingHint = data.resolved?.sectionHeading?.trim();
            visualBeforeFallback = data.resolved?.visibleBeforeText?.trim();
            visualAfterFallback = data.resolved?.visibleAfterText?.trim();
            if (data.resolved?.selectedText && data.resolved.selectedText.trim().length >= 4) {
              verifiedExplicitText = data.resolved.selectedText.trim();
            }
          }
        } catch {
          // Ignore network/capture failure and continue to fallback
        }
      }

      // 3. Fallback: Check clipboard ONLY when not in cursor-only mode and clipboard text exists inside `activeDoc`
      if (!verifiedExplicitText && visualMode !== 'cursor') {
        try {
          const clip = (await navigator.clipboard.readText()).trim();
          if (
            clip &&
            clip.length >= 4 &&
            clip.length <= 2500 &&
            !clip.startsWith('http://') &&
            !clip.startsWith('https://') &&
            matchTextInActiveDocumentWithContext(clip)
          ) {
            verifiedExplicitText = clip;
          }
        } catch {
          // Clipboard read permission not granted
        }
      }

      if (verifiedExplicitText) {
        const matchedFromDoc = matchTextInActiveDocumentWithContext(
          verifiedExplicitText,
          visualHeadingHint
        );
        if (matchedFromDoc) {
          return {
            ...matchedFromDoc,
            insertMode: 'replace' as const,
          };
        }

        return {
          sectionId: undefined,
          sectionLabel: visualHeadingHint || '框選段落',
          snippetText: verifiedExplicitText,
          contextBefore: visualBeforeFallback || '',
          contextAfter: visualAfterFallback || '',
          fullContextText: [
            visualBeforeFallback ? `【前文脈絡】\n${visualBeforeFallback}` : '',
            `【框選段落】\n${verifiedExplicitText}`,
            visualAfterFallback ? `【後文脈絡】\n${visualAfterFallback}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          blockIndex: undefined,
          insertMode: 'replace' as const,
        };
      }

      // 4. Cursor Position Detection: When no text is highlighted, match the visible text before/after the cursor
      if (allowCursorContext && (visualBeforeFallback || visualAfterFallback || visualHeadingHint)) {
        const cursorMatched = matchCursorContextInActiveDocument(
          visualBeforeFallback,
          visualAfterFallback,
          visualHeadingHint
        );
        if (cursorMatched) {
          return cursorMatched;
        }
      }

      return null;
    })();

    inFlightVisualSelectionRef.current = {
      orbTopPx,
      allowCursorContext,
      startedAt: Date.now(),
      promise,
    };
    return promise;
  }

  async function handleLinkSelectionOrbToSprite() {
    const domSelected = window.getSelection()?.toString().trim();
    const domMatched =
      domSelected && domSelected.length >= 4
        ? matchTextInActiveDocumentWithContext(domSelected)
        : null;

    if (domMatched && domMatched.snippetText.trim()) {
      if (domMatched.sectionId && activeDoc?.docType === 'word') {
        setSelectedSectionId(domMatched.sectionId);
      }
      setSelectionOrb((prev) => ({
        ...prev,
        visible: true,
        linked: true,
        sectionId: domMatched.sectionId,
        sectionLabel: domMatched.sectionLabel,
        snippetText: domMatched.snippetText,
        contextBefore: domMatched.contextBefore,
        contextAfter: domMatched.contextAfter,
        fullContextText: domMatched.fullContextText,
        blockIndex: domMatched.blockIndex,
      }));
      const nextLinked = {
        sectionId: domMatched.sectionId,
        label: domMatched.sectionLabel,
        snippetText: domMatched.snippetText,
        contextBefore: domMatched.contextBefore,
        contextAfter: domMatched.contextAfter,
        fullContextText: domMatched.fullContextText,
        blockIndex: domMatched.blockIndex,
      };
      latestLinkedSelectionRef.current = nextLinked;
      setLinkedSelection(nextLinked);
      setScopeMode('target_region');
      setSpriteMinimized(false);
      setSpriteSignalFlash(true);
      setTimeout(() => setSpriteSignalFlash(false), 2600);
      requestAnimationFrame(() => {
        composerTextareaRef.current?.focus();
      });
      return;
    }

    // Do NOT pre-populate any default or guessed paragraph!
    // Wait for actual visual highlight or cursor position resolution and report an error if neither is found.
    setIsResolvingVisualSelection(true);
    setSpriteMinimized(false);
    try {
      const visualResolved = await startVisualSelectionResolution(selectionOrb.topPx, true);
      const isCursorTarget = Boolean(
        visualResolved &&
          (visualResolved.insertMode === 'insert_before' ||
            visualResolved.insertMode === 'insert_after') &&
          (visualResolved.cursorAnchorBefore || visualResolved.cursorAnchorAfter)
      );
      if (
        visualResolved &&
        (visualResolved.snippetText.trim().length >= 2 || isCursorTarget)
      ) {
        if (visualResolved.sectionId && activeDoc?.docType === 'word') {
          setSelectedSectionId(visualResolved.sectionId);
        }
        setSelectionOrb((prev) => ({
          ...prev,
          visible: true,
          linked: true,
          sectionId: visualResolved.sectionId,
          sectionLabel: visualResolved.sectionLabel,
          snippetText: visualResolved.snippetText,
          contextBefore: visualResolved.contextBefore,
          contextAfter: visualResolved.contextAfter,
          fullContextText: visualResolved.fullContextText,
          blockIndex: visualResolved.blockIndex,
        }));
        const upgradedLinked = {
          sectionId: visualResolved.sectionId,
          label: visualResolved.sectionLabel,
          snippetText: visualResolved.snippetText,
          contextBefore: visualResolved.contextBefore,
          contextAfter: visualResolved.contextAfter,
          fullContextText: visualResolved.fullContextText,
          blockIndex: visualResolved.blockIndex,
          insertMode: visualResolved.insertMode,
          cursorAnchorBefore: visualResolved.cursorAnchorBefore,
          cursorAnchorAfter: visualResolved.cursorAnchorAfter,
        };
        latestLinkedSelectionRef.current = upgradedLinked;
        setLinkedSelection(upgradedLinked);
        setScopeMode('target_region');
        setSpriteSignalFlash(true);
        setTimeout(() => setSpriteSignalFlash(false), 2600);
        requestAnimationFrame(() => {
          composerTextareaRef.current?.focus();
        });
      } else {
        latestLinkedSelectionRef.current = null;
        setLinkedSelection(null);
        setSelectionOrb((prev) => ({ ...prev, linked: false }));
        setMessages((prev) => [
          ...prev,
          {
            id: `orb-no-selection-${Date.now()}`,
            role: 'assistant',
            text: '⚠️ 未能辨識到您在文件中反白框選的文字或游標位置（系統不會自動套用預設資料）。請確認已在文件畫面中將文字反白框選或將游標停留在段落間後再試一次。',
            timestamp: '剛剛',
          },
        ]);
      }
    } finally {
      setIsResolvingVisualSelection(false);
    }
  }

  function openDocumentInWorkbench(doc: CoAuthorDocument, isNewSession = false) {
    setIsIframeLoading(true);
    setActiveDocId(doc.id);
    setScopeMode('whole_doc');
    setLinkedSelection(null);
    iframeScrollTopRef.current = 0;
    userLockedSectionInSidebarRef.current = false;
    setSelectionOrb((prev) => ({ ...prev, visible: false, linked: false }));
    if (doc.wordSections?.[0]) setSelectedSectionId(doc.wordSections[0].id);
    if (doc.excelSheets?.[0]) setSelectedSheetId(doc.excelSheets[0].id);
    if (doc.pptSlides?.[0]) setSelectedSlideId(doc.pptSlides[0].id);
    setSelectedCell(null);
    if (isNewSession) {
      setMessages([
        {
          id: `session-${Date.now()}`,
          role: 'assistant',
          text: `已載入「${doc.title}」。可直接與我討論整份文件的優化方向，或點一下指定區域鎖定改稿。`,
          timestamp: '剛剛',
        },
      ]);
    }
  }

  function findMatchingProjectAndDriveItem(fileName: string): {
    projectCode: string;
    projectName: string;
    projectId: string;
    driveItem?: HistoricalDriveItem;
  } {
    const clean = fileName.trim().toLowerCase();
    for (const g of groups) {
      for (const p of g.projects) {
        const stack: HistoricalDriveItem[] = [...(p.files ?? [])];
        while (stack.length > 0) {
          const it = stack.shift()!;
          if (it.name.trim().toLowerCase() === clean) {
            return {
              projectCode: p.code,
              projectName: p.name,
              projectId: p.id,
              driveItem: it,
            };
          }
          if (it.children) stack.push(...it.children);
        }
      }
    }

    for (const g of groups) {
      for (const p of g.projects) {
        const keywords = [p.code, p.name.slice(0, 4)].filter((k) => k.length >= 2);
        if (keywords.some((k) => clean.includes(k.toLowerCase()))) {
          return {
            projectCode: p.code,
            projectName: p.name,
            projectId: p.id,
          };
        }
      }
    }

    if (fileName.includes('州巧')) {
      return {
        projectCode: 'TD-2024',
        projectName: '州巧移動代步服務生態系創新優化計畫',
        projectId: '2024-zhouqiao',
        driveItem: {
          id: '1-b6tU7mBHC0VVAf9ROWz4n-JCYp-ynF87lVecnmQv4U',
          name: fileName,
          kind: 'document',
          driveUrl:
            'https://docs.google.com/document/d/1-b6tU7mBHC0VVAf9ROWz4n-JCYp-ynF87lVecnmQv4U/edit',
        },
      };
    }

    const prefix = fileName
      .replace(/\.(docx?|xlsx?|pptx?|csv|txt)$/i, '')
      .split(/[_\-]/)[0]
      ?.trim();
    if (prefix && prefix.length >= 2) {
      return {
        projectCode: 'PROJ-DOC',
        projectName: prefix,
        projectId: `proj-${Date.now()}`,
      };
    }

    const firstProj = groups[0]?.projects[0];
    return {
      projectCode: firstProj?.code ?? 'T3-2026',
      projectName: firstProj?.name ?? 'T3 桃園機場第三航廈自駕運輸系統',
      projectId: firstProj?.id ?? '2026-t3-projects',
    };
  }

  async function handleDroppedOrSelectedFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || uploadingDocState) return;
    const file = fileList[0];
    const docType = inferDocTypeFromFileName(file.name);
    const matchedMeta = findMatchingProjectAndDriveItem(file.name);
    const { projectCode, projectName, projectId, driveItem } = matchedMeta;
    const today = new Date().toISOString().slice(0, 10);
    const id = `upload-${docType}-${Date.now()}`;

    // Stay on the previous screen first and show rotating upload/conversion loading progress
    setUploadingDocState({
      fileName: file.name,
      docType,
      stepLabel: '正在比對雲端檔案索引與快取…',
      progressPercent: 30,
    });

    let extractedText = '';
    if (
      file.type.startsWith('text/') ||
      file.name.endsWith('.txt') ||
      file.name.endsWith('.md') ||
      file.name.endsWith('.csv')
    ) {
      try {
        extractedText = (await file.text()).trim();
      } catch {
        extractedText = '';
      }
    }

    let resolvedDriveId: string | undefined = driveItem?.id;
    let resolvedDriveUrl: string | undefined = driveItem?.driveUrl;
    let resolvedSections:
      | Array<{
          id: string;
          code: string;
          title: string;
          content: string;
          headingId?: string;
          subSections?: Array<{
            id: string;
            code: string;
            title: string;
            content: string;
            headingId?: string;
            level?: 2 | 3;
          }>;
        }>
      | undefined;

    droppedFilesByDocIdRef.current.set(id, file);

    try {
      // Stage 1: Only run fast-path JSON lookup first if we already matched a historical Drive ID
      if (driveItem?.id) {
        const fastRes = await fetch('/api/projects/coauthor', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            docType,
            existingDriveId: driveItem.id,
          }),
        });
        if (fastRes.ok && fastRes.headers.get('content-type')?.includes('application/json')) {
          const fastData = (await fastRes.json()) as {
            driveItemId?: string;
            driveUrl?: string;
            wordSections?: typeof resolvedSections;
          };
          if (fastData.wordSections && fastData.wordSections.length > 0) {
            resolvedSections = fastData.wordSections;
          }
          if (fastData.driveItemId) {
            resolvedDriveId = fastData.driveItemId;
            resolvedDriveUrl = fastData.driveUrl ?? resolvedDriveUrl;
          }
        }
      }

      // Stage 2: Stream binary File via FormData to parse local chapters (<20ms) and upload/convert to Google Docs
      if ((!resolvedDriveId || !resolvedSections) && file.size > 0) {
        setUploadingDocState({
          fileName: file.name,
          docType,
          stepLabel: '正在解析文件章節並轉換為 Google Docs 原生編輯格式…',
          progressPercent: 68,
        });
        const form = new FormData();
        form.append('file', file);
        form.append('fileName', file.name);
        form.append('docType', docType);
        if (resolvedDriveId) form.append('existingDriveId', resolvedDriveId);

        const upRes = await fetch('/api/projects/coauthor', {
          method: 'PUT',
          body: form,
        });
        if (upRes.ok && upRes.headers.get('content-type')?.includes('application/json')) {
          const upData = (await upRes.json()) as {
            driveItemId?: string;
            driveUrl?: string;
            wordSections?: typeof resolvedSections;
          };
          if (upData.wordSections && upData.wordSections.length > 0) {
            resolvedSections = upData.wordSections;
          }
          if (upData.driveItemId) {
            resolvedDriveId = upData.driveItemId;
            resolvedDriveUrl = upData.driveUrl ?? resolvedDriveUrl;
          }
        }
      }

      setUploadingDocState({
        fileName: file.name,
        docType,
        stepLabel: '已完成章節解析，正在開啟編輯視窗…',
        progressPercent: 95,
      });
    } catch {
      // ignore network error and open with best available metadata
    }

    let newDoc: CoAuthorDocument;
    if (docType === 'excel') {
      const parsedRows =
        extractedText && file.name.endsWith('.csv')
          ? extractedText
              .split(/\r?\n/)
              .slice(0, 30)
              .map((line) => line.split(',').map((c) => c.trim()))
          : [
              ['01', `${file.name} 項目一`, '系統工程組', today, '50%', ''],
              ['02', `${file.name} 項目二`, '自駕研發組', today, '20%', ''],
            ];
      newDoc = {
        id,
        projectId,
        projectCode,
        projectName,
        title: file.name,
        docType: 'excel',
        driveItemId: resolvedDriveId,
        driveUrl: resolvedDriveUrl,
        updatedAt: today,
        excelSheets: [
          {
            id: 'sheet-1',
            name: '1_工作表',
            columns: ['項次', '工作項目', '負責單位', '日期', '進度', '備註'],
            rows: parsedRows,
          },
        ],
      };
    } else if (docType === 'ppt') {
      newDoc = {
        id,
        projectId,
        projectCode,
        projectName,
        title: file.name,
        docType: 'ppt',
        driveItemId: resolvedDriveId,
        driveUrl: resolvedDriveUrl,
        updatedAt: today,
        pptSlides: [
          {
            id: 'slide-1',
            slideNumber: 1,
            title: file.name.replace(/\.(pptx|ppt)$/i, ''),
            subtitle: `${projectCode} 專案簡報`,
            bullets: [
              '專案階段目標與範圍',
              '系統技術規格與架構說明',
              '場域測試進度與後續規劃',
            ],
            speakerNotes: '',
            layout: 'title_content',
            images: [],
          },
        ],
      };
    } else {
      const initialWordSections =
        resolvedSections && resolvedSections.length > 0
          ? resolvedSections.map((s) => ({ ...s, images: [] }))
          : [
              {
                id: 'sec-1',
                code: '1.0',
                title: file.name.replace(/\.(docx?|txt|md)$/i, ''),
                content:
                  extractedText ||
                  `本文件為《${file.name}》，定義專案計畫架構與技術規範。`,
                images: [],
              },
            ];
      newDoc = {
        id,
        projectId,
        projectCode,
        projectName,
        title: file.name,
        docType: 'word',
        driveItemId: resolvedDriveId,
        driveUrl: resolvedDriveUrl,
        updatedAt: today,
        wordSections: initialWordSections,
      };
    }

    resolvedDocIdsRef.current.add(id);
    setDocuments((prev) => [newDoc, ...prev]);
    setUploadingDocState(null);
    openDocumentInWorkbench(newDoc, true);
  }

  function createNewBlankDocument(docType: CoAuthorDocType) {
    const firstProj = groups[0]?.projects[0];
    const projectCode = firstProj?.code ?? 'T3-2026';
    const projectName = firstProj?.name ?? 'T3 桃園機場第三航廈自駕運輸系統';
    const projectId = firstProj?.id ?? '2026-t3-projects';
    const id = `new-${docType}-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);

    const newDoc: CoAuthorDocument =
      docType === 'word'
        ? {
            id,
            projectId,
            projectCode,
            projectName,
            title: `新建專案技術規範文件_${today}.docx`,
            docType: 'word',
            updatedAt: today,
            wordSections: [
              {
                id: 'sec-1',
                code: '1.0',
                title: '專案背景與系統設計目標',
                content: '',
                images: [],
              },
              {
                id: 'sec-2',
                code: '2.0',
                title: '核心技術規格與驗證標準',
                content: '',
                images: [],
              },
            ],
          }
        : docType === 'excel'
        ? {
            id,
            projectId,
            projectCode,
            projectName,
            title: `新建專案時程與WBS查核表_${today}.xlsx`,
            docType: 'excel',
            updatedAt: today,
            excelSheets: [
              {
                id: 'sheet-1',
                name: '1_專案WBS與查核點',
                columns: ['WBS 編號', '工作項目 / 交付物', '負責單位', '預計開始', '預計完成', '完成率', '備註說明'],
                rows: [
                  ['WBS-1.1', '系統需求規範與介面定義書 (ICD)', '系統工程組', today, '2026-05-30', '50%', '初版撰寫中'],
                  ['WBS-1.2', '車載感知與控制模組整合測試', '自駕研發 R&D', '2026-05-15', '2026-06-30', '20%', '排程規劃中'],
                ],
              },
            ],
          }
        : {
            id,
            projectId,
            projectCode,
            projectName,
            title: `新建專案進度與技術簡報_${today}.pptx`,
            docType: 'ppt',
            updatedAt: today,
            pptSlides: [
              {
                id: 'slide-1',
                slideNumber: 1,
                title: `${projectName} — 專案進度與技術架構簡報`,
                subtitle: 'Turing Drive 專案團隊報告',
                bullets: [
                  '本階段關鍵里程碑達成狀況與交付物清單',
                  '車載自駕系統與行控中心 (OCC) 整合測試成果',
                  '後續場域驗證時程與跨單位配合事項',
                ],
                speakerNotes: '',
                layout: 'visual_split',
                images: [],
              },
            ],
          };

    setDocuments((prev) => [newDoc, ...prev]);
    openDocumentInWorkbench(newDoc, true);
  }

  /**
   * Animates character-by-character live AI writing directly into the active document canvas.
   * When `targetSnippetToReplace` is provided (user selected a specific paragraph inside a larger section),
   * only that paragraph is replaced in-place inside `sec.content`, preserving all surrounding paragraphs.
   */
  function animateWordSectionStream(
    docId: string,
    targetSectionId: string,
    sectionTitle: string,
    fullText: string,
    mode: 'replace' | 'append' | 'add_section',
    newSectionCode?: string,
    targetSnippetToReplace?: string
  ) {
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);

    let targetId = targetSectionId;
    if (mode === 'add_section') {
      const createdId = `sec-${Date.now()}`;
      targetId = createdId;
      setDocuments((prev) =>
        prev.map((d) => {
          if (d.id !== docId) return d;
          const nextNum = (d.wordSections?.length ?? 0) + 1;
          const code = newSectionCode ?? `${nextNum}.0`;
          const cleanTitle = sectionTitle.replace(new RegExp(`^${code}\\s+`), '').trim();
          return {
            ...d,
            wordSections: [
              ...(d.wordSections ?? []),
              {
                id: createdId,
                code,
                title: cleanTitle,
                content: '',
                images: [],
              },
            ],
          };
        })
      );
      setSelectedSectionId(createdId);
    }

    const activeTargetDoc = documents.find((d) => d.id === docId);
    const activeTargetSec = (activeTargetDoc?.wordSections ?? []).find((s) => s.id === targetId);
    const baseSectionContent = activeTargetSec?.content ?? '';
    const trimmedSnippet = targetSnippetToReplace?.trim() ?? '';
    const firstSnippetLine =
      trimmedSnippet
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length >= 8) ?? '';
    const exactReplaceTarget =
      trimmedSnippet.length > 0 && baseSectionContent.includes(trimmedSnippet)
        ? trimmedSnippet
        : firstSnippetLine.length >= 8 && baseSectionContent.includes(firstSnippetLine)
        ? firstSnippetLine
        : '';
    const canReplaceSubstringInPlace =
      mode === 'replace' &&
      exactReplaceTarget.length > 0 &&
      exactReplaceTarget !== baseSectionContent.trim();

    setStreamingSectionId(targetId);
    let cursor = 0;
    const step = Math.max(4, Math.ceil(fullText.length / 42));

    streamIntervalRef.current = setInterval(() => {
      cursor = Math.min(fullText.length, cursor + step);
      const partial = fullText.slice(0, cursor);

      setDocuments((prev) =>
        prev.map((d) => {
          if (d.id !== docId) return d;
          return {
            ...d,
            wordSections: (d.wordSections ?? []).map((sec) => {
              if (sec.id !== targetId) return sec;
              const isSubParagraphTitle =
                canReplaceSubstringInPlace ||
                trimmedSnippet.length > 0 ||
                (sectionTitle || '').includes('·');
              const cleanTitle = isSubParagraphTitle
                ? sec.title
                : (sectionTitle || sec.title)
                    .replace(new RegExp(`^${sec.code}\\s+`), '')
                    .trim();
              // Never wipe out the entire section content when the user only targeted a single snippet!
              const nextContent = canReplaceSubstringInPlace
                ? baseSectionContent.replace(exactReplaceTarget, partial)
                : mode === 'append' && baseSectionContent
                ? `${baseSectionContent}\n\n${partial}`
                : trimmedSnippet.length > 0 && baseSectionContent.length > trimmedSnippet.length * 1.5
                ? baseSectionContent
                : partial;
              return {
                ...sec,
                title: cleanTitle || sec.title,
                content: nextContent,
              };
            }),
          };
        })
      );

      if (cursor >= fullText.length) {
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
        setStreamingSectionId(null);
        isProcessingPromptRef.current = false;
        setIsAiWriting(false);
        setAiWritingTargetLabel(null);
      }
    }, 32);
  }

  function animatePptSlideStream(
    docId: string,
    targetSlideId: string,
    slideTitle: string,
    slideSubtitle: string,
    bullets: string[],
    speakerNotes: string,
    mode: 'replace_slide' | 'add_slide'
  ) {
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);

    let targetId = targetSlideId;
    if (mode === 'add_slide') {
      const createdId = `slide-${Date.now()}`;
      targetId = createdId;
      setDocuments((prev) =>
        prev.map((d) => {
          if (d.id !== docId) return d;
          const nextNum = (d.pptSlides?.length ?? 0) + 1;
          return {
            ...d,
            pptSlides: [
              ...(d.pptSlides ?? []),
              {
                id: createdId,
                slideNumber: nextNum,
                title: slideTitle,
                subtitle: slideSubtitle,
                bullets: [''],
                speakerNotes: '',
                layout: 'title_content',
                images: [],
              },
            ],
          };
        })
      );
      setSelectedSlideId(createdId);
    }

    setStreamingSectionId(targetId);
    const joinedBullets = bullets.join('\n');
    let cursor = 0;
    const step = Math.max(4, Math.ceil(joinedBullets.length / 36));

    streamIntervalRef.current = setInterval(() => {
      cursor = Math.min(joinedBullets.length, cursor + step);
      const partialBullets = joinedBullets.slice(0, cursor).split('\n');

      setDocuments((prev) =>
        prev.map((d) => {
          if (d.id !== docId) return d;
          return {
            ...d,
            pptSlides: (d.pptSlides ?? []).map((sl) =>
              sl.id === targetId
                ? {
                    ...sl,
                    title: slideTitle || sl.title,
                    subtitle: slideSubtitle || sl.subtitle,
                    bullets: partialBullets,
                    speakerNotes: cursor >= joinedBullets.length ? speakerNotes : sl.speakerNotes,
                  }
                : sl
            ),
          };
        })
      );

      if (cursor >= joinedBullets.length) {
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
        setStreamingSectionId(null);
        isProcessingPromptRef.current = false;
        setIsAiWriting(false);
        setAiWritingTargetLabel(null);
      }
    }, 32);
  }

  function startSpriteResize(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = spriteWidth;
    setIsResizingSprite(true);

    function onMouseMove(ev: MouseEvent) {
      const delta = startX - ev.clientX;
      const maxAllowed = Math.min(760, Math.floor(window.innerWidth * 0.58));
      const next = Math.min(maxAllowed, Math.max(260, startW + delta));
      setSpriteWidth(next);
    }

    function onMouseUp() {
      setIsResizingSprite(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function startSpriteHeightResize(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = spriteFloatingHeight;
    setIsResizingSprite(true);

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientY - startY;
      const maxAllowed = Math.min(780, Math.floor(window.innerHeight * 0.82));
      const next = Math.min(maxAllowed, Math.max(220, startH + delta));
      setSpriteFloatingHeight(next);
    }

    function onMouseUp() {
      setIsResizingSprite(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  async function stageReferenceFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming: StagedRefAttachment[] = [];

    for (const file of Array.from(fileList)) {
      const kindLabel = describeReferenceKind(file);
      const lower = file.name.toLowerCase();
      let extractedText: string | undefined;
      let base64Data: string | undefined;

      if (
        file.type.startsWith('text/') ||
        /\.(txt|md|csv|json|xml|log|tsv|html)$/i.test(lower)
      ) {
        try {
          extractedText = (await file.text()).trim().slice(0, 6000);
        } catch {
          extractedText = undefined;
        }
      } else if (
        file.size <= 7 * 1024 * 1024 &&
        (file.type.startsWith('image/') ||
          file.type.startsWith('video/') ||
          file.type === 'application/pdf')
      ) {
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          base64Data = btoa(binary);
        } catch {
          base64Data = undefined;
        }
      }

      incoming.push({
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        kindLabel,
        extractedText,
        base64Data,
      });
    }

    setStagedRefFiles((prev) => [...prev, ...incoming]);
    setSpriteMinimized(false);
  }

  async function handleSendPrompt(customPrompt?: string) {
    const rawText = (customPrompt ?? composerInput).trim();
    const attachedRefs = customPrompt ? [] : stagedRefFiles;
    if (!rawText && attachedRefs.length === 0) return;

    const text =
      rawText ||
      `已提供參考資料（${attachedRefs.map((f) => f.name).join('、')}），請分析來源內容大綱並協助更新此區域。`;

    if (!customPrompt) {
      setComposerInput('');
      setStagedRefFiles([]);
    }

    const queuedItem: QueuedPromptItem = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
      attachedRefs,
      scopeMode,
      linkedSelectionSnapshot: linkedSelection ? { ...linkedSelection } : null,
      selectedRowIndexSnapshot: selectedCell?.row ?? null,
      targetIdSnapshot: currentTargetInfo.id,
      targetLabelSnapshot:
        scopeMode === 'whole_doc'
          ? activeDoc?.title ?? '專案內容'
          : currentTargetInfo.label ?? '指定區域',
    };

    // If AI is currently analyzing/writing, enqueue this prompt so it automatically starts
    // right after the current analysis finishes!
    if (isAiWriting || isProcessingPromptRef.current) {
      setPromptQueue((prev) => [...prev, queuedItem]);
      setSpriteMinimized(false);
      return;
    }

    isProcessingPromptRef.current = true;
    await executeQueuedPromptItem(queuedItem);
  }

  async function executeQueuedPromptItem(item: QueuedPromptItem) {
    isProcessingPromptRef.current = true;
    const { text, attachedRefs } = item;

    // If visual selection resolution is currently in flight (user clicked the orb and immediately submitted),
    // wait up to 2.2s so the exact highlighted text is guaranteed to be resolved before sending to Vertex AI
    if (
      item.scopeMode === 'target_region' &&
      inFlightVisualSelectionRef.current &&
      Date.now() - inFlightVisualSelectionRef.current.startedAt < 4500
    ) {
      await Promise.race([
        inFlightVisualSelectionRef.current.promise,
        new Promise((r) => setTimeout(r, 2200)),
      ]);
    }

    let currentLinked = latestLinkedSelectionRef.current ?? linkedSelection;
    // If the queued item targeted the same paragraph that is still active (e.g. refined by the previous prompt),
    // use the latest `linkedSelection` so the newly updated snippet is used; otherwise respect the snapshot.
    let effectiveLinked =
      item.linkedSelectionSnapshot &&
      currentLinked &&
      (item.linkedSelectionSnapshot.label === currentLinked.label ||
        item.linkedSelectionSnapshot.sectionId === currentLinked.sectionId)
        ? currentLinked
        : item.linkedSelectionSnapshot ?? currentLinked;

    // If the user simply placed their cursor in the Word document (without clicking the orb first)
    // and typed a prompt asking to write/insert/modify in this area, automatically detect the live cursor position!
    const hasPositionalWriteIntent =
      activeDoc?.docType === 'word' &&
      !effectiveLinked &&
      !userLockedSectionInSidebarRef.current &&
      /這個區域|這塊區域|這個位置|這段|這裡|此處|游標|寫進|寫入|加入|新增|插入|補上|如上方|如下方|上方.*格式/i.test(
        text
      );

    if (hasPositionalWriteIntent) {
      setIsResolvingVisualSelection(true);
      try {
        const autoResolved = await Promise.race([
          startVisualSelectionResolution(selectionOrb.topPx || 240, true),
          new Promise<null>((r) => setTimeout(() => r(null), 4800)),
        ]);
        if (
          autoResolved &&
          (autoResolved.snippetText.trim().length >= 2 ||
            autoResolved.cursorAnchorBefore ||
            autoResolved.cursorAnchorAfter)
        ) {
          const nextAutoLinked = {
            sectionId: autoResolved.sectionId,
            label: autoResolved.sectionLabel,
            snippetText: autoResolved.snippetText,
            contextBefore: autoResolved.contextBefore,
            contextAfter: autoResolved.contextAfter,
            fullContextText: autoResolved.fullContextText,
            blockIndex: autoResolved.blockIndex,
            insertMode: autoResolved.insertMode,
            cursorAnchorBefore: autoResolved.cursorAnchorBefore,
            cursorAnchorAfter: autoResolved.cursorAnchorAfter,
          };
          latestLinkedSelectionRef.current = nextAutoLinked;
          setLinkedSelection(nextAutoLinked);
          setScopeMode('target_region');
          currentLinked = nextAutoLinked;
          effectiveLinked = nextAutoLinked;
        }
      } finally {
        setIsResolvingVisualSelection(false);
      }
    }

    const effectiveScopeMode = effectiveLinked ? 'target_region' : item.scopeMode;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
      attachments:
        attachedRefs.length > 0
          ? attachedRefs.map((f) => ({ name: f.name, kindLabel: f.kindLabel }))
          : undefined,
      linkedSnippet: effectiveLinked
        ? {
            label: effectiveLinked.label,
            text:
              effectiveLinked.snippetText ||
              `【游標插入位置】位於「${
                (effectiveLinked.cursorAnchorAfter || effectiveLinked.cursorAnchorBefore || '')
                  .split(/\r?\n/)[0]
                  ?.slice(0, 36) || effectiveLinked.label
              }」處`,
          }
        : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsAiWriting(true);
    setSpriteMinimized(false);
    setAiWritingTargetLabel(
      effectiveLinked?.label ??
        item.targetLabelSnapshot ??
        (effectiveScopeMode === 'whole_doc'
          ? activeDoc?.title ?? '專案內容'
          : currentTargetInfo.label ?? '指定區域')
    );

    const effectiveTargetId =
      effectiveLinked?.sectionId ?? item.targetIdSnapshot ?? currentTargetInfo.id;
    const effectiveTargetLabel =
      effectiveLinked?.label ?? item.targetLabelSnapshot ?? currentTargetInfo.label;
    const effectiveTargetContent =
      effectiveLinked?.fullContextText ||
      effectiveLinked?.snippetText ||
      currentTargetInfo.content;

    try {
      const res = await fetch('/api/projects/coauthor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          scopeMode: effectiveScopeMode,
          history: messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
          referenceFiles:
            attachedRefs.length > 0
              ? attachedRefs.map((f) => ({
                  name: f.name,
                  mimeType: f.mimeType,
                  sizeBytes: f.sizeBytes,
                  kindLabel: f.kindLabel,
                  extractedText: f.extractedText,
                  base64Data: f.base64Data,
                }))
              : undefined,
          activeDoc: activeDoc
            ? {
                id: activeDoc.id,
                title: activeDoc.title,
                docType: activeDoc.docType,
                driveItemId: activeDoc.driveItemId,
                projectCode: activeDoc.projectCode,
                projectName: activeDoc.projectName,
                selectedTargetId: effectiveTargetId,
                selectedTargetLabel: effectiveTargetLabel,
                selectedRowIndex: item.selectedRowIndexSnapshot ?? selectedCell?.row ?? null,
                currentTargetContent: effectiveTargetContent,
                linkedSnippetText: effectiveLinked?.snippetText,
                userExplicitlyLockedTarget: Boolean(
                  effectiveLinked || userLockedSectionInSidebarRef.current
                ),
                insertMode: effectiveLinked?.insertMode,
                cursorAnchorBefore: effectiveLinked?.cursorAnchorBefore,
                cursorAnchorAfter: effectiveLinked?.cursorAnchorAfter,
                fullOutlineSummary: currentTargetInfo.outline,
                fullDocumentText: currentTargetInfo.fullDocumentText,
              }
            : null,
        }),
      });

      const data = (await res.json()) as CoAuthorResponse;

      let modifiedParagraphText: string | undefined;
      for (const op of data.operations ?? []) {
        if (op.kind === 'write_word_section' && op.content) {
          modifiedParagraphText = stripClientAuxiliaryPhrases(op.content);
          break;
        }
        if (op.kind === 'write_ppt_slide' && op.bullets?.length) {
          modifiedParagraphText = `${op.slideTitle}\n${op.bullets.join('\n')}`.trim();
          break;
        }
        if (op.kind === 'write_excel_rows' && op.rows?.length) {
          modifiedParagraphText = op.rows.map((r) => r.join('\t')).join('\n');
          break;
        }
      }

      if (modifiedParagraphText) {
        if (linkedSelection) {
          setLinkedSelection((prev) =>
            prev ? { ...prev, snippetText: modifiedParagraphText } : null
          );
        }
        setSelectionOrb((prev) =>
          prev.visible ? { ...prev, snippetText: modifiedParagraphText } : prev
        );
      }

      if (data.resolvedNativeDocId && activeDoc && activeDoc.driveItemId !== data.resolvedNativeDocId) {
        const nextNativeId = data.resolvedNativeDocId;
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === activeDoc.id
              ? {
                  ...d,
                  driveItemId: nextNativeId,
                  driveUrl: `https://docs.google.com/document/d/${nextNativeId}/edit`,
                }
              : d
          )
        );
      } else if (data.driveFileUpdated && !data.driveLiveStreaming) {
        setIframeReloadSeq((s) => s + 1);
      } else if (data.needsDriveOAuth && modifiedParagraphText && activeDoc) {
        const fallbackDriveId =
          activeDoc.docType === 'word'
            ? '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY'
            : activeDoc.docType === 'excel'
            ? '1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9'
            : '1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B';
        pendingDrivePatchRef.current = {
          driveFileId: activeDoc.driveItemId || fallbackDriveId,
          targetSnippet:
            linkedSelection?.snippetText || currentTargetInfo.content || '',
          newContent: modifiedParagraphText,
          sectionTitleHint: currentTargetInfo.label,
        };
        openDriveWriteAuthPopup();
      }

      const displayReply =
        modifiedParagraphText && attachedRefs.length === 0
          ? modifiedParagraphText
          : stripClientAuxiliaryPhrases(data.reply || '已完成。');

      const generatedImgs = (data.operations ?? [])
        .filter((op): op is Extract<CoAuthorOperation, { kind: 'generate_image' }> => op.kind === 'generate_image')
        .map((op) => ({
          caption: op.caption.replace(/\*\*/g, ''),
          dataUrl: op.dataUrl,
          insertedInDoc: Boolean(data.driveFileUpdated),
        }));

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: displayReply,
        timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        refusedCompanyAdmin: data.refusedCompanyAdmin,
        webSearch: data.webSearch,
        graphRetrieval: data.graphRetrieval,
        generatedImages: generatedImgs.length > 0 ? generatedImgs : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      let hasStreamAnimation = false;

      for (const op of data.operations ?? []) {
        if (op.kind === 'open_or_create_doc') {
          const match = documents.find((d) => d.docType === op.docType);
          if (match) {
            openDocumentInWorkbench(match);
          } else {
            createNewBlankDocument(op.docType);
          }
        } else if (op.kind === 'write_word_section' && activeDoc) {
          hasStreamAnimation = true;
          setScopeMode('target_region');
          const matchedSec = (activeDoc.wordSections ?? []).find(
            (s) =>
              s.id === op.sectionId ||
              s.code === op.sectionId ||
              s.title === op.sectionId ||
              cleanSectionLabel(s.code, s.title) === op.sectionId
          );
          const secId =
            matchedSec?.id ??
            effectiveLinked?.sectionId ??
            selectedSectionId ??
            activeDoc.wordSections?.[0]?.id ??
            'sec-1';
          animateWordSectionStream(
            activeDoc.id,
            secId,
            op.sectionTitle,
            op.content,
            op.mode,
            op.newSectionCode,
            effectiveLinked?.snippetText
          );
        } else if (op.kind === 'write_ppt_slide' && activeDoc) {
          hasStreamAnimation = true;
          setScopeMode('target_region');
          const matchedSlide = (activeDoc.pptSlides ?? []).find(
            (sl) =>
              sl.id === op.slideId ||
              String(sl.slideNumber) === op.slideId ||
              sl.title === op.slideId ||
              `第 ${sl.slideNumber} 頁：${sl.title}` === op.slideId
          );
          const slId =
            matchedSlide?.id ??
            selectedSlideId ??
            activeDoc.pptSlides?.[0]?.id ??
            'slide-1';
          animatePptSlideStream(
            activeDoc.id,
            slId,
            op.slideTitle,
            op.slideSubtitle,
            op.bullets,
            op.speakerNotes,
            op.mode
          );
        } else if (op.kind === 'write_excel_rows' && activeDoc) {
          setScopeMode('target_region');
          const matchedSheet = (activeDoc.excelSheets ?? []).find(
            (sh) =>
              sh.id === op.sheetId ||
              sh.name === op.sheetId ||
              (typeof op.sheetId === 'string' && op.sheetId.startsWith(sh.name))
          );
          const targetSheetId =
            matchedSheet?.id ??
            selectedSheetId ??
            activeDoc.excelSheets?.[0]?.id ??
            'sheet-1';
          if (op.mode === 'add_sheet') {
            const newId = `sheet-${Date.now()}`;
            setDocuments((prev) =>
              prev.map((d) => {
                if (d.id !== activeDoc.id) return d;
                return {
                  ...d,
                  excelSheets: [
                    ...(d.excelSheets ?? []),
                    {
                      id: newId,
                      name: op.newSheetName || `工作表_${(d.excelSheets?.length ?? 0) + 1}`,
                      columns: op.columns ?? ['項次', '項目名稱', '負責單位', '時程', '狀態'],
                      rows: op.rows,
                    },
                  ],
                };
              })
            );
            setSelectedSheetId(newId);
          } else {
            const existingRowCount =
              activeDoc.excelSheets?.find((sh) => sh.id === targetSheetId)?.rows.length ?? 0;
            const targetRowIdx =
              typeof op.rowIndex === 'number'
                ? op.rowIndex
                : selectedCell?.row ?? Math.max(0, existingRowCount - 1);

            setDocuments((prev) =>
              prev.map((d) => {
                if (d.id !== activeDoc.id) return d;
                return {
                  ...d,
                  excelSheets: (d.excelSheets ?? []).map((sh) => {
                    if (sh.id !== targetSheetId) return sh;
                    const normalizedNewRows = op.rows.map((r) =>
                      sh.columns.map((_, colIdx) => r[colIdx] ?? '')
                    );
                    if (op.mode === 'update_selected_row' && normalizedNewRows[0]) {
                      return {
                        ...sh,
                        rows: sh.rows.map((row, rIdx) =>
                          rIdx === targetRowIdx ? normalizedNewRows[0] : row
                        ),
                      };
                    }
                    return {
                      ...sh,
                      rows:
                        op.mode === 'replace_rows'
                          ? normalizedNewRows
                          : [...sh.rows, ...normalizedNewRows],
                    };
                  }),
                };
              })
            );
            setSelectedSheetId(targetSheetId);
            setSelectedCell({
              row:
                op.mode === 'update_selected_row'
                  ? targetRowIdx
                  : op.mode === 'replace_rows'
                  ? 0
                  : existingRowCount,
              col: 0,
            });
          }
        } else if (op.kind === 'generate_image' && activeDoc) {
          setScopeMode('target_region');
          const newImg: DocImageItem = {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            caption: op.caption.replace(/\*\*/g, ''),
            prompt: op.prompt,
            dataUrl: op.dataUrl,
            createdAt: new Date().toISOString().slice(0, 10),
          };
          setDocuments((prev) =>
            prev.map((d) => {
              if (d.id !== activeDoc.id) return d;
              if (d.docType === 'word') {
                const matchedSec = (d.wordSections ?? []).find(
                  (s) =>
                    s.id === op.targetId ||
                    s.code === op.targetId ||
                    s.title === op.targetId ||
                    cleanSectionLabel(s.code, s.title) === op.targetId
                );
                const targetSecId =
                  matchedSec?.id ?? selectedSectionId ?? d.wordSections?.[0]?.id;
                return {
                  ...d,
                  wordSections: (d.wordSections ?? []).map((sec) => {
                    if (sec.id !== targetSecId) return sec;
                    const shouldReplace =
                      op.mode === 'replace' ||
                      (sec.images.length === 1 && sec.images[0].id.startsWith('sec-'));
                    return {
                      ...sec,
                      images: shouldReplace ? [newImg] : [...sec.images, newImg],
                    };
                  }),
                };
              }
              if (d.docType === 'ppt') {
                const matchedSl = (d.pptSlides ?? []).find(
                  (sl) =>
                    sl.id === op.targetId ||
                    String(sl.slideNumber) === op.targetId ||
                    sl.title === op.targetId
                );
                const targetSlId =
                  matchedSl?.id ?? selectedSlideId ?? d.pptSlides?.[0]?.id;
                return {
                  ...d,
                  pptSlides: (d.pptSlides ?? []).map((sl) => {
                    if (sl.id !== targetSlId) return sl;
                    const shouldReplace =
                      op.mode === 'replace' ||
                      (sl.images.length === 1 &&
                        (sl.images[0].id === 'init-slide-img' ||
                          sl.images[0].id.startsWith('slide-')));
                    return {
                      ...sl,
                      layout: 'visual_split',
                      images: shouldReplace ? [newImg] : [...sl.images, newImg],
                    };
                  }),
                };
              }
              return d;
            })
          );
        } else if (op.kind === 'format_word_document' && activeDoc) {
          setScopeMode('target_region');
          setSelectedSectionId('toc-index');
          setDocuments((prev) =>
            prev.map((d) => {
              if (d.id !== activeDoc.id) return d;
              const currentFmt: WordDocumentFormat = {
                ...DEFAULT_WORD_FORMAT,
                ...(d.wordFormat ?? {}),
              };
              const nextFmt: WordDocumentFormat = {
                ...currentFmt,
                ...(op.fontFamily ? { fontFamily: op.fontFamily } : {}),
                ...(typeof op.fontSizePt === 'number' ? { fontSizePt: op.fontSizePt } : {}),
                ...(typeof op.lineSpacing === 'number' ? { lineSpacing: op.lineSpacing } : {}),
                ...(typeof op.paragraphIndentEm === 'number'
                  ? { paragraphIndentEm: op.paragraphIndentEm }
                  : {}),
                ...(typeof op.showTableOfContents === 'boolean'
                  ? { showTableOfContents: op.showTableOfContents }
                  : {}),
                ...(typeof op.showPageNumbers === 'boolean'
                  ? { showPageNumbers: op.showPageNumbers }
                  : {}),
                ...(typeof op.showHeaderFooter === 'boolean'
                  ? { showHeaderFooter: op.showHeaderFooter }
                  : {}),
                ...(typeof op.headerText === 'string' ? { headerText: op.headerText } : {}),
                ...(typeof op.footerText === 'string' ? { footerText: op.footerText } : {}),
                ...(op.pageNumberStyle ? { pageNumberStyle: op.pageNumberStyle } : {}),
              };
              const nextSections = op.renumberSections
                ? (d.wordSections ?? []).map((s, idx) => ({
                    ...s,
                    code: `${idx + 1}.0`,
                  }))
                : d.wordSections;
              return {
                ...d,
                wordFormat: nextFmt,
                wordSections: nextSections,
              };
            })
          );
        }
      }

      if (!hasStreamAnimation) {
        isProcessingPromptRef.current = false;
        setIsAiWriting(false);
        setAiWritingTargetLabel(null);
      }
    } catch {
      isProcessingPromptRef.current = false;
      setIsAiWriting(false);
      setAiWritingTargetLabel(null);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: '連線發生異常，請稍後再試一次。',
          timestamp: '剛剛',
        },
      ]);
    }
  }

  // Automatically start the next queued prompt as soon as the current analysis finishes
  useEffect(() => {
    if (isAiWriting || isProcessingPromptRef.current || promptQueue.length === 0) return;
    const nextItem = promptQueue[0];
    if (!nextItem) return;
    isProcessingPromptRef.current = true;
    setPromptQueue((prev) => prev.slice(1));
    void executeQueuedPromptItem(nextItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAiWriting, promptQueue]);

  // ============================================================================
  // MODE A: No document open yet -> Clean Project AI Assistant with Drag-and-Drop Sidebar
  // ============================================================================
  if (!activeDoc) {
    return (
      <div className="relative flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-slate-50/60">
        {uploadingDocState && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-td-blue">
                  <span className="h-6 w-6 animate-spin rounded-full border-3 border-td-blue border-t-transparent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-td-blue">
                    正在準備雲端原生編輯環境
                  </p>
                  <p className="mt-0.5 truncate text-sm font-extrabold text-slate-900">
                    {uploadingDocState.fileName}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>{uploadingDocState.stepLabel}</span>
                  <span className="font-mono font-bold text-td-blue">
                    {uploadingDocState.progressPercent}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-td-blue to-indigo-600 transition-all duration-300"
                    style={{ width: `${uploadingDocState.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Left Project Files & Drag-and-Drop Sidebar */}
        <aside
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFileOverSidebar(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFileOverSidebar(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFileOverSidebar(false);
            void handleDroppedOrSelectedFiles(e.dataTransfer.files);
          }}
          className={`hidden w-72 shrink-0 flex-col border-r transition lg:flex ${
            isDraggingFileOverSidebar
              ? 'border-td-blue bg-blue-50/60 ring-2 ring-inset ring-td-blue'
              : 'border-slate-200/80 bg-white'
          }`}
        >
          <div className="border-b border-slate-100 p-4">
            <h2 className="text-sm font-extrabold text-td-blue-dark">
              專案協作檔案
            </h2>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => createNewBlankDocument('word')}
                className="flex flex-col items-center justify-center rounded-xl border border-blue-200 bg-blue-50/60 px-2 py-2 text-[11px] font-bold text-blue-700 transition hover:bg-blue-100/80"
              >
                <span>+ 新 Word</span>
              </button>
              <button
                type="button"
                onClick={() => createNewBlankDocument('excel')}
                className="flex flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50/60 px-2 py-2 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100/80"
              >
                <span>+ 新 Excel</span>
              </button>
              <button
                type="button"
                onClick={() => createNewBlankDocument('ppt')}
                className="flex flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-2 py-2 text-[11px] font-bold text-amber-800 transition hover:bg-amber-100/80"
              >
                <span>+ 新 PPT</span>
              </button>
            </div>

            {/* Drag and Drop Zone to start a new conversation with a dropped file */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                void handleDroppedOrSelectedFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={Boolean(uploadingDocState)}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-2.5 flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-3 py-2.5 text-center transition ${
                uploadingDocState
                  ? 'border-td-blue bg-blue-50/80 text-td-blue'
                  : isDraggingFileOverSidebar
                  ? 'border-td-blue bg-blue-100/70 text-td-blue'
                  : 'border-slate-300 bg-slate-50/70 text-slate-600 hover:border-td-blue hover:bg-blue-50/30 hover:text-td-blue'
              }`}
            >
              {uploadingDocState ? (
                <div className="flex items-center gap-2 py-0.5">
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-td-blue border-t-transparent" />
                  <span className="truncate text-xs font-bold">
                    {uploadingDocState.stepLabel}
                  </span>
                </div>
              ) : (
                <>
                  <span className="text-xs font-bold">
                    拖放檔案至此開啟新對話
                  </span>
                  <span className="mt-0.5 text-[10px] text-slate-400">
                    支援 Word / Excel / PPT（或點擊上傳）
                  </span>
                </>
              )}
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            <p className="px-1.5 text-[11px] font-bold text-slate-400">
              專案檔案清單
            </p>
            {documents.map((doc) => {
              const badgeColor =
                doc.docType === 'word'
                  ? 'bg-blue-50 text-blue-700 ring-blue-200'
                  : doc.docType === 'excel'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-amber-50 text-amber-800 ring-amber-200';
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => openDocumentInWorkbench(doc, true)}
                  className="group flex w-full items-start gap-2.5 rounded-xl border border-slate-200/80 bg-white p-3 text-left transition hover:border-td-blue hover:bg-blue-50/30 hover:shadow-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ${badgeColor}`}
                      >
                        {doc.docType.toUpperCase()}
                      </span>
                      <span className="font-mono text-[10px] font-semibold text-slate-400">
                        {doc.projectCode}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs font-bold text-td-blue-dark group-hover:text-td-blue">
                      {doc.title}
                    </p>
                  </div>
                </button>
              );
            })}

            {onSwitchToHistoryTab && (
              <button
                type="button"
                onClick={onSwitchToHistoryTab}
                className="mt-2 flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-td-blue hover:text-td-blue"
              >
                從「歷史文件」挑選檔案
              </button>
            )}
          </div>
        </aside>

        {/* Center Main AI Project Assistant Chat Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="mx-auto max-w-4xl space-y-4">
              {/* Chat Conversation Messages */}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-2xs ${
                      m.role === 'user'
                        ? 'bg-td-blue text-white'
                        : m.refusedCompanyAdmin
                        ? 'border border-amber-300 bg-amber-50/90 text-slate-800'
                        : 'border border-slate-200/90 bg-white text-slate-800'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2 text-[11px] opacity-75">
                      <span className="font-bold">
                        {m.role === 'user' ? viewer.name : '專案助手'}
                      </span>
                      <span>{m.timestamp}</span>
                    </div>
                    {m.role === 'assistant' && m.webSearch && (
                      <div className="mb-2 rounded-lg border border-sky-200/80 bg-sky-50/70 px-2.5 py-1.5 text-xs text-sky-900">
                        <div className="flex flex-wrap items-center gap-1.5 font-semibold text-sky-800">
                          <span>Google 網路即時檢索</span>
                          {m.webSearch.queries.length > 0 && (
                            <span className="truncate font-normal text-sky-700">
                              （搜尋：{m.webSearch.queries.slice(0, 2).join('、')}）
                            </span>
                          )}
                        </div>
                        {m.webSearch.sources.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {m.webSearch.sources.map((src, sIdx) => (
                              <a
                                key={sIdx}
                                href={src.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700 underline-offset-2 ring-1 ring-sky-200 hover:underline"
                              >
                                {src.title}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {m.role === 'assistant' && m.graphRetrieval && !m.webSearch && (
                      <div className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-2.5 py-1.5 text-[11px] text-indigo-900">
                        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                          <span>
                            Graphify 知識圖譜檢索（{m.graphRetrieval.totalNodes} 節點 ·{' '}
                            {m.graphRetrieval.totalEdges} 關聯邊）
                          </span>
                          {m.graphRetrieval.autoOptimized && (
                            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              新檔案已動態優化索引
                            </span>
                          )}
                        </div>
                        {m.graphRetrieval.matchedFileNames.length > 0 && (
                          <div className="mt-0.5 truncate text-[10px] text-indigo-700">
                            引用歷史檔案：{m.graphRetrieval.matchedFileNames.slice(0, 2).join('、')}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </div>
                </div>
              ))}
              <div ref={fullChatEndRef} />
            </div>
          </div>

          {/* Bottom Composer (Aligned with AI 助手 ChatComposer) */}
          <div className="border-t border-td-border bg-white p-3">
            <div className="mx-auto max-w-4xl">
              {stagedRefFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {stagedRefFiles.map((rf) => (
                    <span
                      key={rf.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/80 px-2.5 py-1 text-xs font-semibold text-indigo-800"
                    >
                      <span>參考資料：{rf.name}</span>
                      <span className="text-[10px] text-indigo-500">({rf.kindLabel})</span>
                      <button
                        type="button"
                        onClick={() =>
                          setStagedRefFiles((prev) => prev.filter((item) => item.id !== rf.id))
                        }
                        className="ml-0.5 rounded px-1 text-indigo-400 hover:bg-indigo-100 hover:text-rose-600"
                        title="移除此參考資料"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {promptQueue.length > 0 && (
                <div className="mb-2 space-y-1.5 rounded-xl border border-amber-200/90 bg-amber-50/70 px-3 py-2 text-xs text-slate-700">
                  <div className="flex items-center justify-between font-semibold text-amber-800">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                      <span>待執行佇列（{promptQueue.length} 筆 · 等待當前分析完成後依序開始）</span>
                    </span>
                  </div>
                  {promptQueue.map((qItem, idx) => (
                    <div
                      key={qItem.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 ring-1 ring-amber-200/70"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800">
                          #{idx + 1}
                        </span>
                        <span className="font-medium text-slate-800">{qItem.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPromptQueue((prev) => prev.filter((item) => item.id !== qItem.id))
                        }
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                        title="從佇列移除此筆指令"
                      >
                        移除 ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <ChatComposer
                inputRef={composerTextareaRef}
                value={composerInput}
                onChange={setComposerInput}
                onSend={(overrideText) => void handleSendPrompt(overrideText)}
                onFilesSelected={(files) => void stageReferenceFiles(files)}
                disabled={false}
                pending={false}
                sendDisabled={!composerInput.trim() && stagedRefFiles.length === 0}
                sendTitle={
                  isAiWriting
                    ? '當前正在分析中，送出後將排入佇列並於當前任務完成後自動開始'
                    : undefined
                }
                placeholder={
                  isAiWriting
                    ? '正在分析中，您可繼續輸入下一條指令（按 Enter 送出並排入佇列）…'
                    : '輸入訊息，或把檔案拖進來…（按 Enter 傳送）'
                }
                sendLabel={isAiWriting ? '排入佇列' : '傳送'}
                modelLabel="gemini-3.8-flash"
                quickPrompts={PROJECT_QUICK_PROMPTS}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // MODE B: Active Co-Authoring Workbench
  // - Full Vertical Height (`h-screen`) with Top Toolbar merged into Left Sidebar's Upper Box
  // - Left Sidebar split into 2 stacked boxes (上格：回到上一頁、檔案名稱、變更儲存位置；下格：當前檔案內容索引)
  // - Center: Interactive Word / Excel / PPT Editor Canvas + Compact AI ChatComposer below
  // - Right: Resizable AI Co-Author Sprite (專案協作小精靈)
  // ============================================================================
  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-100">
      {/* Cloud Storage Location Picker & New Folder Modal */}
      {showLocationModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs"
          onClick={() => setShowLocationModal(false)}
        >
          <div
            className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-extrabold text-slate-900">
                  設定雲端硬碟儲存位置
                </h3>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  檔案：{activeDoc.title}（帳號：{locationAccountEmail || viewer.email}）
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLocationModal(false)}
                className="ml-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
                aria-label="關閉"
              >
                ✕
              </button>
            </div>

            {/* Current File Location Banner */}
            <div className="border-b border-slate-100 bg-blue-50/50 px-5 py-2.5 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                <span className="shrink-0 text-slate-500">當前檔案位置：</span>
                <div className="flex flex-wrap items-center gap-1 font-bold text-td-blue-dark">
                  {currentFolderPath.map((seg, idx) => (
                    <span key={seg.id + idx} className="inline-flex items-center gap-1">
                      {idx > 0 && <span className="text-slate-400">/</span>}
                      <span>{seg.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Breadcrumb Bar + New Folder Button */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-2.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs">
                {browseFolderPath.map((crumb, idx) => {
                  const isLast = idx === browseFolderPath.length - 1;
                  return (
                    <span key={crumb.id + idx} className="inline-flex items-center gap-1">
                      {idx > 0 && <span className="text-slate-300">›</span>}
                      <button
                        type="button"
                        onClick={() => {
                          const fid = getEffectiveActiveDriveFileId(activeDoc);
                          void fetchDriveLocationData(fid, crumb.id);
                        }}
                        className={`rounded px-1.5 py-0.5 font-bold transition ${
                          isLast
                            ? 'bg-slate-100 text-slate-900'
                            : 'text-td-blue hover:bg-blue-50'
                        }`}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowNewFolderInput((v) => !v);
                  setLocationFeedback(null);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-td-blue/30 bg-blue-50/70 px-2.5 py-1 text-xs font-bold text-td-blue transition hover:bg-blue-100/80"
              >
                <span>＋ 新增資料夾</span>
              </button>
            </div>

            {/* Inline Create New Folder Row */}
            {showNewFolderInput && (
              <div className="flex items-center gap-2 border-b border-indigo-100 bg-indigo-50/40 px-5 py-2.5">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // Prevent any implicit form or dialog action on Enter;
                      // Enter is strictly for finishing IME character input.
                      e.stopPropagation();
                    }
                  }}
                  placeholder="輸入新資料夾名稱後，請點擊右側「新建」…"
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 focus:border-td-blue focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!newFolderName.trim() || creatingFolder}
                  onClick={() => void handleCreateDriveFolder()}
                  className="shrink-0 rounded-lg bg-td-blue px-3 py-1.5 text-xs font-bold text-white hover:bg-td-blue-dark disabled:opacity-50"
                >
                  {creatingFolder ? '建立中…' : '新建'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
              </div>
            )}

            {/* Folder List */}
            <div className="max-h-72 min-h-[210px] overflow-y-auto px-5 py-3">
              {locationLoading ? (
                <div className="flex h-44 flex-col items-center justify-center gap-2 text-xs text-slate-500">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-td-blue border-t-transparent" />
                  <span>正在讀取雲端硬碟資料夾…</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {/* Option to select current browsed folder directly */}
                  <div
                    onClick={() => setSelectedFolderId(browseFolderId)}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs transition ${
                      selectedFolderId === browseFolderId
                        ? 'border-td-blue bg-blue-50/80 font-bold text-td-blue-dark ring-1 ring-td-blue/30'
                        : 'border-slate-200/80 bg-slate-50/60 text-slate-700 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="text-sm">📂</span>
                      <span className="truncate">
                        目前所在層級：{browseFolderPath[browseFolderPath.length - 1]?.name || '我的雲端硬碟'}
                      </span>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-1.5">
                      {browseFolderId !== 'root' && (
                        <button
                          type="button"
                          disabled={deletingFolderId === browseFolderId}
                          onClick={(e) => {
                            e.stopPropagation();
                            const curName =
                              browseFolderPath[browseFolderPath.length - 1]?.name || '此資料夾';
                            void handleDeleteDriveFolder(browseFolderId, curName, true);
                          }}
                          className="rounded-md border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[11px] font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                          title="刪除此雲端資料夾並返回上一層"
                        >
                          {deletingFolderId === browseFolderId ? '刪除中…' : '刪除此資料夾'}
                        </button>
                      )}
                      {selectedFolderId === browseFolderId && (
                        <span className="rounded bg-td-blue px-2 py-0.5 text-[10px] font-bold text-white">
                          已選取此位置
                        </span>
                      )}
                    </div>
                  </div>

                  {childFolders.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      此資料夾內尚無子資料夾，可直接儲存於此或點擊右上角「＋ 新增資料夾」
                    </div>
                  ) : (
                    childFolders.map((folder) => {
                      const isSelected = selectedFolderId === folder.id;
                      const isCurrentFileFolder = currentFolderId === folder.id;
                      const isDeletingThis = deletingFolderId === folder.id;
                      return (
                        <div
                          key={folder.id}
                          onClick={() => setSelectedFolderId(folder.id)}
                          onDoubleClick={() => {
                            const fid = getEffectiveActiveDriveFileId(activeDoc);
                            void fetchDriveLocationData(fid, folder.id);
                          }}
                          className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs transition ${
                            isSelected
                              ? 'border-td-blue bg-blue-50/90 font-bold text-td-blue-dark ring-1 ring-td-blue/30'
                              : 'border-slate-200/80 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <svg
                              className="h-4 w-4 shrink-0 text-amber-500"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                            </svg>
                            <span className="truncate">{folder.name}</span>
                            {isCurrentFileFolder && (
                              <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                目前所在
                              </span>
                            )}
                          </div>

                          <div className="ml-2 flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isDeletingThis}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteDriveFolder(folder.id, folder.name, false);
                              }}
                              className="rounded-md border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                              title={`刪除資料夾「${folder.name}」`}
                            >
                              {isDeletingThis ? '刪除中…' : '刪除'}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const fid = getEffectiveActiveDriveFileId(activeDoc);
                                void fetchDriveLocationData(fid, folder.id);
                              }}
                              className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-td-blue hover:text-td-blue"
                            >
                              進入 ›
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Feedback message */}
            {locationFeedback && (
              <div
                className={`mx-5 mb-3 rounded-xl px-3.5 py-2 text-xs font-bold ${
                  locationFeedback.type === 'success'
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                {locationFeedback.message}
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3">
              <div className="truncate text-xs text-slate-600">
                將儲存至：
                <span className="ml-1 font-bold text-slate-900">
                  {selectedFolderId === browseFolderId
                    ? browseFolderPath[browseFolderPath.length - 1]?.name || '我的雲端硬碟'
                    : childFolders.find((f) => f.id === selectedFolderId)?.name || '選取的資料夾'}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLocationModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={locationMoving || locationLoading}
                  onClick={() => void handleMoveFileToFolder()}
                  className="rounded-xl bg-td-blue px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-td-blue-dark disabled:opacity-50"
                >
                  {locationMoving ? '正在移動檔案…' : '儲存至此位置'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Area: Left Two-Tier Sidebar + Center Native Editor + Right Collaboration Assistant (圖一懸浮小視窗 / 圖三並排分欄) */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#f9fbfd]">
        {spriteMinimized && (
          <button
            type="button"
            onClick={() => setSpriteMinimized(false)}
            className="absolute right-4 top-3 z-30 inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[0_4px_16px_rgba(15,23,42,0.08)] backdrop-blur-md transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span>協作助手</span>
          </button>
        )}

        {/* Left Sidebar (Codex-style unified light surface — 上格：回到上一頁、檔案名稱、變更儲存位置；下格：當前檔案內容索引) */}
        {chapterIndexCollapsed ? (
          <div className="hidden w-12 shrink-0 flex-col items-center gap-2 border-r border-slate-200/75 bg-[#f9f9fb] p-1.5 md:flex">
            {/* Collapsed Upper Box: Back to List + Change Location + Expand */}
            <div className="flex w-full flex-col items-center gap-1.5 border-b border-slate-200/70 pb-2">
              <button
                type="button"
                onClick={() => setActiveDocId(null)}
                title="回到上一頁（檔案清單）"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-slate-600 transition hover:bg-slate-200/60 hover:text-slate-900"
              >
                ←
              </button>
              <button
                type="button"
                onClick={openDriveLocationModal}
                title={`變更雲端儲存位置（目前：${currentFolderPath.map((p) => p.name).join(' / ')}）`}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-amber-600 transition hover:bg-slate-200/60"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setChapterIndexCollapsed(false)}
                title={`展開檔案資訊與內容索引（${activeDoc.title}）`}
                className="flex w-full flex-col items-center gap-1 rounded-lg py-1.5 text-slate-500 transition hover:bg-slate-200/60 hover:text-slate-900"
              >
                <span className="text-[10px] font-bold leading-none">▶</span>
                <span
                  style={{ writingMode: 'vertical-rl' }}
                  className="text-[10px] font-semibold tracking-widest"
                >
                  展開側欄
                </span>
              </button>
            </div>

            {/* Collapsed Lower Box: Content Index Quick Badges */}
            <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
              {activeDoc.docType === 'word' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSectionId('toc-index');
                    }}
                    onDoubleClick={() => {
                      void jumpToWordSectionInEditor('toc-index', '計畫書目錄');
                    }}
                    title="0.0 目錄索引與頁碼配置 (TOC)（點兩下跳至該內容位置）"
                    className={`flex h-7 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-semibold transition ${
                      selectedSectionId === 'toc-index' && scopeMode === 'target_region'
                        ? 'bg-emerald-600 text-white'
                        : selectedSectionId === 'toc-index'
                        ? 'bg-slate-200/90 text-slate-900'
                        : 'text-slate-500 hover:bg-slate-200/50 hover:text-slate-800'
                    }`}
                  >
                    0.0
                  </button>
                  {(activeDoc.wordSections ?? []).map((sec) => {
                    const isLocked = sec.id === selectedSectionId && scopeMode === 'target_region';
                    const isCurrent = sec.id === selectedSectionId;
                    const displayTitle = sec.title.replace(new RegExp(`^${sec.code}\\s+`), '').trim();
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => {
                          setSelectedSectionId(sec.id);
                        }}
                        onDoubleClick={() => {
                          void jumpToWordSectionInEditor(sec.id, sec.title, sec.headingId);
                        }}
                        title={`${sec.code} ${displayTitle}（點兩下跳至該內容位置）`}
                        className={`flex h-7 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-semibold transition ${
                          isLocked
                            ? 'bg-emerald-600 text-white'
                            : isCurrent
                            ? 'bg-slate-200/90 text-slate-900'
                            : 'text-slate-500 hover:bg-slate-200/50 hover:text-slate-800'
                        }`}
                      >
                        {sec.code}
                      </button>
                    );
                  })}
                </>
              )}

              {activeDoc.docType === 'excel' &&
                (activeDoc.excelSheets ?? []).map((sh, idx) => {
                  const isLocked = sh.id === selectedSheetId && scopeMode === 'target_region';
                  const isCurrent = sh.id === selectedSheetId;
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      onClick={() => {
                        setSelectedSheetId(sh.id);
                        setSelectedCell(null);
                      }}
                      onDoubleClick={() => {
                        setSelectedSheetId(sh.id);
                        setSelectedCell(null);
                      }}
                      title={`${sh.name}（點兩下跳至該工作表）`}
                      className={`flex h-7 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-semibold transition ${
                        isLocked
                          ? 'bg-emerald-600 text-white'
                          : isCurrent
                          ? 'bg-slate-200/90 text-slate-900'
                          : 'text-slate-500 hover:bg-slate-200/50 hover:text-slate-800'
                      }`}
                    >
                      S{idx + 1}
                    </button>
                  );
                })}

              {activeDoc.docType === 'ppt' &&
                (activeDoc.pptSlides ?? []).map((sl) => {
                  const isLocked = sl.id === selectedSlideId && scopeMode === 'target_region';
                  const isCurrent = sl.id === selectedSlideId;
                  return (
                    <button
                      key={sl.id}
                      type="button"
                      onClick={() => {
                        setSelectedSlideId(sl.id);
                      }}
                      onDoubleClick={() => {
                        setSelectedSlideId(sl.id);
                      }}
                      title={`Slide ${sl.slideNumber}：${sl.title}（點兩下跳至該投影片）`}
                      className={`flex h-7 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-semibold transition ${
                        isLocked
                          ? 'bg-emerald-600 text-white'
                          : isCurrent
                          ? 'bg-slate-200/90 text-slate-900'
                          : 'text-slate-500 hover:bg-slate-200/50 hover:text-slate-800'
                      }`}
                    >
                      P{sl.slideNumber}
                    </button>
                  );
                })}
            </div>
          </div>
        ) : (
          <div className="hidden w-64 shrink-0 flex-col border-r border-slate-200/75 bg-[#f9f9fb] md:flex">
            {/* ================================================================= */}
            {/* 上面一格 (UPPER SECTION): 回到上一頁 ＋ 檔案名稱 ＋ 變更雲端儲存位置 */}
            {/* ================================================================= */}
            <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200/70 px-3 py-2.5">
              {/* Row 1: Back to list + Format Badge + Collapse button */}
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => setActiveDocId(null)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200/60 hover:text-slate-900"
                >
                  <span>←</span>
                  <span>檔案清單</span>
                </button>

                <div className="flex items-center gap-1">
                  <span className="shrink-0 rounded-md bg-slate-200/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                    {activeDoc.docType.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setChapterIndexCollapsed(true)}
                    title="收合側邊欄以放大檢視空間"
                    className="rounded-lg p-1 text-[11px] text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700"
                  >
                    ◀
                  </button>
                </div>
              </div>

              {/* Row 2: Editable Document Title Input */}
              <div>
                <div className="mb-0.5 flex items-center justify-between px-0.5 text-[10px] font-medium text-slate-400">
                  <span>檔案名稱</span>
                  <span className="font-mono text-slate-400">{activeDoc.projectCode}</span>
                </div>
                <input
                  type="text"
                  value={activeDoc.title}
                  title={activeDoc.title}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDocuments((prev) =>
                      prev.map((d) => (d.id === activeDoc.id ? { ...d, title: val } : d))
                    );
                  }}
                  className="w-full rounded-lg border border-transparent bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ring-1 ring-slate-200/70 transition hover:ring-slate-300 focus:bg-white focus:ring-slate-400 focus:outline-none"
                />
              </div>

              {/* Row 3: Cloud Drive Location Button */}
              <button
                type="button"
                onClick={openDriveLocationModal}
                title={`目前雲端儲存位置：${currentFolderPath.map((p) => p.name).join(' / ')}（點擊變更儲存位置或管理資料夾）`}
                className="flex w-full items-center justify-between gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 ring-1 ring-slate-200/70 transition hover:bg-white hover:text-slate-900 hover:ring-slate-300"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-slate-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                  <span className="truncate text-[11px]">
                    {currentFolderPath[currentFolderPath.length - 1]?.name || '我的雲端硬碟'}
                  </span>
                </div>
                <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                  變更位置
                </span>
              </button>

              {isAiWriting && (
                <div className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
                  <span className="truncate">撰寫中：{aiWritingTargetLabel}</span>
                </div>
              )}
            </div>

            {/* ================================================================= */}
            {/* 下面一格 (LOWER SECTION): 當前檔案的內容索引 (Codex-style clean nav list) */}
            {/* ================================================================= */}
            <div className="flex min-h-0 flex-1 flex-col px-2 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-1 px-1.5">
                <span className="text-[11px] font-semibold text-slate-400">
                  當前檔案內容索引
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (activeDoc.docType === 'word') {
                      const newId = `sec-${Date.now()}`;
                      const nextNum = (activeDoc.wordSections?.length ?? 0) + 1;
                      setDocuments((prev) =>
                        prev.map((d) =>
                          d.id === activeDoc.id
                            ? {
                                ...d,
                                wordSections: [
                                  ...(d.wordSections ?? []),
                                  {
                                    id: newId,
                                    code: `${nextNum}.0`,
                                    title: '新增技術規範章節',
                                    content: '',
                                    images: [],
                                  },
                                ],
                              }
                            : d
                        )
                      );
                      setSelectedSectionId(newId);
                      setScopeMode('target_region');
                    } else if (activeDoc.docType === 'excel') {
                      const newId = `sheet-${Date.now()}`;
                      const nextNum = (activeDoc.excelSheets?.length ?? 0) + 1;
                      setDocuments((prev) =>
                        prev.map((d) =>
                          d.id === activeDoc.id
                            ? {
                                ...d,
                                excelSheets: [
                                  ...(d.excelSheets ?? []),
                                  {
                                    id: newId,
                                    name: `${nextNum}_新增工作表`,
                                    columns: ['項次', '工作項目', '負責單位', '預計完成', '進度', '備註'],
                                    rows: [['01', '', '', '', '0%', '']],
                                  },
                                ],
                              }
                            : d
                        )
                      );
                      setSelectedSheetId(newId);
                      setScopeMode('target_region');
                    } else {
                      const newId = `slide-${Date.now()}`;
                      const nextNum = (activeDoc.pptSlides?.length ?? 0) + 1;
                      setDocuments((prev) =>
                        prev.map((d) =>
                          d.id === activeDoc.id
                            ? {
                                ...d,
                                pptSlides: [
                                  ...(d.pptSlides ?? []),
                                  {
                                    id: newId,
                                    slideNumber: nextNum,
                                    title: `新增簡報主題`,
                                    subtitle: `${activeDoc.projectCode} 專案簡報`,
                                    bullets: [''],
                                    speakerNotes: '',
                                    layout: 'title_content',
                                    images: [],
                                  },
                                ],
                              }
                            : d
                        )
                      );
                      setSelectedSlideId(newId);
                      setScopeMode('target_region');
                    }
                  }}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-200/60 hover:text-slate-800"
                >
                  + 新增
                </button>
                {activeDoc.docType === 'word' &&
                  (activeDoc.wordSections ?? []).some(
                    (s, i) => getSubSectionsForWordSection(s, i).length > 0
                  ) && (
                    <button
                      type="button"
                      onClick={() => {
                        const secs = activeDoc.wordSections ?? [];
                        const anyCollapsed = secs.some((s, i) => {
                          const subs = getSubSectionsForWordSection(s, i);
                          if (subs.length === 0) return false;
                          const isExp =
                            expandedSectionIds[s.id] ??
                            (i === 0 ||
                              selectedSectionId === s.id ||
                              selectedSectionId.startsWith(`${s.id}-sub-`));
                          return !isExp;
                        });
                        const next: Record<string, boolean> = {};
                        for (const s of secs) {
                          next[s.id] = anyCollapsed;
                        }
                        setExpandedSectionIds(next);
                      }}
                      title="展開或收合所有第二層細項分類"
                      className="rounded-md bg-slate-200/65 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-300/70 hover:text-slate-900"
                    >
                      {(activeDoc.wordSections ?? []).some((s, i) => {
                        const subs = getSubSectionsForWordSection(s, i);
                        if (subs.length === 0) return false;
                        const isExp =
                          expandedSectionIds[s.id] ??
                          (i === 0 ||
                            selectedSectionId === s.id ||
                            selectedSectionId.startsWith(`${s.id}-sub-`));
                        return !isExp;
                      })
                        ? '全展開'
                        : '全收合'}
                    </button>
                  )}
              </div>

              <div className="flex-1 space-y-1 overflow-y-auto pr-0.5">
              {activeDoc.docType === 'word' && (
                <>
                  {/* Dedicated Table of Contents & Page Number Index Segment */}
                  {(() => {
                    const isTocViewing = selectedSectionId === 'toc-index';
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedSectionId('toc-index');
                          void jumpToWordSectionInEditor('toc-index', '計畫書目錄');
                        }}
                        onDoubleClick={() => {
                          void jumpToWordSectionInEditor('toc-index', '計畫書目錄');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void jumpToWordSectionInEditor('toc-index', '計畫書目錄');
                          }
                        }}
                        title="點擊直接跳至「目錄索引與頁碼配置」位置"
                        className={`group flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-xl px-2.5 py-2 text-left transition select-none ${
                          isTocViewing
                            ? 'bg-slate-200/55 text-slate-900'
                            : 'text-slate-600 hover:bg-slate-200/45 hover:text-slate-900'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] font-semibold text-slate-400">
                              0.0 索引與頁碼
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs font-medium text-slate-800">
                            目錄索引與頁碼配置 (TOC)
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {(activeDoc.wordSections ?? []).map((sec, secIdx) => {
                    const subSections = getSubSectionsForWordSection(sec, secIdx);
                    const hasSubs = subSections.length > 0;
                    const isChildSelected = selectedSectionId.startsWith(`${sec.id}-sub-`);
                    const isExpanded =
                      expandedSectionIds[sec.id] ??
                      (secIdx === 0 || selectedSectionId === sec.id || isChildSelected);
                    const isViewing = sec.id === selectedSectionId || isChildSelected;
                    const isStreamingThis = streamingSectionId === sec.id;
                    const displayTitle = sec.title.replace(new RegExp(`^${sec.code}\\s+`), '').trim();

                    return (
                      <div key={sec.id} className="space-y-0.5">
                        {/* LEVEL 1: 主章節 (Major Chapter Row) */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedSectionId(sec.id);
                            if (hasSubs && !isExpanded) {
                              setExpandedSectionIds((prev) => ({
                                ...prev,
                                [sec.id]: true,
                              }));
                            }
                            void jumpToWordSectionInEditor(sec.id, sec.title, sec.headingId);
                          }}
                          onDoubleClick={() => {
                            void jumpToWordSectionInEditor(sec.id, sec.title, sec.headingId);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              void jumpToWordSectionInEditor(sec.id, sec.title, sec.headingId);
                            }
                          }}
                          title={`點擊直接跳至「${sec.code} ${displayTitle}」位置；點擊左側箭頭可摺疊/展開細項`}
                          className={`group flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-xl px-2 py-2 text-left transition select-none ${
                            isViewing
                              ? 'bg-slate-200/55 text-slate-900'
                              : 'text-slate-700 hover:bg-slate-200/45 hover:text-slate-900'
                          }`}
                        >
                          {hasSubs ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedSectionIds((prev) => ({
                                  ...prev,
                                  [sec.id]: !isExpanded,
                                }));
                              }}
                              title={isExpanded ? '收合此章節細項' : `展開此章節細項（共 ${subSections.length} 項）`}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-slate-500 transition hover:bg-slate-300/70 hover:text-slate-900"
                            >
                              {isExpanded ? '▼' : '▶'}
                            </button>
                          ) : (
                            <span className="flex h-5 w-3.5 shrink-0 items-center justify-center text-[9px] text-slate-300">
                              •
                            </span>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-mono text-[10px] font-semibold text-slate-400">
                                {sec.code}
                              </span>
                              {hasSubs && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedSectionIds((prev) => ({
                                      ...prev,
                                      [sec.id]: !isExpanded,
                                    }));
                                  }}
                                  className="rounded bg-slate-200/80 px-1.5 py-0.2 text-[9px] font-semibold text-slate-600 transition hover:bg-slate-300/80"
                                >
                                  {subSections.length} 小節
                                </button>
                              )}
                              {isStreamingThis && (
                                <span className="animate-pulse rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                                  撰寫中
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-800">
                              {displayTitle}
                            </p>
                          </div>
                        </div>

                        {/* LEVEL 2: 可摺疊收合細項分類 (Collapsible Sub-Sections Tree) */}
                        {hasSubs && isExpanded && (
                          <div className="ml-3.5 space-y-0.5 border-l-2 border-slate-200/90 py-0.5 pl-2">
                            {subSections.map((sub) => {
                              const isSubViewing = selectedSectionId === sub.id;
                              const isLevel3 = sub.level === 3;

                              return (
                                <div
                                  key={sub.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    setSelectedSectionId(sub.id);
                                    void jumpToWordSectionInEditor(
                                      sub.id,
                                      sub.title,
                                      sub.headingId,
                                      sec.id
                                    );
                                  }}
                                  onDoubleClick={() => {
                                    void jumpToWordSectionInEditor(
                                      sub.id,
                                      sub.title,
                                      sub.headingId,
                                      sec.id
                                    );
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      void jumpToWordSectionInEditor(
                                        sub.id,
                                        sub.title,
                                        sub.headingId,
                                        sec.id
                                      );
                                    }
                                  }}
                                  title={`點擊直接跳至細項「${sub.code} ${sub.title}」位置`}
                                  className={`group flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-lg py-1.5 pr-1.5 text-left transition select-none ${
                                    isLevel3 ? 'pl-3.5' : 'pl-2'
                                  } ${
                                    isSubViewing
                                      ? 'bg-slate-200/70 text-slate-900 font-medium'
                                      : 'text-slate-600 hover:bg-slate-200/45 hover:text-slate-900'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1">
                                      <span className="font-mono text-[9px] font-semibold text-slate-400">
                                        {sub.code}
                                      </span>
                                    </div>
                                    <p
                                      className={`mt-0.5 line-clamp-2 leading-snug ${
                                        isLevel3
                                          ? 'text-[11px] text-slate-700'
                                          : 'text-[11.5px] font-semibold text-slate-800'
                                      }`}
                                    >
                                      {sub.title}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {activeDoc.docType === 'excel' &&
                (activeDoc.excelSheets ?? []).map((sh) => {
                  const active = sh.id === selectedSheetId;
                  return (
                    <div key={sh.id} className="space-y-0.5">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedSheetId(sh.id);
                          setSelectedCell(null);
                        }}
                        onDoubleClick={() => {
                          setSelectedSheetId(sh.id);
                          setSelectedCell(null);
                        }}
                        title={`點兩下切換至工作表「${sh.name}」`}
                        className={`group flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-xl px-2.5 py-2 text-left transition select-none ${
                          active
                            ? 'bg-slate-200/55 text-slate-900'
                            : 'text-slate-600 hover:bg-slate-200/45 hover:text-slate-900'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] font-semibold text-slate-400">
                              工作表 ({sh.rows.length} 列)
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs font-medium text-slate-800">{sh.name}</p>
                        </div>
                      </div>

                      {active && (
                        <div className="space-y-0.5 pl-2">
                          {sh.rows.map((r, rIdx) => {
                            const rowLocked =
                              scopeMode === 'target_region' && selectedCell?.row === rIdx;
                            return (
                              <button
                                key={rIdx}
                                type="button"
                                onClick={() => {
                                  if (rowLocked) {
                                    setSelectedCell(null);
                                    setScopeMode('whole_doc');
                                  } else {
                                    setSelectedCell({ row: rIdx, col: 0 });
                                    setScopeMode('target_region');
                                  }
                                }}
                                className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[11px] transition ${
                                  rowLocked
                                    ? 'bg-slate-800 font-semibold text-white'
                                    : 'text-slate-600 hover:bg-slate-200/50'
                                }`}
                              >
                                <span className="truncate">
                                  第 {rIdx + 1} 列：{r[0] || ''} {r[1] || ''}
                                </span>
                                {rowLocked && <span className="ml-1 shrink-0 text-[9px]">已鎖定</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

              {activeDoc.docType === 'ppt' &&
                (activeDoc.pptSlides ?? []).map((sl) => {
                  const active = sl.id === selectedSlideId;
                  const isStreamingThis = streamingSectionId === sl.id;
                  return (
                    <div
                      key={sl.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedSlideId(sl.id);
                      }}
                      onDoubleClick={() => {
                        setSelectedSlideId(sl.id);
                      }}
                      title={`點兩下切換至「Slide ${sl.slideNumber}：${sl.title}」`}
                      className={`group flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-xl px-2.5 py-2 text-left transition select-none ${
                        active
                          ? 'bg-slate-200/55 text-slate-900'
                          : 'text-slate-600 hover:bg-slate-200/45 hover:text-slate-900'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-semibold text-slate-400">
                            Slide {sl.slideNumber}
                          </span>
                          {isStreamingThis && (
                            <span className="animate-pulse rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                              撰寫中
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs font-medium text-slate-800">
                          {sl.title}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* CENTER COLUMN: 100% NATIVE EDITOR BASE LAYER + SEGMENTED AI OVERLAY LAYER + FLOATING CODEX-STYLE BOTTOM COMPOSER */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f9fbfd]">
          {(() => {
            // Resolve real Google Docs / Sheets / Slides native editor URL for every file
            const matchedDriveId =
              activeDoc.driveItemId ||
              findMatchingProjectAndDriveItem(activeDoc.title).driveItem?.id;
            const isUploadedCustomDoc = activeDoc.id.startsWith('upload-');
            const fallbackDriveId = isUploadedCustomDoc
              ? undefined
              : activeDoc.docType === 'word'
              ? '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY'
              : activeDoc.docType === 'excel'
              ? '1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9'
              : '1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B';
            const effectiveDriveId = matchedDriveId || fallbackDriveId;
            const isNativeGoogleDocId = Boolean(effectiveDriveId && effectiveDriveId.length >= 40);
            const nativeEditorUrl = effectiveDriveId
              ? buildDriveEmbedPreviewUrl(
                  {
                    id: effectiveDriveId,
                    name: activeDoc.title,
                    kind:
                      activeDoc.docType === 'word'
                        ? 'document'
                        : activeDoc.docType === 'excel'
                        ? 'spreadsheet'
                        : 'presentation',
                    driveUrl: activeDoc.driveUrl ?? '',
                  },
                  'edit',
                  driveAuthUser
                ) ??
                `https://docs.google.com/document/d/${effectiveDriveId}/edit?rm=embedded${
                  isNativeGoogleDocId ? '' : '&rtpof=true&sd=true'
                }&tab=t.0${
                  driveAuthUser ? `&authuser=${encodeURIComponent(driveAuthUser.trim())}` : ''
                }`
              : null;

            return (
              <div
                ref={editorViewportRef}
                onMouseEnter={() => {
                  isPointerInEditorRef.current = true;
                }}
                onMouseLeave={() => {
                  isPointerInEditorRef.current = false;
                }}
                className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                {/* 1. BASE LAYER: 100% NATIVE GOOGLE DOCS / SHEETS / SLIDES EDITOR */}
                {nativeEditorUrl ? (
                  <>
                    {isIframeLoading && (
                      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center bg-gradient-to-b from-white/95 via-white/80 to-transparent py-3">
                        <div className="inline-flex items-center gap-2.5 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
                          <span>正在載入「{activeDoc.title}」雲端編輯畫面…</span>
                        </div>
                      </div>
                    )}
                    <iframe
                      ref={nativeIframeRef}
                      key={`${activeDoc.id}:${effectiveDriveId}:${driveAuthUser}:${iframeReloadSeq}`}
                      title={activeDoc.title}
                      src={nativeEditorUrl}
                      onLoad={() => setIsIframeLoading(false)}
                      style={
                        activeDoc.docType === 'word'
                          ? {
                              width: 'calc(100% + 88px)',
                              marginLeft: '-88px',
                              maxWidth: 'none',
                            }
                          : undefined
                      }
                      className={`h-full flex-1 border-0 bg-[#f9fbfd] ${
                        activeDoc.docType === 'word' ? '' : 'w-full'
                      } ${isResizingSprite ? 'pointer-events-none' : ''}`}
                      allow="clipboard-read; clipboard-write"
                    />
                  </>
                ) : uploadingDocState ? (
                  <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-3 bg-[#f9fbfd] text-slate-600">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
                    <p className="text-sm font-semibold text-slate-700">
                      正在載入「{activeDoc.title}」原生編輯畫面…
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-1 flex-col overflow-hidden bg-[#f9fbfd]">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-900">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                        <span className="font-medium">
                          已從本機檔案解析「{activeDoc.title}」章節內容（尚未完成 Google Docs 雲端轉檔，可能因檔案較大或雲端授權過期）
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {droppedFilesByDocIdRef.current.has(activeDoc.id) && (
                          <button
                            type="button"
                            onClick={async () => {
                              const savedFile = droppedFilesByDocIdRef.current.get(activeDoc.id);
                              if (!savedFile) return;
                              const dt = new DataTransfer();
                              dt.items.add(savedFile);
                              await handleDroppedOrSelectedFiles(dt.files);
                            }}
                            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
                          >
                            重新轉換為 Google Docs 原生編輯器
                          </button>
                        )}
                        <a
                          href={`/auth/google?returnTo=${encodeURIComponent('/tools/project-assistant')}`}
                          className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          重新授權 Google Drive
                        </a>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-8">
                      <div className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
                        <h2 className="mb-6 border-b border-slate-100 pb-4 text-xl font-bold text-slate-900">
                          {activeDoc.title}
                        </h2>
                        <div className="space-y-8">
                          {(activeDoc.wordSections ?? []).map((sec) => (
                            <div
                              key={sec.id}
                              id={`local-sec-${sec.id}`}
                              className={`rounded-lg border p-5 transition ${
                                selectedSectionId === sec.id
                                  ? 'border-sky-400 bg-sky-50/30 ring-1 ring-sky-300'
                                  : 'border-slate-100 bg-white hover:border-slate-200'
                              }`}
                              onClick={() => {
                                setSelectedSectionId(sec.id);
                                setLinkedSelection({
                                  sectionId: sec.id,
                                  label: `${sec.code} ${sec.title}`,
                                  snippetText: sec.content.slice(0, 240),
                                  fullContextText: sec.content.slice(0, 1800),
                                  insertMode: 'replace',
                                });
                                setScopeMode('target_region');
                              }}
                            >
                              <div className="mb-3 flex items-center justify-between">
                                <h3 className="text-base font-bold text-slate-800">
                                  {sec.code} {sec.title}
                                </h3>
                                <span className="text-[11px] font-medium text-sky-600">
                                  點擊此章節即可鎖定讓 AI 改寫或補充
                                </span>
                              </div>
                              <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                                {sec.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {trySilentAuthIframe && !hasDriveWriteToken && (
                  <iframe
                    title="Silent Drive Write Auth"
                    src={`/auth/google?returnTo=${encodeURIComponent(
                      '/tools/project-assistant?driveAuthPopup=1'
                    )}&loginHint=${encodeURIComponent(
                      (driveAuthUser || viewer.email || '').trim()
                    )}&silent=1`}
                    className="pointer-events-none absolute h-0 w-0 border-0 opacity-0"
                  />
                )}

                {/* 1.5A NON-BLOCKING MICRO-PROBE LAYER: Detects drag-selection ("框選一段文字") inside the native editor without blocking native clicks */}
                <div
                  ref={probeLayerRef}
                  style={{ pointerEvents: 'none' }}
                  onPointerDown={(e) => {
                    e.currentTarget.style.pointerEvents = 'none';
                  }}
                  onWheel={(e) => {
                    e.currentTarget.style.pointerEvents = 'none';
                    const now = Date.now();
                    const dt = now - lastWheelAtRef.current;
                    lastWheelAtRef.current = now;
                    const frameDeltaPx = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
                    const multiplier =
                      dt >= 25 && dt <= 350 ? Math.min(7.5, Math.max(2.5, dt / 16.6)) : 4.5;
                    iframeScrollTopRef.current = Math.max(
                      0,
                      iframeScrollTopRef.current + frameDeltaPx * multiplier
                    );
                  }}
                  onPointerMove={(e) => {
                    e.currentTarget.style.pointerEvents = 'none';
                    const vp = editorViewportRef.current;
                    if (!vp) return;
                    const rect = vp.getBoundingClientRect();
                    const relX = e.clientX - rect.left;
                    const relY = e.clientY - rect.top;
                    const xRatio = relX / Math.max(1, rect.width);
                    const now = Date.now();

                    // Right-edge scrollbar drag tracking
                    if (e.buttons === 1 && xRatio > 0.94) {
                      const scrollRatio = Math.max(
                        0,
                        Math.min(1, (relY - 90) / Math.max(200, rect.height - 110))
                      );
                      iframeScrollTopRef.current = scrollRatio * 12000;
                      return;
                    }

                    // Case A: User is actively dragging (e.buttons === 1) to highlight a paragraph
                    if (e.buttons === 1) {
                      if (!iframeDragStartRef.current) {
                        iframeDragStartRef.current = lastHoverPosRef.current
                          ? {
                              x: lastHoverPosRef.current.x,
                              y: lastHoverPosRef.current.y,
                              time: lastHoverPosRef.current.time,
                            }
                          : { x: relX, y: relY, time: now };
                      }
                      const start = iframeDragStartRef.current;
                      const dist = Math.hypot(relX - start.x, relY - start.y);
                      if (dist >= 14 && relY > 110) {
                        const midY = Math.min(
                          Math.max(135, Math.round((start.y + relY) / 2)),
                          rect.height - 75
                        );
                        const resolved = resolveParagraphAtPosition(midY, rect.height);
                        setSelectionOrb({
                          visible: true,
                          topPx: midY,
                          leftPercent: 89,
                          linked: false,
                          sectionId: resolved.sectionId,
                          sectionLabel: resolved.sectionLabel,
                          snippetText: resolved.snippetText,
                          contextBefore: resolved.contextBefore,
                          contextAfter: resolved.contextAfter,
                          fullContextText: resolved.fullContextText,
                          blockIndex: resolved.blockIndex,
                        });
                      }
                      return;
                    }

                    // Case B: User just released mouse button (e.buttons === 0) after dragging across text inside the cross-origin iframe
                    const prev = lastHoverPosRef.current;
                    if (iframeDragStartRef.current) {
                      const start = iframeDragStartRef.current;
                      iframeDragStartRef.current = null;
                      const dist = Math.hypot(relX - start.x, relY - start.y);
                      if (dist >= 14 && relY > 110) {
                        const midY = Math.min(
                          Math.max(135, Math.round((start.y + relY) / 2)),
                          rect.height - 75
                        );
                        const resolved = resolveParagraphAtPosition(midY, rect.height);
                        setSelectionOrb({
                          visible: true,
                          topPx: midY,
                          leftPercent: 89,
                          linked: false,
                          sectionId: resolved.sectionId,
                          sectionLabel: resolved.sectionLabel,
                          snippetText: resolved.snippetText,
                          contextBefore: resolved.contextBefore,
                          contextAfter: resolved.contextAfter,
                          fullContextText: resolved.fullContextText,
                          blockIndex: resolved.blockIndex,
                        });
                        // Pre-warm visual selection resolution immediately when drag ends so clicking the orb is instant!
                        void startVisualSelectionResolution(midY);
                      }
                    } else if (
                      prev &&
                      document.activeElement === nativeIframeRef.current &&
                      prev.y > 110 &&
                      relY > 110 &&
                      prev.xRatio >= 0.14 &&
                      prev.xRatio <= 0.85 &&
                      xRatio >= 0.14 &&
                      xRatio <= 0.92
                    ) {
                      const elapsed = now - prev.time;
                      const dy = Math.abs(relY - prev.y);
                      const dx = Math.abs(relX - prev.x);
                      if (elapsed >= 180 && elapsed <= 12000 && (dy >= 18 || dx >= 50)) {
                        const midY = Math.min(
                          Math.max(135, Math.round((prev.y + relY) / 2)),
                          rect.height - 75
                        );
                        const resolved = resolveParagraphAtPosition(midY, rect.height);
                        setSelectionOrb({
                          visible: true,
                          topPx: midY,
                          leftPercent: 89,
                          linked: false,
                          sectionId: resolved.sectionId,
                          sectionLabel: resolved.sectionLabel,
                          snippetText: resolved.snippetText,
                          contextBefore: resolved.contextBefore,
                          contextAfter: resolved.contextAfter,
                          fullContextText: resolved.fullContextText,
                          blockIndex: resolved.blockIndex,
                        });
                        void startVisualSelectionResolution(midY);
                      }
                    }

                    lastHoverPosRef.current = { x: relX, y: relY, xRatio, time: now };
                  }}
                  className="absolute inset-x-0 bottom-14 top-28 z-10"
                />

                {/* 1.5B RIGHT-MARGIN BLANK SPACE SENSOR STRIP ("這個段落右邊空白處"): Detects cursor in the right margin next to any selected paragraph */}
                <div
                  aria-hidden="true"
                  onMouseMove={(e) => {
                    const vp = editorViewportRef.current;
                    if (!vp) return;
                    const rect = vp.getBoundingClientRect();
                    const relY = e.clientY - rect.top;
                    if (relY < 125 || relY > rect.height - 70) return;
                    if (!selectionOrb.visible) {
                      const midY = Math.min(Math.max(135, Math.round(relY)), rect.height - 75);
                      const resolved = resolveParagraphAtPosition(midY, rect.height);
                      setSelectionOrb({
                        visible: true,
                        topPx: midY,
                        leftPercent: 89,
                        linked: false,
                        sectionId: resolved.sectionId,
                        sectionLabel: resolved.sectionLabel,
                        snippetText: resolved.snippetText,
                        contextBefore: resolved.contextBefore,
                        contextAfter: resolved.contextAfter,
                        fullContextText: resolved.fullContextText,
                        blockIndex: resolved.blockIndex,
                      });
                    }
                  }}
                  style={{ left: '84%', width: '12%' }}
                  className="absolute bottom-16 top-32 z-10"
                />

                {/* 1.6 FLOATING SELECTION ORB ("會在這個段落右邊空白處的中間 會跑出一個小球"): Pure single orb in right margin blank space */}
                {selectionOrb.visible && (
                  <button
                    type="button"
                    onMouseEnter={() => {
                      // Start resolving the highlighted text the moment the cursor touches the orb
                      if (!selectionOrb.linked) {
                        void startVisualSelectionResolution(selectionOrb.topPx);
                      }
                    }}
                    onMouseDown={(e) => {
                      // Prevent focus shift away from the Google Docs iframe so its highlighted selection stays active
                      e.preventDefault();
                    }}
                    onClick={() => void handleLinkSelectionOrbToSprite()}
                    title="連結協作助手修改此段落（包含前後文脈絡）"
                    style={{
                      top: `${selectionOrb.topPx}px`,
                      left: `${selectionOrb.leftPercent}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    className={`pointer-events-auto absolute z-40 flex h-9 w-9 items-center justify-center rounded-full text-white shadow-xl transition-all duration-200 hover:scale-110 active:scale-95 ${
                      selectionOrb.linked
                        ? 'bg-gradient-to-br from-emerald-500 via-teal-500 to-indigo-600 ring-4 ring-emerald-400/40'
                        : 'bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 ring-4 ring-indigo-400/45'
                    }`}
                  >
                    {!selectionOrb.linked && (
                      <span className="absolute inset-0 animate-ping rounded-full bg-cyan-300/45" />
                    )}
                    <span className="relative text-sm leading-none">
                      {selectionOrb.linked ? '✓' : '✨'}
                    </span>
                  </button>
                )}
              </div>
            );
          })()}

          {/* CENTER COLUMN BOTTOM COMPOSER: Codex-style floating composer card on unified canvas background (#f9fbfd) */}
          <div className="bg-[#f9fbfd] px-4 pb-2.5 pt-1.5">
            <div className="mx-auto max-w-3xl">
              {linkedSelection && (
                <div className="mb-2 flex flex-col gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-xs shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                        <span>✨</span>
                        <span>已連結段落與前後文</span>
                      </span>
                      {isResolvingVisualSelection && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-medium text-indigo-600">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                          <span>精準同步反白文字中…</span>
                        </span>
                      )}
                      {typeof linkedSelection.blockIndex === 'number' &&
                      allDocSemanticBlocks.length > 0 ? (
                        <select
                          value={linkedSelection.blockIndex}
                          onChange={(e) =>
                            selectSemanticBlockByGlobalIndex(Number(e.target.value))
                          }
                          title="切換目前鎖定的文件段落（自動載入該段前後文）"
                          className="max-w-[240px] truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-800 focus:border-slate-400 focus:bg-white focus:outline-none"
                        >
                          {allDocSemanticBlocks.map((b) => (
                            <option key={b.globalIndex} value={b.globalIndex}>
                              {b.sectionLabel}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="shrink-0 font-semibold text-slate-800">
                          {linkedSelection.label}：
                        </span>
                      )}
                      <input
                        type="text"
                        value={linkedSelection.snippetText}
                        onChange={(e) => {
                          const val = e.target.value;
                          const matched = matchTextInActiveDocumentWithContext(val);
                          if (matched) {
                            setLinkedSelection({
                              sectionId: matched.sectionId,
                              label: matched.sectionLabel,
                              snippetText: val,
                              contextBefore: matched.contextBefore,
                              contextAfter: matched.contextAfter,
                              fullContextText: matched.fullContextText,
                              blockIndex: matched.blockIndex,
                            });
                          } else {
                            setLinkedSelection((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    snippetText: val,
                                    fullContextText: [
                                      prev.contextBefore
                                        ? `【前文脈絡】\n${prev.contextBefore}`
                                        : '',
                                      `【框選段落】\n${val}`,
                                      prev.contextAfter
                                        ? `【後文脈絡】\n${prev.contextAfter}`
                                        : '',
                                    ]
                                      .filter(Boolean)
                                      .join('\n\n'),
                                  }
                                : null
                            );
                          }
                        }}
                        placeholder="可在此確認或調整框選的目標段落文字…"
                        className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50/70 px-2 py-0.5 text-xs text-slate-700 focus:border-slate-400 focus:bg-white focus:outline-none"
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {typeof linkedSelection.blockIndex === 'number' &&
                        allDocSemanticBlocks.length > 1 && (
                          <>
                            <button
                              type="button"
                              disabled={linkedSelection.blockIndex <= 0}
                              onClick={() =>
                                selectSemanticBlockByGlobalIndex(
                                  Math.max(0, (linkedSelection.blockIndex ?? 0) - 1)
                                )
                              }
                              className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              title="切換至上一段落"
                            >
                              ◀ 上一段
                            </button>
                            <button
                              type="button"
                              disabled={
                                linkedSelection.blockIndex >= allDocSemanticBlocks.length - 1
                              }
                              onClick={() =>
                                selectSemanticBlockByGlobalIndex(
                                  Math.min(
                                    allDocSemanticBlocks.length - 1,
                                    (linkedSelection.blockIndex ?? 0) + 1
                                  )
                                )
                              }
                              className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                              title="切換至下一段落"
                            >
                              下一段 ▶
                            </button>
                          </>
                        )}
                      <button
                        type="button"
                        onClick={() => {
                          setLinkedSelection(null);
                          setSelectionOrb((prev) => ({ ...prev, linked: false, visible: false }));
                          setScopeMode('whole_doc');
                        }}
                        className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title="解除框選段落連結"
                      >
                        取消連結 ×
                      </button>
                    </div>
                  </div>
                  {(linkedSelection.contextBefore || linkedSelection.contextAfter) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-slate-100 pt-1 text-[10.5px] text-slate-400">
                      {linkedSelection.contextBefore && (
                        <span className="max-w-[46%] truncate">
                          <strong className="font-semibold text-slate-500">前文：</strong>
                          {linkedSelection.contextBefore.replace(/\s+/g, ' ')}
                        </span>
                      )}
                      {linkedSelection.contextAfter && (
                        <span className="max-w-[46%] truncate">
                          <strong className="font-semibold text-slate-500">後文：</strong>
                          {linkedSelection.contextAfter.replace(/\s+/g, ' ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {stagedRefFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {stagedRefFiles.map((rf) => (
                    <span
                      key={rf.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs"
                    >
                      <span>參考資料：{rf.name}</span>
                      <span className="text-[10px] text-slate-400">({rf.kindLabel})</span>
                      <button
                        type="button"
                        onClick={() =>
                          setStagedRefFiles((prev) => prev.filter((item) => item.id !== rf.id))
                        }
                        className="ml-0.5 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                        title="移除此參考資料"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {promptQueue.length > 0 && (
                <div className="mb-2 space-y-1.5 rounded-xl border border-amber-200/90 bg-amber-50/75 px-3 py-2 text-xs text-slate-700 shadow-2xs">
                  <div className="flex items-center justify-between font-semibold text-amber-800">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                      <span>待執行佇列（{promptQueue.length} 筆 · 等待當前分析完成後依序開始）</span>
                    </span>
                  </div>
                  {promptQueue.map((qItem, idx) => (
                    <div
                      key={qItem.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/95 px-2.5 py-1.5 ring-1 ring-amber-200/80"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800">
                          佇列 #{idx + 1}
                        </span>
                        {qItem.linkedSelectionSnapshot?.label && (
                          <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {qItem.linkedSelectionSnapshot.label}
                          </span>
                        )}
                        <span className="font-medium text-slate-800">{qItem.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPromptQueue((prev) => prev.filter((item) => item.id !== qItem.id))
                        }
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                        title="從佇列移除此筆指令"
                      >
                        移除 ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <ChatComposer
                inputRef={composerTextareaRef}
                value={composerInput}
                onChange={setComposerInput}
                onSend={(overrideText) => void handleSendPrompt(overrideText)}
                onFilesSelected={(files) => void stageReferenceFiles(files)}
                disabled={false}
                pending={false}
                sendDisabled={!composerInput.trim() && stagedRefFiles.length === 0}
                sendTitle={
                  isAiWriting
                    ? '當前正在分析中，送出後將排入佇列並於當前任務完成後自動開始'
                    : undefined
                }
                placeholder={
                  isAiWriting
                    ? linkedSelection
                      ? `正在分析中，可繼續針對「${linkedSelection.label}」輸入下一條指令（送出後自動排入佇列）…`
                      : '正在分析中，您可繼續輸入下一條指令（按 Enter 送出並排入佇列）…'
                    : linkedSelection
                    ? `針對已連結的「${linkedSelection.label}」框選段落輸入修改需求…（按 Enter 傳送）`
                    : '與協作助手討論，或把檔案拖進來…（按 Enter 傳送）'
                }
                sendLabel={isAiWriting ? '排入佇列' : '傳送'}
                modelLabel="gemini-3.8-flash"
                quickPrompts={PROJECT_QUICK_PROMPTS}
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLLABORATION ASSISTANT (協作助手):
            Supports BOTH 圖一 (Codex 懸浮小視窗模式 'floating') and 圖三 (Codex 並排分欄模式 'split') */}
        {!spriteMinimized && (
          <aside
            aria-label="協作助手"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingOverChat(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingOverChat(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingOverChat(false);
              void stageReferenceFiles(e.dataTransfer.files);
            }}
            style={
              spriteLayoutMode === 'floating'
                ? {
                    width: `${spriteWidth}px`,
                    maxHeight: `${spriteFloatingHeight}px`,
                  }
                : {
                    width: `${spriteWidth}px`,
                  }
            }
            className={
              spriteLayoutMode === 'floating'
                ? `absolute right-4 top-3 z-30 flex flex-col overflow-hidden rounded-2xl border bg-white/95 shadow-[0_12px_36px_rgba(15,23,42,0.09)] backdrop-blur-md transition-shadow duration-200 ${
                    spriteSignalFlash
                      ? 'border-slate-400 ring-2 ring-slate-400/30'
                      : isDraggingOverChat
                      ? 'border-td-blue ring-2 ring-td-blue/30'
                      : 'border-slate-200/85'
                  } ${isResizingSprite ? 'select-none' : ''}`
                : `relative flex shrink-0 flex-col overflow-hidden border-l bg-white transition-colors duration-200 ${
                    spriteSignalFlash
                      ? 'border-slate-400'
                      : isDraggingOverChat
                      ? 'border-td-blue bg-blue-50/10'
                      : 'border-slate-200/80'
                  } ${isResizingSprite ? 'select-none' : ''}`
            }
          >
            {/* Left-edge invisible hairline drag handle to resize width (no protruding pill, highlights softly on hover like 圖三) */}
            <div
              role="separator"
              aria-orientation="vertical"
              title="左右拖曳調整協作助手寬度"
              onMouseDown={startSpriteResize}
              className="group absolute bottom-0 left-0 top-0 z-40 w-2 cursor-ew-resize"
            >
              <span className="absolute inset-y-0 left-0 w-[2px] bg-transparent transition-colors group-hover:bg-slate-300/90 group-active:bg-slate-400" />
            </div>

            {/* Bottom-edge invisible drag handle when in floating card mode (圖一) */}
            {spriteLayoutMode === 'floating' && (
              <div
                role="separator"
                aria-orientation="horizontal"
                title="上下拖曳調整懸浮視窗高度"
                onMouseDown={startSpriteHeightResize}
                className="group absolute inset-x-0 bottom-0 z-40 h-2 cursor-ns-resize"
              >
                <span className="mx-auto mt-0.5 block h-0.5 w-8 rounded-full bg-transparent transition-colors group-hover:bg-slate-300" />
              </div>
            )}

            {/* Codex-style Clean Light Header (matches 圖一 card header & 圖三 split-pane header) */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-100 bg-white/95 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <p className="truncate text-base font-bold text-slate-800">協作助手</p>
                {linkedSelection && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    已連結段落
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setSpriteLayoutMode((prev) => (prev === 'floating' ? 'split' : 'floating'))
                  }
                  title={
                    spriteLayoutMode === 'floating'
                      ? '切換為並排分欄模式（如圖三，固定於右側並排）'
                      : '切換為懸浮小視窗模式（如圖一，懸浮於右上角不壓縮文件寬度）'
                  }
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                >
                  {spriteLayoutMode === 'floating' ? (
                    <>
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="2.5" width="12" height="11" rx="2" />
                        <line x1="9.5" y1="2.5" x2="9.5" y2="13.5" />
                      </svg>
                      <span>並排</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="2" y="2.5" width="12" height="11" rx="2" />
                        <rect x="7.5" y="4.5" width="4.5" height="5" rx="1" fill="currentColor" fillOpacity="0.15" />
                      </svg>
                      <span>懸浮</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSpriteMinimized(true)}
                  title="收合協作助手"
                  className="rounded-lg px-2.5 py-1 text-sm font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  收合
                </button>
              </div>
            </div>

            {/* Codex-style subtle metadata / status strip (like 圖一 syncdrive_t3 summary row) */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100/90 bg-slate-50/50 px-4 py-2 text-sm text-slate-500">
              <span className="truncate font-semibold text-slate-600">{activeDoc.title}</span>
              <span className="shrink-0 font-mono text-xs text-slate-400">
                {scopeMode === 'target_region' ? '區段鎖定' : '全文件協作'}
              </span>
            </div>

            {/* Active Sprite Visual Signal Banner when user clicks the floating orb */}
            {linkedSelection && (
              <div className="border-b border-slate-100 bg-slate-50/90 px-4 py-2.5 text-sm text-slate-800">
                <div className="flex items-center justify-between gap-2 font-semibold text-slate-700">
                  <span className="flex shrink-0 items-center gap-1">
                    <span>✨</span>
                    <span>已鎖定框選段落與前後文</span>
                  </span>
                  <span className="truncate font-mono text-xs text-slate-500">
                    {linkedSelection.label}
                  </span>
                </div>
                {linkedSelection.contextBefore && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-600">前文：</span>
                    {linkedSelection.contextBefore.replace(/\s+/g, ' ')}
                  </p>
                )}
                <p className="mt-1.5 line-clamp-5 rounded-lg bg-white/90 px-2.5 py-2 text-sm font-medium leading-relaxed text-slate-800 ring-1 ring-slate-200/80">
                  「{linkedSelection.snippetText}」
                </p>
                {linkedSelection.contextAfter && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-600">後文：</span>
                    {linkedSelection.contextAfter.replace(/\s+/g, ' ')}
                  </p>
                )}
              </div>
            )}

            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-base">
              {messages.slice(-10).map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl p-3 leading-relaxed ${
                    m.role === 'user'
                      ? 'ml-4 bg-slate-100 text-slate-800'
                      : m.refusedCompanyAdmin
                      ? 'border border-amber-200/80 bg-amber-50/70 text-slate-800'
                      : m.linkedSnippet
                      ? 'border border-slate-200 bg-slate-50/70 text-slate-800'
                      : 'text-slate-700'
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-500">
                      {m.role === 'user' ? '您' : '協作助手'}
                    </span>
                    <span>{m.timestamp}</span>
                  </div>
                  {m.linkedSnippet && (
                    <div className="mb-2.5 rounded-lg border border-slate-200/80 bg-white p-2.5 text-sm text-slate-700">
                      <div className="mb-1 flex items-center gap-1 font-semibold text-slate-700">
                        <span>✨</span>
                        <span>已連結框選段落：{m.linkedSnippet.label}</span>
                      </div>
                      <p className="line-clamp-4 text-sm italic leading-relaxed text-slate-600">
                        「{m.linkedSnippet.text}」
                      </p>
                    </div>
                  )}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {m.attachments.map((att, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-200/70 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                        >
                          <span>參考資料：{att.name}</span>
                          <span className="opacity-75">({att.kindLabel})</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {m.role === 'assistant' && m.webSearch && (
                    <div className="mb-2 rounded-lg border border-sky-200/80 bg-sky-50/70 px-2.5 py-1.5 text-xs text-sky-900">
                      <div className="flex flex-wrap items-center gap-1 font-semibold text-sky-800">
                        <span>Google 網路即時檢索</span>
                        {m.webSearch.queries.length > 0 && (
                          <span className="truncate font-normal text-sky-700">
                            · {m.webSearch.queries.slice(0, 2).join('、')}
                          </span>
                        )}
                      </div>
                      {m.webSearch.sources.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {m.webSearch.sources.map((src, sIdx) => (
                            <a
                              key={sIdx}
                              href={src.uri}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700 underline-offset-2 ring-1 ring-sky-200 hover:underline"
                            >
                              {src.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {m.role === 'assistant' && m.graphRetrieval && !m.webSearch && (
                    <div className="mb-2 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <div className="flex flex-wrap items-center gap-1 font-semibold text-slate-700">
                        <span>
                          Graphify 圖譜檢索（{m.graphRetrieval.totalNodes} 節點）
                        </span>
                        {m.graphRetrieval.autoOptimized && (
                          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            已動態優化索引
                          </span>
                        )}
                      </div>
                      {m.graphRetrieval.matchedFileNames.length > 0 && (
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          關聯歷史檔：{m.graphRetrieval.matchedFileNames.slice(0, 2).join('、')}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{m.text.replace(/\*\*/g, '')}</div>
                  {m.generatedImages && m.generatedImages.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      {m.generatedImages.map((img, iIdx) => (
                        <div
                          key={iIdx}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xs"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.dataUrl}
                            alt={img.caption}
                            className="h-auto w-full object-cover"
                          />
                          <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            <span className="truncate font-semibold">{img.caption}</span>
                            {img.insertedInDoc && (
                              <span className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                                已插入文件段落下方
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {isAiWriting && (
                <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-base font-medium text-slate-700">
                  <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-emerald-500" />
                  <span>正在分析與撰寫…</span>
                </div>
              )}

              {promptQueue.length > 0 && (
                <div className="space-y-2.5">
                  {promptQueue.map((qItem, idx) => (
                    <div
                      key={qItem.id}
                      className="ml-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 leading-relaxed text-slate-800"
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                          <span>您 · 佇列中 #{idx + 1}（等待當前完成後開始）</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">{qItem.timestamp}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPromptQueue((prev) => prev.filter((item) => item.id !== qItem.id))
                            }
                            className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-amber-100/80 hover:text-rose-600"
                            title="取消此筆佇列指令"
                          >
                            取消 ×
                          </button>
                        </div>
                      </div>
                      {qItem.linkedSelectionSnapshot && (
                        <div className="mb-2 rounded-lg border border-amber-200/80 bg-white/90 px-2.5 py-1.5 text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">
                            ✨ 鎖定段落：{qItem.linkedSelectionSnapshot.label}
                          </span>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap text-base">{qItem.text}</div>
                    </div>
                  ))}
                </div>
              )}
              <div ref={spriteEndRef} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
