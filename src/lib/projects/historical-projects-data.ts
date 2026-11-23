export type DriveItemKind = 'folder' | 'spreadsheet' | 'document' | 'presentation' | 'pdf' | 'archive' | 'image';

/**
 * Access / sharing level reflecting Google Shared Drive & folder permissions:
 * - 'company_wide': 台灣智慧駕駛 (turing-drive.com) 全網域可檢視
 * - 'department_only': 限定所屬部門／專案群組（如 [EXT] ADAWARP、GBGH、BD-Tokyo Drift 內部）與管理層可檢視
 * - 'confidential': 財務／報價／預算／合約機密，僅管理員、財務、高階主管或負責部門可檢視
 */
export type AccessScopeLevel = 'company_wide' | 'department_only' | 'confidential';

export type HistoricalDriveItem = {
  id: string;
  name: string;
  kind: DriveItemKind;
  driveUrl: string;
  updatedAt?: string;
  sizeOrNote?: string;
  accessScope?: AccessScopeLevel;
  allowedDepartments?: string[];
  allowedRoles?: string[];
  /** Optional explicit departments or roles that have edit permission on this file */
  editAllowedDepartments?: string[];
  editAllowedRoles?: string[];
  keyTakeaways?: string[];
  children?: HistoricalDriveItem[];
};

export type HistoricalProject = {
  id: string;
  code: string;
  name: string;
  startYear: number;
  period: string;
  department: string;
  sharedDriveName: string;
  status: 'active' | 'completed' | 'archived';
  accessScope?: AccessScopeLevel;
  accessGroupLabel?: string;
  allowedDepartments?: string[];
  allowedRoles?: string[];
  summary: string;
  highlights: string[];
  driveFolderId: string;
  driveFolderUrl: string;
  files: HistoricalDriveItem[];
};

export type HistoricalYearGroup = {
  year: number;
  label: string;
  tagline: string;
  projectOverview: string;
  projects: HistoricalProject[];
};

export type ProjectViewerContext = {
  name: string;
  email: string;
  role: string;
  departmentCode: string;
  departmentName: string;
  isGeneralManager?: boolean;
  isChairman?: boolean;
};

/**
 * Returns true if the file is an editable Office / Google Workspace document type
 * (Word / Google Docs, Excel / Google Sheets, PowerPoint / Google Slides).
 */
export function isEditableDocumentKind(item: HistoricalDriveItem): boolean {
  if (
    item.kind === 'spreadsheet' ||
    item.kind === 'document' ||
    item.kind === 'presentation'
  ) {
    return true;
  }
  const lower = item.name.toLowerCase();
  return (
    lower.endsWith('.docx') ||
    lower.endsWith('.doc') ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.pptx') ||
    lower.endsWith('.ppt')
  );
}

/**
 * Generates an embeddable Google Drive / Docs / Sheets / Slides URL
 * for in-app iframe viewing (`preview`) or live editing (`edit`).
 *
 * Note: Many project files on Shared Drives are uploaded Office files (.xlsx, .docx, .pptx).
 * - In `drive_preview` mode: `https://drive.google.com/file/d/{id}/preview` reliably renders
 *   PDFs, uploaded Office files, images, videos, and native Google Docs in read-only mode.
 * - In `edit` mode: uses Google Docs/Sheets/Slides `/edit?rtpof=true&sd=true` editor URL so
 *   both native Google files and uploaded Office files (.docx, .xlsx, .pptx) open in Google's
 *   online Office editor inside the iframe.
 */
function normalizeDriveFileId(rawId: string, driveUrl?: string): string {
  const trimmed = (rawId ?? '').trim();
  const stripped = trimmed.replace(/-(?:ref|copy|dup\d*)$/i, '');
  if (stripped && !stripped.startsWith('seed-') && !stripped.startsWith('hist-')) {
    return stripped;
  }
  if (driveUrl) {
    const match = driveUrl.match(/\/(?:d|folders)\/([a-zA-Z0-9_-]{15,})/);
    if (match?.[1]) return match[1];
  }
  return stripped || trimmed;
}

export function buildDriveEmbedPreviewUrl(
  item: HistoricalDriveItem,
  mode: 'drive_preview' | 'docs_preview' | 'edit' = 'drive_preview',
  authUser?: string
): string | null {
  if (item.kind === 'folder') return null;
  const id = normalizeDriveFileId(item.id, item.driveUrl);
  if (!id) return null;

  const lower = item.name.toLowerCase();
  const cleanAuthUser = authUser?.trim();
  const authUserParam = cleanAuthUser ? `&authuser=${encodeURIComponent(cleanAuthUser)}` : '';
  const authUserQuery = cleanAuthUser ? `?authuser=${encodeURIComponent(cleanAuthUser)}` : '';

  const isNativeGoogleId = id.length >= 40;
  const officeParams = isNativeGoogleId ? '' : '&rtpof=true&sd=true';

  if (mode === 'edit') {
    if (
      item.kind === 'spreadsheet' ||
      item.driveUrl.includes('docs.google.com/spreadsheets') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      lower.endsWith('.csv')
    ) {
      return `https://docs.google.com/spreadsheets/d/${id}/edit?usp=drivesdk&rm=embedded${officeParams}${authUserParam}`;
    }
    if (
      item.kind === 'presentation' ||
      item.driveUrl.includes('docs.google.com/presentation') ||
      lower.endsWith('.pptx') ||
      lower.endsWith('.ppt')
    ) {
      return `https://docs.google.com/presentation/d/${id}/edit?usp=drivesdk&rm=embedded${officeParams}${authUserParam}`;
    }
    if (
      item.kind === 'document' ||
      item.driveUrl.includes('docs.google.com/document') ||
      lower.endsWith('.docx') ||
      lower.endsWith('.doc')
    ) {
      return `https://docs.google.com/document/d/${id}/edit?rm=embedded${officeParams}&tab=t.0${authUserParam}`;
    }
  }

  if (mode === 'docs_preview') {
    if (item.kind === 'spreadsheet' || item.driveUrl.includes('docs.google.com/spreadsheets')) {
      return `https://docs.google.com/spreadsheets/d/${id}/preview?rtpof=true&sd=true${authUserParam}`;
    }
    if (item.kind === 'presentation' || item.driveUrl.includes('docs.google.com/presentation')) {
      return `https://docs.google.com/presentation/d/${id}/preview?rtpof=true&sd=true${authUserParam}`;
    }
    if (item.kind === 'document' || item.driveUrl.includes('docs.google.com/document')) {
      return `https://docs.google.com/document/d/${id}/preview?rtpof=true&sd=true${authUserParam}`;
    }
  }

  return `https://drive.google.com/file/d/${id}/preview${authUserQuery}`;
}

/**
 * Evaluates whether a viewer can access a given project or file based on role,
 * department, and executive flags.
 */
export function canViewerAccessScope(
  viewer: ProjectViewerContext,
  opts: {
    accessScope?: AccessScopeLevel;
    allowedDepartments?: string[];
    allowedRoles?: string[];
  }
): { allowed: boolean; reason: string } {
  const scope = opts.accessScope ?? 'company_wide';
  const isExecOrAdmin =
    viewer.role === 'admin' ||
    Boolean(viewer.isGeneralManager) ||
    Boolean(viewer.isChairman);

  if (scope === 'company_wide') {
    return { allowed: true, reason: '🌐 全公司可檢視（turing-drive.com 網域共享）' };
  }

  if (isExecOrAdmin) {
    return {
      allowed: true,
      reason:
        scope === 'confidential'
          ? '🔐 財務／商務機密（您具備管理員／高階主管全區權限）'
          : '🔒 部門／專案群組限定（您具備管理員／高階主管全區權限）',
    };
  }

  if (scope === 'confidential') {
    if (viewer.role === 'finance' || (opts.allowedRoles ?? []).includes(viewer.role)) {
      return { allowed: true, reason: '🔐 財務／商務機密（財務權限已授權）' };
    }
    const deptMatches = (opts.allowedDepartments ?? []).some(
      (d) =>
        viewer.departmentName.toLowerCase().includes(d.toLowerCase()) ||
        viewer.departmentCode.toLowerCase() === d.toLowerCase()
    );
    if (deptMatches) {
      return { allowed: true, reason: `🔐 商務機密（所屬部門「${viewer.departmentName}」授權存取）` };
    }
    return {
      allowed: false,
      reason: '🔐 僅限管理員、財務或專案權責部門檢視（報價／預算／發票機密）',
    };
  }

  // department_only
  const deptMatches = (opts.allowedDepartments ?? []).some(
    (d) =>
      viewer.departmentName.toLowerCase().includes(d.toLowerCase()) ||
      viewer.departmentCode.toLowerCase() === d.toLowerCase()
  );
  if (deptMatches) {
    return { allowed: true, reason: `🔒 專案群組限定（所屬部門「${viewer.departmentName}」成員）` };
  }

  return {
    allowed: false,
    reason: `🔒 限定部門／群組存取（需具備 ${(opts.allowedDepartments ?? ['權責部門']).join(' / ')} 權限）`,
  };
}

/**
 * Evaluates whether a viewer has EDIT permission on an editable file (Word / Excel / PPT / Docs / Sheets / Slides)
 * based on their login identity, department, project ownership, and project status.
 */
export function canViewerEditFile(
  viewer: ProjectViewerContext,
  project: HistoricalProject,
  item: HistoricalDriveItem,
  inheritedOpts?: {
    accessScope?: AccessScopeLevel;
    allowedDepartments?: string[];
    allowedRoles?: string[];
  }
): { canEdit: boolean; reason: string } {
  if (!isEditableDocumentKind(item)) {
    return { canEdit: false, reason: '此檔案格式為唯讀檢視格式' };
  }

  // First check view access
  const viewAccess = canViewerAccessScope(viewer, {
    accessScope: item.accessScope ?? inheritedOpts?.accessScope ?? project.accessScope,
    allowedDepartments:
      item.allowedDepartments ?? inheritedOpts?.allowedDepartments ?? project.allowedDepartments,
    allowedRoles: item.allowedRoles ?? inheritedOpts?.allowedRoles ?? project.allowedRoles,
  });
  if (!viewAccess.allowed) {
    return { canEdit: false, reason: viewAccess.reason };
  }

  const isExecOrAdmin =
    viewer.role === 'admin' ||
    Boolean(viewer.isGeneralManager) ||
    Boolean(viewer.isChairman);

  if (project.status === 'archived' && !isExecOrAdmin) {
    return {
      canEdit: false,
      reason: '歷史歸檔專案僅開放檢視（如需修改請洽系統管理員或部門主管）',
    };
  }

  if (isExecOrAdmin) {
    return { canEdit: true, reason: '您具備管理員／高階主管編輯權限' };
  }

  const effectiveScope =
    item.accessScope ?? inheritedOpts?.accessScope ?? project.accessScope ?? 'company_wide';

  // Confidential files: Finance or explicitly allowed departments/roles can edit
  if (effectiveScope === 'confidential') {
    const allowedRoles =
      item.editAllowedRoles ??
      item.allowedRoles ??
      inheritedOpts?.allowedRoles ??
      project.allowedRoles ??
      [];
    if (viewer.role === 'finance' || allowedRoles.includes(viewer.role)) {
      return { canEdit: true, reason: '您具備財務／商務機密檔案編輯權限' };
    }
    const allowedDepts =
      item.editAllowedDepartments ??
      item.allowedDepartments ??
      inheritedOpts?.allowedDepartments ??
      project.allowedDepartments ??
      [];
    const deptMatch = allowedDepts.some(
      (d) =>
        viewer.departmentName.toLowerCase().includes(d.toLowerCase()) ||
        viewer.departmentCode.toLowerCase() === d.toLowerCase()
    );
    if (deptMatch) {
      return { canEdit: true, reason: `所屬部門（${viewer.departmentName}）具備此機密檔案編輯權限` };
    }
    return { canEdit: false, reason: '機密檔案僅限授權部門或財務人員編輯（目前為唯讀檢視）' };
  }

  // Check if viewer belongs to the project's responsible department or explicit allowedDepartments
  const candidateDepts = [
    ...(item.editAllowedDepartments ?? []),
    ...(item.allowedDepartments ?? []),
    ...(inheritedOpts?.allowedDepartments ?? []),
    ...(project.allowedDepartments ?? []),
  ];

  // Also match against project.department text (e.g., "專案執行 / 產品與系統研發", "商務開發 BD", "交通行動服務 MaaS")
  const projDeptText = project.department.toLowerCase();
  const viewerDeptName = viewer.departmentName.toLowerCase();
  const viewerDeptCode = viewer.departmentCode.toLowerCase();

  const matchesExplicitDept = candidateDepts.some(
    (d) =>
      viewerDeptName.includes(d.toLowerCase()) ||
      viewerDeptCode === d.toLowerCase()
  );

  const matchesProjectResponsibleDept =
    (viewerDeptCode === 'rd' &&
      (projDeptText.includes('研發') ||
        projDeptText.includes('r&d') ||
        projDeptText.includes('系統') ||
        projDeptText.includes('技術') ||
        projDeptText.includes('專案執行'))) ||
    (viewerDeptCode === 'bd' &&
      (projDeptText.includes('bd') ||
        projDeptText.includes('商務') ||
        projDeptText.includes('營業') ||
        projDeptText.includes('海外') ||
        projDeptText.includes('行銷'))) ||
    (viewerDeptCode === 'maas' &&
      (projDeptText.includes('maas') ||
        projDeptText.includes('交通') ||
        projDeptText.includes('營運') ||
        projDeptText.includes('專案執行'))) ||
    (viewerDeptCode === 'fin' &&
      (projDeptText.includes('財務') || projDeptText.includes('管理')));

  if (matchesExplicitDept || matchesProjectResponsibleDept) {
    return {
      canEdit: true,
      reason: `您所屬部門（${viewer.departmentName}）具備此檔案之共同編輯權限`,
    };
  }

  return {
    canEdit: false,
    reason: `此專案由「${project.department}」權責維護，您的身份（${viewer.departmentName}）僅具檢視權限`,
  };
}

const CONFIDENTIAL_HIGHLIGHT_KEYWORDS = [
  '報價',
  '預算',
  'invoice',
  '発注',
  'po ',
  'pi ',
  '請款',
  '合約',
  '經費',
  '機密',
  '詢價',
];

/**
 * Recursively strips out any folder or file that the viewer does not have permission to view.
 * Unauthorized items are completely removed so even their filenames and metadata never appear.
 */
export function filterDriveItemsForViewer(
  items: HistoricalDriveItem[],
  viewer: ProjectViewerContext,
  inherited?: {
    accessScope?: AccessScopeLevel;
    allowedDepartments?: string[];
    allowedRoles?: string[];
  }
): HistoricalDriveItem[] {
  const result: HistoricalDriveItem[] = [];

  for (const item of items) {
    const effectiveScope = item.accessScope ?? inherited?.accessScope ?? 'company_wide';
    const effectiveDepts = item.allowedDepartments ?? inherited?.allowedDepartments;
    const effectiveRoles = item.allowedRoles ?? inherited?.allowedRoles;

    const access = canViewerAccessScope(viewer, {
      accessScope: effectiveScope,
      allowedDepartments: effectiveDepts,
      allowedRoles: effectiveRoles,
    });

    if (!access.allowed) {
      continue;
    }

    if (item.kind === 'folder' && item.children) {
      const visibleChildren = filterDriveItemsForViewer(item.children, viewer, {
        accessScope: effectiveScope,
        allowedDepartments: effectiveDepts,
        allowedRoles: effectiveRoles,
      });
      result.push({
        ...item,
        children: visibleChildren,
      });
    } else {
      result.push({ ...item });
    }
  }

  return result;
}

/**
 * Filters all year groups, projects, highlights, and nested file trees for the current viewer.
 * Ensures that accounts without permission cannot see confidential projects, folders, or filenames at all.
 */
export function filterYearGroupsForViewer(
  groups: HistoricalYearGroup[],
  viewer: ProjectViewerContext
): HistoricalYearGroup[] {
  return groups
    .map((group) => {
      const visibleProjects: HistoricalProject[] = [];

      for (const proj of group.projects) {
        const projAccess = canViewerAccessScope(viewer, {
          accessScope: proj.accessScope,
          allowedDepartments: proj.allowedDepartments,
          allowedRoles: proj.allowedRoles,
        });
        if (!projAccess.allowed) {
          continue;
        }

        const visibleFiles = filterDriveItemsForViewer(proj.files, viewer, {
          accessScope: proj.accessScope,
          allowedDepartments: proj.allowedDepartments,
          allowedRoles: proj.allowedRoles,
        });

        const canSeeProjectConfidential = canViewerAccessScope(viewer, {
          accessScope: 'confidential',
          allowedDepartments: proj.allowedDepartments ?? ['營業', 'BD', '財務', '總經理'],
          allowedRoles: proj.allowedRoles ?? ['admin', 'finance'],
        }).allowed;

        const visibleHighlights = canSeeProjectConfidential
          ? proj.highlights
          : proj.highlights.filter(
              (h) =>
                !CONFIDENTIAL_HIGHLIGHT_KEYWORDS.some((kw) =>
                  h.toLowerCase().includes(kw)
                )
            );

        visibleProjects.push({
          ...proj,
          highlights: visibleHighlights,
          files: visibleFiles,
        });
      }

      return {
        ...group,
        projects: visibleProjects,
      };
    })
    .filter((group) => group.projects.length > 0);
}

export const HISTORICAL_YEAR_GROUPS: HistoricalYearGroup[] = [
  {
    "year": 2026,
    "label": "2026 年起始專案",
    "tagline": "T3 桃園機場三航廈專案執行、TIER IV 短期合作案、PJ-389 NSC 遠端控制、經濟部國貿署海外拓銷補助案",
    "projectOverview": "涵蓋桃園機場第三航廈自駕運輸系統 2026 年度開發與介面設計、日本 TIER IV 短期技術專案、PJ-389 NSC Remote 遠端監控開發，以及經濟部國貿署日本市場拓展補助計畫。",
    "projects": [
      {
        "id": "2026-t3-projects",
        "code": "T3-2026",
        "name": "T3 桃園機場第三航廈自駕運輸系統（2026 年度執行）",
        "startYear": 2026,
        "period": "2026 Q1 – 執行中",
        "department": "專案執行 / 產品與系統研發",
        "sharedDriveName": "T3 projects",
        "status": "active",
        "accessScope": "company_wide",
        "accessGroupLabel": "tprogram@turing-drive.com · 全公司可讀",
        "summary": "桃園國際機場第三航站區旅客運輸系統 2026 年度執行資料夾，整合開發時程、HMI/FMS 介面設計、廠商報價資料、歷次會議記錄與審查報告。",
        "highlights": [
          "開發時程與里程碑追蹤",
          "介面設計 (HMI / 派遣後台)",
          "報價資料與規格書",
          "會議記錄與相關報告"
        ],
        "driveFolderId": "1fzq_AGkCZy2XLwCZjzu7z7z1m-9qIifX",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1fzq_AGkCZy2XLwCZjzu7z7z1m-9qIifX",
        "files": [
          {
            "id": "1hJNvpG9Z8Mm-COJliBMa81onmiLVNQmd",
            "name": "開發時程",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1hJNvpG9Z8Mm-COJliBMa81onmiLVNQmd",
            "updatedAt": "2026-03-23",
            "sizeOrNote": "專案甘特圖與里程碑規劃（含 6 個檔案）",
            "accessScope": "company_wide",
            "children": [
              {
                "id": "1at59IGrN9zKOv3mcoMKzuCeZRT0AdvXE",
                "name": "時程網圖0D_核定_中階進度表.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1at59IGrN9zKOv3mcoMKzuCeZRT0AdvXE/view?usp=drivesdk",
                "updatedAt": "2026-02-25",
                "sizeOrNote": "PDF · 4.7 MB · 核定版中階進度網圖",
                "keyTakeaways": [
                  "核定版 0D 階段中階時程網圖",
                  "定義第三航廈自駕運輸系統各分標關鍵里程碑與介面檢核點"
                ]
              },
              {
                "id": "1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9",
                "name": "時程表_20260316.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9/edit",
                "updatedAt": "2026-03-23",
                "sizeOrNote": "試算表 · 27 KB · 最新雙週滾動時程表",
                "keyTakeaways": [
                  "2026/03/16 最新版工程與軟硬體整合雙週進度追蹤",
                  "含子系統交付日與查核點狀態"
                ]
              },
              {
                "id": "1pkujdpZUPn27FsAqBKd5x1xmScXCH96x",
                "name": "時程表_20260309.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1pkujdpZUPn27FsAqBKd5x1xmScXCH96x/edit",
                "updatedAt": "2026-03-11",
                "sizeOrNote": "試算表 · 27 KB · 03/09 版進度時程表"
              },
              {
                "id": "1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B",
                "name": "桃園T3 PMS施工協調會20260309 V2.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B/edit",
                "updatedAt": "2026-03-11",
                "sizeOrNote": "簡報 · 29.9 MB · 03/09 施工協調會簡報 V2",
                "keyTakeaways": [
                  "桃園 T3 PMS 施工協調會議簡報",
                  "涵蓋土建機電介面、充電樁配置與高架測試廊道進場時程"
                ]
              },
              {
                "id": "1B1xUjopYjnRpqHh-0MSrwBTK_5Ibz5DJ",
                "name": "計畫時程圖_底圖_20260225.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1B1xUjopYjnRpqHh-0MSrwBTK_5Ibz5DJ/edit",
                "updatedAt": "2026-02-25",
                "sizeOrNote": "簡報 · 79 KB · 計畫時程底圖"
              },
              {
                "id": "1U8C1E7B_lDWWJg3NWgYLxW_QzDVsG_bI",
                "name": "資料整理.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1U8C1E7B_lDWWJg3NWgYLxW_QzDVsG_bI/edit",
                "updatedAt": "2026-03-11",
                "sizeOrNote": "Word · 1.8 MB · 時程與工程規範彙整文件"
              }
            ]
          },
          {
            "id": "16eXqmtrFyv-bOkkLISx9mJheUZD34zke",
            "name": "介面設計",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/16eXqmtrFyv-bOkkLISx9mJheUZD34zke",
            "updatedAt": "2026-03-24",
            "sizeOrNote": "車載 HMI 與行控中心 UI 規範（含 4 子目錄 + SOP 文件）",
            "accessScope": "company_wide",
            "children": [
              {
                "id": "1WGid16WpNuhbYoenBZuvrWqR0znQ4wlT",
                "name": "SyncDrive-T3 營運全景圖台：設計製作與元件規範 (SOP).docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1WGid16WpNuhbYoenBZuvrWqR0znQ4wlT/edit",
                "updatedAt": "2026-03-24",
                "sizeOrNote": "Word · 34 KB · 營運全景圖台 UI/UX 設計製作與元件 SOP",
                "keyTakeaways": [
                  "定義 SyncDrive-T3 營運全景圖台四大圖層（營運核心、資訊配置、資通安全、後勤管理）",
                  "規範車隊即時點位、告警燈號、充電站狀態與無障礙設計標準",
                  "定義雙層車聯網通訊分工架構：車對雲端 (V2C) 採用 MQTT (QoS 1/2) 雙向遙測與調度指令通道，車載內部與圖台即時串流採用 WebSocket / ROS Bridge 訂閱機制"
                ]
              },
              {
                "id": "1p2b25QSJhBM_VzMmPI6puzk69ivR21A1",
                "name": "A. 車輛監控系統-營運核心層",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1p2b25QSJhBM_VzMmPI6puzk69ivR21A1",
                "updatedAt": "2026-03-17",
                "sizeOrNote": "即時車隊動態、班距調度與異常接管介面設計稿（含 5 個簡報）",
                "children": [
                  {
                    "id": "1z-WiIlOe-DywhbmLzTDEzLpb07djfAAQ",
                    "name": "01. 數據監控模組.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1z-WiIlOe-DywhbmLzTDEzLpb07djfAAQ/edit",
                    "updatedAt": "2026-03-10",
                    "sizeOrNote": "簡報 · 17.3 MB · 車隊即時數據監控模組 UI 設計"
                  },
                  {
                    "id": "1E2gvY5mH7j8PptsU2-ys_Z9fmAf9hlfE",
                    "name": "02. 營運管理模組.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1E2gvY5mH7j8PptsU2-ys_Z9fmAf9hlfE/edit",
                    "updatedAt": "2026-03-10",
                    "sizeOrNote": "簡報 · 20.4 MB · 營運調度與派車管理模組 UI 設計"
                  },
                  {
                    "id": "1yrZGqYDo9OAhNrGNZzuvl8x_cHs8cQks",
                    "name": "03. 班表管理模組.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1yrZGqYDo9OAhNrGNZzuvl8x_cHs8cQks/edit",
                    "updatedAt": "2026-03-17",
                    "sizeOrNote": "簡報 · 11.4 MB · 班表排程與發車頻率管理模組"
                  },
                  {
                    "id": "11bxfXe1m5E90PCQ-rZirORxR2mwo96_P",
                    "name": "04. 事件管理模組.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/11bxfXe1m5E90PCQ-rZirORxR2mwo96_P/edit",
                    "updatedAt": "2026-02-26",
                    "sizeOrNote": "簡報 · 7.0 MB · 異常事件告警與應變SOP模組"
                  },
                  {
                    "id": "14e4ThwJUsoM0dHZ1ts0_dqZcEDi6cDsl",
                    "name": "00Turing Drive's 空白投影片.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/14e4ThwJUsoM0dHZ1ts0_dqZcEDi6cDsl/edit",
                    "updatedAt": "2026-02-26",
                    "sizeOrNote": "簡報 · 7.0 MB · 介面設計公版母片"
                  }
                ]
              },
              {
                "id": "1AJKmrM-JsEFMJc6glOy3citTns6P6fvi",
                "name": "B. 車輛監控系統-資訊配置層",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1AJKmrM-JsEFMJc6glOy3citTns6P6fvi",
                "updatedAt": "2026-02-26",
                "sizeOrNote": "站牌 PID 旅客資訊顯示與車內廣播配置層",
                "children": [
                  {
                    "id": "1xgVIRnTtBckuVb3z22t8AfAHZXJs2hmm",
                    "name": "T3車輛監控系統_.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1xgVIRnTtBckuVb3z22t8AfAHZXJs2hmm/edit",
                    "updatedAt": "2026-02-26",
                    "sizeOrNote": "簡報 · 4.2 MB · 車輛監控系統資訊配置與站牌 PID 顯示架構"
                  },
                  {
                    "id": "1MXrn4ueu1Yij_TTxC-fTnSLkApoiXYZB",
                    "name": "PMS_系統監控通訊協議_資通所_20260119_v2.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1MXrn4ueu1Yij_TTxC-fTnSLkApoiXYZB/edit",
                    "updatedAt": "2026-01-19",
                    "sizeOrNote": "試算表 · 86 KB · PMS 系統監控通訊協議欄位配置表 v2"
                  },
                  {
                    "id": "1cw1gSXB2FCREjeB6GOngaNcVQ99Lp_Au",
                    "name": "Ba.即時監控載具_佈局2_2.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1cw1gSXB2FCREjeB6GOngaNcVQ99Lp_Au/view?usp=drivesdk",
                    "updatedAt": "2026-02-26",
                    "sizeOrNote": "PNG 圖檔 · 640 KB · 即時監控載具資訊配置佈局圖"
                  }
                ]
              },
              {
                "id": "1zGWgWliPPw9Z9NoWZ-1dynPuyE1HqZ8i",
                "name": "C. 車輛監控系統-資通安全層",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1zGWgWliPPw9Z9NoWZ-1dynPuyE1HqZ8i",
                "updatedAt": "2026-02-26",
                "sizeOrNote": "車聯網通訊加密、權限控管與資安監控儀表板",
                "children": [
                  {
                    "id": "19RhrauxEvBtKQEcktejrw0XgeID0s-BRkN_9S7WToss",
                    "name": "PMS - VTMS(軟體、It 、開啟資安討論) - 會議與技術規範.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/19RhrauxEvBtKQEcktejrw0XgeID0s-BRkN_9S7WToss/edit",
                    "updatedAt": "2026-02-26",
                    "sizeOrNote": "Google 文件 · VTMS 軟體、IT 與資通安全層架構規範"
                  },
                  {
                    "id": "1m0zL4aQloGgMJtnxkc2rODp_D1jWFGH0",
                    "name": "PMS_系統監控通訊協議_資通所_20260119_v1.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1m0zL4aQloGgMJtnxkc2rODp_D1jWFGH0/edit",
                    "updatedAt": "2026-01-19",
                    "sizeOrNote": "試算表 · 82 KB · 資通安全層通訊協議與加密驗證定義表"
                  }
                ]
              },
              {
                "id": "1vDUxwZM6p-_0IK4QSBMgkr5DPeIZ4Pp6",
                "name": "D. 車輛監控系統-後勤管理層",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1vDUxwZM6p-_0IK4QSBMgkr5DPeIZ4Pp6",
                "updatedAt": "2026-02-26",
                "sizeOrNote": "維保工單、電池健康度 SOH 與零件庫存後勤介面",
                "children": [
                  {
                    "id": "1_0oM61S7xBuEEkjoGaGwcnQHLjaHBn2k",
                    "name": "附冊三_J 後勤、維修及貯存廠篇(送印版).pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1_0oM61S7xBuEEkjoGaGwcnQHLjaHBn2k/view?usp=drivesdk",
                    "updatedAt": "2026-02-26",
                    "sizeOrNote": "PDF · 5.4 MB · 後勤維修及貯存廠管理規範（送印版）"
                  },
                  {
                    "id": "1pdavwbaus1uw8o6-hPQmlP5C80IvlXUz",
                    "name": "後勤作業區域示意圖.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1pdavwbaus1uw8o6-hPQmlP5C80IvlXUz/view?usp=drivesdk",
                    "updatedAt": "2026-02-26",
                    "sizeOrNote": "PDF · 1.2 MB · 車隊後勤維保與充電作業區域配置圖"
                  }
                ]
              }
            ]
          },
          {
            "id": "1GvvezKlj4c0EyZmOr7qOVASSP5vBV5XQ",
            "name": "報價資料",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1GvvezKlj4c0EyZmOr7qOVASSP5vBV5XQ",
            "updatedAt": "2026-03-23",
            "sizeOrNote": "專案預算表與 Turing 報價單（財務／商務機密）",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ],
            "children": [
              {
                "id": "1_ICpYfR6cGtvXYzoIJi-C_ljuB1X6eU7",
                "name": "2026年度營收.產品專案預算表_T3.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1_ICpYfR6cGtvXYzoIJi-C_ljuB1X6eU7/edit",
                "updatedAt": "2026-03-23",
                "sizeOrNote": "試算表 · 223 KB · 2026 年度 T3 專案營收與預算編列總表",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ],
                "keyTakeaways": [
                  "2026 年度 T3 專案各季認列營收、軟硬體採購成本與人力工時預算配置",
                  "可直接引用此預算表發起請購單或費用支用單"
                ]
              },
              {
                "id": "1LAgKKuwSi3Q1YTzaR8jBTN7NVWFAZLl4",
                "name": "T3 PMS案Turing報價_20251020.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1LAgKKuwSi3Q1YTzaR8jBTN7NVWFAZLl4/edit",
                "updatedAt": "2026-02-25",
                "sizeOrNote": "試算表 · 113 KB · T3 PMS 案 Turing 正式報價明細表",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ],
                "keyTakeaways": [
                  "對華電聯網／業主之 T3 PMS 子系統分項報價與軟硬體 BOM 單價明細"
                ]
              }
            ]
          },
          {
            "id": "1LrBGBS9kHG69MJHtDr5ca4gpGZBGeGUo",
            "name": "會議記錄",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1LrBGBS9kHG69MJHtDr5ca4gpGZBGeGUo",
            "updatedAt": "2026-03-11",
            "sizeOrNote": "週會與業主協調會議紀錄（含施工協調會簡報）",
            "accessScope": "company_wide",
            "children": [
              {
                "id": "1DHssHBpJ1OuPa0ycRqhHG8EVIR4F4o36",
                "name": "桃園T3 PMS施工協調會20260309 V2.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1DHssHBpJ1OuPa0ycRqhHG8EVIR4F4o36/edit",
                "updatedAt": "2026-03-11",
                "sizeOrNote": "簡報 · 29.9 MB · 03/09 施工協調會議決議與待辦追蹤",
                "keyTakeaways": [
                  "記錄 2026/03/09 與總包商及機場公司之施工介面協調決議事項"
                ]
              }
            ]
          },
          {
            "id": "1x0vM7kHB3k6ZA_JSA6TG-2aP8nuv1tXT",
            "name": "相關報告",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1x0vM7kHB3k6ZA_JSA6TG-2aP8nuv1tXT",
            "updatedAt": "2026-04-16",
            "sizeOrNote": "第02584K章施工規範與期末設計報告（含 6 個檔案）",
            "accessScope": "company_wide",
            "children": [
              {
                "id": "1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY",
                "name": "01_第02584K章 車輛行車管理系統_20260330v1 資通所與台智駕更新 0413.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY/edit",
                "updatedAt": "2026-04-16",
                "sizeOrNote": "Word · 13.6 MB · 04/13 資通所與台智駕聯合更新版規範",
                "keyTakeaways": [
                  "第 02584K 章「車輛行車管理系統」最新修訂版（2026/04/13）",
                  "整合工研院資通所與台灣智慧駕駛針對車隊通訊、行控安全與備援機制之更新條文",
                  "規範 V2X / MQTT 车地遙測訂閱、WebSocket / ROS Bridge 狀態同步、月台門 (PSD) 安全連鎖與 5G 專網 mTLS 1.3 加密架構"
                ]
              },
              {
                "id": "1wJxIq_5KLsR2Qi3SE0QWCymrAsVOeG0K",
                "name": "期末設計報告(0B)_CH4_車輛行車管理系統_0330v1_資通所與台智駕更新 0413.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1wJxIq_5KLsR2Qi3SE0QWCymrAsVOeG0K/edit",
                "updatedAt": "2026-04-16",
                "sizeOrNote": "Word · 13.4 MB · 期末設計報告 (0B) 第四章定稿",
                "keyTakeaways": [
                  "0B 階段期末設計報告第 4 章完整技術論述與架構圖表"
                ]
              },
              {
                "id": "1GFWlDvm4ognF_8xRWjd-1VKRr23BM7CK",
                "name": "01_第02584K章 車輛行車管理系統_20260207v1.docx.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1GFWlDvm4ognF_8xRWjd-1VKRr23BM7CK/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 9.5 MB · 02/07 版規範 PDF 簽核定稿本",
                "keyTakeaways": [
                  "第 02584K 章 PDF 正式版，適合快速預覽章節結構與驗收標準"
                ]
              },
              {
                "id": "1eA_1h9D_m43SmuFffMIYexaoPaM5Wk0A",
                "name": "01_第02584K章 車輛行車管理系統_20260207v1.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1eA_1h9D_m43SmuFffMIYexaoPaM5Wk0A/edit",
                "updatedAt": "2026-03-11",
                "sizeOrNote": "Word · 13.7 MB · 02/07 版原始可編輯檔"
              },
              {
                "id": "18QllB5fWEcRCmo0U1OFssIjaqMIid7y0",
                "name": "簡報.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/18QllB5fWEcRCmo0U1OFssIjaqMIid7y0/edit",
                "updatedAt": "2026-03-11",
                "sizeOrNote": "簡報 · 240 KB · 審查報告摘要簡報"
              },
              {
                "id": "1unhjr2M8RUPQ9KTGhMZl4xvOn-wfJdbu",
                "name": "00Turing Drive's 空白投影片.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1unhjr2M8RUPQ9KTGhMZl4xvOn-wfJdbu/edit",
                "updatedAt": "2026-04-14",
                "sizeOrNote": "簡報 · 10.4 MB · 2026 官方簡報母片範本"
              }
            ]
          }
        ]
      },
      {
        "id": "2026-tier-iv",
        "code": "BD-TIER4",
        "name": "1.[專案] TIER IV 短期專案",
        "startYear": 2026,
        "period": "2026 Q1 – 執行中",
        "department": "營業部 BD-Tokyo Drift",
        "sharedDriveName": "BD-Tokyo Drift",
        "status": "active",
        "accessScope": "company_wide",
        "accessGroupLabel": "bd-tokyodrift@turing-drive.com · 全公司可讀",
        "summary": "與日本自動駕駛領導廠商 TIER IV 合作之短期技術與商務推進專案，包含 LiDAR-to-Vehicle 外參校正報告、日方 PO 訂單與 PI 報價簽署文件。",
        "highlights": [
          "LiDAR-to-Vehicle 外參校正技術報告",
          "202603 発注 PO 與 PI 簽署單據",
          "日方商務郵件往來紀錄"
        ],
        "driveFolderId": "1hrzS-2-t1moxEPFjiGMcyyf4M4GA20vI",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1hrzS-2-t1moxEPFjiGMcyyf4M4GA20vI",
        "files": [
          {
            "id": "1PU4gXdfephAyFg4GR-cPwSCgyo93-e_n",
            "name": "郵件往來",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1PU4gXdfephAyFg4GR-cPwSCgyo93-e_n",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "TIER IV 技術與商務往來信件備份",
            "children": [
              {
                "id": "1y74KMks_K19SLXeAoaH1oneknHadIzaA",
                "name": "RE_ [Turing Drive]NSC project_ remote support-PI260223A（#0224700）.eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1y74KMks_K19SLXeAoaH1oneknHadIzaA/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 66 KB"
              },
              {
                "id": "15vCvafEykn-j0sOeO-zb04x99M9wPcwc",
                "name": "Re_ [Turing Drive]NSC衍生專案委託（2_25–3_24）合約確認.eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/15vCvafEykn-j0sOeO-zb04x99M9wPcwc/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 405 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "18vatOgUxR2WR6i5A2MYLkL-8ZuOEicvt",
                "name": "RE_ 【PurchaseOrder】⑳LME本部 準委任外注稟議_R7-8年度防衛省警備ロボット自動運転化プロジェクト(カメラ開発)_TuringDrive(2026_3_16～5_15)(#0228500).eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/18vatOgUxR2WR6i5A2MYLkL-8ZuOEicvt/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 22 KB"
              },
              {
                "id": "1JHTv-90q_TM3c5KJkmPMyW246uEC-y4Y",
                "name": "回覆_ [Turing Drive] Quotation Attached.eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1JHTv-90q_TM3c5KJkmPMyW246uEC-y4Y/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 503 KB"
              },
              {
                "id": "1lCFKVNpVYbeq_8YKkIrwYJ99Em6ielWs",
                "name": "回覆_ [Turing Drive] Quotation for Perception System Technical Support Service (Feb–Apr 2026).eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1lCFKVNpVYbeq_8YKkIrwYJ99Em6ielWs/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 305 KB"
              },
              {
                "id": "12yLt6S3p80WFc8l-KWJSw09KRkMwn39p",
                "name": "回覆_ [Turing Drive]NSC project_ remote support-PI260223A.eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/12yLt6S3p80WFc8l-KWJSw09KRkMwn39p/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 296 KB"
              },
              {
                "id": "128IoNy2NpKqm67O9cNNbxhYUwu8G3kme",
                "name": "回覆_ [Turing Drive]Submission of Report.eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/128IoNy2NpKqm67O9cNNbxhYUwu8G3kme/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 936 KB"
              },
              {
                "id": "1XLqbC9ksm6BFPljRCWzSWKKBhsbYYoTT",
                "name": "回覆_ [Turing Drive]更改日期為2_27-3_26：NSC衍生專案委託（2_25–3_24）合約確認.eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1XLqbC9ksm6BFPljRCWzSWKKBhsbYYoTT/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 305 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1-pkzUeDLu1BnrKyn033jAPZvvmWb6Ua0",
                "name": "回覆_ Press Release Prep (TD __ TIER IV).eml",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1-pkzUeDLu1BnrKyn033jAPZvvmWb6Ua0/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 152 KB"
              }
            ]
          },
          {
            "id": "1BI5xMDwpxnI8Ochs1D6-MHKXYwHe1DJr",
            "name": "LiDAR-to-Vehicle (base_link) Extrinsic Calibration_1208.pdf",
            "kind": "pdf",
            "driveUrl": "https://drive.google.com/file/d/1BI5xMDwpxnI8Ochs1D6-MHKXYwHe1DJr/view?usp=drivesdk",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "PDF · 675 KB · 感測器外參校正技術文件",
            "keyTakeaways": [
              "Autoware base_link 與多顆光達 (LiDAR) 外參矩陣標定方法與精度驗證報告",
              "提供 pitch / roll / yaw 與平移誤差收斂標準"
            ]
          },
          {
            "id": "1TEMgzz0x7cKF83-imHnRWMxKwUTpOqaB",
            "name": "TDsigned_PO_202603発注_0228500_Turing Drive Inc.,.pdf",
            "kind": "pdf",
            "driveUrl": "https://drive.google.com/file/d/1TEMgzz0x7cKF83-imHnRWMxKwUTpOqaB/view?usp=drivesdk",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "PDF · 377 KB · 2026年3月正式採購訂單（商務機密）",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ],
            "keyTakeaways": [
              "TIER IV 正式發注採購訂單 (PO #0228500)，雙方已用印簽回"
            ]
          },
          {
            "id": "1U9aQviERu2YlRu1PNrRT6oQRM6cOfMZH",
            "name": "TD-Signned-PI260223A.pdf",
            "kind": "pdf",
            "driveUrl": "https://drive.google.com/file/d/1U9aQviERu2YlRu1PNrRT6oQRM6cOfMZH/view?usp=drivesdk",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "PDF · 323 KB · Proforma Invoice 簽回單",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ]
          },
          {
            "id": "1RKxkb_7EaQ4f0NYLigOxdixf-bympv6Z",
            "name": "TD_PI260213B.pdf",
            "kind": "pdf",
            "driveUrl": "https://drive.google.com/file/d/1RKxkb_7EaQ4f0NYLigOxdixf-bympv6Z/view?usp=drivesdk",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "PDF · 206 KB · PI 報價憑證",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ]
          },
          {
            "id": "1IVRSpHuQA3nVW24G61sTSok_MfBTTxkX",
            "name": "2026預算表NSC remote.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/1IVRSpHuQA3nVW24G61sTSok_MfBTTxkX/edit",
            "updatedAt": "2026-03-12",
            "sizeOrNote": "試算表 · 212 KB · 2026 年度專案預算表",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ]
          }
        ]
      },
      {
        "id": "2026-pj389-nsc",
        "code": "PJ-389",
        "name": "2.[專案] PJ-389 NSC Remote 遠端控制專案",
        "startYear": 2026,
        "period": "2025 Q4 – 2026",
        "department": "營業部 BD-Tokyo Drift / 研發部",
        "sharedDriveName": "BD-Tokyo Drift",
        "status": "active",
        "accessScope": "company_wide",
        "accessGroupLabel": "bd-tokyodrift@turing-drive.com · 全公司可讀",
        "summary": "日本客戶 NSC 遠端監控與操控系統（NSC Remote）專案，整理 API 規格文件、報價單與 Invoice、業務日報、運行數據及客戶郵件往來紀錄。",
        "highlights": [
          "API 相關技術介面規格",
          "運行數據與業務日報",
          "報價單以及 Invoice 歸檔"
        ],
        "driveFolderId": "1ZURTynW5AWvAcKhFkW9bHEhYsHlmKDZu",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1ZURTynW5AWvAcKhFkW9bHEhYsHlmKDZu",
        "files": [
          {
            "id": "1fSizUJag4lvvasnC36pSyu8vqUDqncjh",
            "name": "API相關",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1fSizUJag4lvvasnC36pSyu8vqUDqncjh",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "NSC Remote 遠端控制 API 規格與客戶回饋（含 8 個檔案）",
            "accessScope": "company_wide",
            "children": [
              {
                "id": "1vRzPbhVDt93RoN0onBHa-qaRHtIidncX",
                "name": "TuringDrive_NewAPI_0121.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1vRzPbhVDt93RoN0onBHa-qaRHtIidncX/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 50 KB · Turing Drive 新版遠端控制 API 定義書",
                "keyTakeaways": [
                  "定義遠端監控中心與自駕車端 WebSocket / REST API 狀態回報與控制指令格式"
                ]
              },
              {
                "id": "1AWrBs39jK9v9fBRND0tIoPyTJkZ7ES7m",
                "name": "Calling_Service_API_Documentation_1224.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1AWrBs39jK9v9fBRND0tIoPyTJkZ7ES7m/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 266 KB · Calling Service 叫車派遣 API 規格文件",
                "keyTakeaways": [
                  "遠端叫車服務 (Calling Service) 端點規格、派車狀態機與錯誤碼定義"
                ]
              },
              {
                "id": "1LxwTfR9JIxz3S2efPAVki62BbFysnXOW",
                "name": "API客戶回饋整理0212.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1LxwTfR9JIxz3S2efPAVki62BbFysnXOW/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 349 KB · 日本客戶 API 串接問題與回饋總整理"
              },
              {
                "id": "1IsFRNicmrTkF3pRVxp1YJ6MKdgq7Izwl",
                "name": "API客戶回饋0212：for MaaS.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1IsFRNicmrTkF3pRVxp1YJ6MKdgq7Izwl/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 308 KB · 針對 MaaS 團隊之 API 修改建議"
              },
              {
                "id": "12NIP_LIFrZVCuP1sBrhPew3LfGr_fceD",
                "name": "APIテスト中文翻譯註解.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/12NIP_LIFrZVCuP1sBrhPew3LfGr_fceD/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 1.5 MB · 日方 API 測試案例中日對照註解"
              },
              {
                "id": "1RJLl2ZA2yRcG7xxCWpqojQ_bcqED4U9w",
                "name": "API-disscusion-0211usecase_a.md",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1RJLl2ZA2yRcG7xxCWpqojQ_bcqED4U9w/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Markdown · 5.4 KB · 02/11 Use Case A 技術討論紀錄"
              },
              {
                "id": "1MocNDm5mbeKRxKIiYWJPw27SKb8Idcd0",
                "name": "天線WLA-EX-2209-0012-F(SPEC).pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1MocNDm5mbeKRxKIiYWJPw27SKb8Idcd0/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 3.6 MB · 車載外接天線硬體規格書"
              },
              {
                "id": "1DlhPiDx8ITBJNJMlre6LZR9WMy4g7Nsb",
                "name": "（4G-moduel）Quectel_EM06_Series_LTE-A_Specification_V1.7 (4G).pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1DlhPiDx8ITBJNJMlre6LZR9WMy4g7Nsb/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 432 KB · Quectel EM06 4G LTE-A 通訊模組規格書"
              }
            ]
          },
          {
            "id": "1y8taWodoihBOdCwXHB9RXxHs3gTnjy1L",
            "name": "運行數據",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1y8taWodoihBOdCwXHB9RXxHs3gTnjy1L",
            "updatedAt": "2026-03-13",
            "sizeOrNote": "日本實車運行與手自動切換次數統計（含 4 個試算表）",
            "accessScope": "company_wide",
            "children": [
              {
                "id": "1od9Wte6MCY2uhOdBFmWvFCZ6S5OB1KMo",
                "name": "手動／自動切替回数260312.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1od9Wte6MCY2uhOdBFmWvFCZ6S5OB1KMo/edit",
                "updatedAt": "2026-03-13",
                "sizeOrNote": "試算表 · 49 KB · 截至 2026/03/12 手動／自動駕駛接管切換統計",
                "keyTakeaways": [
                  "統計日本場域每日自駕里程、手動接管 (Disengagement) 次數與觸發原因分類"
                ]
              },
              {
                "id": "18JC_ygzjG3RxQVq-QBl8ljRH9ilDmje_",
                "name": "手動／自動切替回数260310.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/18JC_ygzjG3RxQVq-QBl8ljRH9ilDmje_/edit",
                "updatedAt": "2026-03-11",
                "sizeOrNote": "試算表 · 20 KB · 03/10 切換統計表"
              },
              {
                "id": "1J6C6aHkOrVNt7cM5gLiudX5C0TNIgYSr",
                "name": "手動／自動切替回数260304.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1J6C6aHkOrVNt7cM5gLiudX5C0TNIgYSr/edit",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 24 KB · 03/04 切換統計表"
              },
              {
                "id": "1b5NJ3ZVvH9VOixymPKUPwbt1xz1lhBgw",
                "name": "2026-01-01 ~ 2026-02-14のデータ.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1b5NJ3ZVvH9VOixymPKUPwbt1xz1lhBgw/edit",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 20 KB · 1月至2月中運行原始數據彙整"
              }
            ]
          },
          {
            "id": "1BD6ZaNdn3B8IRbvrneABYAQjgdBvhkn2",
            "name": "報價單以及Invoice",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1BD6ZaNdn3B8IRbvrneABYAQjgdBvhkn2",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "專案報價單與各期請款 Invoice（財務／商務機密）",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ],
            "children": [
              {
                "id": "1DBcn3FbndDQoZViN18ztDCzCA-XKVR4Q",
                "name": "TD_IIGA_251107_Invoice.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1DBcn3FbndDQoZViN18ztDCzCA-XKVR4Q/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 292 KB · IIGA 請款 Invoice (2025/11/07)",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1qXXsU9YD_r6v57HaLT8K-Uo2ClnBdOZZ",
                "name": "TD_IIGA_251128_Invoice.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1qXXsU9YD_r6v57HaLT8K-Uo2ClnBdOZZ/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 224 KB · IIGA 請款 Invoice (2025/11/28)",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1Zx1QrQJMyL4UoupGG6jjdbqtQplPdSRB",
                "name": "TD_IIGA_251223_Invoice.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1Zx1QrQJMyL4UoupGG6jjdbqtQplPdSRB/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 261 KB · IIGA 請款 Invoice (2025/12/23)",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1IXpdDWkbTPrVyh06OHn_9cxA3KT942y4",
                "name": "TuringDrive-IIGA-Stamp.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1IXpdDWkbTPrVyh06OHn_9cxA3KT942y4/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 303 KB · 用印版合約與憑證",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1dDT6DcOua1Iu3Wi6f0M5VrEW9YOn_LnY",
                "name": "第一次付款",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1dDT6DcOua1Iu3Wi6f0M5VrEW9YOn_LnY",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "第一期款請款單據與水單",
                "children": [
                  {
                    "id": "1OpgiMioXEV81IbQQRxiKwXBZGfy5Q5Xr",
                    "name": "TD-Invoice stamped-1118.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1OpgiMioXEV81IbQQRxiKwXBZGfy5Q5Xr/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 335 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  }
                ]
              },
              {
                "id": "1KaiWi7WDA_DXWomhTIN1PIAOYMX5LAVt",
                "name": "第三次付款",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1KaiWi7WDA_DXWomhTIN1PIAOYMX5LAVt",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "第三期款請款單據",
                "children": [
                  {
                    "id": "1jT5CD9YwNpcq0VP4QbSo2e0dPLhzVdT7",
                    "name": "TD_IIGA_260110_Invoice.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1jT5CD9YwNpcq0VP4QbSo2e0dPLhzVdT7/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 261 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  }
                ]
              },
              {
                "id": "1TgZ14addQrOftgJtymYSG0L2j31Fdf0s",
                "name": "第三次以及第四次付款變更說明",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1TgZ14addQrOftgJtymYSG0L2j31Fdf0s",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "付款期程變更協議與說明文件",
                "children": [
                  {
                    "id": "1CMGWROjwuGjPJ8Udh8YcRxECB25_57Od",
                    "name": "389_Invoice款項變更說明（內部使用）.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1CMGWROjwuGjPJ8Udh8YcRxECB25_57Od/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 3.2 MB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "12BMAiLG7V20-TMqAJqUDee2yASFxnCB7",
                    "name": "389_Invoice金額変更の説明.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/12BMAiLG7V20-TMqAJqUDee2yASFxnCB7/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 3.2 MB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1R7TvJgrSsnuED4sB2_hYgHhVK0mK2Z1b",
                    "name": "TD_IIGA_260204_Invoice3.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1R7TvJgrSsnuED4sB2_hYgHhVK0mK2Z1b/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 136 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1dj-1oOlyQue_Sw25kQvWRBJSrIHU9IFR",
                    "name": "TD_IIGA_260204_Invoice4.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1dj-1oOlyQue_Sw25kQvWRBJSrIHU9IFR/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 229 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  }
                ]
              }
            ]
          },
          {
            "id": "1N2AQipTwW7NjwuuZ72i5US-cIFgqzYL6",
            "name": "業務日報",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1N2AQipTwW7NjwuuZ72i5US-cIFgqzYL6",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "日本現場與遠端推進日報",
            "children": [
              {
                "id": "10_sIUF4E2YIHiHB9YxZsQWqV-TfyOkCQ",
                "name": "demo日報0126-0127",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/10_sIUF4E2YIHiHB9YxZsQWqV-TfyOkCQ",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1BegeY5OpIv68che0jmOGf_RWGjtJh1zH",
                    "name": "demo詳細記録0126.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1BegeY5OpIv68che0jmOGf_RWGjtJh1zH/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 638 KB"
                  },
                  {
                    "id": "1JLoHZq6uHFUixJAtZ_gp_44a-AWTbLen",
                    "name": "demo詳細記録0127.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1JLoHZq6uHFUixJAtZ_gp_44a-AWTbLen/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 759 KB"
                  },
                  {
                    "id": "158G1sqGUV-u_sDQYCK5dMTKNCarSwUUV",
                    "name": "Turing Drive SW_Team_1214-0116.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/158G1sqGUV-u_sDQYCK5dMTKNCarSwUUV/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 691 KB"
                  }
                ]
              },
              {
                "id": "1RYHu3dHjbUpvfF7Jd4JyIL_5G9U84KQt",
                "name": "業務日報JPN_1201-1209.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1RYHu3dHjbUpvfF7Jd4JyIL_5G9U84KQt/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 2.6 MB"
              }
            ]
          },
          {
            "id": "1F8--VLsfhJZDiCCS02K_zFuASQNF7888",
            "name": "其他文件",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1F8--VLsfhJZDiCCS02K_zFuASQNF7888",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "輔助技術規範與補充資料",
            "children": [
              {
                "id": "1JDQNsA8c4l6VbZKoaKrleoMlifjadxxV",
                "name": "389-專案中期檢討資料1226.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1JDQNsA8c4l6VbZKoaKrleoMlifjadxxV/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 4.9 MB"
              },
              {
                "id": "1AEwSjkUyGKwFqOHAY8QwhLN1DYzvQqxo",
                "name": "389_Estimate_20250915.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1AEwSjkUyGKwFqOHAY8QwhLN1DYzvQqxo/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 58 KB"
              },
              {
                "id": "1t8_x4MLu0SeDS2hKi5FYLSmwRVamoSrZ",
                "name": "389timeline.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1t8_x4MLu0SeDS2hKi5FYLSmwRVamoSrZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 3.1 MB"
              },
              {
                "id": "1LbBCd0Np5L-FjDqpPDRuDVHLJxcJi9PH",
                "name": "389：揭露日規劃文件.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1LbBCd0Np5L-FjDqpPDRuDVHLJxcJi9PH/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 61 KB"
              },
              {
                "id": "1vNrWxu2K2J8K031zoPsSGWKj4RkH76-L",
                "name": "[TuringDrive]389ディスカッション1017.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1vNrWxu2K2J8K031zoPsSGWKj4RkH76-L/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 961 KB"
              },
              {
                "id": "1YEavc7RDzTikrMDPEPvyc4IH5sONLJEU",
                "name": "ADS校對版子製作.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1YEavc7RDzTikrMDPEPvyc4IH5sONLJEU/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 300 KB"
              },
              {
                "id": "1RanGeFC5ViV_Q7vw9FfmaKItcKatoCNy",
                "name": "AR07現場で借りたいツール.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1RanGeFC5ViV_Q7vw9FfmaKItcKatoCNy/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 466 KB"
              },
              {
                "id": "1f8jh_dkv5RCzFEHL8OUvrhIV_9Ex54Bs",
                "name": "PJ-389_營收及研發專案預算表_20251104.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1f8jh_dkv5RCzFEHL8OUvrhIV_9Ex54Bs/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 217 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1hvoQLlBzNiOcP8AkrJ6guSg5GwpSGov6",
                "name": "TaiwanMeeting_abe結論.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1hvoQLlBzNiOcP8AkrJ6guSg5GwpSGov6/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 15.1 MB"
              },
              {
                "id": "175ylze1mh4La_r7R8GepW5Nx1xr0MDA6",
                "name": "TD-1117-MTG事前相談.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/175ylze1mh4La_r7R8GepW5Nx1xr0MDA6/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 1.2 MB"
              },
              {
                "id": "1n4U-ryaCHZ1Yr95s4tx0MMQP55OcJxuK",
                "name": "TuringDrive_389demo_0128.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1n4U-ryaCHZ1Yr95s4tx0MMQP55OcJxuK/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 5.7 MB"
              },
              {
                "id": "1hIjCTtkh3ASnbn5p-kE63ldpMbUsyPc5",
                "name": "車両情報1021.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1hIjCTtkh3ASnbn5p-kE63ldpMbUsyPc5/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 612 KB"
              }
            ]
          },
          {
            "id": "1vNT_SnRgtxVmhR44PIpwPXCXaO6tb32u",
            "name": "郵件往來",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1vNT_SnRgtxVmhR44PIpwPXCXaO6tb32u",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "客戶信件與會議決議歸檔",
            "children": [
              {
                "id": "1ILAzwYqaJBjaZQUe6Ns84eubKa-2uAfT",
                "name": "回信",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1ILAzwYqaJBjaZQUe6Ns84eubKa-2uAfT",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1X6HXRQjtNoV6IA4rMCGgvI_DwSsPKCYn",
                    "name": "[Turing Drive]現状の課題整理および今後の対応計画について.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1X6HXRQjtNoV6IA4rMCGgvI_DwSsPKCYn/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 20 KB"
                  },
                  {
                    "id": "1t4bPaZ_lH8-Pn3AIjLykNP6aP_5Fljjf",
                    "name": "[Turing Drive_ 389]1_8〜1_16 第二次現地テスト実施予定のご共有と事前確認のお願い.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1t4bPaZ_lH8-Pn3AIjLykNP6aP_5Fljjf/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 18 KB"
                  },
                  {
                    "id": "1bPZyOuLhfF_q-V7ZDnJxQesyrexlcQ2B",
                    "name": "[Turing Drive_ 389]地図のデータです.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1bPZyOuLhfF_q-V7ZDnJxQesyrexlcQ2B/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 28.2 MB"
                  },
                  {
                    "id": "1i-yGy9ebj6N8ak2ZecLmm7rooUet_hWL",
                    "name": "[TuringDrive 389] API ドキュメンタリー：SyncDrive Dispatch Service API Documentation version 3.0.1 Release.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1i-yGy9ebj6N8ak2ZecLmm7rooUet_hWL/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 76 KB"
                  },
                  {
                    "id": "1mAHPCMXoJL7xEIC9_oJHBfQwDCpRdpzn",
                    "name": "[TuringDrive] 配線図／CANコネクタおよび電源取得に関する技術確認のお願い.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1mAHPCMXoJL7xEIC9_oJHBfQwDCpRdpzn/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 454 KB"
                  },
                  {
                    "id": "1vmIL8aLv8agJ9E_eGhSS2sFbJg73o2Qo",
                    "name": "[TuringDrive]宮古島プロジェクト御見積書の送付および打合せのお願い.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1vmIL8aLv8agJ9E_eGhSS2sFbJg73o2Qo/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 420 KB"
                  },
                  {
                    "id": "1VfkkMTBKfHO33JrcI3ps4JXRB4R8PwO_",
                    "name": "[TuringDrive_ 389]日報.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1VfkkMTBKfHO33JrcI3ps4JXRB4R8PwO_/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 2.9 MB"
                  },
                  {
                    "id": "1QpEIGBdNRh6Ymk_0F-toytmgwhFOjRwQ",
                    "name": "[TuringDrive_ 389]第三期・第四期請求書送付および金額調整のご説明.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1QpEIGBdNRh6Ymk_0F-toytmgwhFOjRwQ/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 4.9 MB"
                  },
                  {
                    "id": "1LhiWqN1YVuZnAflRZTmyh2NDXTLsDezl",
                    "name": "Fw_ [Turing Drive 389]3_3 宮古島試乗対応に関するお願い（研修室利用および安全ドライバー手配）.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1LhiWqN1YVuZnAflRZTmyh2NDXTLsDezl/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 24 KB"
                  },
                  {
                    "id": "1ABh1OoGXuFzMDVwc6WC8dYyWnJjWDmsY",
                    "name": "Re_ [TuringDrive] (AR07)外部電源接続および部品位置図に関するご確認.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1ABh1OoGXuFzMDVwc6WC8dYyWnJjWDmsY/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 5.4 MB"
                  },
                  {
                    "id": "1mLZ0Fxwrby5OCSm3AC47-_Q0ABW90IJD",
                    "name": "回覆_ [Turing Drive 389]3月3日試乗対応の件のお詫び／今後の対応.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1mLZ0Fxwrby5OCSm3AC47-_Q0ABW90IJD/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 35 KB"
                  },
                  {
                    "id": "1Z8S8T1DkjaYFkn09ZLQuJo0DQS2wwP0j",
                    "name": "回覆_ [Turing Drive 389]運行データのご提供について.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1Z8S8T1DkjaYFkn09ZLQuJo0DQS2wwP0j/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 70 KB"
                  },
                  {
                    "id": "1yv18IsziSAoAgM65HS_HFBQQ6G_BolUO",
                    "name": "回覆_ [Turing Drive] Teemo photos & size.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1yv18IsziSAoAgM65HS_HFBQQ6G_BolUO/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 143 KB"
                  },
                  {
                    "id": "1oxyc0Wty1yrx-NSqs-W-AIPRRUljFrIB",
                    "name": "回覆_ [TuringDrive]0110請求書（Invoice）の発行.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1oxyc0Wty1yrx-NSqs-W-AIPRRUljFrIB/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 564 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1rFOrx_qeZObS7dkrr4crF8B8O6z3TETx",
                    "name": "回覆_ [TuringDrive]1105請求書（Invoice）の発行.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1rFOrx_qeZObS7dkrr4crF8B8O6z3TETx/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 480 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1abmPg-o59dflEHLLRDPXu_5nlSYKqcCv",
                    "name": "回覆_ [TuringDrive]1128請求書（Invoice）の発行.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1abmPg-o59dflEHLLRDPXu_5nlSYKqcCv/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 557 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1bAPdfmaX61ppx0YxDIWfZDg4x__wA17U",
                    "name": "回覆_ [TuringDrive]IPC購入に関するご案内（Vecow ECX-3600）.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1bAPdfmaX61ppx0YxDIWfZDg4x__wA17U/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 1.2 MB"
                  },
                  {
                    "id": "1VKxNapBEWRWwBCXLVU_rA96XVkH-wYsk",
                    "name": "回覆_ [TuringDrive]ResorTech 出展のご連絡／宮古島プロジェクト打合せのお願い（11_13–14）.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1VKxNapBEWRWwBCXLVU_rA96XVkH-wYsk/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 37 KB"
                  },
                  {
                    "id": "1AEdesyjlTL473bDreG6b-ewITvdCShWv",
                    "name": "回覆_ [TuringDrive]いさむ自動車にお借りしたいツール.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1AEdesyjlTL473bDreG6b-ewITvdCShWv/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 4.8 MB"
                  },
                  {
                    "id": "1iwaeeavZZv45gCYtFJE5-ynQDqSupIYd",
                    "name": "回覆_ [TuringDrive]御見積書（改訂版）の送付および確認事項（IPC構成／配線図）.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1iwaeeavZZv45gCYtFJE5-ynQDqSupIYd/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 33 KB"
                  }
                ]
              },
              {
                "id": "13amBueRUgCu_XQE1ktEMywue4lfjYEX5",
                "name": "收付款相關",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/13amBueRUgCu_XQE1ktEMywue4lfjYEX5",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1ojqKHdBjjqwjW5Zj1fjYG6L6nQNKzir4",
                    "name": "[TuringDrive_ 389]第三期・第四期請求書送付および金額調整のご説明.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1ojqKHdBjjqwjW5Zj1fjYG6L6nQNKzir4/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 4.9 MB"
                  }
                ]
              },
              {
                "id": "17NCRlOhtQPmRMg5hTfe56Jcy1wBwY8yi",
                "name": "現場活動安排",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/17NCRlOhtQPmRMg5hTfe56Jcy1wBwY8yi",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1mkh46khZKWWqBdu5i7rpDiWlH6VOcNw2",
                    "name": "回覆_ [Turing Drive 389]3_20以降：宮古島試乗対応に関する調整.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1mkh46khZKWWqBdu5i7rpDiWlH6VOcNw2/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 29 KB"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "2026-boft-subsidy",
        "code": "GOV-BOFT",
        "name": "4.[專案] 經濟部國貿署海外市場拓銷補助案",
        "startYear": 2026,
        "period": "2025 – 2026",
        "department": "營業部 BD-Tokyo Drift",
        "sharedDriveName": "BD-Tokyo Drift",
        "status": "active",
        "accessScope": "company_wide",
        "accessGroupLabel": "bd-tokyodrift@turing-drive.com · 全公司可讀",
        "summary": "經濟部國際貿易署補助計畫，涵蓋三大任務（行銷執行、建立日本據點、建立代理商）、Japan IT Week 參展，以及期中與期末成果報告。",
        "highlights": [
          "任務一：行銷執行 & IT Week",
          "任務二：建立日本據點 / 任務三：建立代理商",
          "國貿署執行事項比較表.xlsx"
        ],
        "driveFolderId": "1P72BG5NLl4r027NUJTsh4882mmj7KemK",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1P72BG5NLl4r027NUJTsh4882mmj7KemK",
        "files": [
          {
            "id": "1h960MoUqctjGgD2I5FsoL93BmrBn7Ej7",
            "name": "任務一：行銷執行",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1h960MoUqctjGgD2I5FsoL93BmrBn7Ej7",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "海外行銷宣傳與展會推廣佐證",
            "children": [
              {
                "id": "1nh8NzyH1pnmErJK4fzoeflaCG5tgOwaf",
                "name": "no Jokes",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1nh8NzyH1pnmErJK4fzoeflaCG5tgOwaf",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1kQiYgMtttaNfNskFRU1Mk-VJaa3kjt_w",
                    "name": "20250904_Turing Drive_大阪萬博＆Wave ai展覽海報設計_1 (1).pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1kQiYgMtttaNfNskFRU1Mk-VJaa3kjt_w/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 161 KB"
                  },
                  {
                    "id": "1smzjG_Njk7l8B6MPjKi5Inv-TCW64Fop",
                    "name": "請款檔案.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1smzjG_Njk7l8B6MPjKi5Inv-TCW64Fop/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 230 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  }
                ]
              },
              {
                "id": "16HfL4K-kuE2lyBT796iXUdHW318PmoSf",
                "name": "給威昇",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/16HfL4K-kuE2lyBT796iXUdHW318PmoSf",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "11keR9cUoVSmWyySr8v6IllY3Rh5k7AJo",
                    "name": ".DS_Store",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/11keR9cUoVSmWyySr8v6IllY3Rh5k7AJo/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 6 KB"
                  },
                  {
                    "id": "16qkxj7mib4dvqcNMRrNbueEm_yuXG44_",
                    "name": "0113to0115宮古島活動.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/16qkxj7mib4dvqcNMRrNbueEm_yuXG44_/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 1.9 MB"
                  },
                  {
                    "id": "1c3lCuZcVNI-wnDP2x3fRw4E6PsQiX7m3",
                    "name": "0212to0214沖繩加速器活動.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1c3lCuZcVNI-wnDP2x3fRw4E6PsQiX7m3/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 771 KB"
                  },
                  {
                    "id": "1Hm22y7o6rnJ5-_n8GaIPSeb8r0rITp5d",
                    "name": "0423to0513Tokyo IT Week SushiTech.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1Hm22y7o6rnJ5-_n8GaIPSeb8r0rITp5d/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 1.8 MB"
                  },
                  {
                    "id": "1hdGviU8IkO8Iu3jf6XjuN1aq14AdBqow",
                    "name": "合約草稿0527(kuma).docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1hdGviU8IkO8Iu3jf6XjuN1aq14AdBqow/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "Word · 18 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1GlY-XCeJG39uqDs4AifOWFedlzmR0H8Z",
                    "name": "合約草稿0527(kuma).pages",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1GlY-XCeJG39uqDs4AifOWFedlzmR0H8Z/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 239 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1MWZa7rIfo3hRFsDgrGx-GmlxNwb0wkME",
                    "name": "計畫書送件版：工作項目.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1MWZa7rIfo3hRFsDgrGx-GmlxNwb0wkME/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 661 KB"
                  }
                ]
              },
              {
                "id": "1fRiitZjYJxPhkkxZkLwn7FYeTF3Z4o4-",
                "name": "行銷公司（藝極）合約",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1fRiitZjYJxPhkkxZkLwn7FYeTF3Z4o4-",
                "updatedAt": "2026-03-09",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ],
                "children": [
                  {
                    "id": "1KxCtjT4ckVWIiVlLiyfQ4Avy_NTV5U0p",
                    "name": ".DS_Store",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1KxCtjT4ckVWIiVlLiyfQ4Avy_NTV5U0p/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 6 KB"
                  },
                  {
                    "id": "1kP5kqBupjBGdkOnh4cl2qz6hblUt0pN0",
                    "name": "【藝極】台灣智慧駕駛_形象影片與SEO報價單.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1kP5kqBupjBGdkOnh4cl2qz6hblUt0pN0/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 1.0 MB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1Iksxm-tq_R2NXjZulvbFch3qIar9CqxT",
                    "name": "【藝極科技股份有限公司】國貿署報價單總表 的副本.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1Iksxm-tq_R2NXjZulvbFch3qIar9CqxT/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 366 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1F2s8mMDuVkGEPu-u5ck2aYb-8__SUF_n",
                    "name": "台智駕_形象影片與SEO報價單(用印回傳)1141021.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1F2s8mMDuVkGEPu-u5ck2aYb-8__SUF_n/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 4.8 MB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1XjnA3iMPWedxPM7J2zspiygL_Zbt5sRR",
                    "name": "台智駕_形象影片與SEO報價單(雙方用印回傳)1141021)_雙方用印.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1XjnA3iMPWedxPM7J2zspiygL_Zbt5sRR/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 8.7 MB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1CkBbqGwYfRt9GvPinMgITErEv8haUnyW",
                    "name": "藝極-費用申請-1023.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1CkBbqGwYfRt9GvPinMgITErEv8haUnyW/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 211 KB"
                  },
                  {
                    "id": "15KvJm9MgDtnVKSGzMVoGtnWoKNTBbAxv",
                    "name": "藝極-費用申請-1027.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/15KvJm9MgDtnVKSGzMVoGtnWoKNTBbAxv/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 211 KB"
                  },
                  {
                    "id": "1wT-VXA4ie7uNXTH9D1LFLH93HoFV6UJJ",
                    "name": "藝極-費用申請-1030.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1wT-VXA4ie7uNXTH9D1LFLH93HoFV6UJJ/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 211 KB"
                  }
                ]
              },
              {
                "id": "1oTwyeJcgkXFVO0Ky2P-QXz6rDlOfXiDO",
                "name": ".DS_Store",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1oTwyeJcgkXFVO0Ky2P-QXz6rDlOfXiDO/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 6 KB"
              },
              {
                "id": "1_LumBaIiI3vhuaxppTM_J8HhwGEpqB7L",
                "name": "20231227_(威昇)勞務報酬單-$33400.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1_LumBaIiI3vhuaxppTM_J8HhwGEpqB7L/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 768 KB"
              },
              {
                "id": "1AeSz1rNIS8LWkE-LPfzKtHdCfpAwjBbj",
                "name": "20250602（威昇）請採驗費用申請單.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1AeSz1rNIS8LWkE-LPfzKtHdCfpAwjBbj/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 125 KB"
              },
              {
                "id": "1tmmxSs8uPF-IhcnyWufQV6WKFsuC6M2a",
                "name": "Turing Drive御中_PR用映像制作_見積書_Q-0000000020.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1tmmxSs8uPF-IhcnyWufQV6WKFsuC6M2a/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 91 KB"
              },
              {
                "id": "1RdfmerFDLAcK2Pcgjzbm-8IZ0dseb_Tc",
                "name": "威昇合約1118.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1RdfmerFDLAcK2Pcgjzbm-8IZ0dseb_Tc/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 1.2 MB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1KaGruA0PqTKc2Qyv8kMoevURiefm5dHk",
                "name": "比較表格.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1KaGruA0PqTKc2Qyv8kMoevURiefm5dHk/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 17 KB"
              }
            ]
          },
          {
            "id": "1-W8ktr1Cqe7qByg9_V7AFSoLFe4kvAo3",
            "name": "任務二：建立日本據點",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1-W8ktr1Cqe7qByg9_V7AFSoLFe4kvAo3",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "日本辦公室設立與駐點資料",
            "children": [
              {
                "id": "196Ibz5T0PaBaNZ_xD6Xo4EBzrUsdvVp2",
                "name": "設立日本法人",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/196Ibz5T0PaBaNZ_xD6Xo4EBzrUsdvVp2",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1mJGwPLNCNpJUncMvdtKTIaxRg5wbc6wa",
                    "name": "基本資料.pages",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1mJGwPLNCNpJUncMvdtKTIaxRg5wbc6wa/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 186 KB"
                  },
                  {
                    "id": "1fV5D5kSlWiLUHNRBcV0uOXK4uFsiJUn5",
                    "name": "成立公司代行比較表.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1fV5D5kSlWiLUHNRBcV0uOXK4uFsiJUn5/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 81 KB"
                  },
                  {
                    "id": "1AxhEXd5WwSiwmpMoIuyiiHs9fZOz1Qo6",
                    "name": "設立日本據點費用預想.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1AxhEXd5WwSiwmpMoIuyiiHs9fZOz1Qo6/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "Word · 20 KB"
                  },
                  {
                    "id": "1uwVLJG9hrWau9urip_9jEhDwZaBG4oCj",
                    "name": "設立日本據點費用預想.pages",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1uwVLJG9hrWau9urip_9jEhDwZaBG4oCj/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 216 KB"
                  }
                ]
              },
              {
                "id": "1QR44ATQt9mSLyqhe1tX-oWfyeizd_Whj",
                "name": "日本辦公室據點比較.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1QR44ATQt9mSLyqhe1tX-oWfyeizd_Whj/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 63 KB"
              }
            ]
          },
          {
            "id": "17LuNuojNM55UjCiB06HGBmP4otBmn92q",
            "name": "任務三：建立代理商",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/17LuNuojNM55UjCiB06HGBmP4otBmn92q",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "日本在地代理商開發與合作協議",
            "children": [
              {
                "id": "1FG8b5AYeXB7Zv9OHZjtjBZBd0YVd5A0S",
                "name": "1015-ADA-p3.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1FG8b5AYeXB7Zv9OHZjtjBZBd0YVd5A0S/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 6.8 MB"
              },
              {
                "id": "1NJbHAyjG-FAOGsLjwOEFMK59YphqARVE",
                "name": "1015-ADA-p3.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1NJbHAyjG-FAOGsLjwOEFMK59YphqARVE/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 357 KB"
              },
              {
                "id": "14VkLUD3D_sDwiYNieY00xfJQK0zi7Kn2",
                "name": "1015_Software_Agency_Agreement_ADAWARP_Signed.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/14VkLUD3D_sDwiYNieY00xfJQK0zi7Kn2/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 1.0 MB"
              },
              {
                "id": "1FKAaALF-hyAZvLFFASfM2I_akPrFoYaN",
                "name": "Adawarp殿：代理契約（案）0722拷貝.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1FKAaALF-hyAZvLFFASfM2I_akPrFoYaN/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 233 KB"
              },
              {
                "id": "17z6RrEMu2Ea5m0PVRqeim6ATsOHx6oLu",
                "name": "Adawarp殿：代理契約（案）0722拷貝.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/17z6RrEMu2Ea5m0PVRqeim6ATsOHx6oLu/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 155 KB"
              },
              {
                "id": "1_zM6g22dveFddXpK5GdEB8pDTMSOPFSH",
                "name": "Software_Agency_Agreement_ADAWARP_Signed.pdf.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1_zM6g22dveFddXpK5GdEB8pDTMSOPFSH/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 876 KB"
              },
              {
                "id": "1QMNlczzsEBqPgoSZbpa7hm9Zfj2Oq4rC",
                "name": "Xtran殿：代理契約（案）0722.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1QMNlczzsEBqPgoSZbpa7hm9Zfj2Oq4rC/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 237 KB"
              },
              {
                "id": "1bAWrzvvEDPlNVPweBHPNkzqyEsOSFFKm",
                "name": "Xtran殿：代理契約（案）0722.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1bAWrzvvEDPlNVPweBHPNkzqyEsOSFFKm/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 158 KB"
              },
              {
                "id": "1t3S37NlyDw4vt_MQtJ5XW6QR7tqkUOZl",
                "name": "代理商合約草稿.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1t3S37NlyDw4vt_MQtJ5XW6QR7tqkUOZl/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 18 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1mVmTGgU3SgKvxueMK2BlslTKKCrKTC8c",
                "name": "代理商合約草稿.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1mVmTGgU3SgKvxueMK2BlslTKKCrKTC8c/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 716 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1_HG2glYNlls0e5qv17S4W4TD0NE4-TKT",
                "name": "修正済み_Adawarp殿：代理契約（案）0722.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1_HG2glYNlls0e5qv17S4W4TD0NE4-TKT/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 771 KB"
              },
              {
                "id": "1dt3JsXCqvrlhVQps05X-KTBpADRlgKJ8",
                "name": "修正済み_Adawarp殿：代理契約（案）0722.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1dt3JsXCqvrlhVQps05X-KTBpADRlgKJ8/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 100 KB"
              },
              {
                "id": "13ab38Dd_uvuIRO3ufdpHPQh6VsIC5qrb",
                "name": "修正済み_Xtran殿：代理契約0725.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/13ab38Dd_uvuIRO3ufdpHPQh6VsIC5qrb/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 97 KB"
              },
              {
                "id": "1VSVppq8tNRtr-6y-ByHPYrgBNHtIl6p7",
                "name": "修正済み_Xtran殿：代理契約（案）0722.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1VSVppq8tNRtr-6y-ByHPYrgBNHtIl6p7/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 97 KB"
              }
            ]
          },
          {
            "id": "1C_8aiyYe3-0ny7fCL4aegbRP75waOEVn",
            "name": "IT week",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1C_8aiyYe3-0ny7fCL4aegbRP75waOEVn",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "Japan IT Week 參展規劃與現場素材",
            "children": [
              {
                "id": "1BMi4jj2DWdXIE92-tEaDBvkP_yDaaEV1",
                "name": "DX.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1BMi4jj2DWdXIE92-tEaDBvkP_yDaaEV1/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 7.4 MB"
              },
              {
                "id": "16y8yy9g9xc-Gz2R-_7-b9j9Q0ugD5CeS",
                "name": "登壇者講演連絡先情報入力0313.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/16y8yy9g9xc-Gz2R-_7-b9j9Q0ugD5CeS/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 1.2 MB"
              }
            ]
          },
          {
            "id": "199trnIgAVxopxXEbg1XQ680SfKtCyGuj",
            "name": "期中報告",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/199trnIgAVxopxXEbg1XQ680SfKtCyGuj",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "國貿署補助計畫期中審查報告",
            "children": [
              {
                "id": "134OBhZI4wFdwdaV2zPBAe3ISR3DNEEGm",
                "name": "信用卡帳單",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/134OBhZI4wFdwdaV2zPBAe3ISR3DNEEGm",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1VrLBmRCXZqRVAtTjcwGpQym8_V3OipTk",
                    "name": "J350190-2025年02月.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1VrLBmRCXZqRVAtTjcwGpQym8_V3OipTk/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 668 KB"
                  },
                  {
                    "id": "1ZNK_f359bhRRELDnSPQWK8vsEbO6XiBv",
                    "name": "J350190-2025年03月.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1ZNK_f359bhRRELDnSPQWK8vsEbO6XiBv/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 2.0 MB"
                  },
                  {
                    "id": "1cs1jmJ-J8NT_ilqe9VztA8_5MWbHSpaI",
                    "name": "J350190-2025年04月.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1cs1jmJ-J8NT_ilqe9VztA8_5MWbHSpaI/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 2.6 MB"
                  },
                  {
                    "id": "1cinRzGrlF6dZUq2GyvzRJ7f6RyXiN3eZ",
                    "name": "J350190-2025年05月.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1cinRzGrlF6dZUq2GyvzRJ7f6RyXiN3eZ/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 2.5 MB"
                  }
                ]
              },
              {
                "id": "1wjsUaRQLaSPItPt7OjEuMxx_KghH_Lqt",
                "name": "意見回覆",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1wjsUaRQLaSPItPt7OjEuMxx_KghH_Lqt",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1y-XppA5ANOheRKe36jKxSrG1bSvVGBQR",
                    "name": "114年(TD)期中補件說明書0618.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1y-XppA5ANOheRKe36jKxSrG1bSvVGBQR/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "Word · 18 KB"
                  },
                  {
                    "id": "1cNzZnEQMPNcckEsOpKW06qR1lVDOM1Mg",
                    "name": "~$複本 34、20250613期中一審 超恩股份有限公司及台灣智慧駕駛股份有限公司(補助款未提供扣抵聯、外文缺簡譯中文、缺合約、差旅憑證抬頭不完整).xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1cNzZnEQMPNcckEsOpKW06qR1lVDOM1Mg/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "試算表 · 165 B",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1vPuoQM2LcYleLRhnTPlTmnkSIcDitxru",
                    "name": "台灣智慧駕駛：差旅報告書.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1vPuoQM2LcYleLRhnTPlTmnkSIcDitxru/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 199 KB"
                  },
                  {
                    "id": "1iIepiCpCJH5iO31a9ENlazAYkfYGSAz-",
                    "name": "差旅報告書.pages",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1iIepiCpCJH5iO31a9ENlazAYkfYGSAz-/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 198 KB"
                  },
                  {
                    "id": "1Pqd4oDAGeWxAStKTSkt6Umf_KfCHrE4L",
                    "name": "複本 34、20250613期中一審 超恩股份有限公司及台灣智慧駕駛股份有限公司(補助款未提供扣抵聯、外文缺簡譯中文、缺合約、差旅憑證抬頭不完整).xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1Pqd4oDAGeWxAStKTSkt6Umf_KfCHrE4L/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "試算表 · 488 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1BAarQaFCrQLufPTqkif3wmaCa6_4ZAK7",
                    "name": "附檔一：住宿單據用印.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1BAarQaFCrQLufPTqkif3wmaCa6_4ZAK7/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 704 KB"
                  },
                  {
                    "id": "1o4S4cdi2WgUdh4Oe1DRrwdJhL5MeAWKb",
                    "name": "附檔二：威昇單據.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1o4S4cdi2WgUdh4Oe1DRrwdJhL5MeAWKb/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 358 KB"
                  }
                ]
              },
              {
                "id": "1I5nXT7tu9NDxROerVt5qQZzMYmyt9cLO",
                "name": "據點活動說明表0423",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1I5nXT7tu9NDxROerVt5qQZzMYmyt9cLO",
                "updatedAt": "2026-03-09",
                "children": []
              },
              {
                "id": "1KqFbxk1HTKNF7CmYs18_5dMiUT6r4LMF",
                "name": ".DS_Store",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1KqFbxk1HTKNF7CmYs18_5dMiUT6r4LMF/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 6 KB"
              },
              {
                "id": "11XT2A72I4CKVRjdtbdgq05Meq9d1zBaP",
                "name": "TD補件：住宿費說明.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/11XT2A72I4CKVRjdtbdgq05Meq9d1zBaP/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 335 KB"
              },
              {
                "id": "111cEEmEOZHBeurCu7EgaQY1xma49EM7v",
                "name": "TuringDrive-期中報告簡報0707.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/111cEEmEOZHBeurCu7EgaQY1xma49EM7v/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 8.1 MB"
              },
              {
                "id": "1QyuYhWSZzvcSwvVMZekUH0-FicKYWXYd",
                "name": "TuringDrive0529：期中結案報告格式(多家).docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1QyuYhWSZzvcSwvVMZekUH0-FicKYWXYd/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 11.6 MB"
              },
              {
                "id": "13YXRsLbVmv60NLRuzFNf9M4NDT206ttB",
                "name": "TuringDrive1030：期末結案報告格式(多家).pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/13YXRsLbVmv60NLRuzFNf9M4NDT206ttB/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 12.8 MB"
              },
              {
                "id": "1ml9WpZGdz1HjlsjI0MFpYKNQ18bb0dDD",
                "name": "TuringDrive（格式參考用）：期中結案報告格式(多家).pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1ml9WpZGdz1HjlsjI0MFpYKNQ18bb0dDD/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 12.8 MB"
              },
              {
                "id": "1y_wiGjXhDnkO8XytULn8DtkfcXiiYp_g",
                "name": "~$期中報告整合檔0715.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1y_wiGjXhDnkO8XytULn8DtkfcXiiYp_g/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 165 B"
              },
              {
                "id": "1xmbm7CtUS2H_OCPa0N7_jTarwlxGii2c",
                "name": "付款證明_威昇.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1xmbm7CtUS2H_OCPa0N7_jTarwlxGii2c/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 95 KB"
              },
              {
                "id": "1DwTM_ppFaSydNIoo_FlFhxvWTvn8l4wZ",
                "name": "威昇合約用印完的影本.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1DwTM_ppFaSydNIoo_FlFhxvWTvn8l4wZ/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 1.2 MB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1V6b_Y3W6P7KyZqoOZn8ZdqlJCeTyxXhn",
                "name": "宮古島市説明用資料自動運転20250115.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1V6b_Y3W6P7KyZqoOZn8ZdqlJCeTyxXhn/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 5.0 MB"
              },
              {
                "id": "1CWk-euMKNWo_rnBnYT3qyi2mMX3WMw8d",
                "name": "期中報告整合檔0715.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1CWk-euMKNWo_rnBnYT3qyi2mMX3WMw8d/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 11.4 MB"
              },
              {
                "id": "1_Sr07kMRK8cX6T95uis4QRngLHFAVpdi",
                "name": "期中報告簡報範本.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1_Sr07kMRK8cX6T95uis4QRngLHFAVpdi/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 295 KB"
              },
              {
                "id": "10kLQFX8H2gf_XIeGnIrbqs9bIJ6lGIwv",
                "name": "超恩寄來的：期中結案報告格式(多家).docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/10kLQFX8H2gf_XIeGnIrbqs9bIJ6lGIwv/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 685 KB"
              },
              {
                "id": "11RqK3Pp3LqQwbphAo1zAKz3-c3IrIU80",
                "name": "附件3-1[TD]期中結案報告.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/11RqK3Pp3LqQwbphAo1zAKz3-c3IrIU80/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 857 KB"
              }
            ]
          },
          {
            "id": "1JrrmYGo9jftzSpl6owzYHgqxdvkkzklX",
            "name": "期末報告",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1JrrmYGo9jftzSpl6owzYHgqxdvkkzklX",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "國貿署補助計畫期末結案與經費核銷",
            "children": [
              {
                "id": "1Yxg0EqM_ALxxsUOpuLeJrwuNrnDK0709",
                "name": "付款證明",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1Yxg0EqM_ALxxsUOpuLeJrwuNrnDK0709",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1u-q9ZvSyNje7fvnK1RekG5AELz8f6jdJ",
                    "name": "（TD）付款證明1027.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1u-q9ZvSyNje7fvnK1RekG5AELz8f6jdJ/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PNG 圖檔 · 115 KB"
                  },
                  {
                    "id": "1Ze6kLTuQOpBQfGf3T_ONm2KFtw95W6R7",
                    "name": "（TD）付款證明1030.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1Ze6kLTuQOpBQfGf3T_ONm2KFtw95W6R7/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PNG 圖檔 · 174 KB"
                  },
                  {
                    "id": "1HVtRtlzwK9CSP1SW72MlsEkvy3yCztFT",
                    "name": "（TD）付款證明1031.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1HVtRtlzwK9CSP1SW72MlsEkvy3yCztFT/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PNG 圖檔 · 150 KB"
                  }
                ]
              },
              {
                "id": "1i_nOAUkIpzmYfKLhF8O-7CSAmproL7EA",
                "name": "補件",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1i_nOAUkIpzmYfKLhF8O-7CSAmproL7EA",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1dMlyCHUjvG6xNVKy01sGTZvenKrCE7EG",
                    "name": "補件二",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1dMlyCHUjvG6xNVKy01sGTZvenKrCE7EG",
                    "updatedAt": "2026-03-09",
                    "children": [
                      {
                        "id": "1YtwQuhvCAgI0UxkaQ_dXauMetxXk4JGn",
                        "name": ".DS_Store",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1YtwQuhvCAgI0UxkaQ_dXauMetxXk4JGn/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "文件 · 6 KB"
                      },
                      {
                        "id": "1cr__kQCXJQDe9kUZCIYDYW3kpGDoZAT8",
                        "name": "住宿費中文簡譯.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1cr__kQCXJQDe9kUZCIYDYW3kpGDoZAT8/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "PDF · 808 KB"
                      },
                      {
                        "id": "10Lh7Kg-J2PZM84lMeR_gGBAkZUA4gCAc",
                        "name": "信用卡明細.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/10Lh7Kg-J2PZM84lMeR_gGBAkZUA4gCAc/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "PDF · 9.4 MB"
                      },
                      {
                        "id": "123orL8ItnVQScGO_Oz1N9j0aRxew42mR",
                        "name": "設計物說明.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/123orL8ItnVQScGO_Oz1N9j0aRxew42mR/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "PDF · 2.0 MB"
                      }
                    ]
                  },
                  {
                    "id": "1VhLgSLPMX9YLgvh24CzY2Te0DLuFHAVM",
                    "name": ".DS_Store",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1VhLgSLPMX9YLgvh24CzY2Te0DLuFHAVM/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 6 KB"
                  },
                  {
                    "id": "1uG1OUzdBlsZ_9XnytZcEqvZNZ9RNKKpj",
                    "name": "20250904_Turing Drive_大阪萬博＆Wave ai展覽海報設計_1117.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1uG1OUzdBlsZ_9XnytZcEqvZNZ9RNKKpj/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 161 KB"
                  },
                  {
                    "id": "105dkT8wd6zz3W_B6h-E95GfTeSBtjv0p",
                    "name": "nojkes勞務報酬單-$33400 1117.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/105dkT8wd6zz3W_B6h-E95GfTeSBtjv0p/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 971 KB"
                  },
                  {
                    "id": "1rXgIF-OMXU_XXvVASrwLKpGxkRyU3QAB",
                    "name": "【藝極科技股份有限公司】國貿署報價單總表1117.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1rXgIF-OMXU_XXvVASrwLKpGxkRyU3QAB/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 366 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1FDeWbu0BQvdF5KvhurqHXBZrTHtwmflW",
                    "name": "住宿中譯本.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1FDeWbu0BQvdF5KvhurqHXBZrTHtwmflW/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 1.4 MB"
                  },
                  {
                    "id": "1qV9ZwEGIZUcIQUdXjxxiOHcgu4MnqtjP",
                    "name": "期末報告：SEO優化報告1117.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1qV9ZwEGIZUcIQUdXjxxiOHcgu4MnqtjP/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 1.5 MB"
                  }
                ]
              },
              {
                "id": "1bZt203kHMVrCK-HVt4Nt0y6aSEBja50q",
                "name": "請採驗",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1bZt203kHMVrCK-HVt4Nt0y6aSEBja50q",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1J12qHdBsQfl6Ap5A4ccblUVRWgFikzuV",
                    "name": "20251110_NoJokes_請採驗費用申請單.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1J12qHdBsQfl6Ap5A4ccblUVRWgFikzuV/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-25",
                    "sizeOrNote": "試算表 · 680 KB"
                  },
                  {
                    "id": "1BsBU_bxdh5QDADIY-lbh_s55i28Sg0-s",
                    "name": "20251110_藝極_請採驗費用申請單.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1BsBU_bxdh5QDADIY-lbh_s55i28Sg0-s/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "試算表 · 129 KB"
                  }
                ]
              },
              {
                "id": "1amj2fMSTCu_akzyOcqX9P_k92lSNNu8h",
                "name": ".DS_Store",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1amj2fMSTCu_akzyOcqX9P_k92lSNNu8h/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 6 KB"
              },
              {
                "id": "1DOl6r_AWwSb4Mozi3Ws32nfLOG7TzKOz",
                "name": "TuringDrive-期末報告簡報1203.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1DOl6r_AWwSb4Mozi3Ws32nfLOG7TzKOz/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 14.0 MB"
              },
              {
                "id": "1ULoBPN9nSW1SAs7gVvvwPZ2nsK7rUMl3",
                "name": "TuringDrive-期末報告簡報1204.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1ULoBPN9nSW1SAs7gVvvwPZ2nsK7rUMl3/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 14.0 MB"
              },
              {
                "id": "1LtU1cETZzmeov3Zb5Oj3rfr6-pUXFf4z",
                "name": "TuringDrive-期末報告簡報1205.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1LtU1cETZzmeov3Zb5Oj3rfr6-pUXFf4z/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 6.8 MB"
              },
              {
                "id": "1u8Owo19if8E6JC-NIs5DCcYdYirIygNS",
                "name": "TuringDrive1030：期末結案報告格式(多家).docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1u8Owo19if8E6JC-NIs5DCcYdYirIygNS/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 11.6 MB"
              },
              {
                "id": "1aXbdx77AV30qoY_UjZI-7JPMYh0tg78l",
                "name": "交出版本：期末結案報告格式(多家) 1105.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1aXbdx77AV30qoY_UjZI-7JPMYh0tg78l/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 712 KB"
              },
              {
                "id": "1a8Azhhs4Krzv45jUJXr0j-ZhCCxc8N6q",
                "name": "差旅報告書1030.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1a8Azhhs4Krzv45jUJXr0j-ZhCCxc8N6q/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 265 KB"
              },
              {
                "id": "1Qz910iUprNnj44Z5kL9nAn9om9nqm-eY",
                "name": "期末報告：SEO優化報告.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1Qz910iUprNnj44Z5kL9nAn9om9nqm-eY/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 1.2 MB"
              },
              {
                "id": "1ihKvnntv2wmHi0Kp_yZ9BT1NF_RE7E-F",
                "name": "期末報告：SEO優化報告1117.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1ihKvnntv2wmHi0Kp_yZ9BT1NF_RE7E-F/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 2.1 MB"
              },
              {
                "id": "1PQr3Jq07bn5ODZysNyT36WzMeprIRBWd",
                "name": "期末報告：（Adawarp）代理商合約.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1PQr3Jq07bn5ODZysNyT36WzMeprIRBWd/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 1.0 MB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1Py11iR9k61D3gitCdqy9uzXM5ub161xQ",
                "name": "期末報告：（Xtran）代理商合約.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1Py11iR9k61D3gitCdqy9uzXM5ub161xQ/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 244 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1SwIutF9ue9u07BLwNj-IHzup-Xg7DAtQ",
                "name": "附件3-1期中結案報告格式.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1SwIutF9ue9u07BLwNj-IHzup-Xg7DAtQ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 126 KB"
              }
            ]
          },
          {
            "id": "1ZKZYDm7pDUGVbiCdsSv2Miw8Nr7iXH4W",
            "name": "計畫書等準備文件",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1ZKZYDm7pDUGVbiCdsSv2Miw8Nr7iXH4W",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "原始申請計畫書與核定公文",
            "children": [
              {
                "id": "1nZiOpZr1wh5FyXy5B-PNW93X_XsRM3oX",
                "name": "TD訂正簽約文件0306.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1nZiOpZr1wh5FyXy5B-PNW93X_XsRM3oX/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 326 KB"
              },
              {
                "id": "1gI4MKJCQz6tEIAP360fMsYoAVdElVK-i",
                "name": "國貿署補助案草稿.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1gI4MKJCQz6tEIAP360fMsYoAVdElVK-i/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 18 KB"
              },
              {
                "id": "1B6NEaNKWGdB-uBVBsd1A5Wg__IGQ4QfK",
                "name": "國貿署補助案草稿.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1B6NEaNKWGdB-uBVBsd1A5Wg__IGQ4QfK/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 236 KB"
              },
              {
                "id": "1BM4Tb5uHQodCSYs-Q6L_j3qfEzBrRpu-",
                "name": "簡單規劃.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1BM4Tb5uHQodCSYs-Q6L_j3qfEzBrRpu-/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 16 KB"
              },
              {
                "id": "1YrDyeI6UOqOxtKdEuE9gsTpaBZA6Wp7b",
                "name": "計劃書送件版_114B00337_All (1).pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1YrDyeI6UOqOxtKdEuE9gsTpaBZA6Wp7b/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 969 KB"
              },
              {
                "id": "1BXR5cZla-e4Z3_2Ek1vv-9N89c_5zHXP",
                "name": "計劃書送件版_114B00337_改格式.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1BXR5cZla-e4Z3_2Ek1vv-9N89c_5zHXP/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 536 KB"
              },
              {
                "id": "1kHP_LOvrRZmCwCS4xwghdJCDYxD-zzum",
                "name": "計劃書送件版_114B00337_改格式.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1kHP_LOvrRZmCwCS4xwghdJCDYxD-zzum/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 8.5 MB"
              },
              {
                "id": "1zTCQLvCZ-X4_It8bMbj3eVGEViux0N2h",
                "name": "附件2-4修正後計畫書(多家)_超恩_20241230.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1zTCQLvCZ-X4_It8bMbj3eVGEViux0N2h/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 177 KB"
              },
              {
                "id": "1c_3K2B08PrQZ0pOQCUk1XwqEAvj0Mu-j",
                "name": "附件2-4修正後計畫書(多家)_超恩_202412302.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1c_3K2B08PrQZ0pOQCUk1XwqEAvj0Mu-j/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 1023 KB"
              },
              {
                "id": "1u2jkBuZHZhA7CjYDMcD_spYqelWzaKhT",
                "name": "預算評估紀錄.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1u2jkBuZHZhA7CjYDMcD_spYqelWzaKhT/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 17 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1gzvJcnEX21gF5gWZ8xDUk1G1yOP61RRN",
                "name": "（0110TD訂正）附件2-4修正後計畫書(多家)_超恩_202412302.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1gzvJcnEX21gF5gWZ8xDUk1G1yOP61RRN/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 81 KB"
              },
              {
                "id": "1aGeVo5mNwgivRQpYw-ES3d4SnKHMz4yq",
                "name": "（0116TD訂正）附件2-4修正後計畫書(多家)_超恩_20250110.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1aGeVo5mNwgivRQpYw-ES3d4SnKHMz4yq/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 83 KB"
              },
              {
                "id": "1Ke9hP2h3y5qFcyBauPfh6VxopN2vOmGt",
                "name": "（0117TD訂正）附件2-4修正後計畫書(多家)_超恩_20250110.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1Ke9hP2h3y5qFcyBauPfh6VxopN2vOmGt/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 84 KB"
              },
              {
                "id": "1lSj4PlPhM0Q1pV-TNKefxEeeLDrxo8HW",
                "name": "（0117TD訂正）附件2-4修正後計畫書(多家)_超恩_20250110.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1lSj4PlPhM0Q1pV-TNKefxEeeLDrxo8HW/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 1.0 MB"
              },
              {
                "id": "17RIFdu1iEkNynBWayqHVBZTHgX-yAhr8",
                "name": "（0220TD訂正）附件2-4修正後計畫書(多家)_超恩_20250110.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/17RIFdu1iEkNynBWayqHVBZTHgX-yAhr8/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "Word · 87 KB"
              },
              {
                "id": "149STLaBcNfSrlwfO6--WJeiMYU8M5zOr",
                "name": "（0220TD訂正）附件2-4修正後計畫書(多家)_超恩_20250110.pages",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/149STLaBcNfSrlwfO6--WJeiMYU8M5zOr/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "文件 · 1.0 MB"
              },
              {
                "id": "1l9wyk-DOVO6pYS3iRUjsgiN6JkjMoZVe",
                "name": "（final）114年度補助業界開發國際市場計畫書.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1l9wyk-DOVO6pYS3iRUjsgiN6JkjMoZVe/view?usp=drivesdk",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "PDF · 989 KB"
              }
            ]
          },
          {
            "id": "1-CejmPv8STM32jGeW_Yk1Wjy--phAnyR",
            "name": "國貿署執行事項比較表.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/1-CejmPv8STM32jGeW_Yk1Wjy--phAnyR/edit",
            "updatedAt": "2026-03-09",
            "sizeOrNote": "試算表 · 144 KB · KPI 目標與實際達成比較",
            "keyTakeaways": [
              "國貿署補助案三大任務 KPI 指標、查核點進度與經費執行率對照表"
            ]
          }
        ]
      }
    ]
  },
  {
    "year": 2025,
    "label": "2025 年起始專案",
    "tagline": "桃園機場 T3 專案全系統規劃、Golface 商業合作案、GBGH 自駕接駁 Demo、ADAWARP 跨國合作案",
    "projectOverview": "聚焦桃園國際機場第三航廈自駕運輸系統（ADS、MaaS、服務建議書華電最終版、RTK基站、行控號控、BIM T3 模型及北市審查委員意見回覆）、Golface 智慧球車新商務案、GBGH 場域實證與 ADAWARP 專案。",
    "projects": [
      {
        "id": "2025-t3-airport",
        "code": "T3-2025",
        "name": "桃園國際機場第三航站區旅客運輸系統（2025 主專案）",
        "startYear": 2025,
        "period": "2025 Q1 – 2025 Q4",
        "department": "專案執行 / 研發部 / 系統工程",
        "sharedDriveName": "專案執行",
        "status": "completed",
        "accessScope": "company_wide",
        "accessGroupLabel": "tprogram@turing-drive.com · 全公司可讀",
        "summary": "完整收錄桃園機場 T3 自駕運輸系統之專案管理分工、服務建議書（華電最終版）、ADS 自駕系統、MaaS 派遣、簡報 QA、RTK 基站示意圖、行控號控示意圖、BIM T3 模型及 1001 北市審查委員意見回覆。",
        "highlights": [
          "服務建議書_華電最終版 & T3 document_for 華電_20250523_final",
          "臺灣桃園國際機場第三航站區旅客運輸系統工程專案_Turing內部分工表.xlsx",
          "1001 北市審查委員意見回覆 & BIM T3 模型",
          "行控號控示意圖.pptx & RTK基站設置倉10屋頂示意圖.pptx"
        ],
        "driveFolderId": "1wq0SgemEvT8psTyWB8pIhy3bWaE7tZW1",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1wq0SgemEvT8psTyWB8pIhy3bWaE7tZW1",
        "files": [
          {
            "id": "1PuCSQJ5oqVKA6cds5qd4IpW95QTbZqsF",
            "name": "服務建議書_華電最終版",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1PuCSQJ5oqVKA6cds5qd4IpW95QTbZqsF",
            "updatedAt": "2025-07-07",
            "sizeOrNote": "提交華電聯網之最終版服務建議書（含 5 個檔案）",
            "children": [
              {
                "id": "1WZtNhxpXibWdan0tZu9VXOFIVw-JNA2J",
                "name": "PMS建議書All-V13-20250606(本100)_浮水印版.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1WZtNhxpXibWdan0tZu9VXOFIVw-JNA2J/view?usp=drivesdk",
                "updatedAt": "2025-06-06",
                "sizeOrNote": "PDF · 30.3 MB · PMS 服務建議書全冊 V13 最終版",
                "keyTakeaways": [
                  "桃園國際機場第三航站區 PMS 旅客運輸系統服務建議書完整定稿（V13 浮水印版）"
                ]
              },
              {
                "id": "1nUNpX_nIC0kZYO9LWqaWZlG9Nf1INywq",
                "name": "PMS第三航站區旅客運輸系統工程建議書附件三v4.0_250606.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1nUNpX_nIC0kZYO9LWqaWZlG9Nf1INywq/view?usp=drivesdk",
                "updatedAt": "2025-06-06",
                "sizeOrNote": "PDF · 30.1 MB · 建議書附件三 v4.0"
              },
              {
                "id": "1MTXec7pPivKSUCqHLlz3ZqjM6d17SgBv",
                "name": "PMS第三航站區旅客運輸系統工程建議書附件五v1.3_250604.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1MTXec7pPivKSUCqHLlz3ZqjM6d17SgBv/view?usp=drivesdk",
                "updatedAt": "2025-06-04",
                "sizeOrNote": "PDF · 48.9 MB · 建議書附件五 v1.3"
              },
              {
                "id": "1UB5wYWkLo8wNEbDKkSEbYbB2zysfcQ9e",
                "name": "PMS第三航站區旅客運輸系統工程建議書附件六v1.2_250604.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1UB5wYWkLo8wNEbDKkSEbYbB2zysfcQ9e/view?usp=drivesdk",
                "updatedAt": "2025-06-04",
                "sizeOrNote": "PDF · 11.0 MB · 建議書附件六 v1.2"
              },
              {
                "id": "1R-NmH4t2FbhhfsQSK1oCT9BR7CPE43_m",
                "name": "文件.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1R-NmH4t2FbhhfsQSK1oCT9BR7CPE43_m/edit",
                "updatedAt": "2025-07-07",
                "sizeOrNote": "Word · 21 KB · 交付版本說明文件"
              }
            ]
          },
          {
            "id": "1Q9j0rQQWT8xq76CF_XdmjI4KBiLROjp_",
            "name": "T3 document_for 華電_20250523_final",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1Q9j0rQQWT8xq76CF_XdmjI4KBiLROjp_",
            "updatedAt": "2025-05-28",
            "sizeOrNote": "交付華電技術文件定稿包（含 9 個檔案）",
            "children": [
              {
                "id": "15lGNOk8ZB9eDMq8kyCMnpHutsUO5tDao",
                "name": "附件_自動駕駛系統篇_20250523_updated2.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/15lGNOk8ZB9eDMq8kyCMnpHutsUO5tDao/edit",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "Word · 19.7 MB · 自動駕駛系統篇定稿"
              },
              {
                "id": "1whp35_j_VNM2UZDdOedYGhb_KELDan2G",
                "name": "附件_旅客運輸系統營運服務管理計畫0522_updated5.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1whp35_j_VNM2UZDdOedYGhb_KELDan2G/edit",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "Word · 13.8 MB · 旅客運輸系統營運服務管理計畫"
              },
              {
                "id": "1SqyaqWHZz8yIyXVCQ52gOOaxOIcZ_2--",
                "name": "行車管理與監控系統_MaaS_20250523.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1SqyaqWHZz8yIyXVCQ52gOOaxOIcZ_2--/edit",
                "updatedAt": "2025-06-16",
                "sizeOrNote": "Word · 7.1 MB · 行車管理與監控系統 MaaS 篇"
              },
              {
                "id": "10EpZJY4khv5Gzw4Ef4Su5MxRMof4yxeC",
                "name": "附件_TURING簡介與實績_20250522_updated_8.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/10EpZJY4khv5Gzw4Ef4Su5MxRMof4yxeC/view?usp=drivesdk",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "PDF · 6.5 MB · Turing 簡介與過往實績彙整"
              },
              {
                "id": "1nFplVzHWEZ4c7gSe5442ZxUOyK8x39Z_",
                "name": "附件_Tier IV實績_20250522_updated_2.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1nFplVzHWEZ4c7gSe5442ZxUOyK8x39Z_/view?usp=drivesdk",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "PDF · 714 KB · Tier IV 國際實績彙整"
              },
              {
                "id": "1Xfg4iGXrgSwmXiEIj_EUmX-Ic_Ls2VEG",
                "name": "Turing實績.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1Xfg4iGXrgSwmXiEIj_EUmX-Ic_Ls2VEG/edit",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "Word · 553 KB · Turing 實績原稿"
              },
              {
                "id": "1Er_oGMwEXUTHGCEl_hIjeaibaqmBOyN_",
                "name": "TIER IV實績.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1Er_oGMwEXUTHGCEl_hIjeaibaqmBOyN_/edit",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "Word · 1.1 MB · Tier IV 實績原稿"
              },
              {
                "id": "1WEbVXhHQ21shgYrfYr0AIDgy8lro8pPF",
                "name": "T3案人員資料_Turing.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1WEbVXhHQ21shgYrfYr0AIDgy8lro8pPF/edit",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "Word · 29 KB · Turing 專案團隊人員學經歷表"
              },
              {
                "id": "1T7r_zTTJIqza2sLRipAU3O01MnWAUU42",
                "name": "T3案人員資料_Tier IV.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1T7r_zTTJIqza2sLRipAU3O01MnWAUU42/edit",
                "updatedAt": "2025-05-28",
                "sizeOrNote": "Word · 24 KB · Tier IV 專案顧問人員資料"
              }
            ]
          },
          {
            "id": "1TawsbneaEDt7ic3PdVpDiOh1zzRBjsZf",
            "name": "ADS（自動駕駛系統技術資料夾）",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1TawsbneaEDt7ic3PdVpDiOh1zzRBjsZf",
            "updatedAt": "2025-05-23",
            "sizeOrNote": "感知、定位、決策控制與 ODD 規格（含 3 個檔案）",
            "children": [
              {
                "id": "1NxlQ7Jx8qQooOCu2vynt5xeVQEFjba2Y",
                "name": "Sensor Layout Design.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1NxlQ7Jx8qQooOCu2vynt5xeVQEFjba2Y/edit",
                "updatedAt": "2025-05-20",
                "sizeOrNote": "簡報 · 1.2 MB · 自駕巴士感測器配置與視野涵蓋設計",
                "keyTakeaways": [
                  "定義光達、相機與毫米波雷達安裝角度及盲區覆蓋計算"
                ]
              },
              {
                "id": "1vjACTKCsCoo5Ao3FNGKLBlXNV3K9tsC5",
                "name": "附冊 - 自動駕駛系統篇_Mei_updated.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1vjACTKCsCoo5Ao3FNGKLBlXNV3K9tsC5/edit",
                "updatedAt": "2025-05-23",
                "sizeOrNote": "Word · 19.6 MB · 自動駕駛系統技術附冊 (Mei 修訂版)"
              },
              {
                "id": "1wea3XoJ831dcSQGMxX22MRn6aFfP_J0K",
                "name": "附冊 - 自動駕駛系統篇_original.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1wea3XoJ831dcSQGMxX22MRn6aFfP_J0K/edit",
                "updatedAt": "2025-05-23",
                "sizeOrNote": "Word · 19.9 MB · 自動駕駛系統技術附冊初版"
              }
            ]
          },
          {
            "id": "1-DVcJtt78AyGZEQ_NrBq7aDZ0t0ambnE",
            "name": "MaaS（車隊管理與派遣平台）",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1-DVcJtt78AyGZEQ_NrBq7aDZ0t0ambnE",
            "updatedAt": "2025-05-23",
            "sizeOrNote": "T3 班表調度、旅客資訊與後台架構（含 2 個檔案）",
            "children": [
              {
                "id": "1W-y3EC6ENfeXCad33JQ20csPVeTzbiQE",
                "name": "行車管理與監控系統_MaaS_20250523_Mei.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1W-y3EC6ENfeXCad33JQ20csPVeTzbiQE/edit",
                "updatedAt": "2025-05-23",
                "sizeOrNote": "Word · 7.1 MB · 行車管理與監控系統 MaaS 架構書 (05/23)"
              },
              {
                "id": "16AYKYxFTH9P6SHf3V3zxBe_TKqspKEak",
                "name": "行車管理與監控系統_20250521_updated.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/16AYKYxFTH9P6SHf3V3zxBe_TKqspKEak/edit",
                "updatedAt": "2025-05-23",
                "sizeOrNote": "Word · 6.4 MB · 行車管理與監控系統 (05/21 更新版)"
              }
            ]
          },
          {
            "id": "14GmQIb8K3DGU6a-6WogdaSFF9rs00sxy",
            "name": "1001北市審查委員意見回覆",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/14GmQIb8K3DGU6a-6WogdaSFF9rs00sxy",
            "updatedAt": "2025-10-15",
            "sizeOrNote": "審查委員問題逐項回覆、實驗計畫書 v3 與用印附件（含 7 個項目與第 2 層子目錄）",
            "children": [
              {
                "id": "1HXZfQq3S--oqyn-gHuji9FZ4XEHb3JON",
                "name": "04無人載具科技創新實驗計畫書(送北市修正版本)1151015更新彙整v3無標註版.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1HXZfQq3S--oqyn-gHuji9FZ4XEHb3JON/view?usp=drivesdk",
                "updatedAt": "2025-10-15",
                "sizeOrNote": "PDF · 30.9 MB · 創新實驗計畫書 v3 無標註正式版",
                "keyTakeaways": [
                  "送交台北市政府審查之無人載具科技創新實驗計畫書 v3 定稿 PDF"
                ]
              },
              {
                "id": "1l0GXiBsMyT7q3Tm4XE3NqXyADFPuTWM8",
                "name": "信義路自駕公車Ａ階段POC委員意見修正對照表1151015.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1l0GXiBsMyT7q3Tm4XE3NqXyADFPuTWM8/edit",
                "updatedAt": "2025-10-15",
                "sizeOrNote": "試算表 · 748 KB · 審查委員意見逐條修正對照表",
                "keyTakeaways": [
                  "彙整各審查委員提問、回覆說明與對應計畫書修訂頁碼"
                ]
              },
              {
                "id": "1zYeMjXEGZv07xjTMN4fKvuOfuXIqFgyS",
                "name": "Turing Drive北市信義路poc簡報 0929.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1zYeMjXEGZv07xjTMN4fKvuOfuXIqFgyS/view?usp=drivesdk",
                "updatedAt": "2025-09-29",
                "sizeOrNote": "PDF · 4.2 MB · 09/29 審查會議簡報 PDF"
              },
              {
                "id": "1HAgnLBovq3cHuxx5Z3RIPbfTawYgdrjZ",
                "name": "台灣智慧駕駛公司發函及用印附件檔.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1HAgnLBovq3cHuxx5Z3RIPbfTawYgdrjZ/view?usp=drivesdk",
                "updatedAt": "2025-10-15",
                "sizeOrNote": "PDF · 8.8 MB · 正式發函公文與公司大小章用印附件"
              },
              {
                "id": "12PaiVDBFRdxO5NRBhDa95cXt506nSZ_j",
                "name": "04無人載具科技創新實驗計畫書(送北市修正版本)1151015更新彙整v3.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/12PaiVDBFRdxO5NRBhDa95cXt506nSZ_j/edit",
                "updatedAt": "2025-10-15",
                "sizeOrNote": "Word · 25.0 MB · v3 追蹤修訂可編輯版"
              },
              {
                "id": "14ZpGbMxYwd5hKLRvbTxyEFssf6pkkZ-k",
                "name": "補件資料(初估保險報價單)",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/14ZpGbMxYwd5hKLRvbTxyEFssf6pkkZ-k",
                "updatedAt": "2025-10-07",
                "sizeOrNote": "創新實驗責任險與場域保險報價補件",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ],
                "children": [
                  {
                    "id": "13ojdF-uvO_7EjxSIdhsk7UX52QhLiuJr",
                    "name": "國泰產險信義路poc報價單.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/13ojdF-uvO_7EjxSIdhsk7UX52QhLiuJr/view?usp=drivesdk",
                    "updatedAt": "2025-10-06",
                    "sizeOrNote": "PDF · 831 KB · 國泰產險信義路 POC 保險報價單",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  }
                ]
              },
              {
                "id": "1bnIRLdd0gJ9Q0OEm3lJSSLoD2wFLieUt",
                "name": "補件資料(第三方瑞其報告）",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1bnIRLdd0gJ9Q0OEm3lJSSLoD2wFLieUt",
                "updatedAt": "2025-10-07",
                "sizeOrNote": "第三方安全評估驗證報告補件",
                "children": [
                  {
                    "id": "116LCyiSt_hrbG4dRQ-tYI1WFgTL_NZnA",
                    "name": "C26-172_台灣智駕_Navya之整車結構CAE靜態分析文件-2026-1007.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/116LCyiSt_hrbG4dRQ-tYI1WFgTL_NZnA/view?usp=drivesdk",
                    "updatedAt": "2025-10-07",
                    "sizeOrNote": "PDF · 3.0 MB · Navya 自駕巴士整車結構 CAE 靜態分析報告"
                  }
                ]
              }
            ]
          },
          {
            "id": "1CdPNneMlCSN4i7kVDZZFelORzzepUWVi",
            "name": "BIM T3模型",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1CdPNneMlCSN4i7kVDZZFelORzzepUWVi",
            "updatedAt": "2025-10-15",
            "sizeOrNote": "第三航廈路線廊道 3D BIM 圖資與點雲（含 3 個檔案）",
            "children": [
              {
                "id": "1W9W2oCUKMoLzNXpyH5nliH28fux3tHsw",
                "name": "【專案機密與授權使用聲明 Confidentiality and Authorized Use Notice】.txt",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1W9W2oCUKMoLzNXpyH5nliH28fux3tHsw/view?usp=drivesdk",
                "updatedAt": "2025-10-15",
                "sizeOrNote": "TXT · 780 B · BIM 模型授權使用與保密聲明"
              },
              {
                "id": "1NHA-IvWOEwcOseV6SR6ot-iqlYS0xbtc",
                "name": "Navisworks Freedom應用軟體資訊(僅windows使用).txt",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1NHA-IvWOEwcOseV6SR6ot-iqlYS0xbtc/view?usp=drivesdk",
                "updatedAt": "2025-10-15",
                "sizeOrNote": "TXT · 49 B · 檢視器軟體開啟說明"
              },
              {
                "id": "1Te2SKFE4iirRTGIr_qJJ3CpBTvIrH-sj",
                "name": "all.nwd",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1Te2SKFE4iirRTGIr_qJJ3CpBTvIrH-sj/view?usp=drivesdk",
                "updatedAt": "2025-10-08",
                "sizeOrNote": "NWD 模型 · 8.4 GB · 桃園機場第三航廈全區 BIM 整合模型檔"
              }
            ]
          },
          {
            "id": "12MWdl0eHhya9dU9jm7_MsLFhrouz4u_s",
            "name": "2025專案管理分工_20250227.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/12MWdl0eHhya9dU9jm7_MsLFhrouz4u_s/edit",
            "updatedAt": "2025-02-27",
            "sizeOrNote": "試算表 · T3 各子系統負責人與 WBS 權責分工表",
            "keyTakeaways": [
              "2025 年度 T3 專案各子系統 PM、RD 模組負責人與交付物矩陣"
            ]
          },
          {
            "id": "1Z2geXjDqmaq_VFf1j0UkxoseH0YSlam-",
            "name": "臺灣桃園國際機場第三航站區旅客運輸系統工程專案_Turing內部分工表_20250417.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/1Z2geXjDqmaq_VFf1j0UkxoseH0YSlam-/edit",
            "updatedAt": "2025-05-15",
            "sizeOrNote": "試算表 · 33 KB · Turing 內部工程分工明細"
          },
          {
            "id": "1Q5W68-HxztVzERjy8AFj7EIoKCdYjvrI",
            "name": "Turing_T3簡報QA_v3_20250620.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/1Q5W68-HxztVzERjy8AFj7EIoKCdYjvrI/edit",
            "updatedAt": "2025-06-30",
            "sizeOrNote": "試算表 · 22 KB · 評選與審查簡報 Q&A 題庫 v3",
            "keyTakeaways": [
              "彙整業主與委員常見技術提問（續航力、定位精度、號誌優先、颱風應變）標準擬答"
            ]
          },
          {
            "id": "1sawsjgRcAypXyFcYgSXAqhOqw1ICbsRd",
            "name": "行控號控示意圖.pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/1sawsjgRcAypXyFcYgSXAqhOqw1ICbsRd/edit",
            "updatedAt": "2025-05-17",
            "sizeOrNote": "簡報 · 1.5 MB · 行控中心與號誌控制連動架構",
            "keyTakeaways": [
              "展示行控中心 (OCC) 與交控號誌控制器之優先號誌觸發邏輯與安全連鎖機制"
            ]
          },
          {
            "id": "1UQr6IO3bdFTT-zZWqKA-Ck4fnHn4vuXO",
            "name": "20240823_RTK基站設置倉10屋頂示意圖.pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/1UQr6IO3bdFTT-zZWqKA-Ck4fnHn4vuXO/edit",
            "updatedAt": "2025-04-30",
            "sizeOrNote": "簡報 · 12.2 MB · 機場 RTK 差分定位基站架設位置圖"
          }
        ]
      },
      {
        "id": "2025-golface-deal",
        "code": "GF-2025",
        "name": "20250224_golface_deal（Golface 智慧高球車合作案）",
        "startYear": 2025,
        "period": "2025 Q1 – 2025 Q4",
        "department": "營業部 / 綠通專案組",
        "sharedDriveName": "綠通 / 營業部",
        "status": "completed",
        "accessScope": "confidential",
        "accessGroupLabel": "營業部 / 財務部 / 管理層限定",
        "allowedDepartments": [
          "營業",
          "BD",
          "財務",
          "總經理"
        ],
        "allowedRoles": [
          "admin",
          "finance"
        ],
        "summary": "2025 年度與 Golface 展開之新一代車隊導入與商業合約專案，延續 15 台量產車成果並擴充場域維運與加值服務。",
        "highlights": [
          "2025/02/24 商務條件與合約議定",
          "球場導入規格與商業分潤架構"
        ],
        "driveFolderId": "1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW",
        "files": [
          {
            "id": "1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW",
            "name": "20250224_golface_deal 專案合約與報價資料夾",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW",
            "updatedAt": "2025-02-24",
            "sizeOrNote": "商務條件、BOM 成本估算與維護協議（商務機密）",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ],
            "children": [
              {
                "id": "1GRK-_34QdyID5-SsfkH9ge5-Hcf0Zvfm",
                "name": "22737",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1GRK-_34QdyID5-SsfkH9ge5-Hcf0Zvfm",
                "updatedAt": "2025-02-24",
                "children": [
                  {
                    "id": "1hHsfbYjOZw6KYNRq06cBBQh2Wp1_duI7",
                    "name": "CH7-4, fig (3).pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1hHsfbYjOZw6KYNRq06cBBQh2Wp1_duI7/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-04-26",
                    "sizeOrNote": "簡報 · 139 KB"
                  }
                ]
              },
              {
                "id": "1tqzEThAfS9JsK6eSWohqBuanXCZqmbR9",
                "name": "fence",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1tqzEThAfS9JsK6eSWohqBuanXCZqmbR9",
                "updatedAt": "2025-02-24",
                "children": [
                  {
                    "id": "1Fliyn8n-MRwRZJUP7WCDvIlgGKQoTExT",
                    "name": "南峰.geojson",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1Fliyn8n-MRwRZJUP7WCDvIlgGKQoTExT/view?usp=drivesdk",
                    "updatedAt": "2024-08-08",
                    "sizeOrNote": "文件 · 44 KB"
                  },
                  {
                    "id": "1TZOGyRSRkUZY8UABI4SPOEn6T3X4D2Jp",
                    "name": "斑芝花.geojson",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1TZOGyRSRkUZY8UABI4SPOEn6T3X4D2Jp/view?usp=drivesdk",
                    "updatedAt": "2024-08-08",
                    "sizeOrNote": "文件 · 7 KB"
                  }
                ]
              },
              {
                "id": "1AAmKPd7iP-SQSmdFToX-WsIHlr57Uy0-",
                "name": "golface_deal",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1AAmKPd7iP-SQSmdFToX-WsIHlr57Uy0-",
                "updatedAt": "2025-02-24",
                "children": [
                  {
                    "id": "1To7kNi117MD_7eZXnNt1AUJrFbs9PdGw",
                    "name": "20001",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1To7kNi117MD_7eZXnNt1AUJrFbs9PdGw",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1i3pvXOShLArkf8O9NebwI5ErIdM5-C-K",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1i3pvXOShLArkf8O9NebwI5ErIdM5-C-K/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1eU5hM7yaWl-eYMgHyiele83sYZZ2wsAq",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1eU5hM7yaWl-eYMgHyiele83sYZZ2wsAq/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "15k1mvV_3HihKRl07Dp3bAV4rnvuJeukO",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/15k1mvV_3HihKRl07Dp3bAV4rnvuJeukO/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1pjMCXqDOmENj-OtMJ7lm5xwXHK6LIpF1",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1pjMCXqDOmENj-OtMJ7lm5xwXHK6LIpF1/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1XLFpNJadZxSJ7EE5oDoRD52r1xxfS0H0",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1XLFpNJadZxSJ7EE5oDoRD52r1xxfS0H0/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1CxG8mz3QjMhoUKUVgrOLy5T6o2jVCiBp",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1CxG8mz3QjMhoUKUVgrOLy5T6o2jVCiBp/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1pJhW3gAHCVDU63nQJTbGAJNoxmCIhP37",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1pJhW3gAHCVDU63nQJTbGAJNoxmCIhP37/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1tFKAMrvcHsLjuCGdPD_3BzPWLG9nCaPI",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1tFKAMrvcHsLjuCGdPD_3BzPWLG9nCaPI/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1HYRWVzJYCcLtR-oZuteQdZeCm8wNiK-R",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1HYRWVzJYCcLtR-oZuteQdZeCm8wNiK-R/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1kAZtxai0edJod9tDSGiWzSm4Udt6Imjf",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1kAZtxai0edJod9tDSGiWzSm4Udt6Imjf/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1FEbKWA7vcWl90vw8qYU1wL-k-ey3k-Ty",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1FEbKWA7vcWl90vw8qYU1wL-k-ey3k-Ty/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1FW2mONE0tzWpWq0HzvEw0UK0IVYcpiHU",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1FW2mONE0tzWpWq0HzvEw0UK0IVYcpiHU/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1sEY8Lhyg0VGBDVr3vrRgasjPUnLBnBAO",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1sEY8Lhyg0VGBDVr3vrRgasjPUnLBnBAO/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1KYqJ1Zb_78GisMGoV35vzDuGQoCZPZn8",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1KYqJ1Zb_78GisMGoV35vzDuGQoCZPZn8/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1MG5_dZm7hkpU49ILNT4X7M3P3sjI36t3",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1MG5_dZm7hkpU49ILNT4X7M3P3sjI36t3/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      }
                    ]
                  },
                  {
                    "id": "1gdXqY_4MwsVT1jreicdVTwlNTAN2Ilow",
                    "name": "20002",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1gdXqY_4MwsVT1jreicdVTwlNTAN2Ilow",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1IHnA_psv4ssSJ_qzKikp-Bb_f2gR_nFv",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1IHnA_psv4ssSJ_qzKikp-Bb_f2gR_nFv/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "13DB5DVY1oKyoBO_6spXqfICZk-dmvolp",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/13DB5DVY1oKyoBO_6spXqfICZk-dmvolp/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1YH_14Ho-yT4ahePa3mzY6cRE_sTVEfQP",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1YH_14Ho-yT4ahePa3mzY6cRE_sTVEfQP/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1ev5Hn2jo3NBqTmpvOaJ1Rh8meCN2EpmS",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ev5Hn2jo3NBqTmpvOaJ1Rh8meCN2EpmS/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1KmEDUOpZzuSRwi_ezfz5hc2GXGzj6phc",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1KmEDUOpZzuSRwi_ezfz5hc2GXGzj6phc/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1tzD_pLSygcYim4qvjNyKBfxN_0V6C201",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1tzD_pLSygcYim4qvjNyKBfxN_0V6C201/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1G951kT20kytxk9D_PJUfAL1vgJAFllM8",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1G951kT20kytxk9D_PJUfAL1vgJAFllM8/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1FkCrnI2rx5icHRm_IP6_HIczYzCjnGTy",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1FkCrnI2rx5icHRm_IP6_HIczYzCjnGTy/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1VIxHtzlgD4OxwH7kscBxG0ooxFWgzP7A",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1VIxHtzlgD4OxwH7kscBxG0ooxFWgzP7A/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "17spesFA8FAedKT2H45PN1aSserChF2if",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/17spesFA8FAedKT2H45PN1aSserChF2if/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1Ry4ZaM_lMfXvvCzEHjcvsfa-1noDqNRl",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1Ry4ZaM_lMfXvvCzEHjcvsfa-1noDqNRl/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1BFQ5u2-YOON3Cxgoeb7JaKJL6zm6NPfZ",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1BFQ5u2-YOON3Cxgoeb7JaKJL6zm6NPfZ/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1cfxduARWAoeqSK7JQVUh96Ti-2hS3610",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1cfxduARWAoeqSK7JQVUh96Ti-2hS3610/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1Nhw8C-3_hdITv_jb4o8XVaLkkBPUe94f",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1Nhw8C-3_hdITv_jb4o8XVaLkkBPUe94f/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1_Tym6fZYG_skfwFjLxM5pqh19RguVNbu",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1_Tym6fZYG_skfwFjLxM5pqh19RguVNbu/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      }
                    ]
                  },
                  {
                    "id": "1vR34ES8KvD5XdFsxgvNdvEKt5QFhrawN",
                    "name": "20004",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1vR34ES8KvD5XdFsxgvNdvEKt5QFhrawN",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1bev2P60eai7qNTD6QB6hNWUELKFOHC4G",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1bev2P60eai7qNTD6QB6hNWUELKFOHC4G/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1A3qg33her0CixlLsebGjs9LcGOv5ieQV",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1A3qg33her0CixlLsebGjs9LcGOv5ieQV/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "124EO-SRTQKG_dk0xYCT_4OKPrSaExpnR",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/124EO-SRTQKG_dk0xYCT_4OKPrSaExpnR/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1j4WyBIBnqLDwWUMsjGfEXfY4s54OJnYv",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1j4WyBIBnqLDwWUMsjGfEXfY4s54OJnYv/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1uFx2fZrjTcpK7aOB4-sHatThB37bL6sa",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1uFx2fZrjTcpK7aOB4-sHatThB37bL6sa/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1DXszy_qFCUAsYdfY1bQOPqoPR9Ej4GuP",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1DXszy_qFCUAsYdfY1bQOPqoPR9Ej4GuP/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1AQrfw1R9LTMVSuviF2l94xMiYHaT5ozY",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1AQrfw1R9LTMVSuviF2l94xMiYHaT5ozY/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1JNygCi_V4XSLq4QhX8Bw3Dw5A78YjuS_",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1JNygCi_V4XSLq4QhX8Bw3Dw5A78YjuS_/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "179M7ad7M3dhccM90LzMB18OGoFAUx_lr",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/179M7ad7M3dhccM90LzMB18OGoFAUx_lr/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1K8K06GB31-9oeh1hy32dtfjaEG4aETao",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1K8K06GB31-9oeh1hy32dtfjaEG4aETao/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "16x5ztvcWx0VMEAuC2_AHcNWYSbMR202b",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/16x5ztvcWx0VMEAuC2_AHcNWYSbMR202b/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "118gDEns4ovzVCiKW5B2GAEZEFiVhRlBX",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/118gDEns4ovzVCiKW5B2GAEZEFiVhRlBX/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1TwnVAi4A_D-a99KUjKUWpMzFO70ZBCyR",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1TwnVAi4A_D-a99KUjKUWpMzFO70ZBCyR/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1OkhEy5VY1jrEg_u1amoU1NG7MJUZdnfn",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1OkhEy5VY1jrEg_u1amoU1NG7MJUZdnfn/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1QH-TLtbhoUzF-n-9UOWiaDzTjnAse8LS",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1QH-TLtbhoUzF-n-9UOWiaDzTjnAse8LS/view?usp=drivesdk",
                        "updatedAt": "2024-05-09",
                        "sizeOrNote": "PNG 圖檔 · 1.4 MB"
                      }
                    ]
                  },
                  {
                    "id": "1QRVI2wOMdLy7CgFCjQLmmseoAcxhodo3",
                    "name": "20008",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1QRVI2wOMdLy7CgFCjQLmmseoAcxhodo3",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "18teh3sc5x5w_EOGKKbUEHpL5TJ5vGauY",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/18teh3sc5x5w_EOGKKbUEHpL5TJ5vGauY/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1iIBp8ICDdONTsedKygsTaGf-FxfEv-zW",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1iIBp8ICDdONTsedKygsTaGf-FxfEv-zW/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1eiHJLQ7XF8V4r4jQE3qrebEK-TzRoDFL",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1eiHJLQ7XF8V4r4jQE3qrebEK-TzRoDFL/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1nFtxaXc0V21NTKC6CNYOKUrPM3uGBSWm",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1nFtxaXc0V21NTKC6CNYOKUrPM3uGBSWm/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "10m1_Fms8s9vhw_G5PaVWR-V4B2TIUO3o",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/10m1_Fms8s9vhw_G5PaVWR-V4B2TIUO3o/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1wbxKj5SDrlMZlVaN1VwWolPZzRuTuOQW",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1wbxKj5SDrlMZlVaN1VwWolPZzRuTuOQW/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1tcN6S95Zj7RAv29Bf5LV7ItKlOdceBl3",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1tcN6S95Zj7RAv29Bf5LV7ItKlOdceBl3/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1hLD5m8Wt_8HVO1-p4cy8g2EoAc3gM2ML",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1hLD5m8Wt_8HVO1-p4cy8g2EoAc3gM2ML/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1Ausmn9CLBuZnwHmGa5YyCkGqHwhL3NZ9",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1Ausmn9CLBuZnwHmGa5YyCkGqHwhL3NZ9/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1gOHEI-Dy2G7kLwC8vnl6NP4GHPpvJo95",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1gOHEI-Dy2G7kLwC8vnl6NP4GHPpvJo95/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1iS2rpEhWUh1ksTf_h22Tw7Mpoj7iDdTy",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1iS2rpEhWUh1ksTf_h22Tw7Mpoj7iDdTy/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1QoVkbmL5FXNetI4-DsrRs_PBvWxnrGr2",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1QoVkbmL5FXNetI4-DsrRs_PBvWxnrGr2/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1lGYLqdydrnQjWpAX8EpkaDG-ssbU7bsH",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1lGYLqdydrnQjWpAX8EpkaDG-ssbU7bsH/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1e7ZUUuF6ll7rNCpuP_1Zq2ZQQPgLGYdP",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1e7ZUUuF6ll7rNCpuP_1Zq2ZQQPgLGYdP/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1AHmXRiMOwzJGbOp3tYNvK4ESbnD-P-xB",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1AHmXRiMOwzJGbOp3tYNvK4ESbnD-P-xB/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      }
                    ]
                  },
                  {
                    "id": "1g63LBE0AgWi44mgGh0s8SdjOzXNyKvxD",
                    "name": "20009",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1g63LBE0AgWi44mgGh0s8SdjOzXNyKvxD",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1PYMVWmPqlY9drJF95DFJcPIJGA6Dn-G6",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1PYMVWmPqlY9drJF95DFJcPIJGA6Dn-G6/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "169p37J776mJ_8s6lHIsMVmX108gbMTxA",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/169p37J776mJ_8s6lHIsMVmX108gbMTxA/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1OXgPes-HDAXl29ebND1cF3lbJ37_CXqj",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1OXgPes-HDAXl29ebND1cF3lbJ37_CXqj/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1eKJRSUTq7joo3pDqjKcaEB0G67qTtFpS",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1eKJRSUTq7joo3pDqjKcaEB0G67qTtFpS/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1LjaAjgQqQdb8v4QydAuWtNPONYjeC-II",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1LjaAjgQqQdb8v4QydAuWtNPONYjeC-II/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "18GWRVvElS_kB89McxY8sxu0HWNigSR6W",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/18GWRVvElS_kB89McxY8sxu0HWNigSR6W/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1eAdVdjEep7ObOx9dDQBGqe1Nab_BenI4",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1eAdVdjEep7ObOx9dDQBGqe1Nab_BenI4/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1xd50O8PYITsJRnsbxatcNJg3D_QZrlsE",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1xd50O8PYITsJRnsbxatcNJg3D_QZrlsE/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1UCiV5ivMyOwN_uCNlOSt96bCnbMkovsr",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1UCiV5ivMyOwN_uCNlOSt96bCnbMkovsr/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1jcnfXN7fKLirjbXG-7PJihQ03tKnWAV2",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1jcnfXN7fKLirjbXG-7PJihQ03tKnWAV2/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1ZW9ckgLefL0IzSDcNECI6Ip4edpTZ4VL",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ZW9ckgLefL0IzSDcNECI6Ip4edpTZ4VL/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1kMCxUa6_OialDB4hQtLIyXvMFEZHZOl4",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1kMCxUa6_OialDB4hQtLIyXvMFEZHZOl4/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1fTEiM3sSqebB9hnabNoRAl3gXvFouQqd",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1fTEiM3sSqebB9hnabNoRAl3gXvFouQqd/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1_UmK9RTt_-MDLww2MCk_lZmpkHlShvfM",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1_UmK9RTt_-MDLww2MCk_lZmpkHlShvfM/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1w0h7Gc2GfqcPdbBz84BeFuOHBQxXooPd",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1w0h7Gc2GfqcPdbBz84BeFuOHBQxXooPd/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      }
                    ]
                  },
                  {
                    "id": "1WiDlNuBggF-Yh3_TSBqgOPyYnDjchO5T",
                    "name": "20010",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1WiDlNuBggF-Yh3_TSBqgOPyYnDjchO5T",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1AhvD1aEXgH_WRBbRfug35yXA7S1TUHlv",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1AhvD1aEXgH_WRBbRfug35yXA7S1TUHlv/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1pQjRu8UuRYS5hlfnkFlrTvzCUR8zr0KG",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1pQjRu8UuRYS5hlfnkFlrTvzCUR8zr0KG/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1A_DhkPxUgTZBlg4wNUWTrH5IfTGnOUlh",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1A_DhkPxUgTZBlg4wNUWTrH5IfTGnOUlh/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "17SXRKn4kLNk8X-fX4YzbLP1hdQgDsprn",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/17SXRKn4kLNk8X-fX4YzbLP1hdQgDsprn/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1F0VEsILLSCM9Wz9SXXOc4wqCRrCGGYC4",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1F0VEsILLSCM9Wz9SXXOc4wqCRrCGGYC4/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1yew3GNbu8rST7Xy0viPkrx0RfXGs0VT3",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1yew3GNbu8rST7Xy0viPkrx0RfXGs0VT3/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "16QLRzT1slCRn0LwjLAIxfpK-thYpdEX2",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/16QLRzT1slCRn0LwjLAIxfpK-thYpdEX2/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "17_MbMn1FjTgTyjurwL-BUAmEcdV6odI3",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/17_MbMn1FjTgTyjurwL-BUAmEcdV6odI3/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1lh6xz6NVL2tAZbTeBKEwJ2Y0kEbjvl0N",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1lh6xz6NVL2tAZbTeBKEwJ2Y0kEbjvl0N/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1qxU3uENKMI_PH8z-XOh36WFKr1DdgZ5-",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1qxU3uENKMI_PH8z-XOh36WFKr1DdgZ5-/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1rnHFhA-2kIXFVnvUwV4qco0rf7BWcFye",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1rnHFhA-2kIXFVnvUwV4qco0rf7BWcFye/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1ae_nmvamnsJuTwJIM1p6gtEtpQ7Xg-55",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ae_nmvamnsJuTwJIM1p6gtEtpQ7Xg-55/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1SKGf06clmjgIHr0tW31uUlhYIsCC3QDa",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1SKGf06clmjgIHr0tW31uUlhYIsCC3QDa/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1r75Yw83zrMBoD8VQLxl0iK_bU6AQhjwj",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1r75Yw83zrMBoD8VQLxl0iK_bU6AQhjwj/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1A5cyeuPFYaQUqmfotaYLdu2q-Vp_2NfZ",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1A5cyeuPFYaQUqmfotaYLdu2q-Vp_2NfZ/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      }
                    ]
                  },
                  {
                    "id": "1ufDh-7kjpNGIT9PXfs5esLWqXLVCWcP5",
                    "name": "20011",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ufDh-7kjpNGIT9PXfs5esLWqXLVCWcP5",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1SSrlV-XQn3-9gjm-ov13vzliwiJ870Nx",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1SSrlV-XQn3-9gjm-ov13vzliwiJ870Nx/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1ghVqpsiqbpHpSWM-yI7v_S0_tk9i06mi",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ghVqpsiqbpHpSWM-yI7v_S0_tk9i06mi/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1obSWOBT1IH8DuNWODpYXCD2GCHy0awPj",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1obSWOBT1IH8DuNWODpYXCD2GCHy0awPj/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "15u9lxlnxtkBt52qwmLjWWnz_Wb1qEzs_",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/15u9lxlnxtkBt52qwmLjWWnz_Wb1qEzs_/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1T72fSwbbsMcOSHIDSHEhgGQExgiCBwko",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1T72fSwbbsMcOSHIDSHEhgGQExgiCBwko/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1q0_NYW-mo23vPQj05WPntKH-4fceAeSK",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1q0_NYW-mo23vPQj05WPntKH-4fceAeSK/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1dYZfBBZIQzLz8DJY3wr4mi0jqiEY3oMb",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1dYZfBBZIQzLz8DJY3wr4mi0jqiEY3oMb/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "157ia3i0waKAjA9OGvP0mFl81CNPARcPk",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/157ia3i0waKAjA9OGvP0mFl81CNPARcPk/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1MXrGI_n5MAQAuxIsS7bdmO03yRkAnynP",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1MXrGI_n5MAQAuxIsS7bdmO03yRkAnynP/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1mov2NlssacG0rk8hdI4O82eu3kDXcl0E",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1mov2NlssacG0rk8hdI4O82eu3kDXcl0E/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1cHQ_i9g6ht3AH62_v_rx0i-20XXYi1rw",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1cHQ_i9g6ht3AH62_v_rx0i-20XXYi1rw/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1ckIiY57ZsEg5eon7v7uZRqIQym5nVthP",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ckIiY57ZsEg5eon7v7uZRqIQym5nVthP/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1yQ0MAKUmtB8Qva95g_27iG-U9H9zMPJk",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1yQ0MAKUmtB8Qva95g_27iG-U9H9zMPJk/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1J7FVmA7nv2je3BMlxBpb7fuHxLhsXuPu",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1J7FVmA7nv2je3BMlxBpb7fuHxLhsXuPu/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1B2HWmX1815doj_BH0UNx9RDMlOhKOf3f",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1B2HWmX1815doj_BH0UNx9RDMlOhKOf3f/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      }
                    ]
                  },
                  {
                    "id": "1Cal6e2upRbuB_QfSxyOQ2RBqVSm8mXlJ",
                    "name": "20012",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Cal6e2upRbuB_QfSxyOQ2RBqVSm8mXlJ",
                    "updatedAt": "2024-05-13",
                    "children": []
                  },
                  {
                    "id": "1786mG1y5Vp-GllKOELqISyoQmCJKtbD0",
                    "name": "20016",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1786mG1y5Vp-GllKOELqISyoQmCJKtbD0",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1Y7T7PGfSq_1PaWP_p3QRhS8hxUx_2LcD",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1Y7T7PGfSq_1PaWP_p3QRhS8hxUx_2LcD/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "148ugyruxqMyr16m9zqWBIAqrvWf9-bgA",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/148ugyruxqMyr16m9zqWBIAqrvWf9-bgA/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1JnHWNo2xhQJQPVUyetD4BFeHad5jAyel",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1JnHWNo2xhQJQPVUyetD4BFeHad5jAyel/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1Xk5EImjI7sbiMZGj-09bwb8sFAeai8AP",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1Xk5EImjI7sbiMZGj-09bwb8sFAeai8AP/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1MKpO4PjRpvfUB3LyoGgZdmWSi-1yLtuT",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1MKpO4PjRpvfUB3LyoGgZdmWSi-1yLtuT/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1VQyq3fWi8wEkdJu6TJcMrCIYBXPyGj0o",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1VQyq3fWi8wEkdJu6TJcMrCIYBXPyGj0o/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1tocrE3QUsAmgJgHvitnyBkkQcbQbPBNW",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1tocrE3QUsAmgJgHvitnyBkkQcbQbPBNW/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1T1xBUYqi8bB0QujNFm9nu3XasWwCypn3",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1T1xBUYqi8bB0QujNFm9nu3XasWwCypn3/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1zzdaPNjU8BwjEdQ2-2FQoVV3qtoYeQPx",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1zzdaPNjU8BwjEdQ2-2FQoVV3qtoYeQPx/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1C6eLT3RiQDlrH8IR8BCF3y9tRVwgPJE2",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1C6eLT3RiQDlrH8IR8BCF3y9tRVwgPJE2/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1htpMe99K_lCDHF-NxRM5UeMlPCSctqt0",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1htpMe99K_lCDHF-NxRM5UeMlPCSctqt0/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "13VHvKhvRpf4NNUFZhb33lRtWnRmysOOG",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/13VHvKhvRpf4NNUFZhb33lRtWnRmysOOG/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1kIR_gMoQzMhP1hB_ihuCtE4NkbbsAzOE",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1kIR_gMoQzMhP1hB_ihuCtE4NkbbsAzOE/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "17I8qyxr0HbLEIIpROUe7qr0GSiHfzkvQ",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/17I8qyxr0HbLEIIpROUe7qr0GSiHfzkvQ/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1MnTb_uMn9JsXUpxZ4RyNL177oEdSYM7z",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1MnTb_uMn9JsXUpxZ4RyNL177oEdSYM7z/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      }
                    ]
                  },
                  {
                    "id": "1RYMnITa6VfyRWesF-HZLirJswNL-Dsvc",
                    "name": "20017",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1RYMnITa6VfyRWesF-HZLirJswNL-Dsvc",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1Ygyvz4Fl7_h9Wdv4-eFGXZEn-akofCxf",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1Ygyvz4Fl7_h9Wdv4-eFGXZEn-akofCxf/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1006 KB"
                      },
                      {
                        "id": "1fO0wnf1_yyXvmA6uwVh8ZYL7pCnrYXnN",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1fO0wnf1_yyXvmA6uwVh8ZYL7pCnrYXnN/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1006 KB"
                      },
                      {
                        "id": "1FFWwbAm7dG7WAKOVBFlS5TUpS7Q_0LW6",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1FFWwbAm7dG7WAKOVBFlS5TUpS7Q_0LW6/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1006 KB"
                      },
                      {
                        "id": "1rcEQoaqxzqaduZs69zIS57u2zmGdE_lC",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1rcEQoaqxzqaduZs69zIS57u2zmGdE_lC/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1006 KB"
                      },
                      {
                        "id": "1Md36yMUlsZu7hhFDPqapotZRdJtA_0hu",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1Md36yMUlsZu7hhFDPqapotZRdJtA_0hu/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1007 KB"
                      },
                      {
                        "id": "1KWKLGU6UXVvl9WHexi2UA0gsTYEIdBAE",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1KWKLGU6UXVvl9WHexi2UA0gsTYEIdBAE/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      },
                      {
                        "id": "1CUwmeAJEWxqhYYtn6HTQSQzCa7ofO_1I",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1CUwmeAJEWxqhYYtn6HTQSQzCa7ofO_1I/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      },
                      {
                        "id": "1m-t6eVjaOCR7d7fiwTyttnWQh29Bpia9",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1m-t6eVjaOCR7d7fiwTyttnWQh29Bpia9/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1006 KB"
                      },
                      {
                        "id": "1PTCXn7fPEUpt5gae8evCnPBT3fLu759s",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1PTCXn7fPEUpt5gae8evCnPBT3fLu759s/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      },
                      {
                        "id": "1XKusPBnm78qmLgKwWbs3FO2zjdX4hR_W",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1XKusPBnm78qmLgKwWbs3FO2zjdX4hR_W/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      },
                      {
                        "id": "1pHSVJVfIoflc-azqo2CIv3df7JOnjUir",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1pHSVJVfIoflc-azqo2CIv3df7JOnjUir/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      },
                      {
                        "id": "1fBBmsGXEqvr7rxNvIeWyoCRoX3QQhv5o",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1fBBmsGXEqvr7rxNvIeWyoCRoX3QQhv5o/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      },
                      {
                        "id": "1fanbjFBDPNmMGrUVQDcoRR7mDUBG5VfR",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1fanbjFBDPNmMGrUVQDcoRR7mDUBG5VfR/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      },
                      {
                        "id": "1T4H2s1hOCaUs8ZgW4uZd_PW6AJHcpayB",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1T4H2s1hOCaUs8ZgW4uZd_PW6AJHcpayB/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1006 KB"
                      },
                      {
                        "id": "1X_xbjY-Xp3Wcasesw2MreGFGX2AOxkLm",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1X_xbjY-Xp3Wcasesw2MreGFGX2AOxkLm/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1005 KB"
                      }
                    ]
                  },
                  {
                    "id": "1xpAbKKvQh1TnliwRDYtOL3GRkjvsF50G",
                    "name": "20018",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1xpAbKKvQh1TnliwRDYtOL3GRkjvsF50G",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1jHlZJ4PHk9jnVzcs-q1bWpUOvGN5N6gM",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1jHlZJ4PHk9jnVzcs-q1bWpUOvGN5N6gM/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1UGhGlyYgNuhp_f63GcYPEHygjx7fEwiN",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1UGhGlyYgNuhp_f63GcYPEHygjx7fEwiN/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "197DXt8mLvnlXQDmpZsLSkgUmSlFo8jC_",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/197DXt8mLvnlXQDmpZsLSkgUmSlFo8jC_/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1u0Xayaw3muEZYK7e3kWP795gISF9rl38",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1u0Xayaw3muEZYK7e3kWP795gISF9rl38/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1kySMnC5visNjP-CK-4WC26XppOJnCQKR",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1kySMnC5visNjP-CK-4WC26XppOJnCQKR/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1zuNQXJL4rZLi2OtyPpmhCaWvUbh4vTK_",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1zuNQXJL4rZLi2OtyPpmhCaWvUbh4vTK_/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1hjyT1kcKaWnOiALN05k8EuDlvyej9www",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1hjyT1kcKaWnOiALN05k8EuDlvyej9www/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "11IbaRx6SCjWkc-FNq2veMZv3Fz9l1Fcf",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/11IbaRx6SCjWkc-FNq2veMZv3Fz9l1Fcf/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1qxzb-ym8-BluvX9PhSdfy5aa4ezLJebO",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1qxzb-ym8-BluvX9PhSdfy5aa4ezLJebO/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1V1XSTYI-iugDeSj3ewCKUIcSfOqoDkbZ",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1V1XSTYI-iugDeSj3ewCKUIcSfOqoDkbZ/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1-fGE-j_HWeJc86hmTR7YJY_ZtL7Iw1eO",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1-fGE-j_HWeJc86hmTR7YJY_ZtL7Iw1eO/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "10X43_YlrEwzEF5DvL6F8dBpK3hrFUDCG",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/10X43_YlrEwzEF5DvL6F8dBpK3hrFUDCG/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1JcL7i59mRrbERwotep9Q6j8cJ_uqjN3G",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1JcL7i59mRrbERwotep9Q6j8cJ_uqjN3G/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1RpUWZNnFRQPx_6m_g7hDnSlQrBP0LxWN",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1RpUWZNnFRQPx_6m_g7hDnSlQrBP0LxWN/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1f0jsa_LAwbyX2JJx_WWCReT4Jx-d_A-s",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1f0jsa_LAwbyX2JJx_WWCReT4Jx-d_A-s/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      }
                    ]
                  },
                  {
                    "id": "1BonqAxIp6o7id-3NjWDpy0uktRlPTTMP",
                    "name": "20019",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1BonqAxIp6o7id-3NjWDpy0uktRlPTTMP",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1mv4h49n5tGzv8sVg6SmlOgZIdVDGZyJu",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1mv4h49n5tGzv8sVg6SmlOgZIdVDGZyJu/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1oqV8P_FtmM06jnis8rIUQpxNcQRvuXqi",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1oqV8P_FtmM06jnis8rIUQpxNcQRvuXqi/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1zbRimNW7rxp0LnxOqoZWg9fPmpEoUGoQ",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1zbRimNW7rxp0LnxOqoZWg9fPmpEoUGoQ/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1c5hSAnoG84Tx7eCDnhmcCKDZj8SliyTe",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1c5hSAnoG84Tx7eCDnhmcCKDZj8SliyTe/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "18CUOulsDyi9oOFsI08IBZeeqZ1wv0JuE",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/18CUOulsDyi9oOFsI08IBZeeqZ1wv0JuE/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1qdtrzCE05E3e3RFs62mTBOR-_XiI2Iot",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1qdtrzCE05E3e3RFs62mTBOR-_XiI2Iot/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1TZId3eTYaoMhFOotXMoposIb3lsm_6gt",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1TZId3eTYaoMhFOotXMoposIb3lsm_6gt/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1ChpIbN7wVjeHEp_9_zOEHsFhbZywswm8",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ChpIbN7wVjeHEp_9_zOEHsFhbZywswm8/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1sjXz4iOilzEDenZ4moL0NHN1CFtcwm8w",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1sjXz4iOilzEDenZ4moL0NHN1CFtcwm8w/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1ZcBptQzh1fr_QZcyU-15GIJ5IMAP3Nlj",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ZcBptQzh1fr_QZcyU-15GIJ5IMAP3Nlj/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1-r5mKY2bbXA-vfj0e8U3PWLRH8CGWRzx",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1-r5mKY2bbXA-vfj0e8U3PWLRH8CGWRzx/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1WWPT5eeQ0_PpPclIjJF9DN6o9jZDyTBF",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1WWPT5eeQ0_PpPclIjJF9DN6o9jZDyTBF/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1SAw1UCsl_7SwMsax99yrnKNgVvSW0zXM",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1SAw1UCsl_7SwMsax99yrnKNgVvSW0zXM/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1781IjOkRbpWtpbExreXSiPJvCT7602Cg",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1781IjOkRbpWtpbExreXSiPJvCT7602Cg/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "118mesZCaBl2n4DsP4PHErYd4IJvCJH94",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/118mesZCaBl2n4DsP4PHErYd4IJvCJH94/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      }
                    ]
                  },
                  {
                    "id": "1mskf2--CX-72l011k2KyYyoezs4f4sEq",
                    "name": "20020",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1mskf2--CX-72l011k2KyYyoezs4f4sEq",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1XOEVw0yS588la1Lf80QWNnfVedgMgHvy",
                        "name": "000000.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1XOEVw0yS588la1Lf80QWNnfVedgMgHvy/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 951 KB"
                      },
                      {
                        "id": "1_AzbFigtMcSf74tWBvDDbEUBjF5XoanJ",
                        "name": "000001.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1_AzbFigtMcSf74tWBvDDbEUBjF5XoanJ/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 949 KB"
                      },
                      {
                        "id": "12-WXHeUzk0K5U_GXanwPJW6HU_MwpB7A",
                        "name": "000002.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/12-WXHeUzk0K5U_GXanwPJW6HU_MwpB7A/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 949 KB"
                      },
                      {
                        "id": "11GbpZdxkart8PP1oJU2udyMYhcRv33S5",
                        "name": "000003.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/11GbpZdxkart8PP1oJU2udyMYhcRv33S5/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 954 KB"
                      },
                      {
                        "id": "1InlMXFNJyeOWlAHkKD_i9KKhhLRCRYPT",
                        "name": "000004.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1InlMXFNJyeOWlAHkKD_i9KKhhLRCRYPT/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 954 KB"
                      },
                      {
                        "id": "1XIxktNZ_r0JXkuc9gSCiMkwJecINTIYR",
                        "name": "000005.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1XIxktNZ_r0JXkuc9gSCiMkwJecINTIYR/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 958 KB"
                      },
                      {
                        "id": "1yyZPGZIVeflWWF8RCa5sEvPgKq8QDnmx",
                        "name": "000006.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1yyZPGZIVeflWWF8RCa5sEvPgKq8QDnmx/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 960 KB"
                      },
                      {
                        "id": "1ztXnsn9KQ9RTigd506F3lM3Z0RfCWyPc",
                        "name": "000007.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ztXnsn9KQ9RTigd506F3lM3Z0RfCWyPc/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 958 KB"
                      },
                      {
                        "id": "1INA6Le7fkv1S9GoQhwC92Aa2_lt9JIDy",
                        "name": "000008.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1INA6Le7fkv1S9GoQhwC92Aa2_lt9JIDy/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 961 KB"
                      },
                      {
                        "id": "1ccS763jTCMbj8aAL3Z-gMLJLIn7zmndX",
                        "name": "000009.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ccS763jTCMbj8aAL3Z-gMLJLIn7zmndX/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 962 KB"
                      },
                      {
                        "id": "1DTx7PXx0dGRR0fv6YmH-P5NFMqEP5OsJ",
                        "name": "000010.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1DTx7PXx0dGRR0fv6YmH-P5NFMqEP5OsJ/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 961 KB"
                      },
                      {
                        "id": "1O6r_cii4bBGOrdgsicJpudkSV6wdkmg2",
                        "name": "000011.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1O6r_cii4bBGOrdgsicJpudkSV6wdkmg2/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 960 KB"
                      },
                      {
                        "id": "15M3J93WxDyi951BZn8VzY5JXzuNmfMjP",
                        "name": "000012.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/15M3J93WxDyi951BZn8VzY5JXzuNmfMjP/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 964 KB"
                      },
                      {
                        "id": "1-gWKXE7TPQghIwFiuaNtDUHrYjYy1qR6",
                        "name": "000013.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1-gWKXE7TPQghIwFiuaNtDUHrYjYy1qR6/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 964 KB"
                      },
                      {
                        "id": "1K_L2grU8Jg5XP_X_qMeOq4tbddpdeqPc",
                        "name": "000014.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1K_L2grU8Jg5XP_X_qMeOq4tbddpdeqPc/view?usp=drivesdk",
                        "updatedAt": "2024-05-13",
                        "sizeOrNote": "PNG 圖檔 · 965 KB"
                      }
                    ]
                  },
                  {
                    "id": "15TYy1chfvUd2pbKgkTNfKVf0zCNeCnbt",
                    "name": "after_sales_售後服務處理資源",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/15TYy1chfvUd2pbKgkTNfKVf0zCNeCnbt",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1X6-7E722nua0V5-XRSOipSVDVq-fZ_dp",
                        "name": "20241011_GOLF20014",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1X6-7E722nua0V5-XRSOipSVDVq-fZ_dp",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1w4UNPmIL3GhQPApRxigHc5rvqnyj3384",
                        "name": "20241016_GOLF20001",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1w4UNPmIL3GhQPApRxigHc5rvqnyj3384",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1nNSNy0kUCgQ4-GTkVkY-wZ3T9nBsMAPB",
                        "name": "20241018分析",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1nNSNy0kUCgQ4-GTkVkY-wZ3T9nBsMAPB",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1J63zwPGdRPv0Xp99TzmCCu9-Fa4zptzU",
                        "name": "20241104",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1J63zwPGdRPv0Xp99TzmCCu9-Fa4zptzU",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1GN4RWA0YV7iF8poHJvzPD1iPCPztEVVU",
                        "name": "20241220",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1GN4RWA0YV7iF8poHJvzPD1iPCPztEVVU",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1F2CIyk_k0waF0C8oS_D6YRvQOaN8qhdP",
                        "name": "20250102",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1F2CIyk_k0waF0C8oS_D6YRvQOaN8qhdP",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1moh7tWtqifn3zN0p1dydt_oXY-G9GeS3",
                        "name": "20250103to20250109",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1moh7tWtqifn3zN0p1dydt_oXY-G9GeS3",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1juLUGkgIppMIwqUDpdMqiyR-vaplqyCw",
                        "name": "20250114",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1juLUGkgIppMIwqUDpdMqiyR-vaplqyCw",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1H4k5eCft0CyW4afFWELmVu8EDFBiJ24U",
                        "name": "20250120",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1H4k5eCft0CyW4afFWELmVu8EDFBiJ24U",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1Bm_cjvmdSWiTixqdLxrrBxWfHTPbQvRc",
                        "name": "20250123",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Bm_cjvmdSWiTixqdLxrrBxWfHTPbQvRc",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1EmZuvzC080Uut4vP_47C0nL3QVxIqfd9",
                        "name": "20250124",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1EmZuvzC080Uut4vP_47C0nL3QVxIqfd9",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1mNOHaHX4NUktvARcd8dJ5M2Abz5wYv5w",
                        "name": "20250125",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1mNOHaHX4NUktvARcd8dJ5M2Abz5wYv5w",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1Av_z9guTVqOPOcgdnoZrBnSrbki9l-Mx",
                        "name": "20250126",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Av_z9guTVqOPOcgdnoZrBnSrbki9l-Mx",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "18gTfep-vfiKU5L21Dfw0_ob6mF2lC-Sf",
                        "name": "20250127",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/18gTfep-vfiKU5L21Dfw0_ob6mF2lC-Sf",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1XK71_jYp39RNKgWiLTkL9_G3UMIAIOr_",
                        "name": "20250129",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1XK71_jYp39RNKgWiLTkL9_G3UMIAIOr_",
                        "updatedAt": "2025-02-24",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1daYP1cta7IyCYr6FdrfPo-2lPtVM2ap0",
                    "name": "20240424綠通車輛待修方案V2 excel版 的複本_lester.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1daYP1cta7IyCYr6FdrfPo-2lPtVM2ap0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2024-05-17",
                    "sizeOrNote": "試算表 · 30 KB"
                  },
                  {
                    "id": "1kTUS6xsImv4yH0o4esd3S_opjgd_EV39",
                    "name": "IMG20240510114126.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1kTUS6xsImv4yH0o4esd3S_opjgd_EV39/view?usp=drivesdk",
                    "updatedAt": "2024-05-14",
                    "sizeOrNote": "JPG 圖檔 · 1.8 MB"
                  },
                  {
                    "id": "11jRlkZqNiTgZUCOp-xJrP2Eh0fuI75bm",
                    "name": "IMG20240510123959.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/11jRlkZqNiTgZUCOp-xJrP2Eh0fuI75bm/view?usp=drivesdk",
                    "updatedAt": "2024-05-14",
                    "sizeOrNote": "JPG 圖檔 · 1.3 MB"
                  },
                  {
                    "id": "1XZATqktgQO5YSnSpGmW0967igVTuo9wh",
                    "name": "IMG20240510125605.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1XZATqktgQO5YSnSpGmW0967igVTuo9wh/view?usp=drivesdk",
                    "updatedAt": "2024-05-14",
                    "sizeOrNote": "JPG 圖檔 · 1.8 MB"
                  },
                  {
                    "id": "1i2VAroJEEsnTID8nLv9F8tH0q97zw38F",
                    "name": "IMG20240510125609.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1i2VAroJEEsnTID8nLv9F8tH0q97zw38F/view?usp=drivesdk",
                    "updatedAt": "2024-05-14",
                    "sizeOrNote": "JPG 圖檔 · 1.9 MB"
                  },
                  {
                    "id": "10IK87zYDulKi3Vja_eiAv49Da-NRMeRA",
                    "name": "IMG20240510125615.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/10IK87zYDulKi3Vja_eiAv49Da-NRMeRA/view?usp=drivesdk",
                    "updatedAt": "2024-05-14",
                    "sizeOrNote": "JPG 圖檔 · 1.9 MB"
                  }
                ]
              },
              {
                "id": "1GVbaXlXA7OKWnJZc8z6a_LGgK6MkfJrU",
                "name": "OS",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1GVbaXlXA7OKWnJZc8z6a_LGgK6MkfJrU",
                "updatedAt": "2025-02-24",
                "children": [
                  {
                    "id": "1HDJ_h2euNXEfpY5mtQAiYhZb9zVXAHTu",
                    "name": "iptable.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1HDJ_h2euNXEfpY5mtQAiYhZb9zVXAHTu/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-04-07",
                    "sizeOrNote": "Word · 24 KB"
                  }
                ]
              },
              {
                "id": "1lTSTEKcSdJ0W1h0I20v9wcWMOYZ5UPMN",
                "name": "財產編號",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1lTSTEKcSdJ0W1h0I20v9wcWMOYZ5UPMN",
                "updatedAt": "2025-02-24",
                "children": [
                  {
                    "id": "1efmP-R-uSn4-IfmrN0rh0VBbH2LJO63z",
                    "name": "IMG20240612155111.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1efmP-R-uSn4-IfmrN0rh0VBbH2LJO63z/view?usp=drivesdk",
                    "updatedAt": "2024-06-12",
                    "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                  },
                  {
                    "id": "1lpFBIh-RRc5bUYB4PY70dVxyzifoxCkq",
                    "name": "IMG20240624140552.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1lpFBIh-RRc5bUYB4PY70dVxyzifoxCkq/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 1.7 MB"
                  },
                  {
                    "id": "1-8cM2HTprDrRGvNNvVR8kKcSOc7F037M",
                    "name": "IMG20240624140607.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1-8cM2HTprDrRGvNNvVR8kKcSOc7F037M/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                  },
                  {
                    "id": "1CTiTMNedjaY7_Z4OM2hDtAl__W9ql9sC",
                    "name": "IMG20240624140633.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1CTiTMNedjaY7_Z4OM2hDtAl__W9ql9sC/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 1.0 MB"
                  },
                  {
                    "id": "1iPn2wfJN-qcBf0FvQWsVLOu8bESIkIUg",
                    "name": "IMG20240624140647.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1iPn2wfJN-qcBf0FvQWsVLOu8bESIkIUg/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                  },
                  {
                    "id": "1OgIonlrzF5MUdy9JQgoTn-eB-LELelLQ",
                    "name": "IMG20240624142751.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1OgIonlrzF5MUdy9JQgoTn-eB-LELelLQ/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 1.8 MB"
                  },
                  {
                    "id": "1yel16qlteb3G73jxz84bbf8IcH3zBKwP",
                    "name": "IMG20240624143033.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1yel16qlteb3G73jxz84bbf8IcH3zBKwP/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 1.6 MB"
                  },
                  {
                    "id": "1bug6fbaZ4GGgVIxd8J-DklkvvgFWq1XA",
                    "name": "IMG20240624143127.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1bug6fbaZ4GGgVIxd8J-DklkvvgFWq1XA/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 994 KB"
                  },
                  {
                    "id": "1omiNRAm7P9C3sMH5DVDfmWnX7vtuYW-W",
                    "name": "IMG20240624143559.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1omiNRAm7P9C3sMH5DVDfmWnX7vtuYW-W/view?usp=drivesdk",
                    "updatedAt": "2024-06-24",
                    "sizeOrNote": "JPG 圖檔 · 1.4 MB"
                  },
                  {
                    "id": "1WSCShSc9xibDAFveNGQkpmIk1Y6LFMm-",
                    "name": "IMG20240625114410.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1WSCShSc9xibDAFveNGQkpmIk1Y6LFMm-/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 2.1 MB"
                  },
                  {
                    "id": "1i8Yb54-KTSk47_t2b5XpYQit3M4F5qen",
                    "name": "IMG20240625114423.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1i8Yb54-KTSk47_t2b5XpYQit3M4F5qen/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.5 MB"
                  },
                  {
                    "id": "1bXhxTUobXpdtgiedpez_8k3Ly3XUWzWG",
                    "name": "IMG20240625114506.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1bXhxTUobXpdtgiedpez_8k3Ly3XUWzWG/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.1 MB"
                  },
                  {
                    "id": "17QQk5C40qG0cHFDhxrpKc5hfLpp4E3BI",
                    "name": "IMG20240625114517.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/17QQk5C40qG0cHFDhxrpKc5hfLpp4E3BI/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.3 MB"
                  },
                  {
                    "id": "1tkFU2t5Q9Qa4X6cp177u3D1iG-6MnfmF",
                    "name": "IMG20240625134637.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1tkFU2t5Q9Qa4X6cp177u3D1iG-6MnfmF/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.7 MB"
                  },
                  {
                    "id": "1hfqZiyRujOXUeEAGsAYD7Jid_7bD8ra-",
                    "name": "IMG20240625134648.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1hfqZiyRujOXUeEAGsAYD7Jid_7bD8ra-/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                  },
                  {
                    "id": "1rnBqWRn4hbb05DoF8LCcxhuuxhetQhfv",
                    "name": "IMG20240625134657.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1rnBqWRn4hbb05DoF8LCcxhuuxhetQhfv/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.1 MB"
                  },
                  {
                    "id": "1PIKBBddUfYok9At9l9g61j4Ug9HgCgIo",
                    "name": "IMG20240625150155.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1PIKBBddUfYok9At9l9g61j4Ug9HgCgIo/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.7 MB"
                  },
                  {
                    "id": "1ECYw5xnvzpxdaYtc-A1EoObj--kDZiPf",
                    "name": "IMG20240625150209.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1ECYw5xnvzpxdaYtc-A1EoObj--kDZiPf/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.3 MB"
                  },
                  {
                    "id": "1BgwUk7wIIg7HMQX9WUYsg9Qi3cSc1k2d",
                    "name": "IMG20240625150225.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1BgwUk7wIIg7HMQX9WUYsg9Qi3cSc1k2d/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.3 MB"
                  },
                  {
                    "id": "1TBR8QL5OakHRYkxXFoYc60awSmyaHehI",
                    "name": "IMG20240625152951.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1TBR8QL5OakHRYkxXFoYc60awSmyaHehI/view?usp=drivesdk",
                    "updatedAt": "2024-06-25",
                    "sizeOrNote": "JPG 圖檔 · 1.7 MB"
                  }
                ]
              },
              {
                "id": "1LFHBl14_anEFJqJncNVg1d75wQoqci9m",
                "name": "銷售系統導入",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1LFHBl14_anEFJqJncNVg1d75wQoqci9m",
                "updatedAt": "2025-02-24",
                "children": [
                  {
                    "id": "1ldUt_5TTcBeSRCg2tPgBxDx-F6oGTdEA",
                    "name": "20240812_南峰.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1ldUt_5TTcBeSRCg2tPgBxDx-F6oGTdEA/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2024-08-13",
                    "sizeOrNote": "Word · 24 KB"
                  },
                  {
                    "id": "1VtNkGMYP7ZkiyTFWVr5--02WEtPTENqU",
                    "name": "20240812_南峰.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1VtNkGMYP7ZkiyTFWVr5--02WEtPTENqU/view?usp=drivesdk",
                    "updatedAt": "2024-08-09",
                    "sizeOrNote": "PDF · 68 KB"
                  }
                ]
              },
              {
                "id": "15UPuSGK-wOoE7iHW5p-sXwj8qFfesIKR",
                "name": "1.0智慧球車產品文件_v4.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/15UPuSGK-wOoE7iHW5p-sXwj8qFfesIKR/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-07-04",
                "sizeOrNote": "Word · 4.0 MB"
              },
              {
                "id": "1s2Q_Jta4D3Y5AeGTe9C2An1guw5cy_Xr",
                "name": "IMG20220411185204.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1s2Q_Jta4D3Y5AeGTe9C2An1guw5cy_Xr/view?usp=drivesdk",
                "updatedAt": "2022-04-14",
                "sizeOrNote": "JPG 圖檔 · 1.6 MB"
              },
              {
                "id": "1F2JrnvHpgBurAMNLCpbY1YmoU4ahjQIU",
                "name": "NX測試和系統開發.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1F2JrnvHpgBurAMNLCpbY1YmoU4ahjQIU/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2022-04-08",
                "sizeOrNote": "Word · 24 KB"
              },
              {
                "id": "1rRUjeo5zlo78fcDelzCgbHHRhgCt1zrK",
                "name": "SmartkartConfigurationModule導入.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1rRUjeo5zlo78fcDelzCgbHHRhgCt1zrK/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2021-12-23",
                "sizeOrNote": "Word · 67 KB"
              },
              {
                "id": "1Ta9Q8SvmkzZoKEYn754vC7N4pXYr0Vxl",
                "name": "turing_module.drawio",
                "kind": "document",
                "driveUrl": "https://drive.google.com/file/d/1Ta9Q8SvmkzZoKEYn754vC7N4pXYr0Vxl/view?usp=drivesdk",
                "updatedAt": "2021-12-23",
                "sizeOrNote": "文件 · 2 KB"
              },
              {
                "id": "13dpS8NwqGQ6AIPm6YsJkE1tl2H8xPkIp",
                "name": "班芝花928to930.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/13dpS8NwqGQ6AIPm6YsJkE1tl2H8xPkIp/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2022-09-27",
                "sizeOrNote": "Word · 28 KB"
              }
            ]
          }
        ]
      },
      {
        "id": "2025-gbgh-maas",
        "code": "GBGH-2025",
        "name": "GBGH 自駕園區接駁與 MaaS 實證專案",
        "startYear": 2025,
        "period": "2025",
        "department": "交通行動服務部 | Mobility as a Service",
        "sharedDriveName": "GBGH",
        "status": "completed",
        "accessScope": "department_only",
        "accessGroupLabel": "gbgh@turing-drive.com（GBGH 專案群組限定）",
        "allowedDepartments": [
          "交通行動服務",
          "MaaS",
          "專案",
          "研發"
        ],
        "summary": "GBGH 場域自動駕駛接駁車與 MaaS 叫車平台整合專案，包含場域路線規劃、預約派遣流程與安全驗證報告。（依 Google Drive 權限：僅開放 gbgh@turing-drive.com 群組與管理員）",
        "highlights": [
          "GBGH 場域路線與站點規劃",
          "MaaS 預約叫車整合測試"
        ],
        "driveFolderId": "1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue",
        "files": [
          {
            "id": "1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue",
            "name": "GBGH > 文件 > General",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue",
            "updatedAt": "2025-08",
            "sizeOrNote": "場勘報告、測試紀錄與客戶簡報",
            "accessScope": "department_only",
            "allowedDepartments": [
              "交通行動服務",
              "MaaS",
              "專案",
              "研發"
            ],
            "children": [
              {
                "id": "1NGf2JvsuM_6fpUSqpCW-1d6PK-lCnPzQ",
                "name": "ADS Demo",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1NGf2JvsuM_6fpUSqpCW-1d6PK-lCnPzQ",
                "updatedAt": "2025-05-27",
                "children": [
                  {
                    "id": "1MZg-9dZ4gqHUATzr4fIebXurcCYsVmpq",
                    "name": "42438B97BAE7BA61533B8CD408CB090F8DE562F5.mp4",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1MZg-9dZ4gqHUATzr4fIebXurcCYsVmpq/view?usp=drivesdk",
                    "updatedAt": "2025-05-28",
                    "sizeOrNote": "MP4 影片 · 15.0 MB"
                  }
                ]
              },
              {
                "id": "1dH1DHAXwp1lrLGEJZxWLl2K7DpYZ3NLC",
                "name": "MaaS Demo",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1dH1DHAXwp1lrLGEJZxWLl2K7DpYZ3NLC",
                "updatedAt": "2025-05-27",
                "children": []
              },
              {
                "id": "115kMwIKm0_QYn3c5idtW3S3wJ2r5ERIp",
                "name": "MI-$120,000,000",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/115kMwIKm0_QYn3c5idtW3S3wJ2r5ERIp",
                "updatedAt": "2025-05-28",
                "children": [
                  {
                    "id": "1pzpZhvrRdTQZHCIfN9Lgncve43HKZioP",
                    "name": "250609_彩排.mov",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1pzpZhvrRdTQZHCIfN9Lgncve43HKZioP/view?usp=drivesdk",
                    "updatedAt": "2025-06-09",
                    "sizeOrNote": "MP4 影片 · 694.1 MB"
                  },
                  {
                    "id": "1qB6heZyxl-GNEGZWEUMKAjtj0c75Ur-H",
                    "name": "demo_office_國發基金-數發部_260528.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1qB6heZyxl-GNEGZWEUMKAjtj0c75Ur-H/view?usp=drivesdk",
                    "updatedAt": "2025-05-28",
                    "sizeOrNote": "PDF · 1.0 MB"
                  },
                  {
                    "id": "1oh9d2m_1yh5xk1HMNGQEdLUu3k0rGd0L",
                    "name": "Image (1).jpeg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1oh9d2m_1yh5xk1HMNGQEdLUu3k0rGd0L/view?usp=drivesdk",
                    "updatedAt": "2025-06-11",
                    "sizeOrNote": "JPG 圖檔 · 245 KB"
                  },
                  {
                    "id": "1W2bU8gNnlpmS3Xdxfi2j1uu-IujNHFQT",
                    "name": "Image (2).jpeg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1W2bU8gNnlpmS3Xdxfi2j1uu-IujNHFQT/view?usp=drivesdk",
                    "updatedAt": "2025-06-11",
                    "sizeOrNote": "JPG 圖檔 · 240 KB"
                  },
                  {
                    "id": "1yeWAnLOyLifa1ryOzNJznlERCv8T51jb",
                    "name": "Image (3).jpeg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1yeWAnLOyLifa1ryOzNJznlERCv8T51jb/view?usp=drivesdk",
                    "updatedAt": "2025-06-11",
                    "sizeOrNote": "JPG 圖檔 · 204 KB"
                  },
                  {
                    "id": "1W_qthq9EaY7TWCoTTaCxbugo5LBzYz3F",
                    "name": "Image (5).jpeg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1W_qthq9EaY7TWCoTTaCxbugo5LBzYz3F/view?usp=drivesdk",
                    "updatedAt": "2025-06-11",
                    "sizeOrNote": "JPG 圖檔 · 217 KB"
                  },
                  {
                    "id": "1rksGQ5nbFKdu4oTzOIc8lJBBHFN6M43B",
                    "name": "Image.jpeg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1rksGQ5nbFKdu4oTzOIc8lJBBHFN6M43B/view?usp=drivesdk",
                    "updatedAt": "2025-06-11",
                    "sizeOrNote": "JPG 圖檔 · 218 KB"
                  },
                  {
                    "id": "1OlNvHLF4yW8vFUwOkL4zvJMC00PIp9AH",
                    "name": "IMG_4761 copy.JPG",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1OlNvHLF4yW8vFUwOkL4zvJMC00PIp9AH/view?usp=drivesdk",
                    "updatedAt": "2025-06-02",
                    "sizeOrNote": "JPG 圖檔 · 459 KB"
                  },
                  {
                    "id": "1CHGcoMvfBc8uEDYGMDWd8jo1jMZ5LbDM",
                    "name": "IMG_4803.mov",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1CHGcoMvfBc8uEDYGMDWd8jo1jMZ5LbDM/view?usp=drivesdk",
                    "updatedAt": "2025-06-02",
                    "sizeOrNote": "MP4 影片 · 67.1 MB"
                  },
                  {
                    "id": "1PNmQMTa-G_oJLX5yI1HxF7_0Fn2WRW48",
                    "name": "IMG_4825.mov",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1PNmQMTa-G_oJLX5yI1HxF7_0Fn2WRW48/view?usp=drivesdk",
                    "updatedAt": "2025-06-02",
                    "sizeOrNote": "MP4 影片 · 52.1 MB"
                  },
                  {
                    "id": "1UGGK-zHEZTEtKADrWz_tfX72QKjkK58R",
                    "name": "IMG_5227.JPG",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1UGGK-zHEZTEtKADrWz_tfX72QKjkK58R/view?usp=drivesdk",
                    "updatedAt": "2025-06-02",
                    "sizeOrNote": "JPG 圖檔 · 1.7 MB"
                  },
                  {
                    "id": "1J0_q3yHrVXtA5z7fK3524QdrTA7MWHCV",
                    "name": "IMG_5228.JPG",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1J0_q3yHrVXtA5z7fK3524QdrTA7MWHCV/view?usp=drivesdk",
                    "updatedAt": "2025-06-02",
                    "sizeOrNote": "JPG 圖檔 · 1.5 MB"
                  },
                  {
                    "id": "1rL8WQAn2sd5l8V7DxLMnpGQwsBV_7_cT",
                    "name": "Screencast from 2025年五月21日 15時32分31秒.mp4",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1rL8WQAn2sd5l8V7DxLMnpGQwsBV_7_cT/view?usp=drivesdk",
                    "updatedAt": "2025-06-02",
                    "sizeOrNote": "MP4 影片 · 90.8 MB"
                  },
                  {
                    "id": "1l-eddG8sCn5AkKjLY7CrMTR2TBOT8oSr",
                    "name": "Screenshot 2025-06-06 at 5.33.47 PM.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1l-eddG8sCn5AkKjLY7CrMTR2TBOT8oSr/view?usp=drivesdk",
                    "updatedAt": "2025-06-06",
                    "sizeOrNote": "PNG 圖檔 · 505 KB"
                  }
                ]
              },
              {
                "id": "1F9Fe8wiYLyxRYduHxxTH0pTvTuDEfTDs",
                "name": "VD Demo",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1F9Fe8wiYLyxRYduHxxTH0pTvTuDEfTDs",
                "updatedAt": "2025-05-27",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "id": "2025-adawarp",
        "code": "EXT-ADAWARP",
        "name": "[EXT] ADAWARP 跨國技術合作專案",
        "startYear": 2025,
        "period": "2024 Q4 – 2025",
        "department": "國際市場開發 / 研發部",
        "sharedDriveName": "[EXT] ADAWARP",
        "status": "completed",
        "accessScope": "department_only",
        "accessGroupLabel": "extadawarp@turing-drive.com（ADAWARP 專案群組限定）",
        "allowedDepartments": [
          "研發",
          "R&D",
          "國際市場",
          "營業",
          "BD"
        ],
        "summary": "與海外夥伴 ADAWARP 進行之遠端車隊通訊與自駕系統整合外部協作空間，收錄共同技術規格、API 介面定義與展示影片。（依 Google Drive 權限：僅開放 extadawarp@turing-drive.com 群組與管理員）",
        "highlights": [
          "跨國車聯網低延遲串流整合",
          "共同技術驗證與聯測報告"
        ],
        "driveFolderId": "1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl",
        "files": [
          {
            "id": "1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl",
            "name": "[EXT] ADAWARP > 文件 > General",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl",
            "updatedAt": "2025-07",
            "sizeOrNote": "外部共享技術規格與聯測紀錄",
            "accessScope": "department_only",
            "allowedDepartments": [
              "研發",
              "R&D",
              "國際市場",
              "營業",
              "BD"
            ],
            "children": [
              {
                "id": "14VkLUD3D_sDwiYNieY00xfJQK0zi7Kn2",
                "name": "1015_Software_Agency_Agreement_ADAWARP_Signed.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/14VkLUD3D_sDwiYNieY00xfJQK0zi7Kn2/view?usp=drivesdk",
                "updatedAt": "2025-10-15",
                "sizeOrNote": "PDF · 1.1 MB · ADAWARP 軟體代理協議正式簽署版",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1dt3JsXCqvrlhVQps05X-KTBpADRlgKJ8",
                "name": "修正済み_Adawarp殿：代理契約（案）0722.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1dt3JsXCqvrlhVQps05X-KTBpADRlgKJ8/view?usp=drivesdk",
                "updatedAt": "2025-07-22",
                "sizeOrNote": "PDF · 680 KB · Adawarp 日本代理契約書修訂定稿",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1PQr3Jq07bn5ODZysNyT36WzMeprIRBWd",
                "name": "期末報告：（Adawarp）代理商合約.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1PQr3Jq07bn5ODZysNyT36WzMeprIRBWd/view?usp=drivesdk",
                "updatedAt": "2025-11-10",
                "sizeOrNote": "PDF · 950 KB · 遠端控制技術結盟與日本代理成果報告"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "year": 2024,
    "label": "2024 年起始專案",
    "tagline": "GOLFACE 15 台量產車交付、HTC 高雄港 5G 自駕車、JETRO 日本宮古島自駕案、EVE Auto-BAL",
    "projectOverview": "公司量產落地與海外示範關鍵年份：完成綠通 GOLFACE 15 台量產自駕球車硬體點交與多球場場勘、HTC 高雄港區自駕實證、日本 JETRO 宮古島自駕運行與日文版 HMI，以及 EVE Auto-BAL 專案。",
    "projects": [
      {
        "id": "2024-golface-15cars",
        "code": "GF-15MASS",
        "name": "2024_GOLFACE_15台量產車（綠通量產交付案）",
        "startYear": 2024,
        "period": "2024 Q1 – 2024 Q4",
        "department": "客戶專案執行 / 綠通專案組",
        "sharedDriveName": "綠通 / 專案執行",
        "status": "completed",
        "accessScope": "company_wide",
        "accessGroupLabel": "tprogram@turing-drive.com · 全公司可讀",
        "summary": "完成 15 台綠通（GreenTrans）底盤自駕高爾夫球車量產改裝、0716 車輛硬體點交、斑芝花/敏實/台北港等場域驗收，以及 1.0 智慧球車產品文件 v5 與球場維護保養建議。",
        "highlights": [
          "0716 車輛硬體點交 & 智慧球車車輛狀態及系統點交表.docx",
          "1.0 智慧球車產品文件 v5（含球場須知維護保養建議 PDF）",
          "0612 斑芝花、0614 台北港、0624 敏實(含驗收影片)、0702 斑芝花南峰"
        ],
        "driveFolderId": "1kj7NHEZnn-a80VfgrQBOkRqCJizQ0EZ6",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1kj7NHEZnn-a80VfgrQBOkRqCJizQ0EZ6",
        "files": [
          {
            "id": "1I1HYDSaM3RMxZJg8Bh3TIeEPmd2ECLwE",
            "name": "0716車輛硬體點交",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1I1HYDSaM3RMxZJg8Bh3TIeEPmd2ECLwE",
            "updatedAt": "2024-07-16",
            "sizeOrNote": "15 台量產車逐車硬體點交實況照片與影片（含實機點交照片集）",
            "children": [
              {
                "id": "1DwVhUYkJMy1gL11PLZF71KrR_69kd4-i",
                "name": "IMG_20240716_141508.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1DwVhUYkJMy1gL11PLZF71KrR_69kd4-i/view?usp=drivesdk",
                "updatedAt": "2024-07-16",
                "sizeOrNote": "JPG 圖檔 · 3.6 MB · 07/16 量產球車硬體點交現場照片 #1"
              },
              {
                "id": "1avLVS2NwLM6eJjgUsHhStb2TrJNNElxh",
                "name": "IMG_20240716_141515.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1avLVS2NwLM6eJjgUsHhStb2TrJNNElxh/view?usp=drivesdk",
                "updatedAt": "2024-07-16",
                "sizeOrNote": "JPG 圖檔 · 3.6 MB · 07/16 量產球車硬體點交現場照片 #2"
              },
              {
                "id": "1gBT_JYjIRveJQyvUym9dGZsfTEOjtiOj",
                "name": "IMG_20240716_141516.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1gBT_JYjIRveJQyvUym9dGZsfTEOjtiOj/view?usp=drivesdk",
                "updatedAt": "2024-07-16",
                "sizeOrNote": "JPG 圖檔 · 3.8 MB · 07/16 量產球車感測器與車體檢視 #3"
              },
              {
                "id": "1fLJbhoyNPEYVqYlJwkphs16s2RG1b5z2",
                "name": "VID_20240716_141806.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1fLJbhoyNPEYVqYlJwkphs16s2RG1b5z2/view?usp=drivesdk",
                "updatedAt": "2024-07-16",
                "sizeOrNote": "MP4 影片 · 335 MB · 07/16 現場實車動態點交測試影片"
              }
            ]
          },
          {
            "id": "1gB7W-WikNjIwBaOWB5GWAFP5XJFJgn8Z",
            "name": "0624敏實(含驗收影片)",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1gB7W-WikNjIwBaOWB5GWAFP5XJFJgn8Z",
            "updatedAt": "2024-06-27",
            "sizeOrNote": "敏實場域實車測試與驗收影片",
            "children": [
              {
                "id": "1K1OXGNDywmwBSM_hrHoN0jJgIKW0uQr5",
                "name": "14-01.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1K1OXGNDywmwBSM_hrHoN0jJgIKW0uQr5/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 195 KB"
              },
              {
                "id": "1ijuaNe0vf2D4V-lx9P24uQbVwzmfDCjz",
                "name": "14-02.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1ijuaNe0vf2D4V-lx9P24uQbVwzmfDCjz/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 175 KB"
              },
              {
                "id": "1CNE6W_uicmogl1x0MxZ76ykGH5IenLsW",
                "name": "14-03.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1CNE6W_uicmogl1x0MxZ76ykGH5IenLsW/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 211 KB"
              },
              {
                "id": "1mAWekUAgpGrKTGBc0jc70ovmbMupdAWK",
                "name": "14-04.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1mAWekUAgpGrKTGBc0jc70ovmbMupdAWK/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 212 KB"
              },
              {
                "id": "1qaoZHEGf9TdR-eKlBo5YFKfR3a78NfGM",
                "name": "14-充電指示燈.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1qaoZHEGf9TdR-eKlBo5YFKfR3a78NfGM/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "MP4 影片 · 2.3 MB"
              },
              {
                "id": "1p2mlQdAun7JKql7fl2_mohF1o6Htqz9M",
                "name": "14-功能驗收.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1p2mlQdAun7JKql7fl2_mohF1o6Htqz9M/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "MP4 影片 · 35.6 MB"
              },
              {
                "id": "1F8pDGR13Syn8WlglEOXtvLKDbx2enfBt",
                "name": "14-外觀驗收.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1F8pDGR13Syn8WlglEOXtvLKDbx2enfBt/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "MP4 影片 · 20.2 MB"
              },
              {
                "id": "1Smvqx5tYc--0SjZiRRck6ceISFxr5oQ_",
                "name": "15-01.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1Smvqx5tYc--0SjZiRRck6ceISFxr5oQ_/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 193 KB"
              },
              {
                "id": "1Wg0QJVWxpiWDjE-d8MFNjljwjKy3FRED",
                "name": "15-02.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1Wg0QJVWxpiWDjE-d8MFNjljwjKy3FRED/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 166 KB"
              },
              {
                "id": "1_L7kcd063jdteIQzGKYs9g8Pok2o84n1",
                "name": "15-03.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1_L7kcd063jdteIQzGKYs9g8Pok2o84n1/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 203 KB"
              },
              {
                "id": "1FFmSyGDD4d-tOMogL9yz4cDPJp7QJ6vH",
                "name": "15-04.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1FFmSyGDD4d-tOMogL9yz4cDPJp7QJ6vH/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "JPG 圖檔 · 200 KB"
              },
              {
                "id": "1yOmTY36ikqjFWfeNJI1CecA19qfQyJoQ",
                "name": "15-充電指示燈.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1yOmTY36ikqjFWfeNJI1CecA19qfQyJoQ/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "MP4 影片 · 2.4 MB"
              },
              {
                "id": "1ooLcXOmhWtDH5BpcecC6FmM2gpNKg9MC",
                "name": "15-功能驗收.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1ooLcXOmhWtDH5BpcecC6FmM2gpNKg9MC/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "MP4 影片 · 37.7 MB"
              },
              {
                "id": "1MowOODkG87rZZOy0h80MTb5saNuLWQz4",
                "name": "15-外觀驗收.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1MowOODkG87rZZOy0h80MTb5saNuLWQz4/view?usp=drivesdk",
                "updatedAt": "2024-06-27",
                "sizeOrNote": "MP4 影片 · 16.5 MB"
              },
              {
                "id": "1e1PdBVf4Y7UY-f-11Xc62wYldLUS9ejh",
                "name": "no.14行車紀錄鏡頭.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1e1PdBVf4Y7UY-f-11Xc62wYldLUS9ejh/view?usp=drivesdk",
                "updatedAt": "2024-07-16",
                "sizeOrNote": "MP4 影片 · 7.6 MB"
              },
              {
                "id": "1MfmrOdBtKHgOJPRtCB-UqlO2EJQMtAzV",
                "name": "no.15行車紀錄鏡頭.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1MfmrOdBtKHgOJPRtCB-UqlO2EJQMtAzV/view?usp=drivesdk",
                "updatedAt": "2024-07-16",
                "sizeOrNote": "MP4 影片 · 5.7 MB"
              }
            ]
          },
          {
            "id": "1SGY88eytz_ApImSbRt28IrhB57NIvjJd",
            "name": "0612斑之花 & 0702斑之花南峰",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1SGY88eytz_ApImSbRt28IrhB57NIvjJd",
            "updatedAt": "2024-07-04",
            "sizeOrNote": "斑芝花高爾夫球場球道測試資料夾",
            "children": [
              {
                "id": "1a640l9KDV0adpiiM810GWQzJ5g2n6hfe",
                "name": "01-1.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1a640l9KDV0adpiiM810GWQzJ5g2n6hfe/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 171 KB"
              },
              {
                "id": "1Nv5DUBCLVZhFlKBnJ16DW5EljAZxLmYJ",
                "name": "01-2.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1Nv5DUBCLVZhFlKBnJ16DW5EljAZxLmYJ/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 179 KB"
              },
              {
                "id": "1Ce8-k9gPsTfyjk1WVqWDjAtr2jMedCG-",
                "name": "01-3.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1Ce8-k9gPsTfyjk1WVqWDjAtr2jMedCG-/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 169 KB"
              },
              {
                "id": "1KDIHseWESsv0LSz-LbhrjQryEC0X3jkk",
                "name": "01-4.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1KDIHseWESsv0LSz-LbhrjQryEC0X3jkk/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 187 KB"
              },
              {
                "id": "1x5d6EHExTZp4EO01PTF7qqdS_hD_-R6H",
                "name": "04-1.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1x5d6EHExTZp4EO01PTF7qqdS_hD_-R6H/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 168 KB"
              },
              {
                "id": "1M9LjDjYW5s6Q-6vvnQoUM5E-5ZVwEQmv",
                "name": "04-2.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1M9LjDjYW5s6Q-6vvnQoUM5E-5ZVwEQmv/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 162 KB"
              },
              {
                "id": "1rE1q1c5a2VPVIlkr-VwcjJy6NCOXEnPe",
                "name": "04-3.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1rE1q1c5a2VPVIlkr-VwcjJy6NCOXEnPe/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 176 KB"
              },
              {
                "id": "1eq0CDcZXyG4zseZWX_SFmMGvjXASUKsc",
                "name": "04-4.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1eq0CDcZXyG4zseZWX_SFmMGvjXASUKsc/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 176 KB"
              },
              {
                "id": "1eWm-MXHVvReKZG8xkFfn-K0ZnUmUO_xG",
                "name": "11-1.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1eWm-MXHVvReKZG8xkFfn-K0ZnUmUO_xG/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 190 KB"
              },
              {
                "id": "1qbn6ni33WC48pVDd5I8axXBBrH1R23ls",
                "name": "11-2.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1qbn6ni33WC48pVDd5I8axXBBrH1R23ls/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 152 KB"
              },
              {
                "id": "1_ZLsCiQluC-HOBVuw2Ao9IjFQUsGCGSI",
                "name": "11-3.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1_ZLsCiQluC-HOBVuw2Ao9IjFQUsGCGSI/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 152 KB"
              },
              {
                "id": "1YBxSYDGDD25ikNCWXdt6oJOHnPzlQ-0a",
                "name": "11-4.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1YBxSYDGDD25ikNCWXdt6oJOHnPzlQ-0a/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 160 KB"
              },
              {
                "id": "1mWc2ei8C7u7AtL8-v6MQVDYgY6Jiri3N",
                "name": "12-1.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1mWc2ei8C7u7AtL8-v6MQVDYgY6Jiri3N/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 164 KB"
              },
              {
                "id": "1qOgHJRJjypEgFLsSSiUbTLW6kx-HOnVE",
                "name": "12-2.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1qOgHJRJjypEgFLsSSiUbTLW6kx-HOnVE/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 157 KB"
              },
              {
                "id": "14vUWlLFC7FwfqpxXecvuh8_8C9oXfBpU",
                "name": "12-3.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/14vUWlLFC7FwfqpxXecvuh8_8C9oXfBpU/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 167 KB"
              },
              {
                "id": "1fyBU52qvYQhPHWaIWFI8wvaPBEj11jcH",
                "name": "12-4.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1fyBU52qvYQhPHWaIWFI8wvaPBEj11jcH/view?usp=drivesdk",
                "updatedAt": "2024-06-13",
                "sizeOrNote": "JPG 圖檔 · 165 KB"
              }
            ]
          },
          {
            "id": "1Q2GA85BuLVM_I0d7N3GyM9C4QWdqFP9y",
            "name": "0614台北港",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1Q2GA85BuLVM_I0d7N3GyM9C4QWdqFP9y",
            "updatedAt": "2024-06-17",
            "sizeOrNote": "台北港場域測試紀錄",
            "children": [
              {
                "id": "16zpQYaebzmhci4A16rk4QagP-qzCP3ke",
                "name": "08-01.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/16zpQYaebzmhci4A16rk4QagP-qzCP3ke/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 204 KB"
              },
              {
                "id": "1tL2V_vFfNFrFTjgzqUgesRjhzUhIpVuL",
                "name": "08-02.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1tL2V_vFfNFrFTjgzqUgesRjhzUhIpVuL/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 221 KB"
              },
              {
                "id": "1_E7Ln91rd_XluPRnO3sds3gmuV0RvyRQ",
                "name": "08-03.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1_E7Ln91rd_XluPRnO3sds3gmuV0RvyRQ/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 221 KB"
              },
              {
                "id": "1RDXIMDFXeXw9JsxNfujCEhtByk12LlpY",
                "name": "08-04.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1RDXIMDFXeXw9JsxNfujCEhtByk12LlpY/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 170 KB"
              },
              {
                "id": "1ie0xnLfs0H8NLN-2_rc1cGVSZTptiPHT",
                "name": "09-01.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1ie0xnLfs0H8NLN-2_rc1cGVSZTptiPHT/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 203 KB"
              },
              {
                "id": "1mO88YFSu2iSGaToEdwjrn3Mq7f6z6wCK",
                "name": "09-02.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1mO88YFSu2iSGaToEdwjrn3Mq7f6z6wCK/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 201 KB"
              },
              {
                "id": "18P4khNd7rWxRxiK5oAN52gEvmnT3QuzE",
                "name": "09-03.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/18P4khNd7rWxRxiK5oAN52gEvmnT3QuzE/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 201 KB"
              },
              {
                "id": "1Ls9mdIdKkBMELj9b7WbSYizX688SyWTg",
                "name": "09-04.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1Ls9mdIdKkBMELj9b7WbSYizX688SyWTg/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 221 KB"
              },
              {
                "id": "11Szq54-1fzTiHNV5UBtCQNcX_94aTh6b",
                "name": "10-01.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/11Szq54-1fzTiHNV5UBtCQNcX_94aTh6b/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 204 KB"
              },
              {
                "id": "1f3xTBUVJMuaS_ZGpYWFUbPwCmgXesEvX",
                "name": "10-02.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1f3xTBUVJMuaS_ZGpYWFUbPwCmgXesEvX/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 211 KB"
              },
              {
                "id": "1H59MCJH5w2hziaKk36oqqzXIFb9Yqn6f",
                "name": "10-03.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1H59MCJH5w2hziaKk36oqqzXIFb9Yqn6f/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 196 KB"
              },
              {
                "id": "1ejyJmSinnE3FgOjmmPMPo_ipfg4hg5HH",
                "name": "10-04.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1ejyJmSinnE3FgOjmmPMPo_ipfg4hg5HH/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 230 KB"
              },
              {
                "id": "1JnQKXuxV81mdwGI2DXMJQ32LoMbdKens",
                "name": "16-01.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1JnQKXuxV81mdwGI2DXMJQ32LoMbdKens/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 201 KB"
              },
              {
                "id": "1kgSXj5gUWRnk6q1VqaXSqDrnDIJ5cxiW",
                "name": "16-02.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1kgSXj5gUWRnk6q1VqaXSqDrnDIJ5cxiW/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 209 KB"
              },
              {
                "id": "1dsPBNID6DwiuzFSsIhdtFmYn3OSOt6G_",
                "name": "16-03.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1dsPBNID6DwiuzFSsIhdtFmYn3OSOt6G_/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 207 KB"
              },
              {
                "id": "1EsCyuqGbIq3UvfoCu0jWmZNoJ2vqoQsh",
                "name": "16-04.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1EsCyuqGbIq3UvfoCu0jWmZNoJ2vqoQsh/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 218 KB"
              },
              {
                "id": "1S0o1OeV_wFJUqDtMNJ-WapHhn5Sqlm9w",
                "name": "17-01.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1S0o1OeV_wFJUqDtMNJ-WapHhn5Sqlm9w/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 214 KB"
              },
              {
                "id": "1IiT2P78dD8V720f_OTFB6VAhKAZwz69Q",
                "name": "17-02.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1IiT2P78dD8V720f_OTFB6VAhKAZwz69Q/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 205 KB"
              },
              {
                "id": "184ushfSGEZfGhUZ3OyVCEMsrKIFLdh-1",
                "name": "17-03.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/184ushfSGEZfGhUZ3OyVCEMsrKIFLdh-1/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 206 KB"
              },
              {
                "id": "1d0YB_6XJrVY82if73OBEZM9nxlMfBMuv",
                "name": "17-04.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1d0YB_6XJrVY82if73OBEZM9nxlMfBMuv/view?usp=drivesdk",
                "updatedAt": "2024-06-17",
                "sizeOrNote": "JPG 圖檔 · 194 KB"
              }
            ]
          },
          {
            "id": "1LWjGnO5ToxuqXN88I9UcnDjiVtAD1ANc",
            "name": "1.0智慧球車產品文件_v5_20240905.pdf",
            "kind": "pdf",
            "driveUrl": "https://drive.google.com/file/d/1LWjGnO5ToxuqXN88I9UcnDjiVtAD1ANc/view?usp=drivesdk",
            "updatedAt": "2024-09-05",
            "sizeOrNote": "PDF · 905 KB · 1.0 智慧球車完整產品規格書 v5"
          },
          {
            "id": "1hMhSEM67AmrAMoXnZ49li03yACW1mRG3",
            "name": "1.0智慧球車產品文件_v5_20240905_球場須知維護保養建議.pdf",
            "kind": "pdf",
            "driveUrl": "https://drive.google.com/file/d/1hMhSEM67AmrAMoXnZ49li03yACW1mRG3/view?usp=drivesdk",
            "updatedAt": "2024-09-05",
            "sizeOrNote": "PDF · 334 KB · 球場維運與保養 SOP 手冊"
          },
          {
            "id": "1qXB6QqYWNnNiUczPhuzHg96qCisRb1hq",
            "name": "智慧球車車輛狀態及系統點交表_20240627調整簽名欄.docx",
            "kind": "document",
            "driveUrl": "https://docs.google.com/document/d/1qXB6QqYWNnNiUczPhuzHg96qCisRb1hq/edit",
            "updatedAt": "2024-08-21",
            "sizeOrNote": "Word · 43 KB · 正式交付點交簽認表單"
          }
        ]
      },
      {
        "id": "2024-htc-kaohsiung-port",
        "code": "HTC-KHP",
        "name": "HTC 高港自駕車（高雄港 5G 智慧港灣自駕專案）",
        "startYear": 2024,
        "period": "2024 Q1 – 2024 Q4",
        "department": "客戶專案執行 / 交通行動服務部",
        "sharedDriveName": "HTC高港自駕車",
        "status": "completed",
        "summary": "與 HTC 合作於高雄港區導入 5G 智慧自駕接駁與巡檢載具，包含 2024/01/29 高雄港區實地場勘紀錄、待確認事項簡報與專案執行資料夾。",
        "highlights": [
          "20240129_智駕車場勘紀錄.pptx",
          "1月29日高雄場勘待確認事項_0131.pptx",
          "3_客戶專案執行 > HTC高港自駕車"
        ],
        "driveFolderId": "16IuZudQ1fQqGpE35CqRpINvobiqpIHIx",
        "driveFolderUrl": "https://drive.google.com/drive/folders/16IuZudQ1fQqGpE35CqRpINvobiqpIHIx",
        "files": [
          {
            "id": "12x6d86fqeIde5mWzspLUixjBBNsbSwF4",
            "name": "20240129_智駕車場勘紀錄.pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/12x6d86fqeIde5mWzspLUixjBBNsbSwF4/edit",
            "updatedAt": "2024-01-30",
            "sizeOrNote": "簡報 · 9.1 MB · 高雄港實地路線與環境場勘報告"
          },
          {
            "id": "15-2fisPDM-6DccISZsKeiWhg29BV-pz6",
            "name": "1月29日高雄場勘待確認事項_0131 .pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/15-2fisPDM-6DccISZsKeiWhg29BV-pz6/edit",
            "updatedAt": "2024-02-02",
            "sizeOrNote": "簡報 · 11.8 MB · 港區工程介面與待確認議題清單"
          },
          {
            "id": "1Bkv9CRYJnBMXXzyVVYbJAmNLZ3fYjRWm",
            "name": "3_客戶專案執行 > HTC高港自駕車（專案執行主目錄）",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1Bkv9CRYJnBMXXzyVVYbJAmNLZ3fYjRWm",
            "updatedAt": "2024-12",
            "sizeOrNote": "專案管理、里程碑交付與客戶簽收文件",
            "children": [
              {
                "id": "12x6d86fqeIde5mWzspLUixjBBNsbSwF4",
                "name": "20240129_智駕車場勘紀錄.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/12x6d86fqeIde5mWzspLUixjBBNsbSwF4/edit",
                "updatedAt": "2024-01-31",
                "sizeOrNote": "簡報 · 40.9 MB · 高雄港實地路線與通訊場勘紀錄"
              },
              {
                "id": "15-2fisPDM-6DccISZsKeiWhg29BV-pz6",
                "name": "1月29日高雄場勘待確認事項_0131 .pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/15-2fisPDM-6DccISZsKeiWhg29BV-pz6/edit",
                "updatedAt": "2024-02-01",
                "sizeOrNote": "簡報 · 2.5 MB · 場勘後技術介面與待確認事項清單"
              }
            ]
          }
        ]
      },
      {
        "id": "2024-jetro-miyakojima",
        "code": "JP-JETRO",
        "name": "1.[專案] JETRO 日本宮古島自動駕駛示範案",
        "startYear": 2024,
        "period": "2024 – 2025",
        "department": "國際市場開發 / BD-Tokyo Drift",
        "sharedDriveName": "BD-Tokyo Drift",
        "status": "completed",
        "summary": "日本貿易振興機構（JETRO）合作推進之沖繩縣宮古島市自動駕駛示範計畫，完整收錄宮古島市役所自動駕駛說明簡報、手機叫車服務、車載 HMI 日文版操作說明書、預算表與車輛健檢報告。",
        "highlights": [
          "宮古島市説明用自動運転202501.pptx & 宮古島路徑、影片、照片.pptx",
          "HMI（修正）日文版操作說明+Xtran_20241104_jp.pptx",
          "1206藉由手機達成叫車服務.pptx & 車輛健檢檢測項目檢查報告0918.xlsx"
        ],
        "driveFolderId": "16Aq9l_MXIRyVHeQ5Kvf16YBxaEbxbDOR",
        "driveFolderUrl": "https://drive.google.com/drive/folders/16Aq9l_MXIRyVHeQ5Kvf16YBxaEbxbDOR",
        "files": [
          {
            "id": "1siZY3jAUn-DpQm2tAkU_OQ0Kda_0Rlwv",
            "name": "宮古島市説明用自動運転202501.pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/1siZY3jAUn-DpQm2tAkU_OQ0Kda_0Rlwv/edit",
            "updatedAt": "2025-01",
            "sizeOrNote": "簡報 · 84.6 MB · 向日本宮古島市政府簡報之自動駕駛方案"
          },
          {
            "id": "1jjEr2TDAajZXJTCh2v6_YCWJcfqG8eV7",
            "name": "HMI （修正）日文版操作說明+Xtran_20241104_jp.pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/1jjEr2TDAajZXJTCh2v6_YCWJcfqG8eV7/edit",
            "updatedAt": "2024-11-04",
            "sizeOrNote": "簡報 · 20.3 MB · 車載 HMI 日文版操作手冊"
          },
          {
            "id": "1Q8pyCO0Jtm3Nu_PcKO0rQt8IlLplnPR_",
            "name": "1206藉由手機達成叫車服務.pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/1Q8pyCO0Jtm3Nu_PcKO0rQt8IlLplnPR_/edit",
            "updatedAt": "2024-12-06",
            "sizeOrNote": "簡報 · 187 KB · 手機預約叫車與派遣流程說明"
          },
          {
            "id": "119ucgyVuG4-lzg-w8wXKHYhGt50_PmRV",
            "name": "宮古島路徑、影片、照片.pptx",
            "kind": "presentation",
            "driveUrl": "https://docs.google.com/presentation/d/119ucgyVuG4-lzg-w8wXKHYhGt50_PmRV/edit",
            "updatedAt": "2024-11",
            "sizeOrNote": "簡報 · 425 MB · 宮古島實地運行路線影像紀錄"
          },
          {
            "id": "1UTamjj95gLo_9xhvY4H3v2Pz_Zgh7i68",
            "name": "營收及研發專案預算表_Jetro 20241018.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/1UTamjj95gLo_9xhvY4H3v2Pz_Zgh7i68/edit",
            "updatedAt": "2024-10-18",
            "sizeOrNote": "試算表 · 218 KB · JETRO 專案營收與研發預算表",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ]
          },
          {
            "id": "1Y38CzwYD5OKQd9E2PVne1H7P0JY4Uq41",
            "name": "車輛健檢檢測項目檢查報告0918.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/1Y38CzwYD5OKQd9E2PVne1H7P0JY4Uq41/edit",
            "updatedAt": "2024-09-18",
            "sizeOrNote": "試算表 · 1.5 MB · 出車前全車健檢檢測報告"
          },
          {
            "id": "1eTc13a7A-t-TS1cYQbHkEuucO6LDKKhu",
            "name": "TuringDrive-Demo project DM.pdf",
            "kind": "pdf",
            "driveUrl": "https://drive.google.com/file/d/1eTc13a7A-t-TS1cYQbHkEuucO6LDKKhu/view?usp=drivesdk",
            "updatedAt": "2024-10",
            "sizeOrNote": "PDF · 510 KB · 日本展演用宣傳 DM"
          }
        ]
      },
      {
        "id": "2024-eve-autobal",
        "code": "EVE-BAL",
        "name": "EVE Auto-BAL 專案",
        "startYear": 2024,
        "period": "2024",
        "department": "客戶專案執行 / 研發部",
        "sharedDriveName": "專案執行",
        "status": "completed",
        "summary": "EVE Auto-BAL 自動駕駛載具控制與系統整合專案，包含底盤通訊協定、感測器校準與場域測試資料。",
        "highlights": [
          "Auto-BAL 系統架構與控制介面",
          "實車測試與驗收紀錄"
        ],
        "driveFolderId": "1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r",
        "files": [
          {
            "id": "1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r",
            "name": "3_客戶專案執行 > EVE Auto-BAL",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r",
            "updatedAt": "2024-08",
            "sizeOrNote": "專案規格書與測試報告",
            "children": [
              {
                "id": "1oRyrSn6IBRV5mn-nYpg2VZG2fsVhQiB-",
                "name": "所有過往文件",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1oRyrSn6IBRV5mn-nYpg2VZG2fsVhQiB-",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1ALLDALbgy_Z5efIbJeCpVKJ63xboZo87",
                    "name": "0326TD feedback",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ALLDALbgy_Z5efIbJeCpVKJ63xboZo87",
                    "updatedAt": "2026-03-09",
                    "children": [
                      {
                        "id": "1vqCKrZ8miXsmp3GSxjuTTNzF41lsUGeA",
                        "name": "ADS-0326",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1vqCKrZ8miXsmp3GSxjuTTNzF41lsUGeA",
                        "updatedAt": "2026-03-09",
                        "children": []
                      },
                      {
                        "id": "1PY59GXlvhRkAx2mrWZqazUagc9IjoghM",
                        "name": "VD-0326",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1PY59GXlvhRkAx2mrWZqazUagc9IjoghM",
                        "updatedAt": "2026-03-09",
                        "children": []
                      },
                      {
                        "id": "1WZ2DWtKXO2RG7YdkG6auDfStn49eRyrb",
                        "name": ".DS_Store",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1WZ2DWtKXO2RG7YdkG6auDfStn49eRyrb/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "文件 · 6 KB"
                      }
                    ]
                  },
                  {
                    "id": "1_1cBkGfL-IWGkPTiT1ClTSPLfdaAsrib",
                    "name": "0508BAL proposal.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1_1cBkGfL-IWGkPTiT1ClTSPLfdaAsrib/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 4.0 MB"
                  },
                  {
                    "id": "1X9Ng1uPLuVqxJj6F_XHOcrIdYsvkjFn1",
                    "name": "[TD]BAL proposal-0508.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1X9Ng1uPLuVqxJj6F_XHOcrIdYsvkjFn1/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 4.0 MB"
                  },
                  {
                    "id": "1HFavuX7rj1yvCIzo5KXmOndJZcgF943Y",
                    "name": "[TuringDrive] BAL proposal0503.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1HFavuX7rj1yvCIzo5KXmOndJZcgF943Y/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 3.8 MB"
                  },
                  {
                    "id": "1SJ1Remg_RLWANysCIjYgYbryVkoLTEcf",
                    "name": "BAL proposal 0524.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1SJ1Remg_RLWANysCIjYgYbryVkoLTEcf/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 4.3 MB"
                  },
                  {
                    "id": "122EgQJzOfg5Wv4WAiIvoBhZY-ssaLkW1",
                    "name": "eve auto visit.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/122EgQJzOfg5Wv4WAiIvoBhZY-ssaLkW1/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "試算表 · 19 KB"
                  },
                  {
                    "id": "1p5DzUloO3hZexap-ekP5OhXRsjdFuC6c",
                    "name": "EVE auto-mtg notes 20240311.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1p5DzUloO3hZexap-ekP5OhXRsjdFuC6c/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 238 KB"
                  },
                  {
                    "id": "1dBVN1mZp-3wpuGyT6PouEWpR8NapPpsz",
                    "name": "HOSHINO 特典.ai",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1dBVN1mZp-3wpuGyT6PouEWpR8NapPpsz/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 16.6 MB"
                  },
                  {
                    "id": "1-QP8Youu_caoV1UHEy_JO4Xca2d_4dQR",
                    "name": "Sample_ODD.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1-QP8Youu_caoV1UHEy_JO4Xca2d_4dQR/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "試算表 · 17 KB"
                  },
                  {
                    "id": "1GlhFZ4kNeeiwWExo9_E9-31r1-ahkJZe",
                    "name": "Tech team CV(henry, nick).docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1GlhFZ4kNeeiwWExo9_E9-31r1-ahkJZe/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "Word · 1.5 MB"
                  },
                  {
                    "id": "1IHgqW14SVAVhq430ip7PJfFokbYfLxSQ",
                    "name": "Turing_Eve_Discussion_Paper_20231201_vf.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1IHgqW14SVAVhq430ip7PJfFokbYfLxSQ/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 2.0 MB"
                  },
                  {
                    "id": "1JZSva5wN-SYEWRFFIpd0Gtqsweo2z4rw",
                    "name": "車輛資訊_Eveauto_EN.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1JZSva5wN-SYEWRFFIpd0Gtqsweo2z4rw/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "PDF · 5.9 MB"
                  }
                ]
              },
              {
                "id": "1Ga7zNVvq32w96DDc-9QqIZW47_banxzs",
                "name": "郵件往來",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1Ga7zNVvq32w96DDc-9QqIZW47_banxzs",
                "updatedAt": "2026-03-09",
                "children": [
                  {
                    "id": "1UavBe3Ssdrr_mHBo_NXrRo332YB3sf8W",
                    "name": "回信",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1UavBe3Ssdrr_mHBo_NXrRo332YB3sf8W",
                    "updatedAt": "2026-03-09",
                    "children": [
                      {
                        "id": "1Tlj0K_k15GgOIhGZeH1DIhQ6naDN2Sws",
                        "name": "回覆_ [Turing Drive]教具車教學安排.eml",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1Tlj0K_k15GgOIhGZeH1DIhQ6naDN2Sws/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "文件 · 3.5 MB"
                      },
                      {
                        "id": "19VY7Tu-tW4nAU3yjowgIFoPG9WnPx427",
                        "name": "回覆_ [TuringDrive] Reference Materials for Autonomous Driving Functions.eml",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/19VY7Tu-tW4nAU3yjowgIFoPG9WnPx427/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "文件 · 7.6 MB"
                      },
                      {
                        "id": "1lj0tKpryWHTTv2VbZcT4bBgKDpf5Vajz",
                        "name": "回覆_ 御社との基本契約について.eml",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1lj0tKpryWHTTv2VbZcT4bBgKDpf5Vajz/view?usp=drivesdk",
                        "updatedAt": "2026-03-09",
                        "sizeOrNote": "文件 · 445 KB"
                      }
                    ]
                  },
                  {
                    "id": "1Ze_pwlTPqa4QYaWaTdtWD4xRTnKW01ZZ",
                    "name": "Re_ [TuringDrive] Reference Materials for Autonomous Driving Functions.eml",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1Ze_pwlTPqa4QYaWaTdtWD4xRTnKW01ZZ/view?usp=drivesdk",
                    "updatedAt": "2026-03-09",
                    "sizeOrNote": "文件 · 87 KB"
                  }
                ]
              },
              {
                "id": "1AhskbFnVfaf9JROmxIreRxTdKrwBebX5",
                "name": "(EVExTuring)BAL.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1AhskbFnVfaf9JROmxIreRxTdKrwBebX5/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 3.8 MB"
              },
              {
                "id": "1ASfH0QKQnRxJcjtkVnwaUJJVyJMVpBc9",
                "name": "(EVExTuring)BAL_v3.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1ASfH0QKQnRxJcjtkVnwaUJJVyJMVpBc9/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 1.8 MB"
              },
              {
                "id": "1X0Zb2HSt-3JS6KReLjs9XXKjLWdBX9wx",
                "name": "2024-04-08_Turing質問事項+中譯.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1X0Zb2HSt-3JS6KReLjs9XXKjLWdBX9wx/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 152 KB"
              },
              {
                "id": "1T-EhVLREx-YFYF1KRT4_J2NBI-lan4-0",
                "name": "2024-0417_Turing質問事項の回答.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1T-EhVLREx-YFYF1KRT4_J2NBI-lan4-0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 503 KB"
              },
              {
                "id": "1fWa6wnQZ--_yFmAgQuV0KTxxEBphq29q",
                "name": "ADS_Spec_with_EVE_sensors.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1fWa6wnQZ--_yFmAgQuV0KTxxEBphq29q/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 21 KB"
              },
              {
                "id": "1qO5uImCcxs8SKqJSHUFWpEaES9H42tho",
                "name": "BAL proposal(to client).pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1qO5uImCcxs8SKqJSHUFWpEaES9H42tho/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "簡報 · 10.8 MB"
              },
              {
                "id": "12rS6Mth_kY3jzlodDr9bmMl-F8IYhNqb",
                "name": "Estimate_EveAuto_240506.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/12rS6Mth_kY3jzlodDr9bmMl-F8IYhNqb/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 1.6 MB"
              },
              {
                "id": "1IortdGk16quKlzexSUG6V8YvSyKriXle",
                "name": "Eve Antonomy高爾夫球車日本進出口台灣流程+概算報價(for turing).xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1IortdGk16quKlzexSUG6V8YvSyKriXle/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 18 KB",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1S8ih5OXAX5rqp4nQRFxbYYtNWYGgVemZ",
                "name": "工項及時間點0425.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1S8ih5OXAX5rqp4nQRFxbYYtNWYGgVemZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2026-03-09",
                "sizeOrNote": "試算表 · 77 KB"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "year": 2023,
    "label": "2023 年起始專案",
    "tagline": "BigMac Program 核心架構研發、智慧球車 v1.0 / v2.0、亞勁 Robobus、T3 前期規劃",
    "projectOverview": "核心產品化與自駕平台架構升級年：完成 BigMac Program 系統區塊與作動流程設計、智慧高爾夫球車 v1.0 至 v2.0 世代演進、亞勁 Robobus 自駕小巴合作案，以及 T3 專案早期技術評估。",
    "projects": [
      {
        "id": "2023-bigmac-program",
        "code": "RD-BIGMAC",
        "name": "BigMac Program（自駕核心平台架構專案）",
        "startYear": 2023,
        "period": "2022 Q4 – 2023",
        "department": "研發部 | R&D",
        "sharedDriveName": "研發部 | R&D",
        "status": "completed",
        "summary": "Turing Drive 新世代自駕軟硬體平台「BigMac Program」，包含主要系統架構圖、作動流程圖、功能圖、系統區塊圖、網頁認證流程、Milestone 1 驗證與實車 Demo 影片。",
        "highlights": [
          "主要架構圖-系統區塊圖.drawio.png & 作動流程圖.drawio.png",
          "Milestone 1 研發驗證與實車 Demo 資料夾",
          "BigMac 實車展示影片與會議記錄"
        ],
        "driveFolderId": "1cWGdTvKcm8JuXJh22qUuk_6yfq9KMhWW",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1cWGdTvKcm8JuXJh22qUuk_6yfq9KMhWW",
        "files": [
          {
            "id": "1_toGmgOKWI1jGHPl6lVuq51w-aTN4nsV",
            "name": "Milestone 1",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1_toGmgOKWI1jGHPl6lVuq51w-aTN4nsV",
            "updatedAt": "2023-01",
            "sizeOrNote": "第一階段里程碑驗證文件",
            "children": [
              {
                "id": "1sZXZWsrDVqjRr8YISNOl_CLwFFX7I_dM",
                "name": "Layout",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1sZXZWsrDVqjRr8YISNOl_CLwFFX7I_dM",
                "updatedAt": "2023-02-07",
                "children": [
                  {
                    "id": "1Outos9IIeCjrmqHtNrf1CvdjeD4OEKrC",
                    "name": "素材",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Outos9IIeCjrmqHtNrf1CvdjeD4OEKrC",
                    "updatedAt": "2023-02-07",
                    "children": [
                      {
                        "id": "1nM6ObVILGpReReMyXjF8_EtAcToUPvTj",
                        "name": "螢幕擷取畫面 2023-02-07 153527.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1nM6ObVILGpReReMyXjF8_EtAcToUPvTj/view?usp=drivesdk",
                        "updatedAt": "2023-02-07",
                        "sizeOrNote": "PNG 圖檔 · 1.0 MB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1DYWFZW1EpiDMyNKN3T_W7q4Z5AiRwyg4",
                "name": "OLD",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1DYWFZW1EpiDMyNKN3T_W7q4Z5AiRwyg4",
                "updatedAt": "2022-11-16",
                "children": [
                  {
                    "id": "14HzxVSsHfRqZ7YnhXEO_nR4a_GnvngnZ",
                    "name": "PacMan_IOT_V0.1.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/14HzxVSsHfRqZ7YnhXEO_nR4a_GnvngnZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-11-16",
                    "sizeOrNote": "Word · 31 KB"
                  },
                  {
                    "id": "16KODBoNsQ_OMJQD_HvpLyUXhKUy5n5Uz",
                    "name": "PacMan_IOT_V0.2_20221122.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/16KODBoNsQ_OMJQD_HvpLyUXhKUy5n5Uz/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-11-22",
                    "sizeOrNote": "Word · 33 KB"
                  },
                  {
                    "id": "1LSfwDs5m13fssIBbLB-dhtGWDh1YfvjB",
                    "name": "PacMan_IOT_V0.4.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1LSfwDs5m13fssIBbLB-dhtGWDh1YfvjB/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-12-20",
                    "sizeOrNote": "Word · 38 KB"
                  },
                  {
                    "id": "1CcuSA0Jk64-lTeYV9ZZ47M-eP11RaJx8",
                    "name": "PacMan_IOT_V0.5.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1CcuSA0Jk64-lTeYV9ZZ47M-eP11RaJx8/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-12-21",
                    "sizeOrNote": "Word · 36 KB"
                  }
                ]
              },
              {
                "id": "1C1HdTFg49k0zp1i4fq_DkLFcAZBRX3r9",
                "name": "PacMan_IOT_V0.6.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1C1HdTFg49k0zp1i4fq_DkLFcAZBRX3r9/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2023-03-27",
                "sizeOrNote": "Word · 41 KB"
              },
              {
                "id": "1hn3HJA_dFx76_pLB5bZpyU1nqAGpHiAh",
                "name": "PacMan_IOT_V0.7.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1hn3HJA_dFx76_pLB5bZpyU1nqAGpHiAh/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2023-03-28",
                "sizeOrNote": "Word · 42 KB"
              },
              {
                "id": "11uALsmaESJZFdiLqtzJnTjfsaumoGrlN",
                "name": "訊號整理.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/11uALsmaESJZFdiLqtzJnTjfsaumoGrlN/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2023-04-25",
                "sizeOrNote": "試算表 · 35 KB"
              }
            ]
          },
          {
            "id": "124nj5tKn8GlbphE9VrWYZUOv-Gvj85Ur",
            "name": "Demo",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/124nj5tKn8GlbphE9VrWYZUOv-Gvj85Ur",
            "updatedAt": "2023-03-23",
            "sizeOrNote": "BigMac 平台實車展示與測試紀錄",
            "children": [
              {
                "id": "1K2Kid5vPgrxhAADrUaB45raREx9f3BcF",
                "name": "20230323_Demo",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1K2Kid5vPgrxhAADrUaB45raREx9f3BcF",
                "updatedAt": "2023-03-23",
                "children": [
                  {
                    "id": "16pqXWMlecQCHTK2TrSgrXzgfNtqbLX3H",
                    "name": "e9a7b6a5-da3c-4bf3-83e3-a706641b597c.mp4",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/16pqXWMlecQCHTK2TrSgrXzgfNtqbLX3H/view?usp=drivesdk",
                    "updatedAt": "2023-03-23",
                    "sizeOrNote": "MP4 影片 · 716 KB"
                  },
                  {
                    "id": "1cyqY7jthnJHUboSL_t-WOwNhcqEfPqew",
                    "name": "e9a7b6a5-da3c-4bf3-83e3-a706641b597c.webm",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1cyqY7jthnJHUboSL_t-WOwNhcqEfPqew/view?usp=drivesdk",
                    "updatedAt": "2023-03-23",
                    "sizeOrNote": "封存檔 · 381 KB"
                  }
                ]
              }
            ]
          },
          {
            "id": "1c7Ae2MqW_NnaI3UNRdNp1zBf7z93nrAX",
            "name": "BigMac影片",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1c7Ae2MqW_NnaI3UNRdNp1zBf7z93nrAX",
            "updatedAt": "2023-03-30",
            "sizeOrNote": "系統實測影片庫",
            "children": [
              {
                "id": "1CfTty2P6OLgZJBTlEBmQP6ckS0NKa-WQ",
                "name": "recording-2023-03-30-11-21-54.mp4",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1CfTty2P6OLgZJBTlEBmQP6ckS0NKa-WQ/view?usp=drivesdk",
                "updatedAt": "2023-03-30",
                "sizeOrNote": "MP4 影片 · 844 KB"
              },
              {
                "id": "1Y9l0yq8B11Xpz0mwJLgiHK5uoP9K7eKP",
                "name": "recording-2023-03-30-11-21-54.webm",
                "kind": "archive",
                "driveUrl": "https://drive.google.com/file/d/1Y9l0yq8B11Xpz0mwJLgiHK5uoP9K7eKP/view?usp=drivesdk",
                "updatedAt": "2023-03-30",
                "sizeOrNote": "封存檔 · 154 KB"
              }
            ]
          },
          {
            "id": "17vBydfN9IqT9TKYp25pIi15TMQYcZOm-",
            "name": "主要架構圖-作動流程圖.drawio.png",
            "kind": "image",
            "driveUrl": "https://drive.google.com/file/d/17vBydfN9IqT9TKYp25pIi15TMQYcZOm-/view?usp=drivesdk",
            "updatedAt": "2022-12-06",
            "sizeOrNote": "PNG 圖檔 · 964 KB · 系統狀態與作動流程圖"
          },
          {
            "id": "1s-vl9FNlB9Off7nA56OAhU3ESeDzoQEE",
            "name": "主要架構圖-系統區塊圖.drawio.png",
            "kind": "image",
            "driveUrl": "https://drive.google.com/file/d/1s-vl9FNlB9Off7nA56OAhU3ESeDzoQEE/view?usp=drivesdk",
            "updatedAt": "2022-11-22",
            "sizeOrNote": "PNG 圖檔 · 289 KB · 軟硬體模組系統區塊圖"
          },
          {
            "id": "1wOZzTU5lAwmjY_vlmGsDq4VplvVdB9ep",
            "name": "主要架構圖-功能圖.drawio.png",
            "kind": "image",
            "driveUrl": "https://drive.google.com/file/d/1wOZzTU5lAwmjY_vlmGsDq4VplvVdB9ep/view?usp=drivesdk",
            "updatedAt": "2022-11-21",
            "sizeOrNote": "PNG 圖檔 · 480 KB · 核心功能架構圖"
          }
        ]
      },
      {
        "id": "2023-smart-golf-cart",
        "code": "PROD-GOLF",
        "name": "智慧球車 v1.0 & v2.0 產品開發案（含 PaC-Man / SmartKart）",
        "startYear": 2023,
        "period": "2023 Q1 – 2024 Q1",
        "department": "產品開發 / 研發部",
        "sharedDriveName": "SmartKart / 營業部",
        "status": "completed",
        "summary": "自駕高爾夫球車 v1.0 與 v2.0 產品研發專案，整合感知定位、球場專用圖資、車隊管理後台與 SmartKart / PaC-Man 載具平台。",
        "highlights": [
          "智慧球車 v1.0 / v2.0 軟硬體規格",
          "SmartKart 機構與電控設計",
          "PaC-Man 模組化控制單元"
        ],
        "driveFolderId": "1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6",
        "files": [
          {
            "id": "1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6",
            "name": "5_產品開發 > 智慧球車v1.0",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6",
            "updatedAt": "2023-09",
            "sizeOrNote": "第一代智慧球車 BOM、電路與測試報告",
            "children": [
              {
                "id": "1nKhUN3ggmEjqKrkNjiRMhynf2LevV0Wz",
                "name": "golface_sales_case",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1nKhUN3ggmEjqKrkNjiRMhynf2LevV0Wz",
                "updatedAt": "2023-08-31",
                "children": [
                  {
                    "id": "10RS2lFvAFZdLZyjBP6wPPWOo4_xA_dG4",
                    "name": "20211111愛國者V3規格.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/10RS2lFvAFZdLZyjBP6wPPWOo4_xA_dG4/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2023-08-31",
                    "sizeOrNote": "試算表 · 113 KB"
                  },
                  {
                    "id": "17VjoV_QgCfHd75hGgZcBUGIPYsgiIBt-",
                    "name": "20230830_球車智慧系統延長保固費用試算.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/17VjoV_QgCfHd75hGgZcBUGIPYsgiIBt-/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2023-09-05",
                    "sizeOrNote": "試算表 · 23 KB"
                  },
                  {
                    "id": "1Ls8gcsPSLOX-e_AEHfXQ5_G4v1qD87d2",
                    "name": "NRU-110V-AGX32 +AR0147-120 報價單2台_signed.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1Ls8gcsPSLOX-e_AEHfXQ5_G4v1qD87d2/view?usp=drivesdk",
                    "updatedAt": "2023-08-31",
                    "sizeOrNote": "PDF · 685 KB",
                    "accessScope": "confidential",
                    "allowedDepartments": [
                      "營業",
                      "BD",
                      "財務",
                      "總經理"
                    ],
                    "allowedRoles": [
                      "admin",
                      "finance"
                    ]
                  },
                  {
                    "id": "1mkPePkqt-bkJaAIct0cQGiA_eOlFLmPv",
                    "name": "PI--台灣智慧駕駛--220524001_16顆1612不含天線.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1mkPePkqt-bkJaAIct0cQGiA_eOlFLmPv/view?usp=drivesdk",
                    "updatedAt": "2023-08-31",
                    "sizeOrNote": "PDF · 463 KB"
                  },
                  {
                    "id": "1cJF_89KuASpy74wpT31YNKQcqBHa32VM",
                    "name": "球車BOM細項完整版(宸耀+L2controller).xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1cJF_89KuASpy74wpT31YNKQcqBHa32VM/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2023-09-01",
                    "sizeOrNote": "試算表 · 193 KB"
                  }
                ]
              },
              {
                "id": "1DTiNNTCR-6Wst228-9KfvXmvI_bMfhC6",
                "name": "lifeplus",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1DTiNNTCR-6Wst228-9KfvXmvI_bMfhC6",
                "updatedAt": "2022-12-13",
                "children": [
                  {
                    "id": "1bZRy91kcsQy3OLntT_52YKyVUsFwz2de",
                    "name": "租借QrCode",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1bZRy91kcsQy3OLntT_52YKyVUsFwz2de",
                    "updatedAt": "2022-12-19",
                    "children": [
                      {
                        "id": "16Xp8sm-6Swd-Xdu9LTt6i0rqLOerQaVQ",
                        "name": "google好用的試算表唷.url",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/16Xp8sm-6Swd-Xdu9LTt6i0rqLOerQaVQ/view?usp=drivesdk",
                        "updatedAt": "2022-12-13",
                        "sizeOrNote": "文件 · 193 B"
                      },
                      {
                        "id": "1Iu0RjIQQ0tV0HxLQsFm4Q5lIVr1gKXAJ",
                        "name": "Qrcode_argoyc_smartkart_11_12.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1Iu0RjIQQ0tV0HxLQsFm4Q5lIVr1gKXAJ/view?usp=drivesdk",
                        "updatedAt": "2022-12-13",
                        "sizeOrNote": "PDF · 30 KB"
                      },
                      {
                        "id": "1jg-Af-jxhOzPcptWQ_zV0BLn8LxbSZrL",
                        "name": "smartkart_qrcode.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1jg-Af-jxhOzPcptWQ_zV0BLn8LxbSZrL/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-13",
                        "sizeOrNote": "試算表 · 146 KB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1FZdZqF0q9h-Xvt0TO-U-o8P3E5WBw-7Y",
                "name": "Release Note",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1FZdZqF0q9h-Xvt0TO-U-o8P3E5WBw-7Y",
                "updatedAt": "2022-02-16",
                "children": [
                  {
                    "id": "1jF1b-75id8l-wWarFD5T15T6oovOUwQN",
                    "name": "軟體版本說明",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1jF1b-75id8l-wWarFD5T15T6oovOUwQN",
                    "updatedAt": "2022-02-22",
                    "children": [
                      {
                        "id": "1ln7lxH1aVTYBS444JRzJOlIcAdEx9Pf6",
                        "name": "Open Notebook.onetoc2",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1ln7lxH1aVTYBS444JRzJOlIcAdEx9Pf6/view?usp=drivesdk",
                        "updatedAt": "2022-02-22",
                        "sizeOrNote": "文件 · 4 KB"
                      },
                      {
                        "id": "1HYjI-EbLhQLioTtzB8aAABhvwszMZUbk",
                        "name": "未命名節.one",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1HYjI-EbLhQLioTtzB8aAABhvwszMZUbk/view?usp=drivesdk",
                        "updatedAt": "2022-02-22",
                        "sizeOrNote": "文件 · 22 KB"
                      }
                    ]
                  },
                  {
                    "id": "1egH42wR85g8BHdZJOfxZkRFDXGBWyXfe",
                    "name": "20220221_Smtc_NanFeng_ReleaseNote.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1egH42wR85g8BHdZJOfxZkRFDXGBWyXfe/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-02-23",
                    "sizeOrNote": "Word · 256 KB"
                  },
                  {
                    "id": "1c0sz15M1ZDS6bH6CCnM_3uzlTBhSdlvN",
                    "name": "20220318_Smtc_NanFeng_ReleaseNote.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1c0sz15M1ZDS6bH6CCnM_3uzlTBhSdlvN/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-06-21",
                    "sizeOrNote": "Word · 256 KB"
                  }
                ]
              },
              {
                "id": "15rxaZd_Q64vQa1u9uHGPJU5oiuT5FcPV",
                "name": "Scrum",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/15rxaZd_Q64vQa1u9uHGPJU5oiuT5FcPV",
                "updatedAt": "2022-09-26",
                "children": [
                  {
                    "id": "1bzude1AXp3ywdWvis_umjfpacQ1uBxNQ",
                    "name": "1.X time line",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1bzude1AXp3ywdWvis_umjfpacQ1uBxNQ",
                    "updatedAt": "2022-11-17",
                    "children": [
                      {
                        "id": "1BqRdsXHu7icNje6w5pl3yAaeY2AmCfsL",
                        "name": "time_line_and_human_resource_argo.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1BqRdsXHu7icNje6w5pl3yAaeY2AmCfsL/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-19",
                        "sizeOrNote": "簡報 · 134 KB"
                      },
                      {
                        "id": "1vzl6vA3YvWDSoSGmRS0S3fKiu7-ofT88",
                        "name": "time_line_and_human_resource_lifeplis.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1vzl6vA3YvWDSoSGmRS0S3fKiu7-ofT88/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-20",
                        "sizeOrNote": "簡報 · 146 KB"
                      }
                    ]
                  },
                  {
                    "id": "1pZHYYxgG81qZWQzSolabDelsgMTlH-dp",
                    "name": "smart with golface",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1pZHYYxgG81qZWQzSolabDelsgMTlH-dp",
                    "updatedAt": "2022-10-17",
                    "children": [
                      {
                        "id": "1cmZx6u7CwhxUcDFPzR7F3g5DKPp7NN7C",
                        "name": "1.車輛投放與生產排程",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1cmZx6u7CwhxUcDFPzR7F3g5DKPp7NN7C",
                        "updatedAt": "2022-09-28",
                        "children": []
                      },
                      {
                        "id": "1ydZ7sFPAeIzM2pu2-8tyCGO_nqTA60pZ",
                        "name": "[G-smartKart]Spec",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1ydZ7sFPAeIzM2pu2-8tyCGO_nqTA60pZ",
                        "updatedAt": "2022-10-04",
                        "children": []
                      },
                      {
                        "id": "1X-JL8jK3UAV2Vxp4VKwUQHliR3oeBrdo",
                        "name": "HMI",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1X-JL8jK3UAV2Vxp4VKwUQHliR3oeBrdo",
                        "updatedAt": "2022-09-29",
                        "children": []
                      },
                      {
                        "id": "1hpKMdLO7uXdwK77zNx8bgj-rhXvYcZ_B",
                        "name": "其他文件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1hpKMdLO7uXdwK77zNx8bgj-rhXvYcZ_B",
                        "updatedAt": "2022-10-04",
                        "children": []
                      },
                      {
                        "id": "1WzwXL9-VftZ9tVs-DjZM9iQajDjy3HHe",
                        "name": "技術文件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1WzwXL9-VftZ9tVs-DjZM9iQajDjy3HHe",
                        "updatedAt": "2022-10-03",
                        "children": []
                      },
                      {
                        "id": "1eyQfmUKKYtFsjnEwua0vb2KEot_XKg5y",
                        "name": "會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1eyQfmUKKYtFsjnEwua0vb2KEot_XKg5y",
                        "updatedAt": "2022-10-04",
                        "children": []
                      },
                      {
                        "id": "18Kdyg7COdts3Cvv8HFJfFnUaMzvb8cy4",
                        "name": "車隊管理系統",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/18Kdyg7COdts3Cvv8HFJfFnUaMzvb8cy4",
                        "updatedAt": "2022-10-04",
                        "children": []
                      },
                      {
                        "id": "1r7aLJKBHLlZxXYD65EWoOtA-S040Owfk",
                        "name": "1.X功能列表及開發狀況.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1r7aLJKBHLlZxXYD65EWoOtA-S040Owfk/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-09-28",
                        "sizeOrNote": "簡報 · 1.0 MB"
                      },
                      {
                        "id": "1QCf5Tj3U-P-HROelHbL7v6P-WppZwHEU",
                        "name": "人員及分工列表.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1QCf5Tj3U-P-HROelHbL7v6P-WppZwHEU/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-10-17",
                        "sizeOrNote": "Word · 22 KB"
                      }
                    ]
                  },
                  {
                    "id": "1SIRQzfhpFW35NSKFEnDscS9ZWSr347hT",
                    "name": "smartkart with argo",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1SIRQzfhpFW35NSKFEnDscS9ZWSr347hT",
                    "updatedAt": "2022-12-09",
                    "children": [
                      {
                        "id": "1r4d3mL4rvEhr4HjK4QJ_zcRysaIyNrUz",
                        "name": "亞果驗收",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1r4d3mL4rvEhr4HjK4QJ_zcRysaIyNrUz",
                        "updatedAt": "2022-12-09",
                        "children": []
                      },
                      {
                        "id": "1z3pJg96BAZ-Sre8G5ygBromdC5DRQz87",
                        "name": "出差",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1z3pJg96BAZ-Sre8G5ygBromdC5DRQz87",
                        "updatedAt": "2022-12-19",
                        "children": []
                      },
                      {
                        "id": "15CP3d0lQ0q8n5l5yFUU2fFTjrHbDZv86",
                        "name": "技術文件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/15CP3d0lQ0q8n5l5yFUU2fFTjrHbDZv86",
                        "updatedAt": "2023-02-13",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1jMIsoUxQE9jI99t9xugOaDex6e2QepkG",
                    "name": "smartkart1.5",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1jMIsoUxQE9jI99t9xugOaDex6e2QepkG",
                    "updatedAt": "2023-04-07",
                    "children": [
                      {
                        "id": "13zUhNyW6U-77fEC2GHpdqluigo91nE02",
                        "name": "smartkart_argo_architecture_copy.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/13zUhNyW6U-77fEC2GHpdqluigo91nE02/view?usp=drivesdk",
                        "updatedAt": "2023-04-07",
                        "sizeOrNote": "文件 · 10 KB"
                      },
                      {
                        "id": "196VJjIwW4PXkdKE9cNlHruFkaBECGcVG",
                        "name": "智慧球車1.5規劃.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/196VJjIwW4PXkdKE9cNlHruFkaBECGcVG/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-04-07",
                        "sizeOrNote": "Word · 31 KB"
                      },
                      {
                        "id": "1MGvk3OB2xAeePteaa0rasBti0Z7nsq3a",
                        "name": "照片拆解.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1MGvk3OB2xAeePteaa0rasBti0Z7nsq3a/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-04-07",
                        "sizeOrNote": "簡報 · 61 KB"
                      }
                    ]
                  },
                  {
                    "id": "1b0hIJYIjuz_SVa90f0kSB7l-cQefuXzW",
                    "name": "test_record",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1b0hIJYIjuz_SVa90f0kSB7l-cQefuXzW",
                    "updatedAt": "2022-11-21",
                    "children": [
                      {
                        "id": "1rTMiBO7yYokJWoYjAL-6_N_5-vJBiE6B",
                        "name": "20221111_台北港出差測試no entry",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1rTMiBO7yYokJWoYjAL-6_N_5-vJBiE6B",
                        "updatedAt": "2023-01-12",
                        "children": []
                      },
                      {
                        "id": "1uC1b-_DbJOZsyS2OMOY5mzkRz-WiQLML",
                        "name": "出差紀錄測試相關頁面.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1uC1b-_DbJOZsyS2OMOY5mzkRz-WiQLML/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-11-23",
                        "sizeOrNote": "Word · 26 KB"
                      }
                    ]
                  },
                  {
                    "id": "1eDWxmGbhWKNkyCBtFIyQm9TdCQALA7HU",
                    "name": "1.X拆解.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1eDWxmGbhWKNkyCBtFIyQm9TdCQALA7HU/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-12-22",
                    "sizeOrNote": "簡報 · 78 KB"
                  },
                  {
                    "id": "1784xxv-W2u-XG_p7StOV3pQNm87vcEYA",
                    "name": "亞果拆解.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1784xxv-W2u-XG_p7StOV3pQNm87vcEYA/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-12-05",
                    "sizeOrNote": "簡報 · 59 KB"
                  }
                ]
              },
              {
                "id": "1YszmgvfQK5kRuav27TYig-HxaHP_Q50Z",
                "name": "出差測試項目",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1YszmgvfQK5kRuav27TYig-HxaHP_Q50Z",
                "updatedAt": "2022-03-09",
                "children": [
                  {
                    "id": "1TnHqvoAXb1L5Biv5-UJt8xZgcciZ3KxS",
                    "name": "台北港",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1TnHqvoAXb1L5Biv5-UJt8xZgcciZ3KxS",
                    "updatedAt": "2022-05-15",
                    "children": [
                      {
                        "id": "1OfXawFcLOZSaesBvfq9NmJSZYA1owHOP",
                        "name": "AIE900_6號車測試.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1OfXawFcLOZSaesBvfq9NmJSZYA1owHOP/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-05-17",
                        "sizeOrNote": "Word · 27 KB"
                      }
                    ]
                  },
                  {
                    "id": "1BNBQMkCrz2LQfRQwRxrQsmI0CXuZitAW",
                    "name": "班芝花",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1BNBQMkCrz2LQfRQwRxrQsmI0CXuZitAW",
                    "updatedAt": "2022-08-30",
                    "children": [
                      {
                        "id": "1E8zJu5OD5fz4f8xpzF4r0Z10sseJ52uT",
                        "name": "20220831_偵查車.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1E8zJu5OD5fz4f8xpzF4r0Z10sseJ52uT/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-08-30",
                        "sizeOrNote": "Word · 163 KB"
                      }
                    ]
                  },
                  {
                    "id": "1WXSzbwxZkdYw-koOSLQdOr847wnzhfBX",
                    "name": "20220310 percpetion module test.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1WXSzbwxZkdYw-koOSLQdOr847wnzhfBX/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2024-11-08",
                    "sizeOrNote": "Word · 82 KB"
                  }
                ]
              },
              {
                "id": "1AZG9elONnC_AEJNlRUq5IZERdKDMQSqq",
                "name": "場勘照片",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1AZG9elONnC_AEJNlRUq5IZERdKDMQSqq",
                "updatedAt": "2022-09-14",
                "children": [
                  {
                    "id": "1CgrQzoW0Jk66EOLrsgiQ0qlvOK_IJqXm",
                    "name": "bombax_fence",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1CgrQzoW0Jk66EOLrsgiQ0qlvOK_IJqXm",
                    "updatedAt": "2022-11-16",
                    "children": [
                      {
                        "id": "14SPKyk3aVcf7zv22c36SR-in4PLEI2YH",
                        "name": "Screenshot from 2022-10-04 10-53-58.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/14SPKyk3aVcf7zv22c36SR-in4PLEI2YH/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 599 KB"
                      },
                      {
                        "id": "1QOjxiZ58PpxURVNqOQT1GyewbPYYzhzc",
                        "name": "Screenshot from 2022-10-04 10-54-14.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1QOjxiZ58PpxURVNqOQT1GyewbPYYzhzc/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 577 KB"
                      },
                      {
                        "id": "13yeCjmdBUjhIOXVpUk2hCFnUs0tlKh6g",
                        "name": "Screenshot from 2022-10-04 10-54-59.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/13yeCjmdBUjhIOXVpUk2hCFnUs0tlKh6g/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1ssZleKsU7L4y-5_Tr01HChWkyp0vgOM9",
                        "name": "Screenshot from 2022-10-04 10-54-59_kai.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ssZleKsU7L4y-5_Tr01HChWkyp0vgOM9/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 1.5 MB"
                      },
                      {
                        "id": "1CzPgUGwmAI_4F_Z20DNaWs5Ml7fkQnLR",
                        "name": "Screenshot from 2022-10-04 10-55-13.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1CzPgUGwmAI_4F_Z20DNaWs5Ml7fkQnLR/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1ENa5T0qB3znfWP149f37S8raODiyP1fc",
                        "name": "Screenshot from 2022-10-04 10-55-59.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ENa5T0qB3znfWP149f37S8raODiyP1fc/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 956 KB"
                      },
                      {
                        "id": "1d_8kTJPE-BgUYsp6raFB-0cUNQl3a0Ud",
                        "name": "Screenshot from 2022-10-04 10-56-10.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1d_8kTJPE-BgUYsp6raFB-0cUNQl3a0Ud/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "1G_lyaWLJoWIpG2yVKGeCkIHZAGnhoQFK",
                        "name": "Screenshot from 2022-10-04 10-56-10_kai.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1G_lyaWLJoWIpG2yVKGeCkIHZAGnhoQFK/view?usp=drivesdk",
                        "updatedAt": "2022-11-16",
                        "sizeOrNote": "PNG 圖檔 · 1.3 MB"
                      }
                    ]
                  },
                  {
                    "id": "1UgCViZ7OuGmPuJLzK2CnX-dpg8N16qN5",
                    "name": "GOLF_20001_定點.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1UgCViZ7OuGmPuJLzK2CnX-dpg8N16qN5/view?usp=drivesdk",
                    "updatedAt": "2022-09-20",
                    "sizeOrNote": "JPG 圖檔 · 201 KB"
                  },
                  {
                    "id": "1mLHUoKyBG6CJUbLhkjY-pX6XquAFzu8o",
                    "name": "GOLF_20001_非定點.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1mLHUoKyBG6CJUbLhkjY-pX6XquAFzu8o/view?usp=drivesdk",
                    "updatedAt": "2022-09-20",
                    "sizeOrNote": "JPG 圖檔 · 201 KB"
                  },
                  {
                    "id": "1LIi-TzX2dKCYAUtMau2quE6f2JGqL79T",
                    "name": "result_20002.kgl.html",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1LIi-TzX2dKCYAUtMau2quE6f2JGqL79T/view?usp=drivesdk",
                    "updatedAt": "2022-09-20",
                    "sizeOrNote": "文件 · 7.5 MB"
                  },
                  {
                    "id": "1ugsz2EnB-fWC-zVYvxpFesKVmSdS6s7v",
                    "name": "vio_fail.kgl.html",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1ugsz2EnB-fWC-zVYvxpFesKVmSdS6s7v/view?usp=drivesdk",
                    "updatedAt": "2022-09-20",
                    "sizeOrNote": "文件 · 25 KB"
                  },
                  {
                    "id": "1Ar3TeIxVEDs2BFmD8UzCQCVwHOFNiwq8",
                    "name": "場勘照片.zip",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1Ar3TeIxVEDs2BFmD8UzCQCVwHOFNiwq8/view?usp=drivesdk",
                    "updatedAt": "2022-09-14",
                    "sizeOrNote": "封存檔 · 772.5 MB"
                  }
                ]
              },
              {
                "id": "1jVopRCX98oH045oX__Bu9YP_SkO-5DeK",
                "name": "導入流程",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1jVopRCX98oH045oX__Bu9YP_SkO-5DeK",
                "updatedAt": "2022-12-26",
                "children": [
                  {
                    "id": "1Xjj4i3pNvu49hjobNsqoIgwxWKsuNDBZ",
                    "name": "1.X導入流程.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1Xjj4i3pNvu49hjobNsqoIgwxWKsuNDBZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2023-04-14",
                    "sizeOrNote": "簡報 · 58 KB"
                  }
                ]
              },
              {
                "id": "1gOk64M0CSw28mAGjymTYjbXjYpVEgnoq",
                "name": "智慧球車V1.0設計發想與專利申請",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1gOk64M0CSw28mAGjymTYjbXjYpVEgnoq",
                "updatedAt": "2022-02-18",
                "children": [
                  {
                    "id": "1qEtJ1KHGKRrVMYDzKtyMcja04uVqWTmk",
                    "name": "智慧球車V1.0_產品願景.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1qEtJ1KHGKRrVMYDzKtyMcja04uVqWTmk/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-02-18",
                    "sizeOrNote": "Word · 25 KB"
                  }
                ]
              },
              {
                "id": "1DcPNIFgtkECSZRo9Y3bowGst0AoPsMct",
                "name": "智慧球車量產計畫",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1DcPNIFgtkECSZRo9Y3bowGst0AoPsMct",
                "updatedAt": "2022-02-16",
                "children": [
                  {
                    "id": "1kN0JQs1rQjm7RX36Ojo1_gs4yZI12nIx",
                    "name": "軟硬體配置",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1kN0JQs1rQjm7RX36Ojo1_gs4yZI12nIx",
                    "updatedAt": "2022-07-02",
                    "children": [
                      {
                        "id": "1R0xOGuJ-MiUXAWEXTsbeXKXaXBOAs4L6",
                        "name": "硬體採購.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1R0xOGuJ-MiUXAWEXTsbeXKXaXBOAs4L6/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-08-31",
                        "sizeOrNote": "Word · 23 KB"
                      }
                    ]
                  },
                  {
                    "id": "1T9A-OLhyxzEfAp8xfoYNgksM7T7d-oW0",
                    "name": "低階控制總成(SGK-LTA2-L2C) BoM.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1T9A-OLhyxzEfAp8xfoYNgksM7T7d-oW0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-04-19",
                    "sizeOrNote": "試算表 · 46 KB"
                  }
                ]
              },
              {
                "id": "1_MSkFZGxp-Wc_RZhOse99Y8fqFNSb82G",
                "name": "會議記錄",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1_MSkFZGxp-Wc_RZhOse99Y8fqFNSb82G",
                "updatedAt": "2022-04-23",
                "children": [
                  {
                    "id": "1DfANViIZI-u4-qXukfhAkyLOO2fGpmAo",
                    "name": "20220303_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1DfANViIZI-u4-qXukfhAkyLOO2fGpmAo",
                    "updatedAt": "2022-04-27",
                    "children": [
                      {
                        "id": "14vy0aGjNf99C-4kQmNrTstxiZmtkPsEH",
                        "name": "智慧球車CMM功能.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/14vy0aGjNf99C-4kQmNrTstxiZmtkPsEH/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-03-03",
                        "sizeOrNote": "Word · 22 KB"
                      },
                      {
                        "id": "1KUl_TZelDobxUtjXCAoy_KqrkLTd-cUK",
                        "name": "會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1KUl_TZelDobxUtjXCAoy_KqrkLTd-cUK/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-03-03",
                        "sizeOrNote": "Word · 26 KB"
                      }
                    ]
                  },
                  {
                    "id": "1-Kh6dMNjY82CCNCQ9P_KiydQnnNYiNIb",
                    "name": "20220311_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1-Kh6dMNjY82CCNCQ9P_KiydQnnNYiNIb",
                    "updatedAt": "2022-04-27",
                    "children": [
                      {
                        "id": "1P9VKDCZBcMADvHBpkHQI4vy49SSTqQ4-",
                        "name": "會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1P9VKDCZBcMADvHBpkHQI4vy49SSTqQ4-/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-03-11",
                        "sizeOrNote": "Word · 29 KB"
                      }
                    ]
                  },
                  {
                    "id": "1KbbTvDG7RyALpiJrV-Gv-wpMP2_Dk1Eh",
                    "name": "20220324_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1KbbTvDG7RyALpiJrV-Gv-wpMP2_Dk1Eh",
                    "updatedAt": "2022-04-27",
                    "children": [
                      {
                        "id": "1jewv3bM_XaZpytSLoxq-X4m_B1nlRGbw",
                        "name": "會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1jewv3bM_XaZpytSLoxq-X4m_B1nlRGbw/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-03-24",
                        "sizeOrNote": "Word · 27 KB"
                      }
                    ]
                  },
                  {
                    "id": "1h7EA7tuhnZK3uTc9C25QbTa7aKfU3o30",
                    "name": "20220331_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1h7EA7tuhnZK3uTc9C25QbTa7aKfU3o30",
                    "updatedAt": "2022-04-28",
                    "children": [
                      {
                        "id": "1hwy8owYUaJeXCN0knyGnQJwjDxdJ4fK5",
                        "name": "20220331_會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1hwy8owYUaJeXCN0knyGnQJwjDxdJ4fK5/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-07-08",
                        "sizeOrNote": "Word · 30 KB"
                      },
                      {
                        "id": "1WbiYdO8fYORNMmf7I69tJALCdTui1J3_",
                        "name": "CMM demo.mov",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1WbiYdO8fYORNMmf7I69tJALCdTui1J3_/view?usp=drivesdk",
                        "updatedAt": "2022-04-28",
                        "sizeOrNote": "MP4 影片 · 81.4 MB"
                      }
                    ]
                  },
                  {
                    "id": "1ksDbzY8afq-pA_nushprYTmZ7tn4Wbix",
                    "name": "20220408_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ksDbzY8afq-pA_nushprYTmZ7tn4Wbix",
                    "updatedAt": "2022-04-27",
                    "children": [
                      {
                        "id": "1TcFXYd9NUEfmps_ktVdqoMe_Ir0Onz2Q",
                        "name": "會議紀錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1TcFXYd9NUEfmps_ktVdqoMe_Ir0Onz2Q/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-08",
                        "sizeOrNote": "Word · 26 KB"
                      }
                    ]
                  },
                  {
                    "id": "1MhXY26dRxGUZUgcqvXo3k72wQsrGgdih",
                    "name": "20220415_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1MhXY26dRxGUZUgcqvXo3k72wQsrGgdih",
                    "updatedAt": "2022-04-27",
                    "children": [
                      {
                        "id": "1aRvmPsFTPEZO_JuMCH3vhtf_zFtgpbkr",
                        "name": "20220412出差報告.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1aRvmPsFTPEZO_JuMCH3vhtf_zFtgpbkr/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-15",
                        "sizeOrNote": "簡報 · 2.2 MB"
                      },
                      {
                        "id": "1idtplGgurAVXU3uqK_NnhioyblOvmNZG",
                        "name": "會議紀錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1idtplGgurAVXU3uqK_NnhioyblOvmNZG/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-15",
                        "sizeOrNote": "Word · 26 KB"
                      }
                    ]
                  },
                  {
                    "id": "1TQpgg7EZOuU7aDVehnppUWZQEmPK2sCe",
                    "name": "20220428_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1TQpgg7EZOuU7aDVehnppUWZQEmPK2sCe",
                    "updatedAt": "2022-04-28",
                    "children": [
                      {
                        "id": "1GiZti0Bn7WEL0ThEGzEza-lmH6JrYaFu",
                        "name": "新豐導入.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1GiZti0Bn7WEL0ThEGzEza-lmH6JrYaFu/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-28",
                        "sizeOrNote": "Word · 27 KB"
                      },
                      {
                        "id": "1q0kAwhEZpCzOkw7nb2vC2cRJpY9_T97f",
                        "name": "會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1q0kAwhEZpCzOkw7nb2vC2cRJpY9_T97f/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-28",
                        "sizeOrNote": "Word · 27 KB"
                      }
                    ]
                  },
                  {
                    "id": "1-XqpV3qDV8DN4bIU53liqEW6SonsMRmc",
                    "name": "20220513_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1-XqpV3qDV8DN4bIU53liqEW6SonsMRmc",
                    "updatedAt": "2022-05-13",
                    "children": [
                      {
                        "id": "18dDYHbLaOREGxofjxxxOPVE7V1hhiDTf",
                        "name": "會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/18dDYHbLaOREGxofjxxxOPVE7V1hhiDTf/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-05-13",
                        "sizeOrNote": "Word · 28 KB"
                      }
                    ]
                  },
                  {
                    "id": "1Id5bXqToYrlQvQYY-q8Er9QDlqSUsFHP",
                    "name": "20220520_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Id5bXqToYrlQvQYY-q8Er9QDlqSUsFHP",
                    "updatedAt": "2022-05-20",
                    "children": [
                      {
                        "id": "1d8aRAgNFjJ-XcVwBj3stUouwnBgFwKjX",
                        "name": "會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1d8aRAgNFjJ-XcVwBj3stUouwnBgFwKjX/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-05-20",
                        "sizeOrNote": "Word · 60 KB"
                      }
                    ]
                  },
                  {
                    "id": "1trXj-98JRCHfDFK9vcORWy2KUtVStEbv",
                    "name": "20220527_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1trXj-98JRCHfDFK9vcORWy2KUtVStEbv",
                    "updatedAt": "2022-05-23",
                    "children": [
                      {
                        "id": "1plNfgn16Y1RKeB_rHJ7qKTMdgGOF9Lor",
                        "name": "220527會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1plNfgn16Y1RKeB_rHJ7qKTMdgGOF9Lor/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-05-27",
                        "sizeOrNote": "Word · 35 KB"
                      }
                    ]
                  },
                  {
                    "id": "1t4PjukZmOeeJcFWOQFyCdZm6eccjt9sB",
                    "name": "20220602_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1t4PjukZmOeeJcFWOQFyCdZm6eccjt9sB",
                    "updatedAt": "2022-05-30",
                    "children": [
                      {
                        "id": "1clDLNWMh_2Y5AFudiGuFLO7nPnBM-PK4",
                        "name": "220602會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1clDLNWMh_2Y5AFudiGuFLO7nPnBM-PK4/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-06-02",
                        "sizeOrNote": "Word · 571 KB"
                      }
                    ]
                  },
                  {
                    "id": "1Mc2U4bue9FLpDoy7OxJqNNNYwhX-kpPE",
                    "name": "20220609_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Mc2U4bue9FLpDoy7OxJqNNNYwhX-kpPE",
                    "updatedAt": "2022-06-07",
                    "children": [
                      {
                        "id": "1oGLP2Qtku-C8DBRghOaw3AWcUKxtsplQ",
                        "name": "220609會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1oGLP2Qtku-C8DBRghOaw3AWcUKxtsplQ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-06-14",
                        "sizeOrNote": "Word · 2.6 MB"
                      },
                      {
                        "id": "1LzBUpkLSJRq2_bK2HEd5V3XrGeKtJcyA",
                        "name": "智慧囚車#6實車資料.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1LzBUpkLSJRq2_bK2HEd5V3XrGeKtJcyA/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-06-10",
                        "sizeOrNote": "試算表 · 30 KB"
                      }
                    ]
                  },
                  {
                    "id": "1t3CGHIqozAJQQFxjz6NtWocMok_Mnez4",
                    "name": "20220617_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1t3CGHIqozAJQQFxjz6NtWocMok_Mnez4",
                    "updatedAt": "2022-06-15",
                    "children": [
                      {
                        "id": "1qLPKBlVQ-xHY3O8o5oYfbx-IYtIJU3uI",
                        "name": "營業部 Business Development - 文件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1qLPKBlVQ-xHY3O8o5oYfbx-IYtIJU3uI",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1DIm40jXUNQD3c7dB4dYxyWTTl041ScfD",
                        "name": "220617會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1DIm40jXUNQD3c7dB4dYxyWTTl041ScfD/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-06-21",
                        "sizeOrNote": "Word · 280 KB"
                      }
                    ]
                  },
                  {
                    "id": "1oQmZGJaL7uDdv0n5-k34-floM27MQp6Y",
                    "name": "20220623_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1oQmZGJaL7uDdv0n5-k34-floM27MQp6Y",
                    "updatedAt": "2022-06-21",
                    "children": [
                      {
                        "id": "1PmNL5DL32V1PzYc0URmcPW9KtYh8YePR",
                        "name": "220623會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1PmNL5DL32V1PzYc0URmcPW9KtYh8YePR/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-06-23",
                        "sizeOrNote": "Word · 61 KB"
                      }
                    ]
                  },
                  {
                    "id": "1EKF9U1ojskLvNZha83VcTlHilpYikghG",
                    "name": "20220630_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1EKF9U1ojskLvNZha83VcTlHilpYikghG",
                    "updatedAt": "2022-06-28",
                    "children": [
                      {
                        "id": "1uay5hA4pw1dsUxu-lwDvwzZQ2QthR6_P",
                        "name": "220630會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1uay5hA4pw1dsUxu-lwDvwzZQ2QthR6_P/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-06-30",
                        "sizeOrNote": "Word · 70 KB"
                      }
                    ]
                  },
                  {
                    "id": "1vpODLWsfIrw6J6ulUNzkDyr_ya-M3808",
                    "name": "20220707_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1vpODLWsfIrw6J6ulUNzkDyr_ya-M3808",
                    "updatedAt": "2022-07-06",
                    "children": [
                      {
                        "id": "1VTTQKpQzGmqYt_Vn_LGTdYYl-5EjUYZs",
                        "name": "220707會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1VTTQKpQzGmqYt_Vn_LGTdYYl-5EjUYZs/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-07-08",
                        "sizeOrNote": "Word · 151 KB"
                      }
                    ]
                  },
                  {
                    "id": "1DpoZyoltVSAq2GcmGm36qVHqYOSvw9uZ",
                    "name": "20220714_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1DpoZyoltVSAq2GcmGm36qVHqYOSvw9uZ",
                    "updatedAt": "2022-07-13",
                    "children": [
                      {
                        "id": "1djZQ1u-kuxKyWCruOi6tPkKjgv0g2cro",
                        "name": "220714會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1djZQ1u-kuxKyWCruOi6tPkKjgv0g2cro/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-07-15",
                        "sizeOrNote": "Word · 316 KB"
                      }
                    ]
                  },
                  {
                    "id": "1N883BL8LOCHBl3wayJUAid5eF2X2jv1E",
                    "name": "20220722_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1N883BL8LOCHBl3wayJUAid5eF2X2jv1E",
                    "updatedAt": "2022-07-22",
                    "children": [
                      {
                        "id": "1nGHpPolDlfZcCTIAdNozeQG4ENF-jzlm",
                        "name": "220722會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1nGHpPolDlfZcCTIAdNozeQG4ENF-jzlm/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-07-27",
                        "sizeOrNote": "Word · 54 KB"
                      }
                    ]
                  },
                  {
                    "id": "1wrZ_9dfNvY75xMngYgO8QpcL-58tX7_W",
                    "name": "20220729_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1wrZ_9dfNvY75xMngYgO8QpcL-58tX7_W",
                    "updatedAt": "2022-07-28",
                    "children": [
                      {
                        "id": "1ktJbzyRnMNXXXzy3bbBeOWVlQgSfD0QW",
                        "name": "20220727_8號車@奕兆出差.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1ktJbzyRnMNXXXzy3bbBeOWVlQgSfD0QW/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-07-29",
                        "sizeOrNote": "Word · 26 KB"
                      },
                      {
                        "id": "1mD9NMN2oeqvWcCBkqe3AlZfYEMo6VOhV",
                        "name": "220729會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1mD9NMN2oeqvWcCBkqe3AlZfYEMo6VOhV/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-08-01",
                        "sizeOrNote": "Word · 156 KB"
                      }
                    ]
                  },
                  {
                    "id": "1YgCXC_x6CObseVM5QKcTgZCUByoHWeS9",
                    "name": "20220804_會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1YgCXC_x6CObseVM5QKcTgZCUByoHWeS9",
                    "updatedAt": "2022-08-03",
                    "children": [
                      {
                        "id": "1e5FVbMTXs9HuZDxT4l9B3vqq1Ql-DhuF",
                        "name": "220804會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1e5FVbMTXs9HuZDxT4l9B3vqq1Ql-DhuF/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-08-05",
                        "sizeOrNote": "Word · 59 KB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1RxiTHarTQo23pPI6A-H3iekOkS7L7WCZ",
                "name": "系統架構",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1RxiTHarTQo23pPI6A-H3iekOkS7L7WCZ",
                "updatedAt": "2022-02-23",
                "children": [
                  {
                    "id": "1c1LpKrMNtXGcjCN-3e3ACojIVhJ9UD1T",
                    "name": "1.X功能模組",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1c1LpKrMNtXGcjCN-3e3ACojIVhJ9UD1T",
                    "updatedAt": "2022-11-16",
                    "children": []
                  },
                  {
                    "id": "14Yye5xh2W0eFFcFIpVx05_DgrCJZkAYM",
                    "name": "adas system",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/14Yye5xh2W0eFFcFIpVx05_DgrCJZkAYM",
                    "updatedAt": "2022-08-30",
                    "children": [
                      {
                        "id": "1Bkvg_291t45Wc0uWCorKZGLghvQ5VYoR",
                        "name": "violation",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Bkvg_291t45Wc0uWCorKZGLghvQ5VYoR",
                        "updatedAt": "2022-08-30",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1B8hUb1fnHKo6kQ5EkI0euFGBgATVvIOT",
                    "name": "Coding  Document",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1B8hUb1fnHKo6kQ5EkI0euFGBgATVvIOT",
                    "updatedAt": "2022-12-19",
                    "children": [
                      {
                        "id": "1BGM_h_KEh-5_Y-z89Jn8SA5vCYn6xJHr",
                        "name": "releaseNote",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1BGM_h_KEh-5_Y-z89Jn8SA5vCYn6xJHr",
                        "updatedAt": "2022-08-31",
                        "children": []
                      },
                      {
                        "id": "11HsUL_Y_VLQYFUHarlJtyDjAPGq6Wd8Q",
                        "name": "更新紀錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/11HsUL_Y_VLQYFUHarlJtyDjAPGq6Wd8Q",
                        "updatedAt": "2022-12-19",
                        "children": []
                      },
                      {
                        "id": "1A74CIjlr9CUv_l__yQa-E21aHvVQAmCf",
                        "name": "研發會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1A74CIjlr9CUv_l__yQa-E21aHvVQAmCf",
                        "updatedAt": "2022-12-19",
                        "children": []
                      },
                      {
                        "id": "1oOlfJOGa-H6dR-pf1kgKmK6cU0sv1TEn",
                        "name": "20210819_signalf_flow_chart.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1oOlfJOGa-H6dR-pf1kgKmK6cU0sv1TEn/view?usp=drivesdk",
                        "updatedAt": "2021-08-19",
                        "sizeOrNote": "PNG 圖檔 · 99 KB"
                      },
                      {
                        "id": "1tKy0AFLbtN-toe6g_aDxOYQlaLX_DLbM",
                        "name": "Coding Note.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1tKy0AFLbtN-toe6g_aDxOYQlaLX_DLbM/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-24",
                        "sizeOrNote": "Word · 40 KB"
                      },
                      {
                        "id": "1AaFZYYg-pj0FNOl-bqPGkQ8OoDgWAIxm",
                        "name": "signal.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1AaFZYYg-pj0FNOl-bqPGkQ8OoDgWAIxm/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-10-13",
                        "sizeOrNote": "試算表 · 28 KB"
                      },
                      {
                        "id": "1pw27FfVz6xP0o0FlHGDAy9gksK89C9bW",
                        "name": "SmartKart_phase1_class_list.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1pw27FfVz6xP0o0FlHGDAy9gksK89C9bW/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-19",
                        "sizeOrNote": "Word · 30 KB"
                      }
                    ]
                  },
                  {
                    "id": "1jFjfxs9oIhy-JDQd3Z7a7UdkxAGjjg4i",
                    "name": "geofence",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1jFjfxs9oIhy-JDQd3Z7a7UdkxAGjjg4i",
                    "updatedAt": "2022-02-23",
                    "children": [
                      {
                        "id": "1XUhXqp71BAuGvzolSAT-RPE7nT4f7YVd",
                        "name": "geofence.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1XUhXqp71BAuGvzolSAT-RPE7nT4f7YVd/view?usp=drivesdk",
                        "updatedAt": "2022-03-01",
                        "sizeOrNote": "文件 · 5 KB"
                      }
                    ]
                  },
                  {
                    "id": "1WAFw0XuPE5t93g5I7lkn3MDuINo6qIbf",
                    "name": "rentalmanagement",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1WAFw0XuPE5t93g5I7lkn3MDuINo6qIbf",
                    "updatedAt": "2022-03-31",
                    "children": [
                      {
                        "id": "1DxFWOlrH1p9EiBV704X6282TyqEcxeNp",
                        "name": "20220331_geofence_request.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1DxFWOlrH1p9EiBV704X6282TyqEcxeNp/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-03-31",
                        "sizeOrNote": "Word · 30 KB"
                      }
                    ]
                  },
                  {
                    "id": "1yQGFwrInBQKXD_K8mJbe416pCdbNU7nt",
                    "name": "技術文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1yQGFwrInBQKXD_K8mJbe416pCdbNU7nt",
                    "updatedAt": "2022-08-05",
                    "children": [
                      {
                        "id": "1jSCR_aon5Qwq6QsMRLMMdlTnLJDafrax",
                        "name": "ip tablet.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1jSCR_aon5Qwq6QsMRLMMdlTnLJDafrax/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-05",
                        "sizeOrNote": "Word · 23 KB"
                      },
                      {
                        "id": "1uBEtx7ZYQekzz2jcomGe3AN3HnmwvrSa",
                        "name": "MAC Address.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1uBEtx7ZYQekzz2jcomGe3AN3HnmwvrSa/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-02",
                        "sizeOrNote": "Word · 24 KB"
                      },
                      {
                        "id": "1Hic1RuaEAyP3fKilfnGHywtdBhoaC_ys",
                        "name": "network_setting.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1Hic1RuaEAyP3fKilfnGHywtdBhoaC_ys/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-23",
                        "sizeOrNote": "Word · 22 KB"
                      },
                      {
                        "id": "1MNPHo7sZfen1bdoXyfMb1SzY2DsLemae",
                        "name": "nmcli.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1MNPHo7sZfen1bdoXyfMb1SzY2DsLemae/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-11-02",
                        "sizeOrNote": "Word · 85 KB"
                      }
                    ]
                  },
                  {
                    "id": "1rIeDOOL1D9YEDyFHtf4QkU5vtbORVT2V",
                    "name": "新功能開發會議紀錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1rIeDOOL1D9YEDyFHtf4QkU5vtbORVT2V",
                    "updatedAt": "2022-06-08",
                    "children": [
                      {
                        "id": "1h7JbJAQiofCo5fIsdXpjMQr_vEMK4yz9",
                        "name": "20220610",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1h7JbJAQiofCo5fIsdXpjMQr_vEMK4yz9",
                        "updatedAt": "2022-06-10",
                        "children": []
                      },
                      {
                        "id": "1WMhKX53ZkURP6HL5t2cA0abjxAdamhO3",
                        "name": "20220628",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1WMhKX53ZkURP6HL5t2cA0abjxAdamhO3",
                        "updatedAt": "2022-06-28",
                        "children": []
                      },
                      {
                        "id": "1tgsQ4iH1-qZTf93S734tsK20OSTrkaMH",
                        "name": "20220629",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1tgsQ4iH1-qZTf93S734tsK20OSTrkaMH",
                        "updatedAt": "2022-06-29",
                        "children": []
                      },
                      {
                        "id": "1k8txp2kwWMG1v3XKInj-gtaL_Et90cNe",
                        "name": "20220701",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1k8txp2kwWMG1v3XKInj-gtaL_Et90cNe",
                        "updatedAt": "2022-07-01",
                        "children": []
                      },
                      {
                        "id": "1BRAvyT26jOY16vSXS3kGn9ubnnDtZMTt",
                        "name": "20220712",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1BRAvyT26jOY16vSXS3kGn9ubnnDtZMTt",
                        "updatedAt": "2022-07-12",
                        "children": []
                      },
                      {
                        "id": "1yaTSaGB2q7bVEDeFSDNVwNegIWtgEPVq",
                        "name": "20220815",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1yaTSaGB2q7bVEDeFSDNVwNegIWtgEPVq",
                        "updatedAt": "2022-08-15",
                        "children": []
                      },
                      {
                        "id": "1jtDavKV4oCUe-jSxnjEJb6cMQ9H7C0XQ",
                        "name": "20220817",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1jtDavKV4oCUe-jSxnjEJb6cMQ9H7C0XQ",
                        "updatedAt": "2022-08-17",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1Anarqf-zs4i6aTwWvjSkFnz_7FjOoRN0",
                    "name": "規格書",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Anarqf-zs4i6aTwWvjSkFnz_7FjOoRN0",
                    "updatedAt": "2022-11-01",
                    "children": [
                      {
                        "id": "13cUvA83bl9MhOKGB-atQLTudrgMCVwGu",
                        "name": "主系統.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/13cUvA83bl9MhOKGB-atQLTudrgMCVwGu/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2024-03-27",
                        "sizeOrNote": "Word · 40 KB"
                      },
                      {
                        "id": "1lKjL-qLVUnIhikfJr1DeO1E2eKjlbVhs",
                        "name": "主系統.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1lKjL-qLVUnIhikfJr1DeO1E2eKjlbVhs/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2024-11-08",
                        "sizeOrNote": "簡報 · 36 KB"
                      }
                    ]
                  },
                  {
                    "id": "1Zd36tW1lf9Y5bddRjDd8CkwdezaeDQBd",
                    "name": "違規事件上傳",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Zd36tW1lf9Y5bddRjDd8CkwdezaeDQBd",
                    "updatedAt": "2022-11-11",
                    "children": [
                      {
                        "id": "1yMbTaeZLs1SRIegT-uA_TqrpYhpcR7zy",
                        "name": ".$上傳流程.drawio.bkp",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1yMbTaeZLs1SRIegT-uA_TqrpYhpcR7zy/view?usp=drivesdk",
                        "updatedAt": "2022-11-11",
                        "sizeOrNote": "文件 · 9 KB"
                      },
                      {
                        "id": "1PQANVDdkO8rx9p9xyZ2JTPd6kSEuymOp",
                        "name": "2022_11_11_Turing x Lifeplus違規事件上傳對接.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1PQANVDdkO8rx9p9xyZ2JTPd6kSEuymOp/view?usp=drivesdk",
                        "updatedAt": "2022-11-14",
                        "sizeOrNote": "PDF · 616 KB"
                      },
                      {
                        "id": "1nCZw3Tb05maf4uUR6qLhoDmb3gZKY1aT",
                        "name": "2022_11_11_Turing x Lifeplus違規事件上傳對接.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1nCZw3Tb05maf4uUR6qLhoDmb3gZKY1aT/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-11-14",
                        "sizeOrNote": "簡報 · 9.9 MB"
                      },
                      {
                        "id": "1x-NUMJaL1U2kGM7gwHOwRH4LjAf5A6tF",
                        "name": "2022_12_20_Turing x Lifeplus違規事件上傳對接.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1x-NUMJaL1U2kGM7gwHOwRH4LjAf5A6tF/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-01-17",
                        "sizeOrNote": "簡報 · 18.9 MB"
                      },
                      {
                        "id": "1xyiwqW7KevQ8z5zpZcTNDLGA_Zv3bu8T",
                        "name": "MQTT協定.url",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1xyiwqW7KevQ8z5zpZcTNDLGA_Zv3bu8T/view?usp=drivesdk",
                        "updatedAt": "2022-12-19",
                        "sizeOrNote": "文件 · 199 B"
                      },
                      {
                        "id": "1SN7ndjvlV6UdDHBf5YLIsgirkN7iQBGe",
                        "name": "上傳流程.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1SN7ndjvlV6UdDHBf5YLIsgirkN7iQBGe/view?usp=drivesdk",
                        "updatedAt": "2022-11-11",
                        "sizeOrNote": "文件 · 626 B"
                      },
                      {
                        "id": "1lnRYWJ6IJl8MuXMIhwbUrKwbY9A0c8IZ",
                        "name": "資料表格規劃.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1lnRYWJ6IJl8MuXMIhwbUrKwbY9A0c8IZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-19",
                        "sizeOrNote": "試算表 · 24 KB"
                      }
                    ]
                  },
                  {
                    "id": "1NVIrGQTTF1ngHfMquz4iH2USQO35I6la",
                    "name": "遠端更新",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1NVIrGQTTF1ngHfMquz4iH2USQO35I6la",
                    "updatedAt": "2023-04-06",
                    "children": []
                  }
                ]
              },
              {
                "id": "1OOYz_lKSxIke_nkSAknSqIkRvyDT5ThB",
                "name": "規格書",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1OOYz_lKSxIke_nkSAknSqIkRvyDT5ThB",
                "updatedAt": "2022-12-26",
                "children": [
                  {
                    "id": "183M6nbY3xY-ZjtnBWbn-zPvZ2Kpepd4B",
                    "name": "1.0",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/183M6nbY3xY-ZjtnBWbn-zPvZ2Kpepd4B",
                    "updatedAt": "2022-12-26",
                    "children": [
                      {
                        "id": "1P4p29RxZ8moY4B13w2GQED8AXAyDYwXS",
                        "name": "主系統_20221212.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1P4p29RxZ8moY4B13w2GQED8AXAyDYwXS/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2024-10-21",
                        "sizeOrNote": "Word · 38 KB"
                      }
                    ]
                  },
                  {
                    "id": "1D5ZHThWCGufbVjuGM6_vZaqCyyKoCKAU",
                    "name": "1.X",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1D5ZHThWCGufbVjuGM6_vZaqCyyKoCKAU",
                    "updatedAt": "2022-12-26",
                    "children": [
                      {
                        "id": "165TNDmZEgh0CtLr8BRq7OCbWoeE90AX1",
                        "name": "主系統_20221226.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/165TNDmZEgh0CtLr8BRq7OCbWoeE90AX1/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-26",
                        "sizeOrNote": "Word · 41 KB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1V4v-L1-lzXaLQrcc2E_HmT1XwPPftFDN",
                "name": "雜項",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1V4v-L1-lzXaLQrcc2E_HmT1XwPPftFDN",
                "updatedAt": "2022-12-19",
                "children": [
                  {
                    "id": "1bnQpr21EN7F5A4m2BWwwLE7y0ta3EXE6",
                    "name": "CMM_report.html",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1bnQpr21EN7F5A4m2BWwwLE7y0ta3EXE6/view?usp=drivesdk",
                    "updatedAt": "2022-06-10",
                    "sizeOrNote": "文件 · 33 KB"
                  },
                  {
                    "id": "1Ydh0_lNOOZabdd8RCGlM0640D4YTf6jW",
                    "name": "original-79600294-71e9-406e-9bd2-65ff382b9a75.mp4",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1Ydh0_lNOOZabdd8RCGlM0640D4YTf6jW/view?usp=drivesdk",
                    "updatedAt": "2022-02-23",
                    "sizeOrNote": "MP4 影片 · 9.2 MB"
                  },
                  {
                    "id": "1SrlQu-q1e1IGgAOe_6JFGU_0o9ug0lBa",
                    "name": "螢幕快照 2022-02-16 15.55.30.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1SrlQu-q1e1IGgAOe_6JFGU_0o9ug0lBa/view?usp=drivesdk",
                    "updatedAt": "2022-02-16",
                    "sizeOrNote": "PNG 圖檔 · 150 KB"
                  },
                  {
                    "id": "15uqPDXxNC5gCGtfJvAmeoiS0R2QMk3Ct",
                    "name": "豐田通商體驗智慧球車流程_V3.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/15uqPDXxNC5gCGtfJvAmeoiS0R2QMk3Ct/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-02-15",
                    "sizeOrNote": "Word · 30 KB"
                  }
                ]
              },
              {
                "id": "10nd-PJxfuHig7Xbo5Xosi7rZH3F-FLrJ",
                "name": "驗收",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/10nd-PJxfuHig7Xbo5Xosi7rZH3F-FLrJ",
                "updatedAt": "2023-03-14",
                "children": [
                  {
                    "id": "1fYJaux5fttbVxrmfah4zKI_-HruOoA8H",
                    "name": "doc02548820221219101601[374].pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1fYJaux5fttbVxrmfah4zKI_-HruOoA8H/view?usp=drivesdk",
                    "updatedAt": "2023-03-14",
                    "sizeOrNote": "PDF · 1.4 MB"
                  },
                  {
                    "id": "13VdgElwujrUjkc-cjI0u0FHpC7cqC-5a",
                    "name": "doc02553120221220152551[342].pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/13VdgElwujrUjkc-cjI0u0FHpC7cqC-5a/view?usp=drivesdk",
                    "updatedAt": "2023-03-14",
                    "sizeOrNote": "PDF · 1.7 MB"
                  }
                ]
              },
              {
                "id": "1tIQR5tQ9SRJHodYZGd0loqk6cmGg1LJZ",
                "name": "20221206_球車現況整理.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1tIQR5tQ9SRJHodYZGd0loqk6cmGg1LJZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2022-12-08",
                "sizeOrNote": "試算表 · 23 KB"
              },
              {
                "id": "1fYTAmGFotdyjhbagVfZG_okRyQc1Skm9",
                "name": "NX測試和系統開發.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1fYTAmGFotdyjhbagVfZG_okRyQc1Skm9/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2022-04-08",
                "sizeOrNote": "Word · 27 KB"
              }
            ]
          },
          {
            "id": "1NAr-ujseSAb8RhjMg2ptFMF2a5G_Hyg0",
            "name": "5_產品開發（含 PaC-Man、智慧球車 v1.0、智慧球車 v2.0）",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1NAr-ujseSAb8RhjMg2ptFMF2a5G_Hyg0",
            "updatedAt": "2023-12",
            "sizeOrNote": "產品開發總目錄",
            "children": [
              {
                "id": "10kLbbShKR8yNiJ97BOJZJQgBCAxk5Zqb",
                "name": "20210506_教具車產品開發",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/10kLbbShKR8yNiJ97BOJZJQgBCAxk5Zqb",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1CN3nuy0fhwfgtNCDXTjd9bo0Tvn9_Xsc",
                "name": "產品介紹",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1CN3nuy0fhwfgtNCDXTjd9bo0Tvn9_Xsc",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1rVgLPZ18Hz_Af7N_bdafjxjlwh3B-EoG",
                    "name": "geofence.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1rVgLPZ18Hz_Af7N_bdafjxjlwh3B-EoG/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-05-10",
                    "sizeOrNote": "簡報 · 15.5 MB"
                  }
                ]
              }
            ]
          },
          {
            "id": "1uWeQMg0vQQ-CxkZUfzM0AwuMkUVKbJZa",
            "name": "SmartKart > 文件 > General",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1uWeQMg0vQQ-CxkZUfzM0AwuMkUVKbJZa",
            "updatedAt": "2023-10",
            "sizeOrNote": "SmartKart 車體與控制技術文件",
            "children": [
              {
                "id": "1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW",
                "name": "20250224_golface_deal",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW",
                "updatedAt": "2025-02-24",
                "children": [
                  {
                    "id": "1GRK-_34QdyID5-SsfkH9ge5-Hcf0Zvfm",
                    "name": "22737",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1GRK-_34QdyID5-SsfkH9ge5-Hcf0Zvfm",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1hHsfbYjOZw6KYNRq06cBBQh2Wp1_duI7",
                        "name": "CH7-4, fig (3).pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1hHsfbYjOZw6KYNRq06cBBQh2Wp1_duI7/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-26",
                        "sizeOrNote": "簡報 · 139 KB"
                      }
                    ]
                  },
                  {
                    "id": "1tqzEThAfS9JsK6eSWohqBuanXCZqmbR9",
                    "name": "fence",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1tqzEThAfS9JsK6eSWohqBuanXCZqmbR9",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1Fliyn8n-MRwRZJUP7WCDvIlgGKQoTExT",
                        "name": "南峰.geojson",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1Fliyn8n-MRwRZJUP7WCDvIlgGKQoTExT/view?usp=drivesdk",
                        "updatedAt": "2024-08-08",
                        "sizeOrNote": "文件 · 44 KB"
                      },
                      {
                        "id": "1TZOGyRSRkUZY8UABI4SPOEn6T3X4D2Jp",
                        "name": "斑芝花.geojson",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1TZOGyRSRkUZY8UABI4SPOEn6T3X4D2Jp/view?usp=drivesdk",
                        "updatedAt": "2024-08-08",
                        "sizeOrNote": "文件 · 7 KB"
                      }
                    ]
                  },
                  {
                    "id": "1AAmKPd7iP-SQSmdFToX-WsIHlr57Uy0-",
                    "name": "golface_deal",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1AAmKPd7iP-SQSmdFToX-WsIHlr57Uy0-",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1To7kNi117MD_7eZXnNt1AUJrFbs9PdGw",
                        "name": "20001",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1To7kNi117MD_7eZXnNt1AUJrFbs9PdGw",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1gdXqY_4MwsVT1jreicdVTwlNTAN2Ilow",
                        "name": "20002",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1gdXqY_4MwsVT1jreicdVTwlNTAN2Ilow",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1vR34ES8KvD5XdFsxgvNdvEKt5QFhrawN",
                        "name": "20004",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1vR34ES8KvD5XdFsxgvNdvEKt5QFhrawN",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1QRVI2wOMdLy7CgFCjQLmmseoAcxhodo3",
                        "name": "20008",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1QRVI2wOMdLy7CgFCjQLmmseoAcxhodo3",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1g63LBE0AgWi44mgGh0s8SdjOzXNyKvxD",
                        "name": "20009",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1g63LBE0AgWi44mgGh0s8SdjOzXNyKvxD",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1WiDlNuBggF-Yh3_TSBqgOPyYnDjchO5T",
                        "name": "20010",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1WiDlNuBggF-Yh3_TSBqgOPyYnDjchO5T",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1ufDh-7kjpNGIT9PXfs5esLWqXLVCWcP5",
                        "name": "20011",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1ufDh-7kjpNGIT9PXfs5esLWqXLVCWcP5",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1Cal6e2upRbuB_QfSxyOQ2RBqVSm8mXlJ",
                        "name": "20012",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Cal6e2upRbuB_QfSxyOQ2RBqVSm8mXlJ",
                        "updatedAt": "2024-05-13",
                        "children": []
                      },
                      {
                        "id": "1786mG1y5Vp-GllKOELqISyoQmCJKtbD0",
                        "name": "20016",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1786mG1y5Vp-GllKOELqISyoQmCJKtbD0",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1RYMnITa6VfyRWesF-HZLirJswNL-Dsvc",
                        "name": "20017",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1RYMnITa6VfyRWesF-HZLirJswNL-Dsvc",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1xpAbKKvQh1TnliwRDYtOL3GRkjvsF50G",
                        "name": "20018",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1xpAbKKvQh1TnliwRDYtOL3GRkjvsF50G",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1BonqAxIp6o7id-3NjWDpy0uktRlPTTMP",
                        "name": "20019",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1BonqAxIp6o7id-3NjWDpy0uktRlPTTMP",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1mskf2--CX-72l011k2KyYyoezs4f4sEq",
                        "name": "20020",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1mskf2--CX-72l011k2KyYyoezs4f4sEq",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "15TYy1chfvUd2pbKgkTNfKVf0zCNeCnbt",
                        "name": "after_sales_售後服務處理資源",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/15TYy1chfvUd2pbKgkTNfKVf0zCNeCnbt",
                        "updatedAt": "2025-02-24",
                        "children": []
                      },
                      {
                        "id": "1daYP1cta7IyCYr6FdrfPo-2lPtVM2ap0",
                        "name": "20240424綠通車輛待修方案V2 excel版 的複本_lester.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1daYP1cta7IyCYr6FdrfPo-2lPtVM2ap0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2024-05-17",
                        "sizeOrNote": "試算表 · 30 KB"
                      }
                    ]
                  },
                  {
                    "id": "1GVbaXlXA7OKWnJZc8z6a_LGgK6MkfJrU",
                    "name": "OS",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1GVbaXlXA7OKWnJZc8z6a_LGgK6MkfJrU",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1HDJ_h2euNXEfpY5mtQAiYhZb9zVXAHTu",
                        "name": "iptable.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1HDJ_h2euNXEfpY5mtQAiYhZb9zVXAHTu/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-07",
                        "sizeOrNote": "Word · 24 KB"
                      }
                    ]
                  },
                  {
                    "id": "1lTSTEKcSdJ0W1h0I20v9wcWMOYZ5UPMN",
                    "name": "財產編號",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1lTSTEKcSdJ0W1h0I20v9wcWMOYZ5UPMN",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1efmP-R-uSn4-IfmrN0rh0VBbH2LJO63z",
                        "name": "IMG20240612155111.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1efmP-R-uSn4-IfmrN0rh0VBbH2LJO63z/view?usp=drivesdk",
                        "updatedAt": "2024-06-12",
                        "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1lpFBIh-RRc5bUYB4PY70dVxyzifoxCkq",
                        "name": "IMG20240624140552.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1lpFBIh-RRc5bUYB4PY70dVxyzifoxCkq/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 1.7 MB"
                      },
                      {
                        "id": "1-8cM2HTprDrRGvNNvVR8kKcSOc7F037M",
                        "name": "IMG20240624140607.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1-8cM2HTprDrRGvNNvVR8kKcSOc7F037M/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1CTiTMNedjaY7_Z4OM2hDtAl__W9ql9sC",
                        "name": "IMG20240624140633.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1CTiTMNedjaY7_Z4OM2hDtAl__W9ql9sC/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 1.0 MB"
                      },
                      {
                        "id": "1iPn2wfJN-qcBf0FvQWsVLOu8bESIkIUg",
                        "name": "IMG20240624140647.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1iPn2wfJN-qcBf0FvQWsVLOu8bESIkIUg/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                      },
                      {
                        "id": "1OgIonlrzF5MUdy9JQgoTn-eB-LELelLQ",
                        "name": "IMG20240624142751.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1OgIonlrzF5MUdy9JQgoTn-eB-LELelLQ/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 1.8 MB"
                      },
                      {
                        "id": "1yel16qlteb3G73jxz84bbf8IcH3zBKwP",
                        "name": "IMG20240624143033.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1yel16qlteb3G73jxz84bbf8IcH3zBKwP/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 1.6 MB"
                      },
                      {
                        "id": "1bug6fbaZ4GGgVIxd8J-DklkvvgFWq1XA",
                        "name": "IMG20240624143127.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1bug6fbaZ4GGgVIxd8J-DklkvvgFWq1XA/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 994 KB"
                      },
                      {
                        "id": "1omiNRAm7P9C3sMH5DVDfmWnX7vtuYW-W",
                        "name": "IMG20240624143559.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1omiNRAm7P9C3sMH5DVDfmWnX7vtuYW-W/view?usp=drivesdk",
                        "updatedAt": "2024-06-24",
                        "sizeOrNote": "JPG 圖檔 · 1.4 MB"
                      },
                      {
                        "id": "1WSCShSc9xibDAFveNGQkpmIk1Y6LFMm-",
                        "name": "IMG20240625114410.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1WSCShSc9xibDAFveNGQkpmIk1Y6LFMm-/view?usp=drivesdk",
                        "updatedAt": "2024-06-25",
                        "sizeOrNote": "JPG 圖檔 · 2.1 MB"
                      },
                      {
                        "id": "1i8Yb54-KTSk47_t2b5XpYQit3M4F5qen",
                        "name": "IMG20240625114423.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1i8Yb54-KTSk47_t2b5XpYQit3M4F5qen/view?usp=drivesdk",
                        "updatedAt": "2024-06-25",
                        "sizeOrNote": "JPG 圖檔 · 1.5 MB"
                      },
                      {
                        "id": "1bXhxTUobXpdtgiedpez_8k3Ly3XUWzWG",
                        "name": "IMG20240625114506.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1bXhxTUobXpdtgiedpez_8k3Ly3XUWzWG/view?usp=drivesdk",
                        "updatedAt": "2024-06-25",
                        "sizeOrNote": "JPG 圖檔 · 1.1 MB"
                      },
                      {
                        "id": "17QQk5C40qG0cHFDhxrpKc5hfLpp4E3BI",
                        "name": "IMG20240625114517.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/17QQk5C40qG0cHFDhxrpKc5hfLpp4E3BI/view?usp=drivesdk",
                        "updatedAt": "2024-06-25",
                        "sizeOrNote": "JPG 圖檔 · 1.3 MB"
                      },
                      {
                        "id": "1tkFU2t5Q9Qa4X6cp177u3D1iG-6MnfmF",
                        "name": "IMG20240625134637.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1tkFU2t5Q9Qa4X6cp177u3D1iG-6MnfmF/view?usp=drivesdk",
                        "updatedAt": "2024-06-25",
                        "sizeOrNote": "JPG 圖檔 · 1.7 MB"
                      },
                      {
                        "id": "1hfqZiyRujOXUeEAGsAYD7Jid_7bD8ra-",
                        "name": "IMG20240625134648.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1hfqZiyRujOXUeEAGsAYD7Jid_7bD8ra-/view?usp=drivesdk",
                        "updatedAt": "2024-06-25",
                        "sizeOrNote": "JPG 圖檔 · 1.2 MB"
                      }
                    ]
                  },
                  {
                    "id": "1LFHBl14_anEFJqJncNVg1d75wQoqci9m",
                    "name": "銷售系統導入",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1LFHBl14_anEFJqJncNVg1d75wQoqci9m",
                    "updatedAt": "2025-02-24",
                    "children": [
                      {
                        "id": "1ldUt_5TTcBeSRCg2tPgBxDx-F6oGTdEA",
                        "name": "20240812_南峰.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1ldUt_5TTcBeSRCg2tPgBxDx-F6oGTdEA/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2024-08-13",
                        "sizeOrNote": "Word · 24 KB"
                      },
                      {
                        "id": "1VtNkGMYP7ZkiyTFWVr5--02WEtPTENqU",
                        "name": "20240812_南峰.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1VtNkGMYP7ZkiyTFWVr5--02WEtPTENqU/view?usp=drivesdk",
                        "updatedAt": "2024-08-09",
                        "sizeOrNote": "PDF · 68 KB"
                      }
                    ]
                  },
                  {
                    "id": "15UPuSGK-wOoE7iHW5p-sXwj8qFfesIKR",
                    "name": "1.0智慧球車產品文件_v4.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/15UPuSGK-wOoE7iHW5p-sXwj8qFfesIKR/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2024-07-04",
                    "sizeOrNote": "Word · 4.0 MB"
                  },
                  {
                    "id": "1s2Q_Jta4D3Y5AeGTe9C2An1guw5cy_Xr",
                    "name": "IMG20220411185204.jpg",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1s2Q_Jta4D3Y5AeGTe9C2An1guw5cy_Xr/view?usp=drivesdk",
                    "updatedAt": "2022-04-14",
                    "sizeOrNote": "JPG 圖檔 · 1.6 MB"
                  },
                  {
                    "id": "1F2JrnvHpgBurAMNLCpbY1YmoU4ahjQIU",
                    "name": "NX測試和系統開發.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1F2JrnvHpgBurAMNLCpbY1YmoU4ahjQIU/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-04-08",
                    "sizeOrNote": "Word · 24 KB"
                  },
                  {
                    "id": "1rRUjeo5zlo78fcDelzCgbHHRhgCt1zrK",
                    "name": "SmartkartConfigurationModule導入.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1rRUjeo5zlo78fcDelzCgbHHRhgCt1zrK/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-12-23",
                    "sizeOrNote": "Word · 67 KB"
                  },
                  {
                    "id": "1Ta9Q8SvmkzZoKEYn754vC7N4pXYr0Vxl",
                    "name": "turing_module.drawio",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1Ta9Q8SvmkzZoKEYn754vC7N4pXYr0Vxl/view?usp=drivesdk",
                    "updatedAt": "2021-12-23",
                    "sizeOrNote": "文件 · 2 KB"
                  },
                  {
                    "id": "13dpS8NwqGQ6AIPm6YsJkE1tl2H8xPkIp",
                    "name": "班芝花928to930.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/13dpS8NwqGQ6AIPm6YsJkE1tl2H8xPkIp/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-09-27",
                    "sizeOrNote": "Word · 28 KB"
                  }
                ]
              },
              {
                "id": "1xB_L52lDq6CiuJ1iqiZabvR4FbTJkyuy",
                "name": "Email attachments",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1xB_L52lDq6CiuJ1iqiZabvR4FbTJkyuy",
                "updatedAt": "2022-03-03",
                "children": []
              },
              {
                "id": "1vG-uMwnNHC-a9F4-aLmuT_2vfDSyecio",
                "name": "General",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1vG-uMwnNHC-a9F4-aLmuT_2vfDSyecio",
                "updatedAt": "2022-02-14",
                "children": []
              },
              {
                "id": "1HFhpljqm3o2Wd18-FLWZ7gk0xyxwedey",
                "name": "L4 PoC 物品統計",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1HFhpljqm3o2Wd18-FLWZ7gk0xyxwedey",
                "updatedAt": "2022-10-19",
                "children": [
                  {
                    "id": "1I0umNC5Lzsh6RqBDn70KdlESXfBgSOX1",
                    "name": "設備清單(含照片_找東西前先看）.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1I0umNC5Lzsh6RqBDn70KdlESXfBgSOX1/view?usp=drivesdk",
                    "updatedAt": "2022-10-31",
                    "sizeOrNote": "PDF · 5.7 MB"
                  },
                  {
                    "id": "1NNC6jwJXlSUC8dyUknjT_Qvlg9Qhkksq",
                    "name": "設備領用紀錄.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1NNC6jwJXlSUC8dyUknjT_Qvlg9Qhkksq/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2023-01-31",
                    "sizeOrNote": "試算表 · 19 KB"
                  }
                ]
              },
              {
                "id": "1y6gN_UG_HiAapGJENvCz81lKEIClI4jH",
                "name": "ODD define commit",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1y6gN_UG_HiAapGJENvCz81lKEIClI4jH",
                "updatedAt": "2022-10-17",
                "children": [
                  {
                    "id": "1llGeKFu7gucPPUuXsagMvhTxWxs-cHzr",
                    "name": "ODD Docs (under construction)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1llGeKFu7gucPPUuXsagMvhTxWxs-cHzr",
                    "updatedAt": "2022-10-17",
                    "children": [
                      {
                        "id": "1skYJ9KuFKExIP_CBcgozrX6YcrjnUT0j",
                        "name": "Framework of Turing ADS.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1skYJ9KuFKExIP_CBcgozrX6YcrjnUT0j/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-11-21",
                        "sizeOrNote": "試算表 · 1.8 MB"
                      },
                      {
                        "id": "1sgqsAdlw9hQT7TmTMk8DJzWo_Mn4P7ce",
                        "name": "ODD_docs_v1_20220519_template.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1sgqsAdlw9hQT7TmTMk8DJzWo_Mn4P7ce/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-08",
                        "sizeOrNote": "試算表 · 32 KB"
                      },
                      {
                        "id": "1ku8mfjHjHkEQHl5jD_vYQHzTrAuMiwwr",
                        "name": "Turing MaaS - GlofCourse [2020_2021].docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1ku8mfjHjHkEQHl5jD_vYQHzTrAuMiwwr/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-19",
                        "sizeOrNote": "Word · 1.1 MB"
                      }
                    ]
                  },
                  {
                    "id": "1Yuq5ZVgy2tnYHBCNXe57RFgeUHwO27K8",
                    "name": "References",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Yuq5ZVgy2tnYHBCNXe57RFgeUHwO27K8",
                    "updatedAt": "2022-10-17",
                    "children": [
                      {
                        "id": "18XhJv7Zo4FiGuG0BcXLInhTwjxUte9gA",
                        "name": "LSAV 標準規範",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/18XhJv7Zo4FiGuG0BcXLInhTwjxUte9gA",
                        "updatedAt": "2022-10-17",
                        "children": []
                      },
                      {
                        "id": "1L_N_1mREMxsADrNP9mCp_sfFcst-iqvi",
                        "name": "ODD 規範文件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1L_N_1mREMxsADrNP9mCp_sfFcst-iqvi",
                        "updatedAt": "2022-10-17",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "11-i7z4_bEKSwMfZb7GhGBybk8hfATDA1",
                "name": "北海道案評估",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/11-i7z4_bEKSwMfZb7GhGBybk8hfATDA1",
                "updatedAt": "2022-06-06",
                "children": [
                  {
                    "id": "1EyJQ6hR6VPCc-8XqSBnnmysQUYzVkxPp",
                    "name": "mind_project_hokkaido_220606-Map 1.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1EyJQ6hR6VPCc-8XqSBnnmysQUYzVkxPp/view?usp=drivesdk",
                    "updatedAt": "2022-06-06",
                    "sizeOrNote": "PNG 圖檔 · 490 KB"
                  }
                ]
              },
              {
                "id": "1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6",
                "name": "智慧球車v1.0",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6",
                "updatedAt": "2022-02-14",
                "children": [
                  {
                    "id": "1nKhUN3ggmEjqKrkNjiRMhynf2LevV0Wz",
                    "name": "golface_sales_case",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1nKhUN3ggmEjqKrkNjiRMhynf2LevV0Wz",
                    "updatedAt": "2023-08-31",
                    "children": [
                      {
                        "id": "10RS2lFvAFZdLZyjBP6wPPWOo4_xA_dG4",
                        "name": "20211111愛國者V3規格.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/10RS2lFvAFZdLZyjBP6wPPWOo4_xA_dG4/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-08-31",
                        "sizeOrNote": "試算表 · 113 KB"
                      },
                      {
                        "id": "17VjoV_QgCfHd75hGgZcBUGIPYsgiIBt-",
                        "name": "20230830_球車智慧系統延長保固費用試算.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/17VjoV_QgCfHd75hGgZcBUGIPYsgiIBt-/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-09-05",
                        "sizeOrNote": "試算表 · 23 KB"
                      },
                      {
                        "id": "1Ls8gcsPSLOX-e_AEHfXQ5_G4v1qD87d2",
                        "name": "NRU-110V-AGX32 +AR0147-120 報價單2台_signed.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1Ls8gcsPSLOX-e_AEHfXQ5_G4v1qD87d2/view?usp=drivesdk",
                        "updatedAt": "2023-08-31",
                        "sizeOrNote": "PDF · 685 KB",
                        "accessScope": "confidential",
                        "allowedDepartments": [
                          "營業",
                          "BD",
                          "財務",
                          "總經理"
                        ],
                        "allowedRoles": [
                          "admin",
                          "finance"
                        ]
                      },
                      {
                        "id": "1mkPePkqt-bkJaAIct0cQGiA_eOlFLmPv",
                        "name": "PI--台灣智慧駕駛--220524001_16顆1612不含天線.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1mkPePkqt-bkJaAIct0cQGiA_eOlFLmPv/view?usp=drivesdk",
                        "updatedAt": "2023-08-31",
                        "sizeOrNote": "PDF · 463 KB"
                      },
                      {
                        "id": "1cJF_89KuASpy74wpT31YNKQcqBHa32VM",
                        "name": "球車BOM細項完整版(宸耀+L2controller).xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1cJF_89KuASpy74wpT31YNKQcqBHa32VM/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-09-01",
                        "sizeOrNote": "試算表 · 193 KB"
                      }
                    ]
                  },
                  {
                    "id": "1DTiNNTCR-6Wst228-9KfvXmvI_bMfhC6",
                    "name": "lifeplus",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1DTiNNTCR-6Wst228-9KfvXmvI_bMfhC6",
                    "updatedAt": "2022-12-13",
                    "children": [
                      {
                        "id": "1bZRy91kcsQy3OLntT_52YKyVUsFwz2de",
                        "name": "租借QrCode",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1bZRy91kcsQy3OLntT_52YKyVUsFwz2de",
                        "updatedAt": "2022-12-19",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1FZdZqF0q9h-Xvt0TO-U-o8P3E5WBw-7Y",
                    "name": "Release Note",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1FZdZqF0q9h-Xvt0TO-U-o8P3E5WBw-7Y",
                    "updatedAt": "2022-02-16",
                    "children": [
                      {
                        "id": "1jF1b-75id8l-wWarFD5T15T6oovOUwQN",
                        "name": "軟體版本說明",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1jF1b-75id8l-wWarFD5T15T6oovOUwQN",
                        "updatedAt": "2022-02-22",
                        "children": []
                      },
                      {
                        "id": "1egH42wR85g8BHdZJOfxZkRFDXGBWyXfe",
                        "name": "20220221_Smtc_NanFeng_ReleaseNote.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1egH42wR85g8BHdZJOfxZkRFDXGBWyXfe/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-02-23",
                        "sizeOrNote": "Word · 256 KB"
                      },
                      {
                        "id": "1c0sz15M1ZDS6bH6CCnM_3uzlTBhSdlvN",
                        "name": "20220318_Smtc_NanFeng_ReleaseNote.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1c0sz15M1ZDS6bH6CCnM_3uzlTBhSdlvN/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-06-21",
                        "sizeOrNote": "Word · 256 KB"
                      }
                    ]
                  },
                  {
                    "id": "15rxaZd_Q64vQa1u9uHGPJU5oiuT5FcPV",
                    "name": "Scrum",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/15rxaZd_Q64vQa1u9uHGPJU5oiuT5FcPV",
                    "updatedAt": "2022-09-26",
                    "children": [
                      {
                        "id": "1bzude1AXp3ywdWvis_umjfpacQ1uBxNQ",
                        "name": "1.X time line",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1bzude1AXp3ywdWvis_umjfpacQ1uBxNQ",
                        "updatedAt": "2022-11-17",
                        "children": []
                      },
                      {
                        "id": "1pZHYYxgG81qZWQzSolabDelsgMTlH-dp",
                        "name": "smart with golface",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1pZHYYxgG81qZWQzSolabDelsgMTlH-dp",
                        "updatedAt": "2022-10-17",
                        "children": []
                      },
                      {
                        "id": "1SIRQzfhpFW35NSKFEnDscS9ZWSr347hT",
                        "name": "smartkart with argo",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1SIRQzfhpFW35NSKFEnDscS9ZWSr347hT",
                        "updatedAt": "2022-12-09",
                        "children": []
                      },
                      {
                        "id": "1jMIsoUxQE9jI99t9xugOaDex6e2QepkG",
                        "name": "smartkart1.5",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1jMIsoUxQE9jI99t9xugOaDex6e2QepkG",
                        "updatedAt": "2023-04-07",
                        "children": []
                      },
                      {
                        "id": "1b0hIJYIjuz_SVa90f0kSB7l-cQefuXzW",
                        "name": "test_record",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1b0hIJYIjuz_SVa90f0kSB7l-cQefuXzW",
                        "updatedAt": "2022-11-21",
                        "children": []
                      },
                      {
                        "id": "1eDWxmGbhWKNkyCBtFIyQm9TdCQALA7HU",
                        "name": "1.X拆解.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1eDWxmGbhWKNkyCBtFIyQm9TdCQALA7HU/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-22",
                        "sizeOrNote": "簡報 · 78 KB"
                      },
                      {
                        "id": "1784xxv-W2u-XG_p7StOV3pQNm87vcEYA",
                        "name": "亞果拆解.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1784xxv-W2u-XG_p7StOV3pQNm87vcEYA/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-12-05",
                        "sizeOrNote": "簡報 · 59 KB"
                      }
                    ]
                  },
                  {
                    "id": "1YszmgvfQK5kRuav27TYig-HxaHP_Q50Z",
                    "name": "出差測試項目",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1YszmgvfQK5kRuav27TYig-HxaHP_Q50Z",
                    "updatedAt": "2022-03-09",
                    "children": [
                      {
                        "id": "1TnHqvoAXb1L5Biv5-UJt8xZgcciZ3KxS",
                        "name": "台北港",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1TnHqvoAXb1L5Biv5-UJt8xZgcciZ3KxS",
                        "updatedAt": "2022-05-15",
                        "children": []
                      },
                      {
                        "id": "1BNBQMkCrz2LQfRQwRxrQsmI0CXuZitAW",
                        "name": "班芝花",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1BNBQMkCrz2LQfRQwRxrQsmI0CXuZitAW",
                        "updatedAt": "2022-08-30",
                        "children": []
                      },
                      {
                        "id": "1WXSzbwxZkdYw-koOSLQdOr847wnzhfBX",
                        "name": "20220310 percpetion module test.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1WXSzbwxZkdYw-koOSLQdOr847wnzhfBX/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2024-11-08",
                        "sizeOrNote": "Word · 82 KB"
                      }
                    ]
                  },
                  {
                    "id": "1AZG9elONnC_AEJNlRUq5IZERdKDMQSqq",
                    "name": "場勘照片",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1AZG9elONnC_AEJNlRUq5IZERdKDMQSqq",
                    "updatedAt": "2022-09-14",
                    "children": [
                      {
                        "id": "1CgrQzoW0Jk66EOLrsgiQ0qlvOK_IJqXm",
                        "name": "bombax_fence",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1CgrQzoW0Jk66EOLrsgiQ0qlvOK_IJqXm",
                        "updatedAt": "2022-11-16",
                        "children": []
                      },
                      {
                        "id": "1UgCViZ7OuGmPuJLzK2CnX-dpg8N16qN5",
                        "name": "GOLF_20001_定點.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1UgCViZ7OuGmPuJLzK2CnX-dpg8N16qN5/view?usp=drivesdk",
                        "updatedAt": "2022-09-20",
                        "sizeOrNote": "JPG 圖檔 · 201 KB"
                      },
                      {
                        "id": "1mLHUoKyBG6CJUbLhkjY-pX6XquAFzu8o",
                        "name": "GOLF_20001_非定點.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1mLHUoKyBG6CJUbLhkjY-pX6XquAFzu8o/view?usp=drivesdk",
                        "updatedAt": "2022-09-20",
                        "sizeOrNote": "JPG 圖檔 · 201 KB"
                      },
                      {
                        "id": "1LIi-TzX2dKCYAUtMau2quE6f2JGqL79T",
                        "name": "result_20002.kgl.html",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1LIi-TzX2dKCYAUtMau2quE6f2JGqL79T/view?usp=drivesdk",
                        "updatedAt": "2022-09-20",
                        "sizeOrNote": "文件 · 7.5 MB"
                      },
                      {
                        "id": "1ugsz2EnB-fWC-zVYvxpFesKVmSdS6s7v",
                        "name": "vio_fail.kgl.html",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1ugsz2EnB-fWC-zVYvxpFesKVmSdS6s7v/view?usp=drivesdk",
                        "updatedAt": "2022-09-20",
                        "sizeOrNote": "文件 · 25 KB"
                      },
                      {
                        "id": "1Ar3TeIxVEDs2BFmD8UzCQCVwHOFNiwq8",
                        "name": "場勘照片.zip",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1Ar3TeIxVEDs2BFmD8UzCQCVwHOFNiwq8/view?usp=drivesdk",
                        "updatedAt": "2022-09-14",
                        "sizeOrNote": "封存檔 · 772.5 MB"
                      }
                    ]
                  },
                  {
                    "id": "1jVopRCX98oH045oX__Bu9YP_SkO-5DeK",
                    "name": "導入流程",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1jVopRCX98oH045oX__Bu9YP_SkO-5DeK",
                    "updatedAt": "2022-12-26",
                    "children": [
                      {
                        "id": "1Xjj4i3pNvu49hjobNsqoIgwxWKsuNDBZ",
                        "name": "1.X導入流程.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1Xjj4i3pNvu49hjobNsqoIgwxWKsuNDBZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2023-04-14",
                        "sizeOrNote": "簡報 · 58 KB"
                      }
                    ]
                  },
                  {
                    "id": "1gOk64M0CSw28mAGjymTYjbXjYpVEgnoq",
                    "name": "智慧球車V1.0設計發想與專利申請",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1gOk64M0CSw28mAGjymTYjbXjYpVEgnoq",
                    "updatedAt": "2022-02-18",
                    "children": [
                      {
                        "id": "1qEtJ1KHGKRrVMYDzKtyMcja04uVqWTmk",
                        "name": "智慧球車V1.0_產品願景.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1qEtJ1KHGKRrVMYDzKtyMcja04uVqWTmk/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-02-18",
                        "sizeOrNote": "Word · 25 KB"
                      }
                    ]
                  },
                  {
                    "id": "1DcPNIFgtkECSZRo9Y3bowGst0AoPsMct",
                    "name": "智慧球車量產計畫",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1DcPNIFgtkECSZRo9Y3bowGst0AoPsMct",
                    "updatedAt": "2022-02-16",
                    "children": [
                      {
                        "id": "1kN0JQs1rQjm7RX36Ojo1_gs4yZI12nIx",
                        "name": "軟硬體配置",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1kN0JQs1rQjm7RX36Ojo1_gs4yZI12nIx",
                        "updatedAt": "2022-07-02",
                        "children": []
                      },
                      {
                        "id": "1T9A-OLhyxzEfAp8xfoYNgksM7T7d-oW0",
                        "name": "低階控制總成(SGK-LTA2-L2C) BoM.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1T9A-OLhyxzEfAp8xfoYNgksM7T7d-oW0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-19",
                        "sizeOrNote": "試算表 · 46 KB"
                      }
                    ]
                  },
                  {
                    "id": "1_MSkFZGxp-Wc_RZhOse99Y8fqFNSb82G",
                    "name": "會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1_MSkFZGxp-Wc_RZhOse99Y8fqFNSb82G",
                    "updatedAt": "2022-04-23",
                    "children": [
                      {
                        "id": "1DfANViIZI-u4-qXukfhAkyLOO2fGpmAo",
                        "name": "20220303_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1DfANViIZI-u4-qXukfhAkyLOO2fGpmAo",
                        "updatedAt": "2022-04-27",
                        "children": []
                      },
                      {
                        "id": "1-Kh6dMNjY82CCNCQ9P_KiydQnnNYiNIb",
                        "name": "20220311_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1-Kh6dMNjY82CCNCQ9P_KiydQnnNYiNIb",
                        "updatedAt": "2022-04-27",
                        "children": []
                      },
                      {
                        "id": "1KbbTvDG7RyALpiJrV-Gv-wpMP2_Dk1Eh",
                        "name": "20220324_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1KbbTvDG7RyALpiJrV-Gv-wpMP2_Dk1Eh",
                        "updatedAt": "2022-04-27",
                        "children": []
                      },
                      {
                        "id": "1h7EA7tuhnZK3uTc9C25QbTa7aKfU3o30",
                        "name": "20220331_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1h7EA7tuhnZK3uTc9C25QbTa7aKfU3o30",
                        "updatedAt": "2022-04-28",
                        "children": []
                      },
                      {
                        "id": "1ksDbzY8afq-pA_nushprYTmZ7tn4Wbix",
                        "name": "20220408_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1ksDbzY8afq-pA_nushprYTmZ7tn4Wbix",
                        "updatedAt": "2022-04-27",
                        "children": []
                      },
                      {
                        "id": "1MhXY26dRxGUZUgcqvXo3k72wQsrGgdih",
                        "name": "20220415_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1MhXY26dRxGUZUgcqvXo3k72wQsrGgdih",
                        "updatedAt": "2022-04-27",
                        "children": []
                      },
                      {
                        "id": "1TQpgg7EZOuU7aDVehnppUWZQEmPK2sCe",
                        "name": "20220428_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1TQpgg7EZOuU7aDVehnppUWZQEmPK2sCe",
                        "updatedAt": "2022-04-28",
                        "children": []
                      },
                      {
                        "id": "1-XqpV3qDV8DN4bIU53liqEW6SonsMRmc",
                        "name": "20220513_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1-XqpV3qDV8DN4bIU53liqEW6SonsMRmc",
                        "updatedAt": "2022-05-13",
                        "children": []
                      },
                      {
                        "id": "1Id5bXqToYrlQvQYY-q8Er9QDlqSUsFHP",
                        "name": "20220520_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Id5bXqToYrlQvQYY-q8Er9QDlqSUsFHP",
                        "updatedAt": "2022-05-20",
                        "children": []
                      },
                      {
                        "id": "1trXj-98JRCHfDFK9vcORWy2KUtVStEbv",
                        "name": "20220527_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1trXj-98JRCHfDFK9vcORWy2KUtVStEbv",
                        "updatedAt": "2022-05-23",
                        "children": []
                      },
                      {
                        "id": "1t4PjukZmOeeJcFWOQFyCdZm6eccjt9sB",
                        "name": "20220602_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1t4PjukZmOeeJcFWOQFyCdZm6eccjt9sB",
                        "updatedAt": "2022-05-30",
                        "children": []
                      },
                      {
                        "id": "1Mc2U4bue9FLpDoy7OxJqNNNYwhX-kpPE",
                        "name": "20220609_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Mc2U4bue9FLpDoy7OxJqNNNYwhX-kpPE",
                        "updatedAt": "2022-06-07",
                        "children": []
                      },
                      {
                        "id": "1t3CGHIqozAJQQFxjz6NtWocMok_Mnez4",
                        "name": "20220617_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1t3CGHIqozAJQQFxjz6NtWocMok_Mnez4",
                        "updatedAt": "2022-06-15",
                        "children": []
                      },
                      {
                        "id": "1oQmZGJaL7uDdv0n5-k34-floM27MQp6Y",
                        "name": "20220623_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1oQmZGJaL7uDdv0n5-k34-floM27MQp6Y",
                        "updatedAt": "2022-06-21",
                        "children": []
                      },
                      {
                        "id": "1EKF9U1ojskLvNZha83VcTlHilpYikghG",
                        "name": "20220630_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1EKF9U1ojskLvNZha83VcTlHilpYikghG",
                        "updatedAt": "2022-06-28",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1RxiTHarTQo23pPI6A-H3iekOkS7L7WCZ",
                    "name": "系統架構",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1RxiTHarTQo23pPI6A-H3iekOkS7L7WCZ",
                    "updatedAt": "2022-02-23",
                    "children": [
                      {
                        "id": "1c1LpKrMNtXGcjCN-3e3ACojIVhJ9UD1T",
                        "name": "1.X功能模組",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1c1LpKrMNtXGcjCN-3e3ACojIVhJ9UD1T",
                        "updatedAt": "2022-11-16",
                        "children": []
                      },
                      {
                        "id": "14Yye5xh2W0eFFcFIpVx05_DgrCJZkAYM",
                        "name": "adas system",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/14Yye5xh2W0eFFcFIpVx05_DgrCJZkAYM",
                        "updatedAt": "2022-08-30",
                        "children": []
                      },
                      {
                        "id": "1B8hUb1fnHKo6kQ5EkI0euFGBgATVvIOT",
                        "name": "Coding  Document",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1B8hUb1fnHKo6kQ5EkI0euFGBgATVvIOT",
                        "updatedAt": "2022-12-19",
                        "children": []
                      },
                      {
                        "id": "1jFjfxs9oIhy-JDQd3Z7a7UdkxAGjjg4i",
                        "name": "geofence",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1jFjfxs9oIhy-JDQd3Z7a7UdkxAGjjg4i",
                        "updatedAt": "2022-02-23",
                        "children": []
                      },
                      {
                        "id": "1WAFw0XuPE5t93g5I7lkn3MDuINo6qIbf",
                        "name": "rentalmanagement",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1WAFw0XuPE5t93g5I7lkn3MDuINo6qIbf",
                        "updatedAt": "2022-03-31",
                        "children": []
                      },
                      {
                        "id": "1yQGFwrInBQKXD_K8mJbe416pCdbNU7nt",
                        "name": "技術文件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1yQGFwrInBQKXD_K8mJbe416pCdbNU7nt",
                        "updatedAt": "2022-08-05",
                        "children": []
                      },
                      {
                        "id": "1rIeDOOL1D9YEDyFHtf4QkU5vtbORVT2V",
                        "name": "新功能開發會議紀錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1rIeDOOL1D9YEDyFHtf4QkU5vtbORVT2V",
                        "updatedAt": "2022-06-08",
                        "children": []
                      },
                      {
                        "id": "1Anarqf-zs4i6aTwWvjSkFnz_7FjOoRN0",
                        "name": "規格書",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Anarqf-zs4i6aTwWvjSkFnz_7FjOoRN0",
                        "updatedAt": "2022-11-01",
                        "children": []
                      },
                      {
                        "id": "1Zd36tW1lf9Y5bddRjDd8CkwdezaeDQBd",
                        "name": "違規事件上傳",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Zd36tW1lf9Y5bddRjDd8CkwdezaeDQBd",
                        "updatedAt": "2022-11-11",
                        "children": []
                      },
                      {
                        "id": "1NVIrGQTTF1ngHfMquz4iH2USQO35I6la",
                        "name": "遠端更新",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1NVIrGQTTF1ngHfMquz4iH2USQO35I6la",
                        "updatedAt": "2023-04-06",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1OOYz_lKSxIke_nkSAknSqIkRvyDT5ThB",
                    "name": "規格書",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1OOYz_lKSxIke_nkSAknSqIkRvyDT5ThB",
                    "updatedAt": "2022-12-26",
                    "children": [
                      {
                        "id": "183M6nbY3xY-ZjtnBWbn-zPvZ2Kpepd4B",
                        "name": "1.0",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/183M6nbY3xY-ZjtnBWbn-zPvZ2Kpepd4B",
                        "updatedAt": "2022-12-26",
                        "children": []
                      },
                      {
                        "id": "1D5ZHThWCGufbVjuGM6_vZaqCyyKoCKAU",
                        "name": "1.X",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1D5ZHThWCGufbVjuGM6_vZaqCyyKoCKAU",
                        "updatedAt": "2022-12-26",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1V4v-L1-lzXaLQrcc2E_HmT1XwPPftFDN",
                    "name": "雜項",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1V4v-L1-lzXaLQrcc2E_HmT1XwPPftFDN",
                    "updatedAt": "2022-12-19",
                    "children": [
                      {
                        "id": "1bnQpr21EN7F5A4m2BWwwLE7y0ta3EXE6",
                        "name": "CMM_report.html",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1bnQpr21EN7F5A4m2BWwwLE7y0ta3EXE6/view?usp=drivesdk",
                        "updatedAt": "2022-06-10",
                        "sizeOrNote": "文件 · 33 KB"
                      },
                      {
                        "id": "1Ydh0_lNOOZabdd8RCGlM0640D4YTf6jW",
                        "name": "original-79600294-71e9-406e-9bd2-65ff382b9a75.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1Ydh0_lNOOZabdd8RCGlM0640D4YTf6jW/view?usp=drivesdk",
                        "updatedAt": "2022-02-23",
                        "sizeOrNote": "MP4 影片 · 9.2 MB"
                      },
                      {
                        "id": "1SrlQu-q1e1IGgAOe_6JFGU_0o9ug0lBa",
                        "name": "螢幕快照 2022-02-16 15.55.30.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1SrlQu-q1e1IGgAOe_6JFGU_0o9ug0lBa/view?usp=drivesdk",
                        "updatedAt": "2022-02-16",
                        "sizeOrNote": "PNG 圖檔 · 150 KB"
                      },
                      {
                        "id": "15uqPDXxNC5gCGtfJvAmeoiS0R2QMk3Ct",
                        "name": "豐田通商體驗智慧球車流程_V3.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/15uqPDXxNC5gCGtfJvAmeoiS0R2QMk3Ct/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-02-15",
                        "sizeOrNote": "Word · 30 KB"
                      }
                    ]
                  },
                  {
                    "id": "10nd-PJxfuHig7Xbo5Xosi7rZH3F-FLrJ",
                    "name": "驗收",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/10nd-PJxfuHig7Xbo5Xosi7rZH3F-FLrJ",
                    "updatedAt": "2023-03-14",
                    "children": [
                      {
                        "id": "1fYJaux5fttbVxrmfah4zKI_-HruOoA8H",
                        "name": "doc02548820221219101601[374].pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1fYJaux5fttbVxrmfah4zKI_-HruOoA8H/view?usp=drivesdk",
                        "updatedAt": "2023-03-14",
                        "sizeOrNote": "PDF · 1.4 MB"
                      },
                      {
                        "id": "13VdgElwujrUjkc-cjI0u0FHpC7cqC-5a",
                        "name": "doc02553120221220152551[342].pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/13VdgElwujrUjkc-cjI0u0FHpC7cqC-5a/view?usp=drivesdk",
                        "updatedAt": "2023-03-14",
                        "sizeOrNote": "PDF · 1.7 MB"
                      }
                    ]
                  },
                  {
                    "id": "1tIQR5tQ9SRJHodYZGd0loqk6cmGg1LJZ",
                    "name": "20221206_球車現況整理.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1tIQR5tQ9SRJHodYZGd0loqk6cmGg1LJZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-12-08",
                    "sizeOrNote": "試算表 · 23 KB"
                  },
                  {
                    "id": "1fYTAmGFotdyjhbagVfZG_okRyQc1Skm9",
                    "name": "NX測試和系統開發.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1fYTAmGFotdyjhbagVfZG_okRyQc1Skm9/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2022-04-08",
                    "sizeOrNote": "Word · 27 KB"
                  }
                ]
              },
              {
                "id": "1_fmbrtGWRg1-8973fqEMsLsBO7LrBwyE",
                "name": "智慧球車V2.0",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1_fmbrtGWRg1-8973fqEMsLsBO7LrBwyE",
                "updatedAt": "2022-02-14",
                "children": [
                  {
                    "id": "1AdULRVnGcNbOA0zV-vcEKKKOQF-Sdott",
                    "name": "智慧球車V2.0設計發想與專利申請",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1AdULRVnGcNbOA0zV-vcEKKKOQF-Sdott",
                    "updatedAt": "2022-02-18",
                    "children": [
                      {
                        "id": "1OC3WgE-Purqk9hrd_8rZlElD3FeI67Uo",
                        "name": "smartkart_II_sys_architecture.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1OC3WgE-Purqk9hrd_8rZlElD3FeI67Uo/view?usp=drivesdk",
                        "updatedAt": "2022-02-22",
                        "sizeOrNote": "文件 · 827 B"
                      },
                      {
                        "id": "13Xa07aW8G5EJgIsSYmZLf3FJtsUGw7Nd",
                        "name": "智慧球車 V2.0_產品願景(draft).docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/13Xa07aW8G5EJgIsSYmZLf3FJtsUGw7Nd/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-04-07",
                        "sizeOrNote": "Word · 28 KB"
                      }
                    ]
                  },
                  {
                    "id": "1QgG1dPco9OhvEi4dykmCywaxEDSb30fm",
                    "name": "智慧球車架構與流程設計",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1QgG1dPco9OhvEi4dykmCywaxEDSb30fm",
                    "updatedAt": "2022-05-11",
                    "children": [
                      {
                        "id": "1aQ1aNnmQPtKEwOEBvZ4BChEQBE2GM3z1",
                        "name": "TuringSmakart_Flow_V1_20220512.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1aQ1aNnmQPtKEwOEBvZ4BChEQBE2GM3z1/view?usp=drivesdk",
                        "updatedAt": "2022-05-13",
                        "sizeOrNote": "文件 · 1.5 MB"
                      },
                      {
                        "id": "1elbg2Wubf4J-uAIetF_vDopQrqoAQJrK",
                        "name": "TuringSmakart_Flow_V2.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1elbg2Wubf4J-uAIetF_vDopQrqoAQJrK/view?usp=drivesdk",
                        "updatedAt": "2022-05-16",
                        "sizeOrNote": "文件 · 1.5 MB"
                      },
                      {
                        "id": "12deaC_ooaD7cYdsI6zZuGKuf9TTRSBTq",
                        "name": "TuringSmartKart_Flow_V0.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/12deaC_ooaD7cYdsI6zZuGKuf9TTRSBTq/view?usp=drivesdk",
                        "updatedAt": "2022-05-11",
                        "sizeOrNote": "文件 · 12 KB"
                      },
                      {
                        "id": "1vJbPQowJavvkTGsB0ZtOVJK8pAYaSIX-",
                        "name": "智慧球車服務流程.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1vJbPQowJavvkTGsB0ZtOVJK8pAYaSIX-/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-05-13",
                        "sizeOrNote": "簡報 · 1.9 MB"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "2023-yajing-robobus",
        "code": "RB-YAJING",
        "name": "亞勁 Robobus 自駕小巴專案",
        "startYear": 2023,
        "period": "2023",
        "department": "客戶專案執行",
        "sharedDriveName": "專案執行",
        "status": "completed",
        "summary": "與亞勁車電合作之 Robobus 自動駕駛小型巴士整合專案，包含底盤 CAN Bus 介面、感測器配置與場域試運行規劃。",
        "highlights": [
          "Robobus 線控底盤對接",
          "感測器支架與工控機配置"
        ],
        "driveFolderId": "1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI",
        "files": [
          {
            "id": "1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI",
            "name": "3_客戶專案執行 > 亞勁 Robobus",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI",
            "updatedAt": "2023-08",
            "sizeOrNote": "技術規範、介面定義與測試紀錄",
            "children": [
              {
                "id": "1-iUpFRsCzzsd0P6Kwi18M12Rvhov_y7P",
                "name": "亞勁自駕設備配置調查表對應車型RoboBus231205.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1-iUpFRsCzzsd0P6Kwi18M12Rvhov_y7P/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2023-12-29",
                "sizeOrNote": "試算表 · 57 KB"
              }
            ]
          }
        ]
      },
      {
        "id": "2023-t3-early",
        "code": "T3-2023",
        "name": "T3 專案前期規劃與技術可行性評估（2023 old）",
        "startYear": 2023,
        "period": "2023",
        "department": "專案執行 / 系統工程",
        "sharedDriveName": "T3 projects",
        "status": "archived",
        "summary": "桃園機場 T3 旅客運輸系統早期備標、路線廊道研究與自駕車隊容量模擬歸檔資料夾。",
        "highlights": [
          "T3 早期路線與運量評估",
          "前期廠商訪談與規格草案"
        ],
        "driveFolderId": "1fARcQv88_NY3imjGmY774sn08qvusLdv",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1fARcQv88_NY3imjGmY774sn08qvusLdv",
        "files": [
          {
            "id": "1fARcQv88_NY3imjGmY774sn08qvusLdv",
            "name": "T3 projects > 2023 old",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1fARcQv88_NY3imjGmY774sn08qvusLdv",
            "updatedAt": "2023-12",
            "sizeOrNote": "2023 年前期評估歸檔文件",
            "children": [
              {
                "id": "1v3Yc7HXGyxZTr1-5OUg3Oq9bq0f3ODO0",
                "name": "20230116_T3案工項表.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1v3Yc7HXGyxZTr1-5OUg3Oq9bq0f3ODO0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2025-02-27",
                "sizeOrNote": "試算表 · 57 KB"
              },
              {
                "id": "1Q3cGwwW0qMM04QyQilGLJosmWaBUabGM",
                "name": "20231220_桃園ART.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1Q3cGwwW0qMM04QyQilGLJosmWaBUabGM/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2023-12-21",
                "sizeOrNote": "簡報 · 7.7 MB"
              },
              {
                "id": "1iZjKpVxccr0AtGCDoCMjiqEX2slhvdsh",
                "name": "Hwacom proposal.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1iZjKpVxccr0AtGCDoCMjiqEX2slhvdsh/view?usp=drivesdk",
                "updatedAt": "2025-01-09",
                "sizeOrNote": "PDF · 18.2 MB"
              },
              {
                "id": "1ImlYhh3qkpUcEsezcn6csAMkERp4tJqC",
                "name": "RoBobus变形开发16人方案简述-20230906.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1ImlYhh3qkpUcEsezcn6csAMkERp4tJqC/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2023-09-07",
                "sizeOrNote": "試算表 · 363 KB"
              },
              {
                "id": "1fLv9620jKq5NxHVthXUgxIRp_Vqr3gbY",
                "name": "T3 PMS quotation.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1fLv9620jKq5NxHVthXUgxIRp_Vqr3gbY/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-03-01",
                "sizeOrNote": "試算表 · 40 KB"
              },
              {
                "id": "1CaXx8O6N1oprMpfc6hpDZ0VLg3JwTN59",
                "name": "T3 PMS quotation0510.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1CaXx8O6N1oprMpfc6hpDZ0VLg3JwTN59/view?usp=drivesdk",
                "updatedAt": "2024-05-13",
                "sizeOrNote": "PDF · 332 KB"
              },
              {
                "id": "1qq48Qp0f_VyLDScAFjw-BentrEZHsBER",
                "name": "T3 PMS quotation0510.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1qq48Qp0f_VyLDScAFjw-BentrEZHsBER/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-05-14",
                "sizeOrNote": "試算表 · 74 KB"
              },
              {
                "id": "1hvqeYR7BBmaxGkrK8O4l_xsoXJdKCvjt",
                "name": "T3 PMS quotation0514.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1hvqeYR7BBmaxGkrK8O4l_xsoXJdKCvjt/view?usp=drivesdk",
                "updatedAt": "2024-05-14",
                "sizeOrNote": "PDF · 332 KB"
              },
              {
                "id": "1yGhHuSKYs7PzAUse-AvLJ9mDz6sVIlJg",
                "name": "T3 PMS投標簡報(TURING)_20231103.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1yGhHuSKYs7PzAUse-AvLJ9mDz6sVIlJg/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-04-29",
                "sizeOrNote": "簡報 · 29.8 MB"
              },
              {
                "id": "1ea_iGpll1GUHZzm7kRjkYo7rITrwKZ4J",
                "name": "T3 PMS案工作項目表20240229_TF.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1ea_iGpll1GUHZzm7kRjkYo7rITrwKZ4J/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-03-01",
                "sizeOrNote": "試算表 · 2.2 MB"
              },
              {
                "id": "1mksiiJhRlgCoZ_Tr4sFCjupxAbx0LdQb",
                "name": "T3 project T4TD estimation.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1mksiiJhRlgCoZ_Tr4sFCjupxAbx0LdQb/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2025-05-16",
                "sizeOrNote": "試算表 · 26 KB"
              },
              {
                "id": "1LZXDtkU-Kk1APVLd46rdonPCw8lSjG0m",
                "name": "T3 proposal(FHN).pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1LZXDtkU-Kk1APVLd46rdonPCw8lSjG0m/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2025-01-09",
                "sizeOrNote": "簡報 · 5.8 MB"
              },
              {
                "id": "1WCt6pi1gUhTp3jSEm_8YCchyv-wNIo0V",
                "name": "T3 TMS案承接工項清單_0223.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1WCt6pi1gUhTp3jSEm_8YCchyv-wNIo0V/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-02-23",
                "sizeOrNote": "試算表 · 30 KB"
              },
              {
                "id": "1Nsr86aCEAMNwwpgH0yaqtIBQHjdJmsfj",
                "name": "T3 TMS案承接工項清單_0229.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1Nsr86aCEAMNwwpgH0yaqtIBQHjdJmsfj/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-02-29",
                "sizeOrNote": "試算表 · 23 KB"
              },
              {
                "id": "1mtFtzBXqopjIYbeJCpoFACW9xilahHzR",
                "name": "T3 TMS案承接工項清單_20240129（Turing改）.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1mtFtzBXqopjIYbeJCpoFACW9xilahHzR/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-02-15",
                "sizeOrNote": "試算表 · 41 KB"
              },
              {
                "id": "1kJXyQJpCSlR71aZEUKIYKWBCcfxVRwj0",
                "name": "T3 TMS案承接工項清單_20240206.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1kJXyQJpCSlR71aZEUKIYKWBCcfxVRwj0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-02-29",
                "sizeOrNote": "試算表 · 50 KB"
              },
              {
                "id": "1qn2RoBHPH9ahciHNVemyeV26Xi_KEJVc",
                "name": "T3 TMS案承接工項清單_20240301.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1qn2RoBHPH9ahciHNVemyeV26Xi_KEJVc/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2025-02-27",
                "sizeOrNote": "試算表 · 50 KB"
              },
              {
                "id": "1aF-KX_jZ2mLCA2ialR4ltbwM0Hk60SGw",
                "name": "T3 TMS案承接工項清單_20250306.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1aF-KX_jZ2mLCA2ialR4ltbwM0Hk60SGw/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2025-03-13",
                "sizeOrNote": "試算表 · 204 KB"
              },
              {
                "id": "1h3U4lpDcJUcxhTKfMJViEDiGkmY_ejRb",
                "name": "T3proposal-0303.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1h3U4lpDcJUcxhTKfMJViEDiGkmY_ejRb/view?usp=drivesdk",
                "updatedAt": "2024-11-01",
                "sizeOrNote": "PDF · 4.3 MB"
              },
              {
                "id": "1NP7C6Q3B0oX2en4KKNzCmDWuwJ_E3ki3",
                "name": "T3proposal-0303.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1NP7C6Q3B0oX2en4KKNzCmDWuwJ_E3ki3/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2024-11-01",
                "sizeOrNote": "簡報 · 152.9 MB"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "year": 2021,
    "label": "2021–2022 年起始專案",
    "tagline": "台北市信義路自駕巴士夜間實證（ADRTS）、台北港 5G 科專、桃園青埔二期營運案",
    "projectOverview": "台灣指標性自駕開放道路與港區實證時期：執行台北市信義路公車專用道自駕巴士創新實驗計畫（ADRTS）、台北港 5G 科專計畫，以及桃園青埔自駕電動巴士試運行計畫。",
    "projects": [
      {
        "id": "2021-xinyi-adrts",
        "code": "TPE-ADRTS",
        "name": "20210501_信義路自駕巴士_ADRTS實證運行計畫",
        "startYear": 2021,
        "period": "2021 – 2022",
        "department": "交通行動服務部 / 客戶專案執行",
        "sharedDriveName": "交通行動服務部 | MaaS",
        "status": "archived",
        "summary": "台北市信義路雙向公車專用道夜間自駕巴士實證運行計畫，包含試車牌展延申請、公文收寄、工作會議、每月通報單、查核點項目、異業合作與無人載具補助計畫分工經費表。",
        "highlights": [
          "01 試車牌展延申請 / 07 每月通報單 / 08 查核點項目",
          "無人載具補助計畫分工+經費20210415.xlsx",
          "3_客戶專案執行 > (closed)信義路專案 完整歸檔"
        ],
        "driveFolderId": "1_fjkOLgZZ-_keR5ezK-Arq44NeH-EJuU",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1_fjkOLgZZ-_keR5ezK-Arq44NeH-EJuU",
        "files": [
          {
            "id": "1u0TYTDWhVZQ7OuSvqEbzmHBC62VuJljK",
            "name": "01 試車牌展延申請",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1u0TYTDWhVZQ7OuSvqEbzmHBC62VuJljK",
            "updatedAt": "2021-05-14",
            "sizeOrNote": "自動駕駛試車牌照申請與展延核准函",
            "children": [
              {
                "id": "1hFXva4Jh5Gmghe5y1qRN5koMnY1S3xpl",
                "name": "0407告示牌補貼紙",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1hFXva4Jh5Gmghe5y1qRN5koMnY1S3xpl",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "信義路專用道試車告示牌面與補丁貼紙",
                "children": [
                  {
                    "id": "1YWXC6ANOTFYe2qSz-3rMOSxRJRHOyFm4",
                    "name": "臨時牌面0507(最終版)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1YWXC6ANOTFYe2qSz-3rMOSxRJRHOyFm4",
                    "updatedAt": "2021-05-07",
                    "sizeOrNote": "05/07 最終核定版臨時告示牌面",
                    "children": [
                      {
                        "id": "1wZ6T-eAfNKDPvXcafDLSu6Zf73FDwZgn",
                        "name": "信義路所有車輛行照車牌照片.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1wZ6T-eAfNKDPvXcafDLSu6Zf73FDwZgn/view?usp=drivesdk",
                        "updatedAt": "2021-05-07",
                        "sizeOrNote": "PDF · 2.4 MB · 實驗車輛試車牌面與行照核定照片"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1monznzz4o36qQbqmApoERCvnHceQAIl_",
                "name": "保險單",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1monznzz4o36qQbqmApoERCvnHceQAIl_",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "試車牌展延強制險與責任險保單",
                "children": [
                  {
                    "id": "1ZgAIQNUCy4NLBCpxyFcaJOUeOZYZ1pJT",
                    "name": "2保險單OK.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1ZgAIQNUCy4NLBCpxyFcaJOUeOZYZ1pJT/view?usp=drivesdk",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "PDF · 1.5 MB · 信義路自駕巴士強制險與公共意外責任險保單"
                  },
                  {
                    "id": "1HFNNB4QBVKfOiJFE76wrDU5Yz11iRdtP",
                    "name": "台灣智慧駕駛_公共意外責任險報價(富邦).pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1HFNNB4QBVKfOiJFE76wrDU5Yz11iRdtP/view?usp=drivesdk",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "PDF · 620 KB · 富邦產險公共意外責任險保單明細"
                  }
                ]
              },
              {
                "id": "1AjUiFpZPCyzWdPnlWoLiBGuqOEvDkQs-",
                "name": "1100401_申請人執行測試前函復備查函文_展延版",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1AjUiFpZPCyzWdPnlWoLiBGuqOEvDkQs-",
                "updatedAt": "2021-04-01",
                "sizeOrNote": "執行測試前函復備查函文（展延版）",
                "children": [
                  {
                    "id": "136tCVK2gbN6NHTbRQeYnldetXwUF1Ze1",
                    "name": "00申請人回復綜整審查意見(台灣智駕公司)1100119_回復0203.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/136tCVK2gbN6NHTbRQeYnldetXwUF1Ze1/edit",
                    "updatedAt": "2021-04-01",
                    "sizeOrNote": "Word · 380 KB · 申請人執行測試前函復審查意見對照表"
                  },
                  {
                    "id": "17DT1G70_P1qsHqvW774LYG6CaKrWq72j",
                    "name": "「無人載具科技創新實驗計畫」展延申請資格文件檢查回復表_申請人回覆_1228.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/17DT1G70_P1qsHqvW774LYG6CaKrWq72j/edit",
                    "updatedAt": "2021-04-01",
                    "sizeOrNote": "Word · 290 KB · 展延申請資格文件檢查回復表"
                  }
                ]
              },
              {
                "id": "18bwz2R7lqmG-jQq6a0bUeHj6LeDJaleq",
                "name": "1091218台北市政府同意展延公函.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/18bwz2R7lqmG-jQq6a0bUeHj6LeDJaleq/view?usp=drivesdk",
                "updatedAt": "2020-12-18",
                "sizeOrNote": "PDF · 420 KB · 台北市政府同意展延公函"
              }
            ]
          },
          {
            "id": "1V8Zjs8PurX6YCsmJ7ZPFvdBxH58kMSno",
            "name": "02 公文收寄",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1V8Zjs8PurX6YCsmJ7ZPFvdBxH58kMSno",
            "updatedAt": "2021-05-05",
            "sizeOrNote": "北市府、交通局與經濟部公文往來歸檔",
            "children": [
              {
                "id": "1noeGOSxC6luwSDTgRkplWx9eCS38B7pU",
                "name": "1100323_合作意向書延簽",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1noeGOSxC6luwSDTgRkplWx9eCS38B7pU",
                "updatedAt": "2021-03-23",
                "sizeOrNote": "合作意向書延簽公文",
                "children": [
                  {
                    "id": "156o796L2mlhZW5IlrjpxSPLoJnhMUoFZ",
                    "name": "1080826_台北市信義路公車專用道自駕巴士創新實驗計畫合作意向書_final_signed.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/156o796L2mlhZW5IlrjpxSPLoJnhMUoFZ/view?usp=drivesdk",
                    "updatedAt": "2021-03-23",
                    "sizeOrNote": "PDF · 1.8 MB · 台北市政府合作意向書用印簽署版"
                  }
                ]
              },
              {
                "id": "1Q-vceubTI4weR7CvC1CUuHV3xF-2XHW7",
                "name": "1100401_「臺北市信義路公車專用道自駕巴士創新實驗計畫」第二期試辦項目及合作意向書",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1Q-vceubTI4weR7CvC1CUuHV3xF-2XHW7",
                "updatedAt": "2021-04-01",
                "sizeOrNote": "第二期試辦項目及合作意向書",
                "children": [
                  {
                    "id": "150VqoddperVd0-R9W2oH02CyYBXw41i0",
                    "name": "1080826_台北市信義路公車專用道自駕巴士創新實驗計畫合作意向書_final.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/150VqoddperVd0-R9W2oH02CyYBXw41i0/view?usp=drivesdk",
                    "updatedAt": "2021-04-01",
                    "sizeOrNote": "PDF · 1.6 MB · 臺北市信義路公車專用道自駕巴士創新實驗計畫合作意向書定稿"
                  },
                  {
                    "id": "1BqtmhV4VsHRNQ0b9dv1njFFgf1IeIEBa",
                    "name": "1080815(附件2)台北市信義路公車專用道自駕巴士創新實驗計畫合作意向書v2.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1BqtmhV4VsHRNQ0b9dv1njFFgf1IeIEBa/edit",
                    "updatedAt": "2021-04-01",
                    "sizeOrNote": "Word · 420 KB · 第二期試辦項目及合作意向書附件"
                  }
                ]
              },
              {
                "id": "1Yw6Kt09i8shOYHG11JC1Qp_eFqMhLz8t",
                "name": "1100412_實驗場域警示標誌與交維措施備查",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1Yw6Kt09i8shOYHG11JC1Qp_eFqMhLz8t",
                "updatedAt": "2021-04-12",
                "sizeOrNote": "實驗場域警示標誌與交維措施備查函",
                "children": [
                  {
                    "id": "17C9FWXgmFK7noFcRLbPxXav98Dg9o39T",
                    "name": "109-06-23 4米車標示回文_函文.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/17C9FWXgmFK7noFcRLbPxXav98Dg9o39T/view?usp=drivesdk",
                    "updatedAt": "2021-04-12",
                    "sizeOrNote": "PDF · 540 KB · 實驗場域車輛警示標誌與交維措施備查函"
                  },
                  {
                    "id": "1XlDUROFRWVM4h7ld3gKeprWGc8H54MGN",
                    "name": "109-06-23 6M+4M車貼設計尺規圖.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1XlDUROFRWVM4h7ld3gKeprWGc8H54MGN/view?usp=drivesdk",
                    "updatedAt": "2021-04-12",
                    "sizeOrNote": "PDF · 3.1 MB · 6米與4米自駕巴士車身警示標誌尺規設計圖"
                  }
                ]
              },
              {
                "id": "1SEAgZGHwetZTWfLW5_9D4nw7HM3jhu57",
                "name": "1100505_更正實驗時間函",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1SEAgZGHwetZTWfLW5_9D4nw7HM3jhu57",
                "updatedAt": "2021-05-05",
                "sizeOrNote": "更正實驗時間公函",
                "children": [
                  {
                    "id": "1QkzRcGSjXNh_UuG03zL8zEXXX9_AV6It",
                    "name": "109-12-02適應式號誌避開營運時段_函文_交工處.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1QkzRcGSjXNh_UuG03zL8zEXXX9_AV6It/view?usp=drivesdk",
                    "updatedAt": "2021-05-05",
                    "sizeOrNote": "PDF · 480 KB · 實驗運行時段與號誌時制協調公函"
                  },
                  {
                    "id": "1zPYBN2XrQNkMI2z3dQxzld8WVBBg8uBz",
                    "name": "無人載具科技創新實驗計畫-計畫展延公文.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1zPYBN2XrQNkMI2z3dQxzld8WVBBg8uBz/edit",
                    "updatedAt": "2021-05-05",
                    "sizeOrNote": "Word · 85 KB · 實驗時間更正與展延申請函稿"
                  }
                ]
              },
              {
                "id": "13cQFGJGEWYasTDpdZEZjgFP0EOdI0FGc",
                "name": "109-10-15 載客上路測試相關備查文件.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/13cQFGJGEWYasTDpdZEZjgFP0EOdI0FGc/view?usp=drivesdk",
                "updatedAt": "2020-10-15",
                "sizeOrNote": "PDF · 1.2 MB · 載客上路測試相關備查文件"
              },
              {
                "id": "11vnpvqf6iVF1xv80Kf_uhXzMzGHj2BTV",
                "name": "109-10-23核定函(修正).pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/11vnpvqf6iVF1xv80Kf_uhXzMzGHj2BTV/view?usp=drivesdk",
                "updatedAt": "2020-10-23",
                "sizeOrNote": "PDF · 860 KB · 實證運行計畫核定函(修正版)"
              }
            ]
          },
          {
            "id": "19saRSSTX-IRgAdmWKKTF6F51oVNmfCvR",
            "name": "04 工作紀錄 & 03 工作會議",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/19saRSSTX-IRgAdmWKKTF6F51oVNmfCvR",
            "updatedAt": "2021-05-14",
            "sizeOrNote": "夜間道路測試紀錄與跨單位工作會議",
            "children": [
              {
                "id": "1cdyAkEMNYvaSVXqK-B6JoPOb3ZMoNnvm",
                "name": "0401北市府延簽合作同意書",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1cdyAkEMNYvaSVXqK-B6JoPOb3ZMoNnvm",
                "updatedAt": "2021-04-01",
                "sizeOrNote": "北市府延簽合作同意書會議與媒體資料",
                "children": [
                  {
                    "id": "1lKsBs7EE3m4iX_d5V8BPoYYYki_Z3YRo",
                    "name": "提供給議會媒體資料",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1lKsBs7EE3m4iX_d5V8BPoYYYki_Z3YRo",
                    "updatedAt": "2021-04-01",
                    "sizeOrNote": "台北市議會與媒體說明簡報資料",
                    "children": [
                      {
                        "id": "1JAK6_PVrIva2MZr9utXnniH_l1zkdmkx",
                        "name": "FET 市府記者會報告-20200911-2.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1JAK6_PVrIva2MZr9utXnniH_l1zkdmkx/view?usp=drivesdk",
                        "updatedAt": "2021-04-01",
                        "sizeOrNote": "PDF · 4.2 MB · 台北市府與議會媒體公開說明簡報"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1nVH9kvwe2onJFeJo5iBjrfAkYEcFgYQi",
                "name": "0414二期科專拜會市府會前會",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1nVH9kvwe2onJFeJo5iBjrfAkYEcFgYQi",
                "updatedAt": "2021-04-14",
                "sizeOrNote": "二期科專拜會市府會前會紀錄",
                "children": [
                  {
                    "id": "1R3Pgoe6S2dde255_wzh0-9Q9n2nhSE9f",
                    "name": "信義路進度說明0302v1.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1R3Pgoe6S2dde255_wzh0-9Q9n2nhSE9f/edit",
                    "updatedAt": "2021-04-14",
                    "sizeOrNote": "簡報 · 6.8 MB · 二期科專拜會市府會前會進度說明簡報"
                  }
                ]
              },
              {
                "id": "1LAJJEf3Kno2SeomKK2b2NwTvnzv2n9z6",
                "name": "0407大雄哥6米車拖車",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1LAJJEf3Kno2SeomKK2b2NwTvnzv2n9z6",
                "updatedAt": "2021-04-07",
                "sizeOrNote": "6米自駕巴士拖車作業紀錄",
                "children": [
                  {
                    "id": "17d7-31L_uE3e-K73Sc18QC2VN48uOB63",
                    "name": "TRN6米纯動車型檢查點檢表 2020.311＿mod Kevin.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/17d7-31L_uE3e-K73Sc18QC2VN48uOB63/view?usp=drivesdk",
                    "updatedAt": "2021-04-07",
                    "sizeOrNote": "PDF · 520 KB · 6米自駕巴士拖車與出車前安全點檢表"
                  },
                  {
                    "id": "1KZEoYWiq_OkCUq58dPoNlZ2Whw_2X9Hp",
                    "name": "自動駕駛 開_關機程序.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1KZEoYWiq_OkCUq58dPoNlZ2Whw_2X9Hp/edit",
                    "updatedAt": "2021-04-07",
                    "sizeOrNote": "Word · 1.4 MB · 6米自駕巴士開關機與拖車整備SOP"
                  }
                ]
              },
              {
                "id": "1gsuuIG9hWvDZrPDPFPaQEsWa1Z_7aZCn",
                "name": "0412牌面補丁",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1gsuuIG9hWvDZrPDPFPaQEsWa1Z_7aZCn",
                "updatedAt": "2021-04-12",
                "sizeOrNote": "04/09 + 04/12 信義路告示牌貼紙完工照片",
                "children": [
                  {
                    "id": "16wc86SwDPzj_GD3JR5RZA0q9GgF6SJxZ",
                    "name": "(0409+0412完工照片)信義路告示牌貼紙",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/16wc86SwDPzj_GD3JR5RZA0q9GgF6SJxZ",
                    "updatedAt": "2021-04-12",
                    "sizeOrNote": "沿線公車專用道站牌告示貼紙施工照片",
                    "children": [
                      {
                        "id": "19gIrybpqh8Vp3mH3aa_7H2lddyHhTCJn",
                        "name": "信義路專用道站牌告示牌貼紙完工照_01.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/19gIrybpqh8Vp3mH3aa_7H2lddyHhTCJn/view?usp=drivesdk",
                        "updatedAt": "2021-04-12",
                        "sizeOrNote": "JPG 圖檔 · 340 KB · 04/09 沿線候車站牌告示貼紙施工紀錄"
                      },
                      {
                        "id": "12eUJ9K0wwWsd-b4dURvUrJHI0X5EZXiS",
                        "name": "信義路專用道站牌告示牌貼紙完工照_02.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/12eUJ9K0wwWsd-b4dURvUrJHI0X5EZXiS/view?usp=drivesdk",
                        "updatedAt": "2021-04-12",
                        "sizeOrNote": "JPG 圖檔 · 360 KB · 04/12 沿線候車站牌告示貼紙完工確認照"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1lOTD1-gBJyyWwf9WDcxD7l_dNFbSBc9A",
                "name": "台北通APP乘客搭車須知",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1lOTD1-gBJyyWwf9WDcxD7l_dNFbSBc9A",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "台北通 APP 預約試乘與乘客搭車須知規範",
                "children": [
                  {
                    "id": "1Qoe_MKc9G3NRgQWcw9IaM6waE7t2EsBv",
                    "name": "「臺北市聯營公車敬告乘客條款」20190805(修訂後).pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1Qoe_MKc9G3NRgQWcw9IaM6waE7t2EsBv/view?usp=drivesdk",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "PDF · 310 KB · 台北通 APP 預約試乘與乘客搭車安全條款"
                  },
                  {
                    "id": "11fpWyU3Np5Xbwr9z-7GVJQMo7maWTNpX",
                    "name": "乘客乘車安全宣導事項.doc",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/11fpWyU3Np5Xbwr9z-7GVJQMo7maWTNpX/edit",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "Word · 95 KB · 自駕巴士試乘旅客乘車安全須知"
                  }
                ]
              },
              {
                "id": "15fKXkEtRa74uIx1Z8emSG3IvEWxE_gop",
                "name": "市長與公民團體搭乘",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/15fKXkEtRa74uIx1Z8emSG3IvEWxE_gop",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "市長視察與公民團體試乘活動規劃紀錄",
                "children": [
                  {
                    "id": "1xATMmilv1Fw8O_6rWKSkT9dYibdHRaF7",
                    "name": "議員試乘自駕車名單v2.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1xATMmilv1Fw8O_6rWKSkT9dYibdHRaF7/view?usp=drivesdk",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "PDF · 420 KB · 台北市府首長、議員與公民團體試乘梯次名單"
                  },
                  {
                    "id": "1yAaQd6CYSdGLwESckumtekBFSgJHNWKl",
                    "name": "信義路調查問卷v4.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1yAaQd6CYSdGLwESckumtekBFSgJHNWKl/view?usp=drivesdk",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "PDF · 280 KB · 公民團體試乘體驗滿意度調查問卷"
                  }
                ]
              },
              {
                "id": "1ZRuZ9ZdPPAEW7Nk7s4NuR9JEUjUhFEMA",
                "name": "義交派遣",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1ZRuZ9ZdPPAEW7Nk7s4NuR9JEUjUhFEMA",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "信義路沿線重要路口義交協勤派遣表",
                "children": [
                  {
                    "id": "1d_9UtK418O6kZq4Ubzyv1_JdZOc1Psd8",
                    "name": "大都會客運緊急事件處理標準作業程序109.05.27.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1d_9UtK418O6kZq4Ubzyv1_JdZOc1Psd8/edit",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "Word · 180 KB · 路口義交協勤與緊急事件處理標準作業程序"
                  },
                  {
                    "id": "19h05qWHeG7NrCEV5bGEjW2hd5-ABvTVj",
                    "name": "自駕車行駛站位(確定版).xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/19h05qWHeG7NrCEV5bGEjW2hd5-ABvTVj/edit",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "試算表 · 42 KB · 信義路沿線各路口站位與義交配置表"
                  }
                ]
              },
              {
                "id": "1i6kucZhCVFvQFtViiMYyByYf_KK_H6UF",
                "name": "車輛保險",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1i6kucZhCVFvQFtViiMYyByYf_KK_H6UF",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "實驗車輛與乘客責任險投保紀錄",
                "children": [
                  {
                    "id": "19ZbCRAGxWLCstBbfFQaDrproglnFLCDi",
                    "name": "4M#1.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/19ZbCRAGxWLCstBbfFQaDrproglnFLCDi/view?usp=drivesdk",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "PDF · 490 KB · 4米自駕巴士試車牌行照與車險投保憑證"
                  },
                  {
                    "id": "1GCAUTC2CyRpQWG-gYRRHQkKOY6fNFjqd",
                    "name": "6M#1.pdf",
                    "kind": "pdf",
                    "driveUrl": "https://drive.google.com/file/d/1GCAUTC2CyRpQWG-gYRRHQkKOY6fNFjqd/view?usp=drivesdk",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "PDF · 510 KB · 6米自駕巴士試車牌行照與車險投保憑證"
                  }
                ]
              },
              {
                "id": "1kKbiFT-kVLA_hTCxlSNxXDwK3XgcIOnd",
                "name": "防疫政策",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1kKbiFT-kVLA_hTCxlSNxXDwK3XgcIOnd",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "車廂清消與試乘防疫應變計畫",
                "children": [
                  {
                    "id": "1XW3b9SaBPLwp4ei3PrdBsHYgwOoPOU03",
                    "name": "本市聯營冷氣公車車廂內溫度以設定為攝氏24度.doc",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1XW3b9SaBPLwp4ei3PrdBsHYgwOoPOU03/edit",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "Word · 68 KB · 車廂空調循環、清消作業與防疫規範"
                  }
                ]
              }
            ]
          },
          {
            "id": "1FxSzl9u3rXyUvRz_b8FASJHRLemVY0x_",
            "name": "07 每月通報單",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1FxSzl9u3rXyUvRz_b8FASJHRLemVY0x_",
            "updatedAt": "2021-05-14",
            "sizeOrNote": "創新實驗每月運行里程與安全通報單",
            "children": [
              {
                "id": "1VtE3IyV8AtUZOYBVnIr5KH2Qss6550w4",
                "name": "信義路自駕_人工介入次數統計表_A車_20210128.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1VtE3IyV8AtUZOYBVnIr5KH2Qss6550w4/edit",
                "updatedAt": "2021-01-28",
                "sizeOrNote": "試算表 · 45 KB · 信義路自駕 A 車人工介入次數與里程通報統計表"
              },
              {
                "id": "1A65ELq-haiDEuWHIGoPrbJ0UQ-jjK3Xc",
                "name": "109-10-19 信義路場域測繪計劃案.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1A65ELq-haiDEuWHIGoPrbJ0UQ-jjK3Xc/view?usp=drivesdk",
                "updatedAt": "2020-10-19",
                "sizeOrNote": "PDF · 1.4 MB · 信義路場域高精地圖測繪計畫備查案"
              }
            ]
          },
          {
            "id": "1mgMXA4HqhC7N5z6SkWEzTYCrvTWD2wJF",
            "name": "08 查核點項目",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1mgMXA4HqhC7N5z6SkWEzTYCrvTWD2wJF",
            "updatedAt": "2021-05-14",
            "sizeOrNote": "主管機關期中與期末查核點佐證資料",
            "children": [
              {
                "id": "1i_u3pDuc1hYWGAx2yF0e__Ya19g88aq2",
                "name": "桃捷B車盲區偵測",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1i_u3pDuc1hYWGAx2yF0e__Ya19g88aq2",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "B 車盲區偵測查核點驗證資料"
              }
            ]
          },
          {
            "id": "1BKQrpFoIo-8slbhFY0KPaIzwbys1WNOK",
            "name": "88_工作區",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1BKQrpFoIo-8slbhFY0KPaIzwbys1WNOK",
            "updatedAt": "2021-05-14",
            "sizeOrNote": "第二年度計畫規劃書與經費預算工作區",
            "children": [
              {
                "id": "17D2wYapRvm01sJtxCAO5G8Kn0ji0a_RB",
                "name": "工作底圖",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/17D2wYapRvm01sJtxCAO5G8Kn0ji0a_RB",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "信義路路線與站點工作底圖",
                "children": [
                  {
                    "id": "1TMUxqd-802W19WAvl1sx8-0Y8DqbZF-w",
                    "name": "臺北市信義路公車專用道自駕巴士計畫路線圖.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1TMUxqd-802W19WAvl1sx8-0Y8DqbZF-w/edit",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "Word · 2.1 MB · 臺北市信義路雙向公車專用道自駕巴士路線與站點底圖"
                  },
                  {
                    "id": "1GY5F5rtc-hz3ExQ6Ruo1JzBZh8HPDU6B",
                    "name": "底圖v1.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1GY5F5rtc-hz3ExQ6Ruo1JzBZh8HPDU6B/edit",
                    "updatedAt": "2021-05-14",
                    "sizeOrNote": "簡報 · 3.4 MB · 信義路高精地圖測繪與專用道工程底圖 v1"
                  }
                ]
              },
              {
                "id": "1Z7SVf2PBqpcCB26RMlEXDcSdhLZ-WR1k",
                "name": "產品規劃書 - 自動化道路資產盤點與發佈.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1Z7SVf2PBqpcCB26RMlEXDcSdhLZ-WR1k/edit",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "Word · 1.1 MB · 自動化道路資產盤點與發佈產品規劃書"
              },
              {
                "id": "18IoS5rm4VYR4iOwEyRYDGnfF6TOyzYKy",
                "name": "第二年度計畫申請書_經費.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/18IoS5rm4VYR4iOwEyRYDGnfF6TOyzYKy/edit",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "Word · 420 KB · 第二年度計畫申請書經費編列說明",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理",
                  "交通行動服務",
                  "MaaS"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              },
              {
                "id": "1ZIgQzO91Jg0UWflHlj6NA7h7rVhEIJtG",
                "name": "5.經費預算表_TURING_第二年度初估.xlsx",
                "kind": "spreadsheet",
                "driveUrl": "https://docs.google.com/spreadsheets/d/1ZIgQzO91Jg0UWflHlj6NA7h7rVhEIJtG/edit",
                "updatedAt": "2021-05-14",
                "sizeOrNote": "試算表 · 64 KB · TURING 第二年度經費預算初估表",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理",
                  "交通行動服務",
                  "MaaS"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ]
              }
            ]
          },
          {
            "id": "10QUN_nmquuxY1GZSA9rEY8vIRh6-eKO-",
            "name": "申請計劃書",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/10QUN_nmquuxY1GZSA9rEY8vIRh6-eKO-",
            "updatedAt": "2021-05-14",
            "sizeOrNote": "信義路自駕巴士創新實驗申請計畫書全文",
            "children": [
              {
                "id": "144RUL9OmIceBGG2EmEQg1bHdfiBN4Imj",
                "name": "108年無人載具科技創新實驗計畫書-信義路公車專用道自駕巴士創新實驗計畫-v7.1.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/144RUL9OmIceBGG2EmEQg1bHdfiBN4Imj/edit",
                "updatedAt": "2020-08-26",
                "sizeOrNote": "Word · 14.5 MB · 台北市信義路雙向公車專用道夜間自駕巴士實證運行計畫書全文定稿 (v7.1)",
                "keyTakeaways": [
                  "正式計畫全名：台北市信義路雙向公車專用道夜間自駕巴士實證運行計畫（信義路公車專用道自駕巴士創新實驗計畫）",
                  "送交經濟部無人載具科技創新實驗審查之完整申請計畫書定稿版"
                ]
              },
              {
                "id": "1bMV0QQMyxsQUEeQNH5q_5gMy2QY4kkZ0",
                "name": "展延計畫書1224_V3.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1bMV0QQMyxsQUEeQNH5q_5gMy2QY4kkZ0/edit",
                "updatedAt": "2020-12-24",
                "sizeOrNote": "Word · 8.2 MB · 第二年度信義路自駕巴士創新實驗展延計畫書 (V3)",
                "keyTakeaways": [
                  "2021–2022 第二年度信義路自駕巴士實證運行展延計畫書全文"
                ]
              },
              {
                "id": "1xVZklLupgYZ7zy4DlnblEuBLB2ZUlilj",
                "name": "台北市信義路公車專用道自駕巴士創新實驗計畫修正對照表.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1xVZklLupgYZ7zy4DlnblEuBLB2ZUlilj/edit",
                "updatedAt": "2020-09-17",
                "sizeOrNote": "Word · 640 KB · 審查委員意見與創新實驗計畫書修正對照表"
              },
              {
                "id": "17PdX3aV1vpJjkDJbc151G3wqaJ9xGAHt",
                "name": "信義路自駕巴士摘要.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/17PdX3aV1vpJjkDJbc151G3wqaJ9xGAHt/edit",
                "updatedAt": "2021-04-20",
                "sizeOrNote": "簡報 · 8.5 MB · 信義路自駕巴士創新實驗計畫簡報摘要"
              },
              {
                "id": "1IqeTWGpb5WZDVDU303MOzNT3O8J_f99n",
                "name": "1090917修正計畫書提送通知.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1IqeTWGpb5WZDVDU303MOzNT3O8J_f99n/view?usp=drivesdk",
                "updatedAt": "2020-09-17",
                "sizeOrNote": "PDF · 520 KB · 修正計畫書提送通知公文"
              },
              {
                "id": "1S2d5bkg1gPrP53-E9UWMjyS-FJ66Sayx",
                "name": "1090707實證案書面審查意見.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1S2d5bkg1gPrP53-E9UWMjyS-FJ66Sayx/view?usp=drivesdk",
                "updatedAt": "2020-07-07",
                "sizeOrNote": "PDF · 680 KB · 實證案書面審查委員意見彙整"
              }
            ]
          },
          {
            "id": "1ee7lqEYui8HnD-KsH0yf83BuZ2blaSrU",
            "name": "無人載具補助計畫分工+經費20210415.xlsx",
            "kind": "spreadsheet",
            "driveUrl": "https://docs.google.com/spreadsheets/d/1ee7lqEYui8HnD-KsH0yf83BuZ2blaSrU/edit",
            "updatedAt": "2021-04-23",
            "sizeOrNote": "試算表 · 40 KB · 補助計畫團隊分工與預算配置表"
          },
          {
            "id": "1w-ibps5H_HWRfgL9xbhPIqmObzoLDnC7",
            "name": "3_客戶專案執行 > (closed)信義路專案",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1w-ibps5H_HWRfgL9xbhPIqmObzoLDnC7",
            "updatedAt": "2022-08",
            "sizeOrNote": "專案結案報告與運行里程統計",
            "children": [
              {
                "id": "1-tDLiAJyLAYPH0LtWMnS43YMaMoReNF7",
                "name": "信義路_紅綠燈檢測模組",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1-tDLiAJyLAYPH0LtWMnS43YMaMoReNF7",
                "updatedAt": "2021-06-17",
                "sizeOrNote": "號誌檢測模組規格與會議紀錄",
                "children": [
                  {
                    "id": "1dHEr3ceNu9T59iJMeVolRl5xbLFjGAoU",
                    "name": "會議記錄.url",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1dHEr3ceNu9T59iJMeVolRl5xbLFjGAoU/view?usp=drivesdk",
                    "updatedAt": "2021-06-17",
                    "sizeOrNote": "文件 · 134 B · 會議記錄捷徑"
                  }
                ]
              },
              {
                "id": "1KUn0j_z_zYENgIOPeNtBMQyUDZnLcmK2",
                "name": "信義路專案會議紀錄",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1KUn0j_z_zYENgIOPeNtBMQyUDZnLcmK2",
                "updatedAt": "2021-06-29",
                "sizeOrNote": "專案雙週例會與技術協調會議紀錄",
                "children": [
                  {
                    "id": "1H-GsDVbFzu4lktpoEXPTLiqpMGzmiYSt",
                    "name": "20210622_會議記錄.one",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1H-GsDVbFzu4lktpoEXPTLiqpMGzmiYSt/view?usp=drivesdk",
                    "updatedAt": "2021-06-22",
                    "sizeOrNote": "OneNote · 06/22 專案會議記錄"
                  },
                  {
                    "id": "18KuSmdJXOIMDeeiHZuYqxvDSy5rqSyjh",
                    "name": "20210629_會議記錄.one",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/18KuSmdJXOIMDeeiHZuYqxvDSy5rqSyjh/view?usp=drivesdk",
                    "updatedAt": "2021-06-29",
                    "sizeOrNote": "OneNote · 06/29 專案會議記錄"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "2021-taipei-port-5g",
        "code": "PORT-5G",
        "name": "(closed) 台北港 5G 科專自駕計畫",
        "startYear": 2021,
        "period": "2021 – 2022",
        "department": "客戶專案執行",
        "sharedDriveName": "專案執行",
        "status": "archived",
        "summary": "台北港區 5G 車聯網與自動駕駛技術科專實證計畫，驗證港區物流路線自駕運行、5G 專網通訊品質與遠端監控中心整合。",
        "highlights": [
          "台北港區自駕路線實測",
          "5G 科專期末驗收與成果報告"
        ],
        "driveFolderId": "1NL_EaAYofuetP8VKBciTUsozymeCU4iv",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1NL_EaAYofuetP8VKBciTUsozymeCU4iv",
        "files": [
          {
            "id": "1NL_EaAYofuetP8VKBciTUsozymeCU4iv",
            "name": "3_客戶專案執行 > (closed)台北港5G科專",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1NL_EaAYofuetP8VKBciTUsozymeCU4iv",
            "updatedAt": "2022-10",
            "sizeOrNote": "科專計畫書、期中期末簡報與測試數據",
            "children": [
              {
                "id": "17JtL3rES84sWOt8iqIXc4nsxV7ekdEKE",
                "name": "六米白車巴士改進-新平台轉移",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/17JtL3rES84sWOt8iqIXc4nsxV7ekdEKE",
                "updatedAt": "2021-12-28",
                "children": [
                  {
                    "id": "1P8DP1lCrzdEJ0GefHQfkGRj65YNRPHCB",
                    "name": "封存",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1P8DP1lCrzdEJ0GefHQfkGRj65YNRPHCB",
                    "updatedAt": "2022-03-17",
                    "children": [
                      {
                        "id": "1PaqD5PJu49QByzSpkkAMskAcIV_D6gmH",
                        "name": "0831與廠商澄清使用範圍用圖面",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1PaqD5PJu49QByzSpkkAMskAcIV_D6gmH",
                        "updatedAt": "2022-03-17",
                        "children": []
                      },
                      {
                        "id": "1Tiz612_KJZWPARgaOFt1HQm2BoWuc8nE",
                        "name": "機構量測資料",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Tiz612_KJZWPARgaOFt1HQm2BoWuc8nE",
                        "updatedAt": "2022-03-17",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1JZkCSjmhYpDqgYTEpJLeeTu8A9Huwwtt",
                    "name": "專案文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1JZkCSjmhYpDqgYTEpJLeeTu8A9Huwwtt",
                    "updatedAt": "2021-12-28",
                    "children": [
                      {
                        "id": "121gBzWPul0zvEJOCyes_kCDBwZyaXs8Q",
                        "name": "設備所有文件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/121gBzWPul0zvEJOCyes_kCDBwZyaXs8Q",
                        "updatedAt": "2022-01-14",
                        "children": []
                      },
                      {
                        "id": "14CnBO5VM1FW_sZUJvL6FZprZ0nn98gaH",
                        "name": "20210915 青埔白車二級保養與維修.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/14CnBO5VM1FW_sZUJvL6FZprZ0nn98gaH/view?usp=drivesdk",
                        "updatedAt": "2021-12-28",
                        "sizeOrNote": "PDF · 7.9 MB"
                      },
                      {
                        "id": "1GTcrEHFAnnCDZc0--WmWayq_XMfKfEUo",
                        "name": "5G新平台預算.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1GTcrEHFAnnCDZc0--WmWayq_XMfKfEUo/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-01-12",
                        "sizeOrNote": "Word · 21 KB",
                        "accessScope": "confidential",
                        "allowedDepartments": [
                          "營業",
                          "BD",
                          "財務",
                          "總經理"
                        ],
                        "allowedRoles": [
                          "admin",
                          "finance"
                        ]
                      },
                      {
                        "id": "1uMAg5S9qlHwFXrjhftw_rhw2MsI7Ht3z",
                        "name": "新平台每周meeting​.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1uMAg5S9qlHwFXrjhftw_rhw2MsI7Ht3z/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-12-28",
                        "sizeOrNote": "簡報 · 399 KB"
                      },
                      {
                        "id": "1DM8E5tlCN8oaMBb9B62o4n6AVsOjP41W",
                        "name": "新平台設備&工項.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1DM8E5tlCN8oaMBb9B62o4n6AVsOjP41W/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-01-24",
                        "sizeOrNote": "試算表 · 913 KB"
                      },
                      {
                        "id": "1p8rd8v9hE1kERCNbIFJx_x0K5V7R4G4i",
                        "name": "新平台開機手順.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1p8rd8v9hE1kERCNbIFJx_x0K5V7R4G4i/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-07-28",
                        "sizeOrNote": "Word · 6.6 MB"
                      },
                      {
                        "id": "1Q25ywyc8bjgwIVkS6vd9r0YhS9tpx5_v",
                        "name": "白車電源改良事項.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1Q25ywyc8bjgwIVkS6vd9r0YhS9tpx5_v/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-01-12",
                        "sizeOrNote": "Word · 635 KB"
                      }
                    ]
                  },
                  {
                    "id": "1khSJJWanjhDah6XKt5bi0xzSfS3xJpI-",
                    "name": "暫時放",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1khSJJWanjhDah6XKt5bi0xzSfS3xJpI-",
                    "updatedAt": "2022-03-17",
                    "children": [
                      {
                        "id": "13do46iWfTUfcWCeZNyVd9_DZ-b4Fo_xe",
                        "name": "autostart.zip",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/13do46iWfTUfcWCeZNyVd9_DZ-b4Fo_xe/view?usp=drivesdk",
                        "updatedAt": "2022-03-17",
                        "sizeOrNote": "封存檔 · 8 KB"
                      }
                    ]
                  },
                  {
                    "id": "11DhS9IAypvK6fKxMPya6K61ZqrZjSD3X",
                    "name": "會議紀錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/11DhS9IAypvK6fKxMPya6K61ZqrZjSD3X",
                    "updatedAt": "2021-12-28",
                    "children": [
                      {
                        "id": "1piVjbLejH-b_h6JEuXPviKZjbsF2Wubp",
                        "name": "20210803新平台會議紀錄​.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1piVjbLejH-b_h6JEuXPviKZjbsF2Wubp/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-12-28",
                        "sizeOrNote": "簡報 · 46 KB"
                      }
                    ]
                  },
                  {
                    "id": "1luCOu4A0OfcRpEuH7U4PdvKHDNqVFRjS",
                    "name": "電子系統資料",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1luCOu4A0OfcRpEuH7U4PdvKHDNqVFRjS",
                    "updatedAt": "2022-02-14",
                    "children": [
                      {
                        "id": "1tPRF4N2w1ZsULLXFOPvhAuTFB8NGaU8U",
                        "name": "Power supply system diagram.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1tPRF4N2w1ZsULLXFOPvhAuTFB8NGaU8U/view?usp=drivesdk",
                        "updatedAt": "2022-02-14",
                        "sizeOrNote": "文件 · 86 KB"
                      },
                      {
                        "id": "1UuEqV6yukxh9AMeU3W70dY41wVIFhsfH",
                        "name": "Power supply system diagram.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1UuEqV6yukxh9AMeU3W70dY41wVIFhsfH/view?usp=drivesdk",
                        "updatedAt": "2022-02-14",
                        "sizeOrNote": "PDF · 84 KB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1e1iPyAmCgHbcTvV1u03tPFg9mEysFWb8",
                "name": "A1&A2工項細分.docx",
                "kind": "document",
                "driveUrl": "https://docs.google.com/document/d/1e1iPyAmCgHbcTvV1u03tPFg9mEysFWb8/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2022-03-04",
                "sizeOrNote": "Word · 29 KB"
              },
              {
                "id": "1HwrD6Jrkjl1AT3dO90QiLKJnHaOQT5Ou",
                "name": "Kennel_20220511.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1HwrD6Jrkjl1AT3dO90QiLKJnHaOQT5Ou/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2022-05-11",
                "sizeOrNote": "簡報 · 48 KB"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "year": 2020,
    "label": "2019–2020 年起始專案",
    "tagline": "桃園青埔自駕電動巴士試運行計畫、揚昇高爾夫球自駕車開發案、新加坡 CFC 與南洋理工學院案",
    "projectOverview": "公司奠基期代表作：涵蓋桃園青埔自駕電動巴士試運行（含招標契約、創新實驗管理、路側設備規劃與青埔技術文件）、揚昇高爾夫球場自動駕駛球車首發開發案，以及 2019–2020 新加坡 CFC 與 Republic Polytechnic 海外專案。",
    "projects": [
      {
        "id": "2020-taoyuan-qingpu-bus",
        "code": "TYN-QINGPU",
        "name": "20200717_桃園市自動駕駛電動巴士系統試運行計畫（青埔運行計畫）",
        "startYear": 2020,
        "period": "2020 – 2022",
        "department": "交通行動服務部 / 客戶專案執行",
        "sharedDriveName": "交通行動服務部 | MaaS",
        "status": "archived",
        "summary": "桃園高鐵青埔特區自動駕駛電動巴士試運行計畫，包含 01 招標文件與契約、02 報告書、05 創新實驗管理、08 驗收、80 路側設備規劃與 90 青埔技術文件，並延伸青埔二期、緯創 A+ 與資策會 RSU 子案。",
        "highlights": [
          "01_招標文件與契約 / 05_創新實驗管理 / 08_驗收",
          "80_路側設備規劃 & 90_青埔技術文件",
          "3_客戶專案執行 > (closed)青埔運行計畫（含青埔二期、緯創A+、資策會RSU）"
        ],
        "driveFolderId": "1xBE9KD5s5XP9UUcMfKALI-tHbcJwK8Gx",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1xBE9KD5s5XP9UUcMfKALI-tHbcJwK8Gx",
        "files": [
          {
            "id": "1rzjn2PVOiYF_SzfzEqw3GjV19dY5ctmR",
            "name": "01_招標文件與契約",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1rzjn2PVOiYF_SzfzEqw3GjV19dY5ctmR",
            "updatedAt": "2021-03-19",
            "sizeOrNote": "桃園市政府標案契約與需求規範書",
            "children": [
              {
                "id": "14QGN9lg45FL6QFfX9II2vIM5fgnIn8Jg",
                "name": "RFP",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/14QGN9lg45FL6QFfX9II2vIM5fgnIn8Jg",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "19Go23bgoxq6iJIUeVDah-mb7j4TPLoE7",
                    "name": "(1090624-1)桃園市自動駕駛電動巴士系統試運行計畫委託專業服務案",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/19Go23bgoxq6iJIUeVDah-mb7j4TPLoE7",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1z3P1ynS8R1VaaiG-S0h8UkMtFLhimUY8",
                    "name": "_投標須知",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1z3P1ynS8R1VaaiG-S0h8UkMtFLhimUY8",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              },
              {
                "id": "1CTwuI7YMctkulw6Y8J4esaobvNZaiupZ",
                "name": "契約書",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1CTwuI7YMctkulw6Y8J4esaobvNZaiupZ",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1MPeM8gsNqa-bABjjNA-F9pRebTM0kpHB",
                    "name": "契約各章節",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1MPeM8gsNqa-bABjjNA-F9pRebTM0kpHB",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "id": "1pro256NxzA8Fn1lm2Y9b5hj1o1IOeic9",
            "name": "02_報告書",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1pro256NxzA8Fn1lm2Y9b5hj1o1IOeic9",
            "updatedAt": "2021-03-19",
            "sizeOrNote": "工作執行計畫書與歷次期中/期末報告",
            "children": [
              {
                "id": "1jhmgBM2KSoiD6o-qKadUf2k8dNFIFP9_",
                "name": "110年ITS提案",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1jhmgBM2KSoiD6o-qKadUf2k8dNFIFP9_",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1kJILRJFJDpXUawZGB6Ph5hvPi8zWSXe9",
                "name": "工作執行計畫書",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1kJILRJFJDpXUawZGB6Ph5hvPi8zWSXe9",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1A0kCromYEGgsL-HEGtIUJha0Bwt2Jvvq",
                "name": "服務建議書",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1A0kCromYEGgsL-HEGtIUJha0Bwt2Jvvq",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1MjLtfFRlMYUoN30QlzGfPfOGUKdgzFVh",
                    "name": "人員學經歷表",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1MjLtfFRlMYUoN30QlzGfPfOGUKdgzFVh",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1EkdMWWydm0kk7r_3vF67F2mUGtaMgo9c",
                    "name": "送印",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1EkdMWWydm0kk7r_3vF67F2mUGtaMgo9c",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              },
              {
                "id": "1lnbDwWEhrOUz_Br1c_edhTIyjqOg1GIj",
                "name": "期中報告書",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1lnbDwWEhrOUz_Br1c_edhTIyjqOg1GIj",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "10gxs3Brt0F7JA9je7D_Tkz8hdrjKIjbD",
                "name": "未來可行性研究",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/10gxs3Brt0F7JA9je7D_Tkz8hdrjKIjbD",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1dbd0cWxQSttc-akrTU0Fezo8DsXHhBpi",
                    "name": "環評參考資料",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1dbd0cWxQSttc-akrTU0Fezo8DsXHhBpi",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "id": "1anN5JzWdG1Alxva-nG1xFag8r1uKIQzy",
            "name": "05_創新實驗管理",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1anN5JzWdG1Alxva-nG1xFag8r1uKIQzy",
            "updatedAt": "2021-04-20",
            "sizeOrNote": "經濟部無人載具創新實驗審查與運行管理",
            "children": [
              {
                "id": "1BwzKlK_fy6Vjo2Cdvw1g4Oj-MfC4durR",
                "name": "上路實驗後續追蹤",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1BwzKlK_fy6Vjo2Cdvw1g4Oj-MfC4durR",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1Vpk7_mltljnHyqC0W_a_QqVgFRL7gO8N",
                "name": "不載客測試核備文件",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1Vpk7_mltljnHyqC0W_a_QqVgFRL7gO8N",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "16EO1ItDomKSOGzTdBu6FoqafgHAoJ_H1",
                    "name": "強制險",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/16EO1ItDomKSOGzTdBu6FoqafgHAoJ_H1",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1nhzFIhpjmNXjCxxjHwuNpcTy52HPPn5T",
                    "name": "檢附文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1nhzFIhpjmNXjCxxjHwuNpcTy52HPPn5T",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1sz_Hj0h--Nwn6_fzyOU1LSk_Uk5VRs7A",
                        "name": "全車照片",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1sz_Hj0h--Nwn6_fzyOU1LSk_Uk5VRs7A",
                        "updatedAt": "2021-03-19",
                        "children": []
                      },
                      {
                        "id": "1cpAWDwVJ57Hkv2Mo7ZBSQ0N8E8Bcvm-N",
                        "name": "第二輛車",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1cpAWDwVJ57Hkv2Mo7ZBSQ0N8E8Bcvm-N",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1At4FibiltZn_q5YNluzWGBxkUnPLnBAB",
                "name": "計畫展延",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1At4FibiltZn_q5YNluzWGBxkUnPLnBAB",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "135ibw2hDfuCz08BhejOOijfhnxCH8LUx",
                    "name": "修正版送印",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/135ibw2hDfuCz08BhejOOijfhnxCH8LUx",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              },
              {
                "id": "160ZnpcbrGCet3OWuu73vu68ChJu0PgVe",
                "name": "進度追蹤表",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/160ZnpcbrGCet3OWuu73vu68ChJu0PgVe",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1DJhQq2Xzm9gy_8_IN5vt_pgim31oc5ft",
                "name": "青埔實驗核准函",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1DJhQq2Xzm9gy_8_IN5vt_pgim31oc5ft",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "13sz9pCA_P8CFV1CuRGWNbQkYZalRaN8W",
                "name": "青埔實驗計畫變更",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/13sz9pCA_P8CFV1CuRGWNbQkYZalRaN8W",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "17UED_inGEsM2CZDvtM0FlWK_ZUOXqnlP",
                "name": "領牌",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/17UED_inGEsM2CZDvtM0FlWK_ZUOXqnlP",
                "updatedAt": "2021-05-14",
                "children": []
              }
            ]
          },
          {
            "id": "1dbNEZgZz92urJe2XHKnRA4SbRrEeIPk7",
            "name": "08_驗收",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1dbNEZgZz92urJe2XHKnRA4SbRrEeIPk7",
            "updatedAt": "2021-03-19",
            "sizeOrNote": "驗收紀錄與結案證明文件",
            "children": [
              {
                "id": "17mfLL4hLSXnLPwYcHTOjwgfbiqgXrNcV",
                "name": "車輛驗收",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/17mfLL4hLSXnLPwYcHTOjwgfbiqgXrNcV",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1CuD9Up6gGA7Tb1kSp4Jvmb-FcvVBvBkb",
                    "name": "附加價值率",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1CuD9Up6gGA7Tb1kSp4Jvmb-FcvVBvBkb",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "id": "1s4ibgZlKThBbjShLDSh9M3AIlQb_cvAn",
            "name": "80_路側設備規劃",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1s4ibgZlKThBbjShLDSh9M3AIlQb_cvAn",
            "updatedAt": "2021-05-14",
            "sizeOrNote": "青埔路線 RSU 路側感測與號誌連動配置",
            "children": [
              {
                "id": "1ebR5Tmvm9cWmkSq6_s3nChxs2pbFEwWb",
                "name": "台電登記回條",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1ebR5Tmvm9cWmkSq6_s3nChxs2pbFEwWb",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1oTSGnycV5MS_vjCD6AXMRX45cmZ4JqPf",
                "name": "報價單",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1oTSGnycV5MS_vjCD6AXMRX45cmZ4JqPf",
                "updatedAt": "2021-05-14",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ],
                "children": []
              },
              {
                "id": "1FS_COsqZxSxpH5rBHefeORP_NLSZnYjx",
                "name": "攝影機及主機規格",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1FS_COsqZxSxpH5rBHefeORP_NLSZnYjx",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1gp04NBLWbtNjOJoqkIKJNybUjse6CdzA",
                "name": "高精地圖整備",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1gp04NBLWbtNjOJoqkIKJNybUjse6CdzA",
                "updatedAt": "2021-05-14",
                "children": []
              }
            ]
          },
          {
            "id": "1-cJbn8kF1HSPfWTBoFiokJKuH5IEmiDz",
            "name": "90_青埔技術文件",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1-cJbn8kF1HSPfWTBoFiokJKuH5IEmiDz",
            "updatedAt": "2021-03-19",
            "sizeOrNote": "自駕電動巴士系統架構與測試規範",
            "children": [
              {
                "id": "1PdBxVKaG7SVrxmdrDdEWga3qeZAaKW7U",
                "name": "出差日誌",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1PdBxVKaG7SVrxmdrDdEWga3qeZAaKW7U",
                "updatedAt": "2021-03-19",
                "children": []
              },
              {
                "id": "1JuPLw_JP_K9dDymfdSc3-D7ICYnXdOqE",
                "name": "專案文件",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1JuPLw_JP_K9dDymfdSc3-D7ICYnXdOqE",
                "updatedAt": "2021-03-19",
                "children": []
              },
              {
                "id": "1lINNMHVS3hMHQA-4MInfniu-Ua5jZ_HY",
                "name": "會議記錄",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1lINNMHVS3hMHQA-4MInfniu-Ua5jZ_HY",
                "updatedAt": "2021-03-19",
                "children": []
              },
              {
                "id": "1JsW5aQ918pKroeoWgU3H6m6DB0Tnb9mq",
                "name": "架構圖",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1JsW5aQ918pKroeoWgU3H6m6DB0Tnb9mq",
                "updatedAt": "2021-03-19",
                "children": []
              }
            ]
          },
          {
            "id": "1YBfyPjEIq6_RYcNxnaU7DFdoGEmoCF20",
            "name": "3_客戶專案執行 > (closed)青埔運行計畫（含青埔二期、緯創A+、資策會RSU）",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1YBfyPjEIq6_RYcNxnaU7DFdoGEmoCF20",
            "updatedAt": "2022-03",
            "sizeOrNote": "客戶專案執行完整結案資料夾",
            "children": [
              {
                "id": "1N1vdSrlNe0syqBpbZH7KE1ySbv5gnepO",
                "name": "(封存)青埔巴士改進-新平台轉移",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1N1vdSrlNe0syqBpbZH7KE1ySbv5gnepO",
                "updatedAt": "2021-12-28",
                "children": [
                  {
                    "id": "1q2HccaZonjCrl21KyMA7v8MK9wf2raad",
                    "name": "0831與廠商澄清使用範圍用圖面",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1q2HccaZonjCrl21KyMA7v8MK9wf2raad",
                    "updatedAt": "2021-08-31",
                    "children": [
                      {
                        "id": "13xdJmB5XZLYELgL9NEUzWsSdw__tV10O",
                        "name": "新平台機箱空間運用範圍規畫圖.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/13xdJmB5XZLYELgL9NEUzWsSdw__tV10O/view?usp=drivesdk",
                        "updatedAt": "2021-08-31",
                        "sizeOrNote": "PDF · 276 KB"
                      }
                    ]
                  },
                  {
                    "id": "11r_BnCWvldGzkoi7NgKTSmSaRvDg4GVy",
                    "name": "專案文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/11r_BnCWvldGzkoi7NgKTSmSaRvDg4GVy",
                    "updatedAt": "2021-08-03",
                    "children": [
                      {
                        "id": "1tGI_mfeloZCfIObq1zuAKbKTCt1tnusA",
                        "name": "新平台每周meeting​.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1tGI_mfeloZCfIObq1zuAKbKTCt1tnusA/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-10-13",
                        "sizeOrNote": "簡報 · 392 KB"
                      },
                      {
                        "id": "12kY09Ae5TpUmPIr5wOQRPTIri3URZXPR",
                        "name": "新平台設備&工項.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/12kY09Ae5TpUmPIr5wOQRPTIri3URZXPR/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-09-06",
                        "sizeOrNote": "試算表 · 138 KB"
                      }
                    ]
                  },
                  {
                    "id": "1bmrFy9Pyq58kxdMFLUrRy2eFOxJol4Yj",
                    "name": "會議紀錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1bmrFy9Pyq58kxdMFLUrRy2eFOxJol4Yj",
                    "updatedAt": "2021-08-03",
                    "children": [
                      {
                        "id": "1YI4sMRBHJmXZNZuawVQb8ZbRAvu3lZ_b",
                        "name": "20210803新平台會議紀錄​.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1YI4sMRBHJmXZNZuawVQb8ZbRAvu3lZ_b/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-03",
                        "sizeOrNote": "簡報 · 42 KB"
                      }
                    ]
                  },
                  {
                    "id": "1cNmxOECX5bB_UwyuFJsxzAGq4dYYTdbB",
                    "name": "機構量測資料",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1cNmxOECX5bB_UwyuFJsxzAGq4dYYTdbB",
                    "updatedAt": "2021-08-10",
                    "children": [
                      {
                        "id": "1gxZTV0_wIU-pEavRFryeZysAtnVteCBI",
                        "name": "新平台Layout提案.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1gxZTV0_wIU-pEavRFryeZysAtnVteCBI/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-17",
                        "sizeOrNote": "簡報 · 8.0 MB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "13lXoGiQdp9viNyYMqCx3vCeCAnBL0gLw",
                "name": "工研院區塊鏈展示案支援",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/13lXoGiQdp9viNyYMqCx3vCeCAnBL0gLw",
                "updatedAt": "2021-07-27",
                "children": []
              },
              {
                "id": "1leiCyb9X7LT1p2VSgtwGQlwEaZ2SZ2b-",
                "name": "會議記錄",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1leiCyb9X7LT1p2VSgtwGQlwEaZ2SZ2b-",
                "updatedAt": "2021-08-30",
                "children": [
                  {
                    "id": "1NhTFsLk3iE_L9_TmMmgFhsDjSgJ_J4Uh",
                    "name": "20210830_會議資料",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1NhTFsLk3iE_L9_TmMmgFhsDjSgJ_J4Uh",
                    "updatedAt": "2021-08-30",
                    "children": []
                  },
                  {
                    "id": "1ZYAC-ByZZd0CHE9y2T-vZwadCrDfI2o5",
                    "name": "20210906_會議資料",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ZYAC-ByZZd0CHE9y2T-vZwadCrDfI2o5",
                    "updatedAt": "2021-09-06",
                    "children": [
                      {
                        "id": "15FoEPRKRcwPkkA4yrHf-xhmPr1g5KumV",
                        "name": "20210906 會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/15FoEPRKRcwPkkA4yrHf-xhmPr1g5KumV/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-09-06",
                        "sizeOrNote": "Word · 29 KB"
                      }
                    ]
                  },
                  {
                    "id": "1Qn04XBQP6mlbpgThHIlpa7cYPudxPIrN",
                    "name": "20210927_會議資料",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Qn04XBQP6mlbpgThHIlpa7cYPudxPIrN",
                    "updatedAt": "2021-09-27",
                    "children": [
                      {
                        "id": "1d9gtXLz18fR292KeKOr-1YO4MsmtoEtT",
                        "name": "20210927 會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1d9gtXLz18fR292KeKOr-1YO4MsmtoEtT/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-09-27",
                        "sizeOrNote": "Word · 28 KB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "168TZDIn6HxC3u8gEogLrEIkJzO5or0Fn",
                "name": "緯創A+",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/168TZDIn6HxC3u8gEogLrEIkJzO5or0Fn",
                "updatedAt": "2021-07-27",
                "children": [
                  {
                    "id": "1ALUtotgKdt-f7muqs7AffASeiIrfUVk_",
                    "name": "B工項_鼎漢模擬器支援",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ALUtotgKdt-f7muqs7AffASeiIrfUVk_",
                    "updatedAt": "2021-08-05",
                    "children": [
                      {
                        "id": "1CGafeMg_fngkZOYRyp_CHwCwv8cNiORJ",
                        "name": "20210827_A+工作會議.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1CGafeMg_fngkZOYRyp_CHwCwv8cNiORJ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-29",
                        "sizeOrNote": "Word · 283 KB"
                      },
                      {
                        "id": "1ul9cs-W0wasPwbACsUi9BRzhLl4p6qRd",
                        "name": "B工項目標確認.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1ul9cs-W0wasPwbACsUi9BRzhLl4p6qRd/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-05",
                        "sizeOrNote": "Word · 22 KB"
                      },
                      {
                        "id": "18HtDpMaU9zH2ANPDfkdXcAl6hARrtWGg",
                        "name": "Turing_Drive_AV_sys.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/18HtDpMaU9zH2ANPDfkdXcAl6hARrtWGg/view?usp=drivesdk",
                        "updatedAt": "2021-08-05",
                        "sizeOrNote": "文件 · 3 KB"
                      },
                      {
                        "id": "1JG24M4mfy8D5-pjYoOH06rX6srGkIX2b",
                        "name": "Turing_Drive_AV_sys.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1JG24M4mfy8D5-pjYoOH06rX6srGkIX2b/view?usp=drivesdk",
                        "updatedAt": "2021-08-14",
                        "sizeOrNote": "PDF · 113 KB"
                      },
                      {
                        "id": "1luuLvfCveXdwpAmObkw4FcXS_Elonqmb",
                        "name": "Turing_Drive_AV_sys.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1luuLvfCveXdwpAmObkw4FcXS_Elonqmb/view?usp=drivesdk",
                        "updatedAt": "2021-08-05",
                        "sizeOrNote": "PNG 圖檔 · 59 KB"
                      }
                    ]
                  },
                  {
                    "id": "1yqDlqVIjwXxQuSqwceK6oAdZ-re0rDxV",
                    "name": "90_緯創案技術文件.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1yqDlqVIjwXxQuSqwceK6oAdZ-re0rDxV/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-10",
                    "sizeOrNote": "Word · 18 KB"
                  }
                ]
              },
              {
                "id": "1b2JqdCx5QrwSx7gsky5bEL7iIvfKZYtY",
                "name": "資策會RSU對接demo",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1b2JqdCx5QrwSx7gsky5bEL7iIvfKZYtY",
                "updatedAt": "2021-07-27",
                "children": [
                  {
                    "id": "1AfZ7QPdfJxihUpmxUsZBJNWrXwonpB1-",
                    "name": "2021-07-26_青埔智慧道路功能情境需求.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1AfZ7QPdfJxihUpmxUsZBJNWrXwonpB1-/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-07-27",
                    "sizeOrNote": "簡報 · 11.2 MB"
                  },
                  {
                    "id": "1Qn8x1Sj1iX1AVkqGf0XPJUPpmto5V9jz",
                    "name": "資策會x桃園市交通局​ - 工作事項確認.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1Qn8x1Sj1iX1AVkqGf0XPJUPpmto5V9jz/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-07-27",
                    "sizeOrNote": "簡報 · 43 KB"
                  }
                ]
              },
              {
                "id": "1HLNS1aQFl0tn9CFz8mlvfiLMozQjEXUF",
                "name": "青埔二期營運案",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1HLNS1aQFl0tn9CFz8mlvfiLMozQjEXUF",
                "updatedAt": "2021-07-27",
                "children": [
                  {
                    "id": "1DDg3v-YAK_YbPdA1svnKtWF6deSfklul",
                    "name": "20210728_青埔藍車故障事件追蹤",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1DDg3v-YAK_YbPdA1svnKtWF6deSfklul",
                    "updatedAt": "2021-07-28",
                    "children": [
                      {
                        "id": "1l9U5-cwxz1udJOB14cIpOhSmgJTEgpfG",
                        "name": "青埔藍車機械故障事件追蹤.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1l9U5-cwxz1udJOB14cIpOhSmgJTEgpfG/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-01",
                        "sizeOrNote": "Word · 24 KB"
                      }
                    ]
                  },
                  {
                    "id": "1Epj5gqt8mY2YHv-ROoVDDxlH9wR2MBYi",
                    "name": "doc",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Epj5gqt8mY2YHv-ROoVDDxlH9wR2MBYi",
                    "updatedAt": "2021-07-01",
                    "children": [
                      {
                        "id": "1myXN6gGR6edLxQFngEL43Mi0CUrS77qc",
                        "name": "12_21_.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1myXN6gGR6edLxQFngEL43Mi0CUrS77qc/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 19 KB"
                      },
                      {
                        "id": "1wsE-6W7PeDSzWlkoh_YBMz3c0jQ5ichg",
                        "name": "2020.12.4第2台車準備.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1wsE-6W7PeDSzWlkoh_YBMz3c0jQ5ichg/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 18 KB"
                      },
                      {
                        "id": "1n5jr7G0di6ih0mysBgNtEZonDhf5NpZQ",
                        "name": "bus_folder_tree.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1n5jr7G0di6ih0mysBgNtEZonDhf5NpZQ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 16 KB"
                      },
                      {
                        "id": "1HCljFWUU59xZSw__aHD_K4yttwhnstof",
                        "name": "bus_light topic.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1HCljFWUU59xZSw__aHD_K4yttwhnstof/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 15 KB"
                      },
                      {
                        "id": "1SmHAO06R3VF3attu5hTq-l4dKOtDzLHh",
                        "name": "TMRT 硬體準備.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1SmHAO06R3VF3attu5hTq-l4dKOtDzLHh/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-14",
                        "sizeOrNote": "試算表 · 52 KB"
                      },
                      {
                        "id": "1coO6glC54fWqmJSt-4Yb0Bu7jIc5i73N",
                        "name": "巴士硬體準備（jetson xavier).xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1coO6glC54fWqmJSt-4Yb0Bu7jIc5i73N/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "試算表 · 47 KB"
                      },
                      {
                        "id": "1PwNkWlvNnnSF0GS0RHCEkBHSOIcZjyxT",
                        "name": "無標題文件.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1PwNkWlvNnnSF0GS0RHCEkBHSOIcZjyxT/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 15 KB"
                      }
                    ]
                  },
                  {
                    "id": "1Mw26PsOC5x2GnS-LKq78RwIBslT4Ahb-",
                    "name": "flow chart",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Mw26PsOC5x2GnS-LKq78RwIBslT4Ahb-",
                    "updatedAt": "2021-06-01",
                    "children": [
                      {
                        "id": "1OfbLhePBKl6a7faHofajlg90URZeFyvd",
                        "name": "AEB.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1OfbLhePBKl6a7faHofajlg90URZeFyvd/view?usp=drivesdk",
                        "updatedAt": "2021-05-19",
                        "sizeOrNote": "文件 · 2 KB"
                      },
                      {
                        "id": "110LRkRYgKXnrUOCGrsUDTZ5mGrqpTBrG",
                        "name": "AEB.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/110LRkRYgKXnrUOCGrsUDTZ5mGrqpTBrG/view?usp=drivesdk",
                        "updatedAt": "2021-05-19",
                        "sizeOrNote": "PNG 圖檔 · 48 KB"
                      },
                      {
                        "id": "15SR0Fg3lP2fRGcTor3pu7LfPU8HHMtp1",
                        "name": "stop_line.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/15SR0Fg3lP2fRGcTor3pu7LfPU8HHMtp1/view?usp=drivesdk",
                        "updatedAt": "2021-04-01",
                        "sizeOrNote": "文件 · 2 KB"
                      }
                    ]
                  },
                  {
                    "id": "1j5JieHuGVtm9dPGWILXxm-Fy_0JIa7x3",
                    "name": "查核點",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1j5JieHuGVtm9dPGWILXxm-Fy_0JIa7x3",
                    "updatedAt": "2021-07-01",
                    "children": [
                      {
                        "id": "1MJd-317cj_TW8J6H5KR5gkUUCYLp6sCW",
                        "name": "12月~1月.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1MJd-317cj_TW8J6H5KR5gkUUCYLp6sCW/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 16 KB"
                      },
                      {
                        "id": "1kuvTx-0LrdcNlCduO8N1Vvgt8ajQP8NK",
                        "name": "13062710690090.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1kuvTx-0LrdcNlCduO8N1Vvgt8ajQP8NK/view?usp=drivesdk",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "JPG 圖檔 · 398 KB"
                      },
                      {
                        "id": "12SFk2eCP1nQzrGmYYxPgwyACcveMFnT-",
                        "name": "AEB流程.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/12SFk2eCP1nQzrGmYYxPgwyACcveMFnT-/view?usp=drivesdk",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "PNG 圖檔 · 70 KB"
                      },
                      {
                        "id": "1dmLmdarKBdsL0D-AfxkpXiEbYIv85FWx",
                        "name": "情境所需子項目.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1dmLmdarKBdsL0D-AfxkpXiEbYIv85FWx/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "試算表 · 16 KB"
                      },
                      {
                        "id": "1AeCckb5Zh-vHzovKmu0j8E-lHwyZcaGx",
                        "name": "查核點.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1AeCckb5Zh-vHzovKmu0j8E-lHwyZcaGx/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 22 KB"
                      },
                      {
                        "id": "1YNN9bEOwoj4M33UyfJ5eNxgJwygp9Z9O",
                        "name": "桃園青埔路口智慧辨識路口 V2X 通訊協定 V1.1.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1YNN9bEOwoj4M33UyfJ5eNxgJwygp9Z9O/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 44 KB"
                      },
                      {
                        "id": "1OjNmlNpMjVm9rW-lt8gT2pDWiSlJG4M1",
                        "name": "桃捷_V2X相關技術.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1OjNmlNpMjVm9rW-lt8gT2pDWiSlJG4M1/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 626 KB"
                      },
                      {
                        "id": "1dtEf8LcEy69wmHgbGn7Clup2rtNnXJKU",
                        "name": "號誌處理流程.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1dtEf8LcEy69wmHgbGn7Clup2rtNnXJKU/view?usp=drivesdk",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "JPG 圖檔 · 44 KB"
                      }
                    ]
                  },
                  {
                    "id": "1JJoZjJHkoIuoKGx-mP4NosiMH6Xc16g7",
                    "name": "1090806 桃捷二期運行計畫例行會議_V1 - 副本.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1JJoZjJHkoIuoKGx-mP4NosiMH6Xc16g7/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-12-14",
                    "sizeOrNote": "簡報 · 25.2 MB"
                  },
                  {
                    "id": "1_KU6uEMDCyCU-5dqnFlcngpjiGKbDuh0",
                    "name": "2020.9.22 TMRT II.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1_KU6uEMDCyCU-5dqnFlcngpjiGKbDuh0/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-07-01",
                    "sizeOrNote": "Word · 642 KB"
                  },
                  {
                    "id": "117NR-A8wUkz8D1eu4UyKFW-rUQzXOHRu",
                    "name": "20210727 青埔二期營運案計劃.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/117NR-A8wUkz8D1eu4UyKFW-rUQzXOHRu/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-03",
                    "sizeOrNote": "Word · 31 KB"
                  },
                  {
                    "id": "1nJHNlxQgXhEw_Zz3ouPZRQ9R95MWlB7v",
                    "name": "20210803 會議記錄.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1nJHNlxQgXhEw_Zz3ouPZRQ9R95MWlB7v/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-03",
                    "sizeOrNote": "Word · 28 KB"
                  },
                  {
                    "id": "185qI-xlUCQP1TbQgNaETjyBPRsFeh4xk",
                    "name": "TMRT II 流程與時間.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/185qI-xlUCQP1TbQgNaETjyBPRsFeh4xk/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-07-01",
                    "sizeOrNote": "簡報 · 79 KB"
                  },
                  {
                    "id": "1HusE-Vha8IX-FfspeglFlRvYGcbBcw3q",
                    "name": "巴士自駕行駛測試注意事項.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1HusE-Vha8IX-FfspeglFlRvYGcbBcw3q/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-05-04",
                    "sizeOrNote": "Word · 1.9 MB"
                  },
                  {
                    "id": "1lu6LJvqBxkullFFWV2q59mCy-8P5QdW8",
                    "name": "活頁簿.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1lu6LJvqBxkullFFWV2q59mCy-8P5QdW8/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-03",
                    "sizeOrNote": "試算表 · 14 KB"
                  },
                  {
                    "id": "1mJhKfAnYQk0v-rTuVKzvbW6HxanNxNJI",
                    "name": "青埔2期不載客測試情境.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1mJhKfAnYQk0v-rTuVKzvbW6HxanNxNJI/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-07-14",
                    "sizeOrNote": "試算表 · 13.9 MB"
                  },
                  {
                    "id": "18aagvE1L32YMQuEF7ZDIdFPFKvqr3rIY",
                    "name": "青埔A車 主機無畫面的問題.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/18aagvE1L32YMQuEF7ZDIdFPFKvqr3rIY/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-06-22",
                    "sizeOrNote": "Word · 20 KB"
                  },
                  {
                    "id": "1bYnO8HkwKU9GXbXl-CEyJAeItq78OfmQ",
                    "name": "青埔B車紀錄.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1bYnO8HkwKU9GXbXl-CEyJAeItq78OfmQ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-11-15",
                    "sizeOrNote": "試算表 · 2.1 MB"
                  },
                  {
                    "id": "1wbJ8PS8dJQT2umrP42x_eAhW_edlCGFI",
                    "name": "青埔自駕釋義.ppt",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1wbJ8PS8dJQT2umrP42x_eAhW_edlCGFI/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-07-01",
                    "sizeOrNote": "簡報 · 10.0 MB"
                  }
                ]
              },
              {
                "id": "1zx7HQWcqpzVAWhA8LW4tBpYoYB_izCk7",
                "name": "青埔巴士改進-3D物件檢測",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1zx7HQWcqpzVAWhA8LW4tBpYoYB_izCk7",
                "updatedAt": "2021-07-27",
                "children": [
                  {
                    "id": "1ZYiUyRgort7xt_n3R5qVDW3CKbGdMFtA",
                    "name": "影片&照片",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ZYiUyRgort7xt_n3R5qVDW3CKbGdMFtA",
                    "updatedAt": "2021-08-10",
                    "children": [
                      {
                        "id": "1jH6tSq-YIYs85yWO6wfhvq4jHWOotaA1",
                        "name": "PXL_20210806_051946809.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1jH6tSq-YIYs85yWO6wfhvq4jHWOotaA1/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "JPG 圖檔 · 6.1 MB"
                      },
                      {
                        "id": "1ZD0FLLYQmNdBNK25bUGrVhv7vUVT5BvA",
                        "name": "PXL_20210806_052400288.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ZD0FLLYQmNdBNK25bUGrVhv7vUVT5BvA/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "JPG 圖檔 · 7.0 MB"
                      },
                      {
                        "id": "1OSzJ3GWUhDpRGTNV93i7QpOA6Rjo_aie",
                        "name": "PXL_20210806_052406136.MP.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1OSzJ3GWUhDpRGTNV93i7QpOA6Rjo_aie/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "JPG 圖檔 · 10.7 MB"
                      },
                      {
                        "id": "17fGdAy72pkZ7CtbDqU5gd_dIGfEkqRHY",
                        "name": "PXL_20210806_064304860.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/17fGdAy72pkZ7CtbDqU5gd_dIGfEkqRHY/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 28.7 MB"
                      },
                      {
                        "id": "1Bze4kBbqxsJ08Y2FOtwILpst1BbA68zG",
                        "name": "PXL_20210806_064401240.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1Bze4kBbqxsJ08Y2FOtwILpst1BbA68zG/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 26.5 MB"
                      },
                      {
                        "id": "12usCCBoTghWB7EsjkFTIEMj6y503aPcn",
                        "name": "PXL_20210806_065623720.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/12usCCBoTghWB7EsjkFTIEMj6y503aPcn/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 23.4 MB"
                      },
                      {
                        "id": "1MW8r7q6_rnhqQUQ7TqxC41qHzHdJH_oD",
                        "name": "PXL_20210806_065717723.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1MW8r7q6_rnhqQUQ7TqxC41qHzHdJH_oD/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 21.3 MB"
                      },
                      {
                        "id": "1_sOB2TCWMXHqmSdWb4dQWAwyeTpnbxQH",
                        "name": "PXL_20210806_071503861.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1_sOB2TCWMXHqmSdWb4dQWAwyeTpnbxQH/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 30.1 MB"
                      },
                      {
                        "id": "1ESW7EzPUKmSRLF3abaeCidxGKdnOcw2u",
                        "name": "PXL_20210806_071503861_exported_7895~2.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1ESW7EzPUKmSRLF3abaeCidxGKdnOcw2u/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "JPG 圖檔 · 95 KB"
                      },
                      {
                        "id": "16PYvpBsMshNrwPBq0ZJSTUuX8FdxKH68",
                        "name": "PXL_20210806_071559346.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/16PYvpBsMshNrwPBq0ZJSTUuX8FdxKH68/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 18.9 MB"
                      },
                      {
                        "id": "1GYZInPafMHJ7EkRitnD-AVOqIdUsQNf0",
                        "name": "PXL_20210806_072815398.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1GYZInPafMHJ7EkRitnD-AVOqIdUsQNf0/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 13.9 MB"
                      },
                      {
                        "id": "1qeT-JI25XuCwmnaDw_lBCLSqSV0REpbQ",
                        "name": "PXL_20210806_072815398_exported_2031~2.jpg",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1qeT-JI25XuCwmnaDw_lBCLSqSV0REpbQ/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "JPG 圖檔 · 59 KB"
                      },
                      {
                        "id": "1tUvT-7Qd4-tEDA18ooWg3ZTuLJ0yzB9V",
                        "name": "PXL_20210806_072918370.mp4",
                        "kind": "archive",
                        "driveUrl": "https://drive.google.com/file/d/1tUvT-7Qd4-tEDA18ooWg3ZTuLJ0yzB9V/view?usp=drivesdk",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "MP4 影片 · 22.0 MB"
                      }
                    ]
                  },
                  {
                    "id": "1pu9YgttoDryq7Ovz35CsBjbSrIKejodj",
                    "name": "技術說明文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1pu9YgttoDryq7Ovz35CsBjbSrIKejodj",
                    "updatedAt": "2021-08-10",
                    "children": [
                      {
                        "id": "1wU_cBL_iDeD8-cGLZdt-SMzQ_Wf8EkV_",
                        "name": "青埔3D BBOX計劃說明.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1wU_cBL_iDeD8-cGLZdt-SMzQ_Wf8EkV_/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-11-19",
                        "sizeOrNote": "Word · 985 KB"
                      },
                      {
                        "id": "1Fewg6v1j17JTmOSg9rMD_JVbX-FCVWFb",
                        "name": "青埔3D BOX檢測milestone.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1Fewg6v1j17JTmOSg9rMD_JVbX-FCVWFb/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-10-07",
                        "sizeOrNote": "試算表 · 31 KB"
                      }
                    ]
                  },
                  {
                    "id": "1L_N0zGy6-ITeu-tP_qSJeI30Pk2w2lk3",
                    "name": "機構設計",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1L_N0zGy6-ITeu-tP_qSJeI30Pk2w2lk3",
                    "updatedAt": "2021-08-10",
                    "children": [
                      {
                        "id": "1NuHyq_3bYkFijGi8ZXp203G7TokRAeUa",
                        "name": "6M車機構設計提案-Xavier支架 20210629.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1NuHyq_3bYkFijGi8ZXp203G7TokRAeUa/view?usp=drivesdk",
                        "updatedAt": "2021-07-05",
                        "sizeOrNote": "PDF · 1.0 MB"
                      },
                      {
                        "id": "1ohT02xVQsVnUFTzLsjUXSmF-SDf0YSVi",
                        "name": "6M車機構設計提案-鏡頭支架 20210629.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1ohT02xVQsVnUFTzLsjUXSmF-SDf0YSVi/view?usp=drivesdk",
                        "updatedAt": "2021-07-05",
                        "sizeOrNote": "PDF · 898 KB"
                      },
                      {
                        "id": "100EA7OATOlfU3kDe_B2qY5q6Nl7xALO1",
                        "name": "Xavier & camera 支架需求.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/100EA7OATOlfU3kDe_B2qY5q6Nl7xALO1/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-29",
                        "sizeOrNote": "簡報 · 38.9 MB"
                      }
                    ]
                  },
                  {
                    "id": "19bjTcRKTY-TGnBYW6dqyAkZFY2kRIfoE",
                    "name": "測試報告",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/19bjTcRKTY-TGnBYW6dqyAkZFY2kRIfoE",
                    "updatedAt": "2021-08-10",
                    "children": [
                      {
                        "id": "1fbURuqXAW9bBwLFl12hk3SXkiCP8c9Xt",
                        "name": "其他測試-3D bbox檢測框不正常.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1fbURuqXAW9bBwLFl12hk3SXkiCP8c9Xt/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-01-12",
                        "sizeOrNote": "Word · 4.9 MB"
                      },
                      {
                        "id": "1RYNYxGTe_F8FNylzIcQy767T9ZU95jEp",
                        "name": "其他測試-3D bbox深度驗證(處理timestamp).docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1RYNYxGTe_F8FNylzIcQy767T9ZU95jEp/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-01-18",
                        "sizeOrNote": "Word · 3.7 MB"
                      },
                      {
                        "id": "1RjDWwtpv_c5SIElATFk980YI3ale-7UT",
                        "name": "其他測試-3D bbox深度驗證.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1RjDWwtpv_c5SIElATFk980YI3ale-7UT/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-29",
                        "sizeOrNote": "Word · 702 KB"
                      },
                      {
                        "id": "1CRl0nBMZxebs-KDaIsvyjbOK3NCdUnxG",
                        "name": "線上測試1-1.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1CRl0nBMZxebs-KDaIsvyjbOK3NCdUnxG/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-10",
                        "sizeOrNote": "Word · 4.2 MB"
                      },
                      {
                        "id": "1reI3YGTsy5Lu0YvjwyI090d23NayIxXt",
                        "name": "線上測試2-1~3-1.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1reI3YGTsy5Lu0YvjwyI090d23NayIxXt/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-11",
                        "sizeOrNote": "Word · 9.0 MB"
                      },
                      {
                        "id": "1P9f6cZt_6iRPNY1DQp2Aza75D09xSVe7",
                        "name": "線下測試1-1.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1P9f6cZt_6iRPNY1DQp2Aza75D09xSVe7/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-11-25",
                        "sizeOrNote": "Word · 1.1 MB"
                      },
                      {
                        "id": "1hm6k18-fxRuwS6hmSHjfUZHDk9DcxC1t",
                        "name": "線下測試1-2.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1hm6k18-fxRuwS6hmSHjfUZHDk9DcxC1t/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-11-25",
                        "sizeOrNote": "簡報 · 2.5 MB"
                      },
                      {
                        "id": "1ISsidX2z98fNUqFyKOWAiFHVxRc46HMu",
                        "name": "線下測試1-3~1-4.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1ISsidX2z98fNUqFyKOWAiFHVxRc46HMu/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2022-01-12",
                        "sizeOrNote": "Word · 2.4 MB"
                      },
                      {
                        "id": "1qDjEoQ58mwDAfE5mjz0ZxKiTh5gJxOSe",
                        "name": "線下測試1-5.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1qDjEoQ58mwDAfE5mjz0ZxKiTh5gJxOSe/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-11-25",
                        "sizeOrNote": "簡報 · 2.3 MB"
                      },
                      {
                        "id": "1HY_ZhPy1KCPm7NI5iaRAn2zv1g3XxaHJ",
                        "name": "線下測試3-1.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1HY_ZhPy1KCPm7NI5iaRAn2zv1g3XxaHJ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-11-25",
                        "sizeOrNote": "Word · 5.2 MB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1i0n9N7n33ktPEsyVXMGmGyETOM8aqVQl",
                "name": "青埔巴士改進-RSU告警作動",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1i0n9N7n33ktPEsyVXMGmGyETOM8aqVQl",
                "updatedAt": "2021-08-10",
                "children": [
                  {
                    "id": "11xj0dKCT9W9VT4IcIcKFtug7y48dCGCk",
                    "name": "V2X",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/11xj0dKCT9W9VT4IcIcKFtug7y48dCGCk",
                    "updatedAt": "2021-08-10",
                    "children": [
                      {
                        "id": "1tN_XtYMRp9_vxsPOyFFQp0ffXvnkV4Gh",
                        "name": "aws 技術concall.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1tN_XtYMRp9_vxsPOyFFQp0ffXvnkV4Gh/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 293 KB"
                      },
                      {
                        "id": "1mFqZ_H9npLVWC3gX-TDhsSbuk5yiZ7fW",
                        "name": "Invignal-API技術文件.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1mFqZ_H9npLVWC3gX-TDhsSbuk5yiZ7fW/view?usp=drivesdk",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "PDF · 203 KB"
                      },
                      {
                        "id": "1v_nteSlMnUGBMIZJx1CVUhCHMjchs-r5",
                        "name": "InVignal路口號誌發布技術測試報告.pdf",
                        "kind": "pdf",
                        "driveUrl": "https://drive.google.com/file/d/1v_nteSlMnUGBMIZJx1CVUhCHMjchs-r5/view?usp=drivesdk",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "PDF · 1.1 MB"
                      },
                      {
                        "id": "1eGcCULoU1EUQqEKlCQB8gNPlId80AeHN",
                        "name": "RSU-navigation.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1eGcCULoU1EUQqEKlCQB8gNPlId80AeHN/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-05-18",
                        "sizeOrNote": "Word · 22 KB"
                      },
                      {
                        "id": "1tI8Gvg1NZaDANgni7Nm_UfVOFBWwI8h1",
                        "name": "桃園青埔路口智慧辨識路口 V2X 通訊協定 V1.1.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1tI8Gvg1NZaDANgni7Nm_UfVOFBWwI8h1/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "Word · 44 KB"
                      },
                      {
                        "id": "1oe9D5-b5EW7lDPDnTGvhMbdaUrVIkHHo",
                        "name": "桃園青埔路口辨識方案-路口檢測規格.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1oe9D5-b5EW7lDPDnTGvhMbdaUrVIkHHo/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "試算表 · 15 KB"
                      },
                      {
                        "id": "1w88Fbedd7hpS2FNUDK_kudyL9liUD75X",
                        "name": "青埔路口辨識方案.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/1w88Fbedd7hpS2FNUDK_kudyL9liUD75X/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-01",
                        "sizeOrNote": "簡報 · 25.6 MB"
                      }
                    ]
                  },
                  {
                    "id": "1Pd6YaTZTdFz_plnTezrqmTtwnYMWcYlA",
                    "name": "LINE_MOVIE_1630250396215.mp4",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1Pd6YaTZTdFz_plnTezrqmTtwnYMWcYlA/view?usp=drivesdk",
                    "updatedAt": "2021-08-29",
                    "sizeOrNote": "MP4 影片 · 3.5 MB"
                  },
                  {
                    "id": "1xWUBiI1nCmkpzL43tKISt9am1XAwoJ3M",
                    "name": "V2R.drawio",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1xWUBiI1nCmkpzL43tKISt9am1XAwoJ3M/view?usp=drivesdk",
                    "updatedAt": "2021-06-16",
                    "sizeOrNote": "文件 · 52 KB"
                  },
                  {
                    "id": "10LFOYdwwt5PUbgI6vcv5qY-AiQewUsJa",
                    "name": "V2R.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/10LFOYdwwt5PUbgI6vcv5qY-AiQewUsJa/view?usp=drivesdk",
                    "updatedAt": "2021-06-16",
                    "sizeOrNote": "PNG 圖檔 · 252 KB"
                  },
                  {
                    "id": "1iHUhnOhNesqBU74EPbdn0W8SCLdHsefm",
                    "name": "線上測試 1-1.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1iHUhnOhNesqBU74EPbdn0W8SCLdHsefm/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-09-03",
                    "sizeOrNote": "Word · 20 KB"
                  },
                  {
                    "id": "1L7gxv8xbtClEejLiFKgWazw77We9KTCQ",
                    "name": "青埔RSU告警作動 計劃說明.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1L7gxv8xbtClEejLiFKgWazw77We9KTCQ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-29",
                    "sizeOrNote": "Word · 147 KB"
                  },
                  {
                    "id": "1B5rfwrdA7zuO5-zZa0cgFp4NxXiQ90K2",
                    "name": "青埔RSU告警作動milestone.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/1B5rfwrdA7zuO5-zZa0cgFp4NxXiQ90K2/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-29",
                    "sizeOrNote": "試算表 · 24 KB"
                  }
                ]
              },
              {
                "id": "1aR4rwY7hEBAyTqeON4HXcTYcId1z7dKR",
                "name": "青埔巴士改進-紅綠燈檢測",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1aR4rwY7hEBAyTqeON4HXcTYcId1z7dKR",
                "updatedAt": "2021-08-03",
                "children": [
                  {
                    "id": "1knKzCFTd0v_rWnUGkqLjwQuNLYVC0eL-",
                    "name": "專案管理及說明文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1knKzCFTd0v_rWnUGkqLjwQuNLYVC0eL-",
                    "updatedAt": "2021-07-27",
                    "children": [
                      {
                        "id": "1qSV45o-61uE2zx6Ql7nBJCUXO95l8LPz",
                        "name": "信義路紅綠燈檢測模組開發計畫_20210608.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1qSV45o-61uE2zx6Ql7nBJCUXO95l8LPz/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-06-22",
                        "sizeOrNote": "Word · 27 KB",
                        "keyTakeaways": [
                          "規範車載相機視覺辨識與路側 RSU V2X (SPaT/MAP) 號誌優先通行 TSP、MQTT / ROS Bridge 訂閱融合邏輯"
                        ]
                      },
                      {
                        "id": "1y0vu4bFSjjAnFEv965CAaMoZjXycSmal",
                        "name": "信義路紅綠燈檢測驗收標準 .xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/1y0vu4bFSjjAnFEv965CAaMoZjXycSmal/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-18",
                        "sizeOrNote": "試算表 · 20 KB"
                      },
                      {
                        "id": "1bKPv71eCbMhH8v92AWj00t7CpVCFk-Da",
                        "name": "新平台建立說明文件.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1bKPv71eCbMhH8v92AWj00t7CpVCFk-Da/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-27",
                        "sizeOrNote": "Word · 20 KB"
                      },
                      {
                        "id": "1E0-J2oK5xk5DEWitIzpusBcXN0XTiaSk",
                        "name": "紅綠燈檢測說明文件.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1E0-J2oK5xk5DEWitIzpusBcXN0XTiaSk/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-27",
                        "sizeOrNote": "Word · 20 KB"
                      },
                      {
                        "id": "12yYVUq1c16esqZCnTRPpi8I_LHvcQQYx",
                        "name": "線上測試_評估文件.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/12yYVUq1c16esqZCnTRPpi8I_LHvcQQYx/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-19",
                        "sizeOrNote": "Word · 415 KB"
                      }
                    ]
                  },
                  {
                    "id": "1U9i7sy9Quz6J2HUOe-_XY4UolMdFIiV-",
                    "name": "技術文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1U9i7sy9Quz6J2HUOe-_XY4UolMdFIiV-",
                    "updatedAt": "2021-07-27",
                    "children": [
                      {
                        "id": "100Ufva5ZkMwG9jz6z_pYeZsFWWJYOUfK",
                        "name": "20210608_TLDet_meeting.pptx",
                        "kind": "presentation",
                        "driveUrl": "https://docs.google.com/presentation/d/100Ufva5ZkMwG9jz6z_pYeZsFWWJYOUfK/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-06-21",
                        "sizeOrNote": "簡報 · 4.5 MB"
                      },
                      {
                        "id": "132ptKBl5kIaqIBOB0hGfVbEkzUPMaP2u",
                        "name": "data_flow.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/132ptKBl5kIaqIBOB0hGfVbEkzUPMaP2u/view?usp=drivesdk",
                        "updatedAt": "2021-06-17",
                        "sizeOrNote": "PNG 圖檔 · 573 KB"
                      },
                      {
                        "id": "1vQ5QWZpvyn59yzqUalO_DfKOppCSSH-G",
                        "name": "output示意圖.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1vQ5QWZpvyn59yzqUalO_DfKOppCSSH-G/view?usp=drivesdk",
                        "updatedAt": "2021-06-17",
                        "sizeOrNote": "PNG 圖檔 · 2.5 MB"
                      },
                      {
                        "id": "1u1inmDqPkhUaRrm1lNmj0VtR-8HE5MmT",
                        "name": "流程圖.png",
                        "kind": "image",
                        "driveUrl": "https://drive.google.com/file/d/1u1inmDqPkhUaRrm1lNmj0VtR-8HE5MmT/view?usp=drivesdk",
                        "updatedAt": "2021-06-17",
                        "sizeOrNote": "PNG 圖檔 · 320 KB"
                      },
                      {
                        "id": "15VsHpJDPUDXnr-lGXkFob9Fb5vBI2DzP",
                        "name": "線下測試 Job Breakdown.xlsx",
                        "kind": "spreadsheet",
                        "driveUrl": "https://docs.google.com/spreadsheets/d/15VsHpJDPUDXnr-lGXkFob9Fb5vBI2DzP/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-13",
                        "sizeOrNote": "試算表 · 20 KB"
                      }
                    ]
                  },
                  {
                    "id": "1KLDS2n7rgdvU_llfTknRfB6mhz5J40Hl",
                    "name": "會議記錄",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1KLDS2n7rgdvU_llfTknRfB6mhz5J40Hl",
                    "updatedAt": "2021-08-02",
                    "children": [
                      {
                        "id": "1MIiHhJ_EPdJQnb8i7ioBUH78qmg4yzaK",
                        "name": "20210803_會議記錄",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1MIiHhJ_EPdJQnb8i7ioBUH78qmg4yzaK",
                        "updatedAt": "2021-08-02",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1hIr4RtVjTdtB0wPfnfkCH3Ktu3Y1jdFw",
                    "name": "測試文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1hIr4RtVjTdtB0wPfnfkCH3Ktu3Y1jdFw",
                    "updatedAt": "2021-07-28",
                    "children": [
                      {
                        "id": "1wXrsg_V5NYL50VULvB9u_ytX4LhIqpRs",
                        "name": "Job1 ~ Job3 測試文件.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1wXrsg_V5NYL50VULvB9u_ytX4LhIqpRs/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-28",
                        "sizeOrNote": "Word · 8.7 MB"
                      },
                      {
                        "id": "1Fx2UKNYWBor1kOCGB8yHCbmUFSbmZvlZ",
                        "name": "Job4 測試文件.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1Fx2UKNYWBor1kOCGB8yHCbmUFSbmZvlZ/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-07-28",
                        "sizeOrNote": "Word · 60.4 MB"
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1cqC_IghNd6q0I8YO1XSnBHxEZf_0hs_w",
                "name": "青埔巴士改進-車輛日誌記錄系統",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1cqC_IghNd6q0I8YO1XSnBHxEZf_0hs_w",
                "updatedAt": "2021-07-27",
                "children": [
                  {
                    "id": "1WADVyieEc8cOqmwvwvObK0cXyBuzNDgp",
                    "name": "20210804_First_Meeting",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1WADVyieEc8cOqmwvwvObK0cXyBuzNDgp",
                    "updatedAt": "2021-08-05",
                    "children": [
                      {
                        "id": "1rh-WdH7gr-8N6dWu42Ip_CgrQ0Epou_S",
                        "name": "2021_0804_日誌系統會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1rh-WdH7gr-8N6dWu42Ip_CgrQ0Epou_S/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-05",
                        "sizeOrNote": "Word · 58 KB"
                      },
                      {
                        "id": "1EqAdOmdgOG2HkSlJSVkYOJeapL8GxWeK",
                        "name": "Action_item_list.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1EqAdOmdgOG2HkSlJSVkYOJeapL8GxWeK/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-18",
                        "sizeOrNote": "Word · 22 KB"
                      }
                    ]
                  },
                  {
                    "id": "1kyzfvdMiiYnCMdI3qNW5TBUfHVguTWzR",
                    "name": "20210811",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1kyzfvdMiiYnCMdI3qNW5TBUfHVguTWzR",
                    "updatedAt": "2021-08-11",
                    "children": [
                      {
                        "id": "1WJoDsLmyEK1mAe6CqZdlMZ7RtVx91v1q",
                        "name": "2021_0811_日誌系統會議記錄.docx",
                        "kind": "document",
                        "driveUrl": "https://docs.google.com/document/d/1WJoDsLmyEK1mAe6CqZdlMZ7RtVx91v1q/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                        "updatedAt": "2021-08-17",
                        "sizeOrNote": "Word · 29 KB"
                      },
                      {
                        "id": "1HibBcEQkn2C3ca_3HaO8jx4qzhshX-nH",
                        "name": "log_process_data_flow.drawio",
                        "kind": "document",
                        "driveUrl": "https://drive.google.com/file/d/1HibBcEQkn2C3ca_3HaO8jx4qzhshX-nH/view?usp=drivesdk",
                        "updatedAt": "2021-08-18",
                        "sizeOrNote": "文件 · 2 KB"
                      }
                    ]
                  },
                  {
                    "id": "1fory4YJjjndm-ufTouDkiD6CK_9jTqSF",
                    "name": "RosToCsv_weekly.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1fory4YJjjndm-ufTouDkiD6CK_9jTqSF/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-09-13",
                    "sizeOrNote": "簡報 · 45 KB"
                  },
                  {
                    "id": "12UIoPLDfPVuBGWkmh84vdNF2vvvJAX7y",
                    "name": "日誌系統.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/12UIoPLDfPVuBGWkmh84vdNF2vvvJAX7y/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-09-06",
                    "sizeOrNote": "Word · 90 KB"
                  },
                  {
                    "id": "1Ymi9TDf7mxFRPadgkRBxvdn0szyg2bFT",
                    "name": "日誌系統​.pptx",
                    "kind": "presentation",
                    "driveUrl": "https://docs.google.com/presentation/d/1Ymi9TDf7mxFRPadgkRBxvdn0szyg2bFT/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-09-06",
                    "sizeOrNote": "簡報 · 107 KB"
                  },
                  {
                    "id": "15T8ZdWxW_KAs4bksEU1PCRddlSuvsJ-r",
                    "name": "日誌系統檢測.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/15T8ZdWxW_KAs4bksEU1PCRddlSuvsJ-r/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-23",
                    "sizeOrNote": "試算表 · 15 KB"
                  },
                  {
                    "id": "1u33UtD1gkSfm-N5iIvg5AunERXdLSXW0",
                    "name": "日誌系統簡單架構圖",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1u33UtD1gkSfm-N5iIvg5AunERXdLSXW0/view?usp=drivesdk",
                    "updatedAt": "2021-09-01",
                    "sizeOrNote": "文件 · 5 KB"
                  }
                ]
              },
              {
                "id": "1nSnSTZyq5G25zhlE6u1W8jsNE9uGros8",
                "name": "青埔巴士改進-遠端控制自駕模式",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1nSnSTZyq5G25zhlE6u1W8jsNE9uGros8",
                "updatedAt": "2021-08-03",
                "children": [
                  {
                    "id": "1U8F7haVH2sPbfYjzV0jRvrE_1jPSqegB",
                    "name": "aws",
                    "kind": "document",
                    "driveUrl": "https://drive.google.com/file/d/1U8F7haVH2sPbfYjzV0jRvrE_1jPSqegB/view?usp=drivesdk",
                    "updatedAt": "2021-08-17",
                    "sizeOrNote": "文件 · 2 KB"
                  },
                  {
                    "id": "1zdui1jnYF-3pIPGGmgmaofHB9W083mcU",
                    "name": "aws.png",
                    "kind": "image",
                    "driveUrl": "https://drive.google.com/file/d/1zdui1jnYF-3pIPGGmgmaofHB9W083mcU/view?usp=drivesdk",
                    "updatedAt": "2021-08-17",
                    "sizeOrNote": "PNG 圖檔 · 31 KB"
                  },
                  {
                    "id": "1Ct7VZWNTEu9fZc6FWAyO-FqER6nIEocs",
                    "name": "LINE_MOVIE_1630232583842.mp4",
                    "kind": "archive",
                    "driveUrl": "https://drive.google.com/file/d/1Ct7VZWNTEu9fZc6FWAyO-FqER6nIEocs/view?usp=drivesdk",
                    "updatedAt": "2021-08-29",
                    "sizeOrNote": "MP4 影片 · 9.2 MB"
                  },
                  {
                    "id": "1LPdEWniAzfd4mlr8KWzVcSgJzHf4dmnC",
                    "name": "線上測試1-1.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1LPdEWniAzfd4mlr8KWzVcSgJzHf4dmnC/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-29",
                    "sizeOrNote": "Word · 376 KB"
                  },
                  {
                    "id": "1LMztAqdygzDPDEi5Ts12MRFqOQb632_s",
                    "name": "青埔遠端控制自駕模式 計劃說明.docx",
                    "kind": "document",
                    "driveUrl": "https://docs.google.com/document/d/1LMztAqdygzDPDEi5Ts12MRFqOQb632_s/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-29",
                    "sizeOrNote": "Word · 48 KB"
                  },
                  {
                    "id": "10UlCwFhzYiRwl3iMzrYjIorJ8d2eqMAn",
                    "name": "青埔遠端控制自駕模式milestone.xlsx",
                    "kind": "spreadsheet",
                    "driveUrl": "https://docs.google.com/spreadsheets/d/10UlCwFhzYiRwl3iMzrYjIorJ8d2eqMAn/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                    "updatedAt": "2021-08-29",
                    "sizeOrNote": "試算表 · 22 KB"
                  }
                ]
              },
              {
                "id": "1O4pIRYXOEN-u1tuE8i0OcADcCNYBBUvW",
                "name": "RTK 說帖.pdf",
                "kind": "pdf",
                "driveUrl": "https://drive.google.com/file/d/1O4pIRYXOEN-u1tuE8i0OcADcCNYBBUvW/view?usp=drivesdk",
                "updatedAt": "2021-09-06",
                "sizeOrNote": "PDF · 2.8 MB"
              },
              {
                "id": "1cv2HkBtny9Z8kWSs_z9vm4nOJ34UrBVE",
                "name": "S__77553667.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1cv2HkBtny9Z8kWSs_z9vm4nOJ34UrBVE/view?usp=drivesdk",
                "updatedAt": "2021-09-27",
                "sizeOrNote": "JPG 圖檔 · 2.9 MB"
              },
              {
                "id": "1oZ0ufwR1KzROQ3AGQYt0svzE1ZwCSZGc",
                "name": "S__77553669.jpg",
                "kind": "image",
                "driveUrl": "https://drive.google.com/file/d/1oZ0ufwR1KzROQ3AGQYt0svzE1ZwCSZGc/view?usp=drivesdk",
                "updatedAt": "2021-09-27",
                "sizeOrNote": "JPG 圖檔 · 2.9 MB"
              },
              {
                "id": "1id7bzAhZ4mpOqxxDg5GoNs9DrmQrOCPH",
                "name": "青埔奇異點.pptx",
                "kind": "presentation",
                "driveUrl": "https://docs.google.com/presentation/d/1id7bzAhZ4mpOqxxDg5GoNs9DrmQrOCPH/edit?usp=drivesdk&ouid=115404262022083692234&rtpof=true&sd=true",
                "updatedAt": "2021-07-27",
                "sizeOrNote": "簡報 · 51 KB"
              }
            ]
          }
        ]
      },
      {
        "id": "2019-sunrise-golf-cart",
        "code": "GOLF-SUNRISE",
        "name": "20190719_揚昇高爾夫球自動駕駛車開發案",
        "startYear": 2019,
        "period": "2019 – 2020",
        "department": "交通行動服務部 / 研發部",
        "sharedDriveName": "交通行動服務部 | MaaS",
        "status": "archived",
        "summary": "台灣首創高爾夫球場自動駕駛球車實地開發與場域驗證案（揚昇高爾夫鄉村俱樂部），包含合約管理、系統開發、測試驗收、照片影片與 90 揚昇技術文件，奠定後續智慧球車 v1/v2 與 Golface 量產車之技術基礎。",
        "highlights": [
          "06_系統開發 & 90_揚昇技術文件",
          "07_測試驗收 & 08_照片影片",
          "03_合約管理 & 04_詢價報價"
        ],
        "driveFolderId": "1fJhV90XrcK9ojTdl6FZDTFGtrI_fV19l",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1fJhV90XrcK9ojTdl6FZDTFGtrI_fV19l",
        "files": [
          {
            "id": "1QDyBpl1DWlxgN-qZ7DLCWtkvIb9sMCj2",
            "name": "03_合約管理",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1QDyBpl1DWlxgN-qZ7DLCWtkvIb9sMCj2",
            "updatedAt": "2021-03-10",
            "sizeOrNote": "專案合作契約與保密協議",
            "accessScope": "confidential",
            "allowedDepartments": [
              "營業",
              "BD",
              "財務",
              "總經理"
            ],
            "allowedRoles": [
              "admin",
              "finance"
            ],
            "children": [
              {
                "id": "1yR1_7fppfUyFgLrfcW-hxRzjhqnhpKjL",
                "name": "供應商報價",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1yR1_7fppfUyFgLrfcW-hxRzjhqnhpKjL",
                "updatedAt": "2021-03-10",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ],
                "children": [
                  {
                    "id": "1G2MwysBFcH_2ymnaa-I6avi65dP685L-",
                    "name": "奕兆",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1G2MwysBFcH_2ymnaa-I6avi65dP685L-",
                    "updatedAt": "2021-03-10",
                    "children": [
                      {
                        "id": "1UXJmE6g4Vg214qD9UCZf0S4qmjCDn1Ij",
                        "name": "2020",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1UXJmE6g4Vg214qD9UCZf0S4qmjCDn1Ij",
                        "updatedAt": "2021-03-11",
                        "children": []
                      },
                      {
                        "id": "1HGPsB7lGirSPjq8AVuL3F9Jz885Id1Mq",
                        "name": "2021",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1HGPsB7lGirSPjq8AVuL3F9Jz885Id1Mq",
                        "updatedAt": "2021-03-10",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1tn3YFAnuxbqoTJJAK2b0Kq2dkyAQzhxD",
                "name": "合約管理",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1tn3YFAnuxbqoTJJAK2b0Kq2dkyAQzhxD",
                "updatedAt": "2021-03-10",
                "accessScope": "confidential",
                "allowedDepartments": [
                  "營業",
                  "BD",
                  "財務",
                  "總經理"
                ],
                "allowedRoles": [
                  "admin",
                  "finance"
                ],
                "children": [
                  {
                    "id": "1O91H-vCJo6m3YuM3XEHPS6fqKC0dwExy",
                    "name": "01_亞慶",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1O91H-vCJo6m3YuM3XEHPS6fqKC0dwExy",
                    "updatedAt": "2021-03-23",
                    "children": [
                      {
                        "id": "11MXMx_t7QMKm_7COLjvp9PuO1kopKjQJ",
                        "name": "20190624 保密協定",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/11MXMx_t7QMKm_7COLjvp9PuO1kopKjQJ",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1y8ds6iGkbh5MF-GgVetNeIy8T-GKaeSy",
                        "name": "20190719_主合約",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1y8ds6iGkbh5MF-GgVetNeIy8T-GKaeSy",
                        "updatedAt": "2021-05-14",
                        "accessScope": "confidential",
                        "allowedDepartments": [
                          "營業",
                          "BD",
                          "財務",
                          "總經理"
                        ],
                        "allowedRoles": [
                          "admin",
                          "finance"
                        ],
                        "children": []
                      },
                      {
                        "id": "1DUdJvPHVRmTlBi6VflcpWTOPHaV-5kAm",
                        "name": "20190814 追加合約",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1DUdJvPHVRmTlBi6VflcpWTOPHaV-5kAm",
                        "updatedAt": "2021-05-14",
                        "accessScope": "confidential",
                        "allowedDepartments": [
                          "營業",
                          "BD",
                          "財務",
                          "總經理"
                        ],
                        "allowedRoles": [
                          "admin",
                          "finance"
                        ],
                        "children": []
                      },
                      {
                        "id": "16SL6q-N3UumHi832waCeo_0ZCu_WZR3j",
                        "name": "20210203 追加合約(兩輛球車)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/16SL6q-N3UumHi832waCeo_0ZCu_WZR3j",
                        "updatedAt": "2021-05-14",
                        "accessScope": "confidential",
                        "allowedDepartments": [
                          "營業",
                          "BD",
                          "財務",
                          "總經理"
                        ],
                        "allowedRoles": [
                          "admin",
                          "finance"
                        ],
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1oqDMeNiBy2KS1K3XBy3eIjvJFQWzrkl2",
                    "name": "02_人因(車隊管理系統)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1oqDMeNiBy2KS1K3XBy3eIjvJFQWzrkl2",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1dsaJKE_J2Iu4jqdaQyAqisK1jbd2FkCi",
                    "name": "03_人因轉包興創(車隊管理系統)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1dsaJKE_J2Iu4jqdaQyAqisK1jbd2FkCi",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1ClBBgY3nAg_FXqH95WiuvZNIa0cQXymr",
                    "name": "04_奕兆(車輛改裝)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ClBBgY3nAg_FXqH95WiuvZNIa0cQXymr",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1bINYt5YMEFgzmttqGUKH0rfCduzfiNH5",
                    "name": "05_興創(高精度地圖)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1bINYt5YMEFgzmttqGUKH0rfCduzfiNH5",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1SRYYShg444mUkw4wAo_-FnvM7JLWrN78",
                    "name": "06_若水(影像標註)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1SRYYShg444mUkw4wAo_-FnvM7JLWrN78",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1cklrcvrg-eewEN7gNJF9ETXNodRPERNO",
                    "name": "07_浩志美學(語音APP)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1cklrcvrg-eewEN7gNJF9ETXNodRPERNO",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1OzGMB-9XhgMgeiZbt_tKNS_RIpIfOBmo",
                    "name": "08_其他外包",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1OzGMB-9XhgMgeiZbt_tKNS_RIpIfOBmo",
                    "updatedAt": "2021-03-10",
                    "children": [
                      {
                        "id": "1rv8IKnjxPmK88-zIPq33xrgirTpVGZ7-",
                        "name": "雅棋勞務承攬(車隊管理系統UI)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1rv8IKnjxPmK88-zIPq33xrgirTpVGZ7-",
                        "updatedAt": "2021-03-10",
                        "children": []
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "id": "1FjvYm0wTXPBBaLNLxl8guDofsaEjMAsM",
            "name": "06_系統開發",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1FjvYm0wTXPBBaLNLxl8guDofsaEjMAsM",
            "updatedAt": "2021-03-23",
            "sizeOrNote": "球道自駕感知、定位與控制系統研發資料",
            "children": [
              {
                "id": "1RG_hYgJp16_r9ZV90y24aiQqZUexOIId",
                "name": "00_揚昇需求分析",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1RG_hYgJp16_r9ZV90y24aiQqZUexOIId",
                "updatedAt": "2021-03-23",
                "children": [
                  {
                    "id": "1su3G7vEeN8fLORnZm8Ev7-krkEEZxXX2",
                    "name": "01_shotgun相關",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1su3G7vEeN8fLORnZm8Ev7-krkEEZxXX2",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "18DIlSGy23JgytcEy34RqupNIa6QYIT9w",
                    "name": "02_堵車相關",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/18DIlSGy23JgytcEy34RqupNIa6QYIT9w",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "12sDIp72_0ZEjri_0MAA85iTdsK-Yk2HH",
                    "name": "03_行車安全相關",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/12sDIp72_0ZEjri_0MAA85iTdsK-Yk2HH",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1GdViqTxxIQ8OXsqkIXwzL9DPhtnfM3CD",
                    "name": "04_自動停車",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1GdViqTxxIQ8OXsqkIXwzL9DPhtnfM3CD",
                    "updatedAt": "2021-03-23",
                    "children": []
                  },
                  {
                    "id": "1hCdnINhaV0Ef6hDRKnEB4pHv2WLIJBwV",
                    "name": "05_認證金鑰",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1hCdnINhaV0Ef6hDRKnEB4pHv2WLIJBwV",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1u7MVoIxOIygVuBIZeFcxlxsCH7sz5Uje",
                    "name": "06_地下室GPS",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1u7MVoIxOIygVuBIZeFcxlxsCH7sz5Uje",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "13J7daKXm7H7XLbQrPD8pOaVIeT9b3lLm",
                    "name": "07_車上平板安裝位置",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/13J7daKXm7H7XLbQrPD8pOaVIeT9b3lLm",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1PAROrap0dGUnlWk25GGFH_vog43vVeQ9",
                        "name": "1_Reference",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1PAROrap0dGUnlWk25GGFH_vog43vVeQ9",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1uLeQRKgHld4IZOBhiaNYGqWVqhH5qOUF",
                "name": "01_車輛",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1uLeQRKgHld4IZOBhiaNYGqWVqhH5qOUF",
                "updatedAt": "2021-03-11",
                "children": [
                  {
                    "id": "1eveCmeN3Vqy53dQ50ACABcUgYUqWp6CX",
                    "name": "奕兆(車輛改裝)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1eveCmeN3Vqy53dQ50ACABcUgYUqWp6CX",
                    "updatedAt": "2021-03-11",
                    "children": [
                      {
                        "id": "1G23OrhQDWGrV2ogvAIuPTit_nBH20PXK",
                        "name": "BOM",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1G23OrhQDWGrV2ogvAIuPTit_nBH20PXK",
                        "updatedAt": "2021-03-11",
                        "children": []
                      },
                      {
                        "id": "15ijtCeYmT6up7YEaJ33NlPlWT4OQH7kO",
                        "name": "Component",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/15ijtCeYmT6up7YEaJ33NlPlWT4OQH7kO",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1mc8twpymPSP3kIgt7kFYpJLuYW-3zqsK",
                        "name": "系統分析",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1mc8twpymPSP3kIgt7kFYpJLuYW-3zqsK",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1aEuvycpvxFT0G47nBAWgX0m_-hUYr4Mu",
                "name": "02_高精地圖",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1aEuvycpvxFT0G47nBAWgX0m_-hUYr4Mu",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1caIDMxz4G3f_kGW1MBdLkiWRvDccLlHs",
                    "name": "01_興創文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1caIDMxz4G3f_kGW1MBdLkiWRvDccLlHs",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1Y89K_tRSx_2Z9t4OI9uGydM1VmcAnKrV",
                        "name": "20200421_路線草圖 all",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Y89K_tRSx_2Z9t4OI9uGydM1VmcAnKrV",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1ViIXXgZRmZE511cVRdzFzsAQ7_JMncgw",
                    "name": "02_揚昇文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ViIXXgZRmZE511cVRdzFzsAQ7_JMncgw",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1EMMgcq9sUozBsIa-eI91W0C5D-t0AVBR",
                    "name": "03_Turing文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1EMMgcq9sUozBsIa-eI91W0C5D-t0AVBR",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "id": "11bBA_yHsS5I66BnynRc4vnym-g1sgKZy",
            "name": "07_測試驗收",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/11bBA_yHsS5I66BnynRc4vnym-g1sgKZy",
            "updatedAt": "2021-03-25",
            "sizeOrNote": "揚昇球場坡道與球道實車驗收測試紀錄",
            "children": [
              {
                "id": "1sA0KpQEOOHP-nkFq6qjtMLXqUotOYQGQ",
                "name": "揚昇實車測試記錄表",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1sA0KpQEOOHP-nkFq6qjtMLXqUotOYQGQ",
                "updatedAt": "2021-03-29",
                "children": [
                  {
                    "id": "1Q_Q-bl0kyYF1BJ7DtaAIjW6yp7J5M8-R",
                    "name": "1. 測試人員流程",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Q_Q-bl0kyYF1BJ7DtaAIjW6yp7J5M8-R",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1JtwFX5A9sA0t-Su2sTdeVQw0ftf4U8wZ",
                        "name": "測試表單範例",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1JtwFX5A9sA0t-Su2sTdeVQw0ftf4U8wZ",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "11KfW2u0FUj5uGh3OJ006fBha4_1_lv6z",
                        "name": "遠端移車_救援車輛 操作範例(影片檔)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/11KfW2u0FUj5uGh3OJ006fBha4_1_lv6z",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "109OcYk0DNU-xSUaoAKBcvFrsW5IFEvIu",
                    "name": "2.每日測試記錄彙整",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/109OcYk0DNU-xSUaoAKBcvFrsW5IFEvIu",
                    "updatedAt": "2021-04-15",
                    "children": [
                      {
                        "id": "1XMRcG9GkWQo6OHlxCmn5f7a0EEU92cvY",
                        "name": "20210315",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1XMRcG9GkWQo6OHlxCmn5f7a0EEU92cvY",
                        "updatedAt": "2021-03-29",
                        "children": []
                      },
                      {
                        "id": "1LvSz05VzVW4UCUdcqHWVhjIBMnmB_KO-",
                        "name": "20210316",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1LvSz05VzVW4UCUdcqHWVhjIBMnmB_KO-",
                        "updatedAt": "2021-03-29",
                        "children": []
                      },
                      {
                        "id": "1LNXFtukdMZ7opkSUfXABGeVpXWuP4iCj",
                        "name": "20210318",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1LNXFtukdMZ7opkSUfXABGeVpXWuP4iCj",
                        "updatedAt": "2021-03-29",
                        "children": []
                      },
                      {
                        "id": "1TTIPBdbgTnEmm6mDrBHTBW5407xt-BUc",
                        "name": "20210325",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1TTIPBdbgTnEmm6mDrBHTBW5407xt-BUc",
                        "updatedAt": "2021-03-29",
                        "children": []
                      },
                      {
                        "id": "1PRC8hdg3HkvZ_X8KXc9iPkAnkAiG1na-",
                        "name": "20210329",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1PRC8hdg3HkvZ_X8KXc9iPkAnkAiG1na-",
                        "updatedAt": "2021-03-30",
                        "children": []
                      },
                      {
                        "id": "1V9mg9pQgpWKfmaraDvjbxilXmTTZZ0ex",
                        "name": "20210330",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1V9mg9pQgpWKfmaraDvjbxilXmTTZZ0ex",
                        "updatedAt": "2021-04-01",
                        "children": []
                      },
                      {
                        "id": "1htFjE9m9T4W7QzeP1X8suvpNEWsaKXJg",
                        "name": "20210331",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1htFjE9m9T4W7QzeP1X8suvpNEWsaKXJg",
                        "updatedAt": "2021-04-01",
                        "children": []
                      },
                      {
                        "id": "1856Ov52YYgxUO5Sk0LprOZEQWFcTgS72",
                        "name": "20210401_C3_R1",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1856Ov52YYgxUO5Sk0LprOZEQWFcTgS72",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1S5FNm5cUESflVmaVgubVcPUzc2yva2AV",
                        "name": "20210406",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1S5FNm5cUESflVmaVgubVcPUzc2yva2AV",
                        "updatedAt": "2021-04-07",
                        "children": []
                      },
                      {
                        "id": "1BtLaqB6cnwUV69LbWsNykqeo-g8bLZXJ",
                        "name": "20210407",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1BtLaqB6cnwUV69LbWsNykqeo-g8bLZXJ",
                        "updatedAt": "2021-04-08",
                        "children": []
                      },
                      {
                        "id": "1eLcYBjBJ9RTRZrcUd__VdD8ldb_UDu-1",
                        "name": "20210409",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1eLcYBjBJ9RTRZrcUd__VdD8ldb_UDu-1",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1HI8WT27WEIkJmIVLi_C_Q69efWw2qxPw",
                        "name": "20210412",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1HI8WT27WEIkJmIVLi_C_Q69efWw2qxPw",
                        "updatedAt": "2021-04-13",
                        "children": []
                      },
                      {
                        "id": "1_C_U7R-MMo4lNc1ryeeG4j3rNosdMUyd",
                        "name": "20210414",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1_C_U7R-MMo4lNc1ryeeG4j3rNosdMUyd",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1Q_2m1-zIxrfLDw2d4Zoc4DC4nm1zC_4Y",
                    "name": "3.草皮路線行駛狀況盤點表格",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Q_2m1-zIxrfLDw2d4Zoc4DC4nm1zC_4Y",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "id": "1BBQUzgJUrsqPSMekNjEDycuGm-OlOxyT",
            "name": "08_照片影片",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1BBQUzgJUrsqPSMekNjEDycuGm-OlOxyT",
            "updatedAt": "2021-04-16",
            "sizeOrNote": "實車運行照片與展示影片歸檔",
            "children": [
              {
                "id": "1QKATJ8hOaf7itpJi6oVRbJXrCEdBlf01",
                "name": "行銷素材蒐集",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1QKATJ8hOaf7itpJi6oVRbJXrCEdBlf01",
                "updatedAt": "2021-05-14",
                "children": []
              }
            ]
          },
          {
            "id": "1fp4OXuo8JSpVF-90RViMyTrIT0UDnLCu",
            "name": "90_揚昇技術文件",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1fp4OXuo8JSpVF-90RViMyTrIT0UDnLCu",
            "updatedAt": "2021-03-23",
            "sizeOrNote": "第一代自駕球車核心技術規格與圖面",
            "children": [
              {
                "id": "1cnXg564jINMXuZJGw2rueVUC2MOpi0RR",
                "name": "Infra文件",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1cnXg564jINMXuZJGw2rueVUC2MOpi0RR",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1MiqGG4DJPxQq3DiG_zufP_xAoquZfL3v",
                    "name": "2020揚昇發展史",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1MiqGG4DJPxQq3DiG_zufP_xAoquZfL3v",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1z6MzMGqk6l8k5CsBTPJ3argBv9TlZtp5",
                    "name": "Behavier_Control",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1z6MzMGqk6l8k5CsBTPJ3argBv9TlZtp5",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              },
              {
                "id": "1yKcti05m74dLaH9kXFTrR_ime4mIzpTB",
                "name": "issue",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1yKcti05m74dLaH9kXFTrR_ime4mIzpTB",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1_JOvCU_QfAympQG-tccAPKFiN7uxk7oo",
                "name": "OCC文件",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1_JOvCU_QfAympQG-tccAPKFiN7uxk7oo",
                "updatedAt": "2021-03-23",
                "children": [
                  {
                    "id": "1l90lq0NDJ7vewApO_Qr373SNOBGDUHHh",
                    "name": "內部開發文件",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1l90lq0NDJ7vewApO_Qr373SNOBGDUHHh",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1lwP-X9nOx7SGbLFVNyyWvqo2cDsALegD",
                        "name": "時序圖",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1lwP-X9nOx7SGbLFVNyyWvqo2cDsALegD",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1Wrjg-Wi_-3qgLQQUlq8pDfreYEB61Mun",
                        "name": "車輛狀態圖",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Wrjg-Wi_-3qgLQQUlq8pDfreYEB61Mun",
                        "updatedAt": "2021-03-23",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1K69po3wXryid56R3j3vyizo-05N0UI2U",
                    "name": "興創合作",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1K69po3wXryid56R3j3vyizo-05N0UI2U",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1jt_kMoucawWajPQNIx0QDfgD4u4UQJmR",
                        "name": "OLD",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1jt_kMoucawWajPQNIx0QDfgD4u4UQJmR",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1VFJ-Bz7UQU_q5jaJIw9UiXpH7y2YC8Tm",
                "name": "RTK設定",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1VFJ-Bz7UQU_q5jaJIw9UiXpH7y2YC8Tm",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1BuLRdSxUS94Y8g650oJM5z4EMnNRsKOS",
                "name": "地圖相關",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1BuLRdSxUS94Y8g650oJM5z4EMnNRsKOS",
                "updatedAt": "2021-03-29",
                "children": [
                  {
                    "id": "1L_OuQ93_4HjcnpUiB7wcq12lLfl8Rp_a",
                    "name": "全區gird圖",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1L_OuQ93_4HjcnpUiB7wcq12lLfl8Rp_a",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1HOnR7I0pG41yxPKWckX6nF_coZwHY1mH",
                    "name": "全區路線圖",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1HOnR7I0pG41yxPKWckX6nF_coZwHY1mH",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1HH9lfFAjCGrkJInV4k2uc8WTdmZOZB3G",
                    "name": "精度驗證",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1HH9lfFAjCGrkJInV4k2uc8WTdmZOZB3G",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "14qPDrqvvW36F0P4ZZ0iXCzUdQX6kzgJx",
                        "name": "20210202YS",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/14qPDrqvvW36F0P4ZZ0iXCzUdQX6kzgJx",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "19G89KsDxEuX9yjmCyfGFAg_o99NCmi9U",
                        "name": "RTK_test_0122",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/19G89KsDxEuX9yjmCyfGFAg_o99NCmi9U",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1o-BcOyHONnCX1LUpQhrHRJh9W7dwrA6G",
                "name": "手機攝影紀錄",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1o-BcOyHONnCX1LUpQhrHRJh9W7dwrA6G",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1KpLwiGTFAhsf1CbHpnEGA49PlPJgAJb4",
                "name": "車輛spec",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1KpLwiGTFAhsf1CbHpnEGA49PlPJgAJb4",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1W3OH50iBnbCJkh0WWQ-uoNT9u0QcIL2G",
                    "name": "二人座",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1W3OH50iBnbCJkh0WWQ-uoNT9u0QcIL2G",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "16Gngoa68EfxB6dz9qkgmlnS3w0cYM0-z",
                    "name": "新二人座(#3、#4)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/16Gngoa68EfxB6dz9qkgmlnS3w0cYM0-z",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "2019-singapore-cfc",
        "code": "SG-CFC2019",
        "name": "2019 Singapore CFC & 2020 Republic Polytechnic（新加坡海外市場開發）",
        "startYear": 2019,
        "period": "2019 – 2020",
        "department": "國際市場開發",
        "sharedDriveName": "營業部 Business Development",
        "status": "archived",
        "summary": "2019 年參與新加坡自動駕駛 Call for Collaboration (CFC) 國際徵案，以及 2020 年新加坡 Republic Polytechnic (Tron-e SG) 自駕合作專案之技術提案與商務檔案。",
        "highlights": [
          "2019 Singapore CFC 提案資料夾",
          "2020 Republic Polytechnic (Tron-e SG) 專案資料夾"
        ],
        "driveFolderId": "1-kOU1QmmG6hoCQN6v9IMeKum-5qJfyKv",
        "driveFolderUrl": "https://drive.google.com/drive/folders/1-kOU1QmmG6hoCQN6v9IMeKum-5qJfyKv",
        "files": [
          {
            "id": "1ze7VUYilZiXT28_wP4Qpgkxng4X8pLeJ",
            "name": "2019 Singapore CFC",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1ze7VUYilZiXT28_wP4Qpgkxng4X8pLeJ",
            "updatedAt": "2021-04-26",
            "sizeOrNote": "英文提案簡報、規格書與新加坡法規整理",
            "children": [
              {
                "id": "1FX3omkdfDOI42p3utV_4TpsmfChTI_vh",
                "name": "0_Team Work and Partner Management",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1FX3omkdfDOI42p3utV_4TpsmfChTI_vh",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1J6gucRYVyq5H62TCqdiiLVF5NRkJrWuX",
                    "name": "20190611_Singapore visit",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1J6gucRYVyq5H62TCqdiiLVF5NRkJrWuX",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1Qc-8HjDOpIc_5jGvShe1splfifmPfZVf",
                        "name": "20190612_Singapore Visit",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Qc-8HjDOpIc_5jGvShe1splfifmPfZVf",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1q_xeztF983Bw9-hfrClFniTAt_JPXXDJ",
                    "name": "20190725_Singapore visit",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1q_xeztF983Bw9-hfrClFniTAt_JPXXDJ",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1bfKm5H0E2xoQEybDHjk2Un2POQpPXD0J",
                    "name": "20190912_Singapore visit",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1bfKm5H0E2xoQEybDHjk2Un2POQpPXD0J",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "18SSu5_1_sCy7LAAMUwozRlssXUc6L81H",
                    "name": "CETRAN HD Map Evaluation Agreement with HERE",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/18SSu5_1_sCy7LAAMUwozRlssXUc6L81H",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1yYfgiJzXDYxBdNZi1-2Rse4v-oRgVfEw",
                    "name": "NDA",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1yYfgiJzXDYxBdNZi1-2Rse4v-oRgVfEw",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "14j3VvyLbaoDPUJUpVxil8VjURKATQuva",
                    "name": "分工表",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/14j3VvyLbaoDPUJUpVxil8VjURKATQuva",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1QA6nPuYfi0LWQ9qBA226O1SMHFdrSc4f",
                    "name": "合作夥伴介紹",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1QA6nPuYfi0LWQ9qBA226O1SMHFdrSc4f",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              },
              {
                "id": "1b2x1AUAxfVdopTk1Rqqga5419gCqcGZT",
                "name": "1_CFC Tender Documents and Summary",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1b2x1AUAxfVdopTk1Rqqga5419gCqcGZT",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1GORdWdJznPbwqLwMh4RRv2iKGW38x6gF",
                    "name": "1-1_Core and Cost Tables",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1GORdWdJznPbwqLwMh4RRv2iKGW38x6gF",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1J1NNHpyj3m3CKdWOmHslPZsLPPTmIDsG",
                    "name": "1-2_From DVD Disc",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1J1NNHpyj3m3CKdWOmHslPZsLPPTmIDsG",
                    "updatedAt": "2021-04-26",
                    "children": [
                      {
                        "id": "1oZsiA4k95qVUZLwuNkfMl3dmKjBfPS2d",
                        "name": "OD Data",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1oZsiA4k95qVUZLwuNkfMl3dmKjBfPS2d",
                        "updatedAt": "2021-04-26",
                        "children": []
                      },
                      {
                        "id": "1AEMsCZOFlaWalW5eYpucPuoRNuoc8JOm",
                        "name": "Roads",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1AEMsCZOFlaWalW5eYpucPuoRNuoc8JOm",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1QoQ_DLOf5bbBM2qGx0aYOEl2UlYpruzi",
                        "name": "Shape files for bus stops",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1QoQ_DLOf5bbBM2qGx0aYOEl2UlYpruzi",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1akSRqg0rZgKCiIjNwf_mBNiP6aKFM60L",
                    "name": "1_Updated Version",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1akSRqg0rZgKCiIjNwf_mBNiP6aKFM60L",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1nWZWFvVjmOLE0hIapuKXfwwIjJjGAi3p",
                    "name": "X_Original Version",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1nWZWFvVjmOLE0hIapuKXfwwIjJjGAi3p",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              },
              {
                "id": "1z3YffYkHobCjtFh-4lDiTm7wwIOkV79P",
                "name": "3_Reference Materials (New)",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1z3YffYkHobCjtFh-4lDiTm7wwIOkV79P",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1ULhnpbAQL6PevpZzG2d_ah92VNx5kfKH",
                    "name": "Altair",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1ULhnpbAQL6PevpZzG2d_ah92VNx5kfKH",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1bUXffD8pKFHUzS3vsTPKMSO255LVf2d9",
                    "name": "Autonomy R&D (Section 6-III & 13)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1bUXffD8pKFHUzS3vsTPKMSO255LVf2d9",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1JFrNVM2-4DrJRaVJXfgLH1DdObxdModJ",
                        "name": "EURO NCAP",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1JFrNVM2-4DrJRaVJXfgLH1DdObxdModJ",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1KcL30xYy4JDJqla-myoVjPvggoiEqss3",
                        "name": "Mcity",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1KcL30xYy4JDJqla-myoVjPvggoiEqss3",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1IVzZwmO_jNlEzNXvDQBiD-0ESozS0dhW",
                        "name": "NHTSA",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1IVzZwmO_jNlEzNXvDQBiD-0ESozS0dhW",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1Pqh20aHiTZLobtwYzXXicFqjVCI7SWMQ",
                        "name": "NVIDIA",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Pqh20aHiTZLobtwYzXXicFqjVCI7SWMQ",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1qFgvYPl87TUL7cbbUTc3EdUisIP8HC7v",
                    "name": "Booking & FMS",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1qFgvYPl87TUL7cbbUTc3EdUisIP8HC7v",
                    "updatedAt": "2021-04-26",
                    "children": [
                      {
                        "id": "18IlJZjn1Rvwv71ctlt45ryEdHSBYiAx8",
                        "name": "Metropia",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/18IlJZjn1Rvwv71ctlt45ryEdHSBYiAx8",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1iw1W1SzITsYsBl8GatXzUS-_WdcDLOWd",
                        "name": "Trapeze",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1iw1W1SzITsYsBl8GatXzUS-_WdcDLOWd",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1GAdq-OkUdvK_EMOqsSheu4HGpIA5bedE",
                    "name": "Concept of Operation",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1GAdq-OkUdvK_EMOqsSheu4HGpIA5bedE",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1qmaTXmPOFT5ePlX1FdtyxJGUj-YmD-MY",
                        "name": "JID",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1qmaTXmPOFT5ePlX1FdtyxJGUj-YmD-MY",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "10McFBT8eptHcgaGkuYDLboThMaKnu4SU",
                    "name": "Cybersecurity",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/10McFBT8eptHcgaGkuYDLboThMaKnu4SU",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1A3Ost9QL3w8DAsjc9XRUv5AI-HJfAo7P",
                    "name": "HD MAP",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1A3Ost9QL3w8DAsjc9XRUv5AI-HJfAo7P",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1-amY2u9POfTaA6PfOZht_twygTkmUa1F",
                    "name": "Market Analysis",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1-amY2u9POfTaA6PfOZht_twygTkmUa1F",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1rm8rwQCsmqJOYTWaryJsP8-0edIuybIX",
                    "name": "Milestone 1 Application",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1rm8rwQCsmqJOYTWaryJsP8-0edIuybIX",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1fZbvZHnZYVkQo72yhW8udfAphqW7pT9L",
                    "name": "NVIDIA",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1fZbvZHnZYVkQo72yhW8udfAphqW7pT9L",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1uDB_5Pote9QTc8pZvBPtRZuK7JSqwTeL",
                    "name": "Parcel delivery",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1uDB_5Pote9QTc8pZvBPtRZuK7JSqwTeL",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1BPxWAZAOw4WV0-8fBWDmWa0CTlYX66R6",
                    "name": "Routing Models",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1BPxWAZAOw4WV0-8fBWDmWa0CTlYX66R6",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1LjKJbnHVexl29JQtlEmFdbw7kc4F5WZ-",
                    "name": "Safety",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1LjKJbnHVexl29JQtlEmFdbw7kc4F5WZ-",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1E-eZITRwhOKkwoDvcB13kJ847-KeCGtK",
                    "name": "Simulation",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1E-eZITRwhOKkwoDvcB13kJ847-KeCGtK",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "13jic4pAwD3XANRopKRy47_lPr1EGN6QV",
                    "name": "Singapore AV Technical Requirements (TR 68)",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/13jic4pAwD3XANRopKRy47_lPr1EGN6QV",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1MSKKB8AL7e7t8stlaY7-xAIiEzgk-QTO",
                        "name": "中文翻譯",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1MSKKB8AL7e7t8stlaY7-xAIiEzgk-QTO",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1C4O9khBrstTVl3aTK7r1Cf_5ezBYvHTA",
                    "name": "Singapore Land Transport Master Plan",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1C4O9khBrstTVl3aTK7r1Cf_5ezBYvHTA",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1Vo7Xtj24HxlapjpePNd-18M_bP8W2shB",
                    "name": "TURING 現有專案",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1Vo7Xtj24HxlapjpePNd-18M_bP8W2shB",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1jhigbaPC8hqYUW7yl2SIwSQ9_Yd159e-",
                    "name": "V2X",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1jhigbaPC8hqYUW7yl2SIwSQ9_Yd159e-",
                    "updatedAt": "2021-05-14",
                    "children": []
                  }
                ]
              },
              {
                "id": "1Gcmx-EaEbv6Jjnan2ld7Pe4P9fe0HUUc",
                "name": "5_Core Form and Cost Tables",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1Gcmx-EaEbv6Jjnan2ld7Pe4P9fe0HUUc",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "1r6prImimkoFP5GjUCne2rpdn19pIpUjk",
                    "name": "20190731_Proposal Submission",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1r6prImimkoFP5GjUCne2rpdn19pIpUjk",
                    "updatedAt": "2021-04-26",
                    "children": [
                      {
                        "id": "1q2aXe3AcdrzE4vqJuWvYAEiHURdyY7x0",
                        "name": "ModeA-JID",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1q2aXe3AcdrzE4vqJuWvYAEiHURdyY7x0",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1RY9_x92q9Cqnvangz787qz536JRGxcXq",
                        "name": "ModeA-Punggol",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1RY9_x92q9Cqnvangz787qz536JRGxcXq",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1FnI0_rzdTjnVgsm7dIHB2MdpW9fjChPx",
                        "name": "ModeB-JID",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1FnI0_rzdTjnVgsm7dIHB2MdpW9fjChPx",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1kE0lOg4eG3xTeCfXWDDEZTmcHZhrVJKU",
                        "name": "ModeB-Punggol",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1kE0lOg4eG3xTeCfXWDDEZTmcHZhrVJKU",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1l18qMBcHUG4uGfGqpyEu04O7wCEU5YM4",
                    "name": "20190930_Core Form and Cost Tables_QA r1 & r2 submission",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1l18qMBcHUG4uGfGqpyEu04O7wCEU5YM4",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1hTpglIX1ccmQ17MPogGkiU2vm3tRhpOP",
                    "name": "20191126_Core Form and Cost Tables_QA r3 & r4 submission",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1hTpglIX1ccmQ17MPogGkiU2vm3tRhpOP",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "1PsuKTQtUaa2_Gwl8l9t4DYvKVm5j7XJ2",
                    "name": "Core Form and Cost Tables_AVIDO format",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1PsuKTQtUaa2_Gwl8l9t4DYvKVm5j7XJ2",
                    "updatedAt": "2021-05-14",
                    "children": []
                  },
                  {
                    "id": "122ylfbiU0K3OdaYSrKJwkAqAWex7jEek",
                    "name": "分項與彙整試算",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/122ylfbiU0K3OdaYSrKJwkAqAWex7jEek",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1qEKvXo5dTda5pOync4tw4yGI8DerKUqk",
                        "name": "Cost Talbes 試算大表",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1qEKvXo5dTda5pOync4tw4yGI8DerKUqk",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1kdEBjHH_4pxl014NveqklUuB21zTwHWu",
                "name": "6_Proposal (New)",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1kdEBjHH_4pxl014NveqklUuB21zTwHWu",
                "updatedAt": "2021-04-26",
                "children": [
                  {
                    "id": "10aHzdoBHqqz6dHbMXyWETHfq852qm5-2",
                    "name": "20190729_Submission",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/10aHzdoBHqqz6dHbMXyWETHfq852qm5-2",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1rM8MjPiJYJ4xAH0ofhsYhV3wadwVYV4q",
                        "name": "Proposal in 3 parts for print",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1rM8MjPiJYJ4xAH0ofhsYhV3wadwVYV4q",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1RAHsyjzCTZ874UtH63TXvSzJNRyB9Vid",
                        "name": "附件",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1RAHsyjzCTZ874UtH63TXvSzJNRyB9Vid",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1K3GTsAimcY-QhAHaq75hC7mKqcPRjS6P",
                    "name": "Working Draft",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1K3GTsAimcY-QhAHaq75hC7mKqcPRjS6P",
                    "updatedAt": "2021-04-26",
                    "children": [
                      {
                        "id": "13a0Un7LP1bV3MM7qGffMnj_vMN-mlwzY",
                        "name": "Kenetics (blackbox and ticketing)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/13a0Un7LP1bV3MM7qGffMnj_vMN-mlwzY",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1FPufBqat6T8D89UkWICp6eiBrl-JwK5z",
                        "name": "KKC (HD Map)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1FPufBqat6T8D89UkWICp6eiBrl-JwK5z",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1-J9ENIh0NcnrWk1tDQP0kn4tuUYEvyjd",
                        "name": "Metropia (demand analysis)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1-J9ENIh0NcnrWk1tDQP0kn4tuUYEvyjd",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1rXIpMHLjRTy-5_aVEXukD-j8EDALmfjI",
                        "name": "SWAT (Booking, PIDS, AV FMS)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1rXIpMHLjRTy-5_aVEXukD-j8EDALmfjI",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1Z2Wt0X88MJNA_gOEuRu-SnmhZhUxccfl",
                        "name": "Trivect (safety operator schedule)",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1Z2Wt0X88MJNA_gOEuRu-SnmhZhUxccfl",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1iFldFrABEXKR6NNyZTUQHmfDPjnzKZK-",
                "name": "7_QA",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1iFldFrABEXKR6NNyZTUQHmfDPjnzKZK-",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "17oROm-uOE03b9J_oH-IThHtgMz7e9ocw",
                    "name": "Turing's Appendices",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/17oROm-uOE03b9J_oH-IThHtgMz7e9ocw",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1s_6gPCnttrMLV1dCJ17Cmgrf4ftX22m2",
                        "name": "原始資料",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1s_6gPCnttrMLV1dCJ17Cmgrf4ftX22m2",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1sgTRJ3BMSNMGbRE2JAHQzyzDSjdIVveV",
                "name": "8_Presentation and Technical Demonstration",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1sgTRJ3BMSNMGbRE2JAHQzyzDSjdIVveV",
                "updatedAt": "2021-04-26",
                "children": [
                  {
                    "id": "1jB_S1gqnUJqSpszXB8JrZbMzqKQ4dIB9",
                    "name": "20190916_Presentation to AVIDO",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1jB_S1gqnUJqSpszXB8JrZbMzqKQ4dIB9",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1u2hPzQLHtgZmL6Zo0MiLX3VzWne233nE",
                        "name": "SWAT",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1u2hPzQLHtgZmL6Zo0MiLX3VzWne233nE",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1yd3Jct4YNE_sb_oLXvabOBeDzetSosQd",
                    "name": "20191001_Technical Demonstration in Taiwan",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1yd3Jct4YNE_sb_oLXvabOBeDzetSosQd",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "135j0Mm5UI4zusHiz7RVrZ_26i8pllV2Y",
                        "name": "Photos of AVIDO Technical Demonstration",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/135j0Mm5UI4zusHiz7RVrZ_26i8pllV2Y",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              },
              {
                "id": "1mD1acitAx9QE9d5GCdhuaIPXl5FKmV8M",
                "name": "9_Illustrations",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1mD1acitAx9QE9d5GCdhuaIPXl5FKmV8M",
                "updatedAt": "2021-05-14",
                "children": [
                  {
                    "id": "12B-ilEWHPOluKeiekp1h1TPhBwt0-9Z_",
                    "name": "Illustration from Felix Lim",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/12B-ilEWHPOluKeiekp1h1TPhBwt0-9Z_",
                    "updatedAt": "2021-05-14",
                    "children": [
                      {
                        "id": "1AjmSbxtUNwD3Kvab6BmeHpf0QLbgKW9t",
                        "name": "新增資料夾",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1AjmSbxtUNwD3Kvab6BmeHpf0QLbgKW9t",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  },
                  {
                    "id": "1J-NJTOgU-CuBLVgG5O30ciK50uwSyotv",
                    "name": "radar_picture",
                    "kind": "folder",
                    "driveUrl": "https://drive.google.com/drive/folders/1J-NJTOgU-CuBLVgG5O30ciK50uwSyotv",
                    "updatedAt": "2021-04-26",
                    "children": [
                      {
                        "id": "1ZDpH68S8KvC5MfafEg7nTMLi5kIHWG45",
                        "name": "4m_analysis_picture",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1ZDpH68S8KvC5MfafEg7nTMLi5kIHWG45",
                        "updatedAt": "2021-05-14",
                        "children": []
                      },
                      {
                        "id": "1ZcN4BoZJA14wuIg5qD_XCMbAi9L2Yutm",
                        "name": "6m_analysis_picture",
                        "kind": "folder",
                        "driveUrl": "https://drive.google.com/drive/folders/1ZcN4BoZJA14wuIg5qD_XCMbAi9L2Yutm",
                        "updatedAt": "2021-05-14",
                        "children": []
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "id": "1Iwv6parn2TxpzMZSSzbOkyxZ0xKXs9X0",
            "name": "2020 Republic Polytechnic (Tron-e SG)",
            "kind": "folder",
            "driveUrl": "https://drive.google.com/drive/folders/1Iwv6parn2TxpzMZSSzbOkyxZ0xKXs9X0",
            "updatedAt": "2021-04-26",
            "sizeOrNote": "新加坡共和理工學院自駕電動巴士合作案",
            "children": [
              {
                "id": "1EURApXTc_WwG2vHxqpOmQPe6mA7AaF6p",
                "name": "RP Reference",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1EURApXTc_WwG2vHxqpOmQPe6mA7AaF6p",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "1TOktb-D2W-bmFUqibzFPBLynN3r4hBWg",
                "name": "RPO000ETT20300055",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/1TOktb-D2W-bmFUqibzFPBLynN3r4hBWg",
                "updatedAt": "2021-05-14",
                "children": []
              },
              {
                "id": "10UxxJODc-x34jTU9Kt_LnA8V7zkWJYrJ",
                "name": "Turing Drive Proposal",
                "kind": "folder",
                "driveUrl": "https://drive.google.com/drive/folders/10UxxJODc-x34jTU9Kt_LnA8V7zkWJYrJ",
                "updatedAt": "2021-05-14",
                "children": []
              }
            ]
          }
        ]
      }
    ]
  }
];
