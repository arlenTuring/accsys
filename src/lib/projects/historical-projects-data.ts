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
export function buildDriveEmbedPreviewUrl(
  item: HistoricalDriveItem,
  mode: 'drive_preview' | 'docs_preview' | 'edit' = 'drive_preview',
  authUser?: string
): string | null {
  if (item.kind === 'folder') return null;
  const id = item.id;
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
    year: 2026,
    label: '2026 年起始專案',
    tagline: 'T3 桃園機場三航廈專案執行、TIER IV 短期合作案、PJ-389 NSC 遠端控制、經濟部國貿署海外拓銷補助案',
    projectOverview:
      '涵蓋桃園機場第三航廈自駕運輸系統 2026 年度開發與介面設計、日本 TIER IV 短期技術專案、PJ-389 NSC Remote 遠端監控開發，以及經濟部國貿署日本市場拓展補助計畫。',
    projects: [
      {
        id: '2026-t3-projects',
        code: 'T3-2026',
        name: 'T3 桃園機場第三航廈自駕運輸系統（2026 年度執行）',
        startYear: 2026,
        period: '2026 Q1 – 執行中',
        department: '專案執行 / 產品與系統研發',
        sharedDriveName: 'T3 projects',
        status: 'active',
        accessScope: 'company_wide',
        accessGroupLabel: 'tprogram@turing-drive.com · 全公司可讀',
        summary:
          '桃園國際機場第三航站區旅客運輸系統 2026 年度執行資料夾，整合開發時程、HMI/FMS 介面設計、廠商報價資料、歷次會議記錄與審查報告。',
        highlights: ['開發時程與里程碑追蹤', '介面設計 (HMI / 派遣後台)', '報價資料與規格書', '會議記錄與相關報告'],
        driveFolderId: '1fzq_AGkCZy2XLwCZjzu7z7z1m-9qIifX',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1fzq_AGkCZy2XLwCZjzu7z7z1m-9qIifX',
        files: [
          {
            id: '1hJNvpG9Z8Mm-COJliBMa81onmiLVNQmd',
            name: '開發時程',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1hJNvpG9Z8Mm-COJliBMa81onmiLVNQmd',
            updatedAt: '2026-03-23',
            sizeOrNote: '專案甘特圖與里程碑規劃（含 6 個檔案）',
            accessScope: 'company_wide',
            children: [
              {
                id: '1at59IGrN9zKOv3mcoMKzuCeZRT0AdvXE',
                name: '時程網圖0D_核定_中階進度表.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1at59IGrN9zKOv3mcoMKzuCeZRT0AdvXE/view?usp=drivesdk',
                updatedAt: '2026-02-25',
                sizeOrNote: 'PDF · 4.7 MB · 核定版中階進度網圖',
                keyTakeaways: ['核定版 0D 階段中階時程網圖', '定義第三航廈自駕運輸系統各分標關鍵里程碑與介面檢核點'],
              },
              {
                id: '1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9',
                name: '時程表_20260316.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9/edit',
                updatedAt: '2026-03-23',
                sizeOrNote: '試算表 · 27 KB · 最新雙週滾動時程表',
                keyTakeaways: ['2026/03/16 最新版工程與軟硬體整合雙週進度追蹤', '含子系統交付日與查核點狀態'],
              },
              {
                id: '1pkujdpZUPn27FsAqBKd5x1xmScXCH96x',
                name: '時程表_20260309.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1pkujdpZUPn27FsAqBKd5x1xmScXCH96x/edit',
                updatedAt: '2026-03-11',
                sizeOrNote: '試算表 · 27 KB · 03/09 版進度時程表',
              },
              {
                id: '1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B',
                name: '桃園T3 PMS施工協調會20260309 V2.pptx',
                kind: 'presentation',
                driveUrl: 'https://docs.google.com/presentation/d/1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B/edit',
                updatedAt: '2026-03-11',
                sizeOrNote: '簡報 · 29.9 MB · 03/09 施工協調會簡報 V2',
                keyTakeaways: ['桃園 T3 PMS 施工協調會議簡報', '涵蓋土建機電介面、充電樁配置與高架測試廊道進場時程'],
              },
              {
                id: '1B1xUjopYjnRpqHh-0MSrwBTK_5Ibz5DJ',
                name: '計畫時程圖_底圖_20260225.pptx',
                kind: 'presentation',
                driveUrl: 'https://docs.google.com/presentation/d/1B1xUjopYjnRpqHh-0MSrwBTK_5Ibz5DJ/edit',
                updatedAt: '2026-02-25',
                sizeOrNote: '簡報 · 79 KB · 計畫時程底圖',
              },
              {
                id: '1U8C1E7B_lDWWJg3NWgYLxW_QzDVsG_bI',
                name: '資料整理.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1U8C1E7B_lDWWJg3NWgYLxW_QzDVsG_bI/edit',
                updatedAt: '2026-03-11',
                sizeOrNote: 'Word · 1.8 MB · 時程與工程規範彙整文件',
              },
            ],
          },
          {
            id: '16eXqmtrFyv-bOkkLISx9mJheUZD34zke',
            name: '介面設計',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/16eXqmtrFyv-bOkkLISx9mJheUZD34zke',
            updatedAt: '2026-03-24',
            sizeOrNote: '車載 HMI 與行控中心 UI 規範（含 4 子目錄 + SOP 文件）',
            accessScope: 'company_wide',
            children: [
              {
                id: '1WGid16WpNuhbYoenBZuvrWqR0znQ4wlT',
                name: 'SyncDrive-T3 營運全景圖台：設計製作與元件規範 (SOP).docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1WGid16WpNuhbYoenBZuvrWqR0znQ4wlT/edit',
                updatedAt: '2026-03-24',
                sizeOrNote: 'Word · 34 KB · 營運全景圖台 UI/UX 設計製作與元件 SOP',
                keyTakeaways: [
                  '定義 SyncDrive-T3 營運全景圖台四大圖層（營運核心、資訊配置、資通安全、後勤管理）',
                  '規範車隊即時點位、告警燈號、充電站狀態與無障礙設計標準',
                ],
              },
              {
                id: '1p2b25QSJhBM_VzMmPI6puzk69ivR21A1',
                name: 'A. 車輛監控系統-營運核心層',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1p2b25QSJhBM_VzMmPI6puzk69ivR21A1',
                updatedAt: '2026-03-17',
                sizeOrNote: '即時車隊動態、班距調度與異常接管介面設計稿（含 5 個簡報）',
                children: [
                  {
                    id: '1z-WiIlOe-DywhbmLzTDEzLpb07djfAAQ',
                    name: '01. 數據監控模組.pptx',
                    kind: 'presentation',
                    driveUrl: 'https://docs.google.com/presentation/d/1z-WiIlOe-DywhbmLzTDEzLpb07djfAAQ/edit',
                    updatedAt: '2026-03-10',
                    sizeOrNote: '簡報 · 17.3 MB · 車隊即時數據監控模組 UI 設計',
                  },
                  {
                    id: '1E2gvY5mH7j8PptsU2-ys_Z9fmAf9hlfE',
                    name: '02. 營運管理模組.pptx',
                    kind: 'presentation',
                    driveUrl: 'https://docs.google.com/presentation/d/1E2gvY5mH7j8PptsU2-ys_Z9fmAf9hlfE/edit',
                    updatedAt: '2026-03-10',
                    sizeOrNote: '簡報 · 20.4 MB · 營運調度與派車管理模組 UI 設計',
                  },
                  {
                    id: '1yrZGqYDo9OAhNrGNZzuvl8x_cHs8cQks',
                    name: '03. 班表管理模組.pptx',
                    kind: 'presentation',
                    driveUrl: 'https://docs.google.com/presentation/d/1yrZGqYDo9OAhNrGNZzuvl8x_cHs8cQks/edit',
                    updatedAt: '2026-03-17',
                    sizeOrNote: '簡報 · 11.4 MB · 班表排程與發車頻率管理模組',
                  },
                  {
                    id: '11bxfXe1m5E90PCQ-rZirORxR2mwo96_P',
                    name: '04. 事件管理模組.pptx',
                    kind: 'presentation',
                    driveUrl: 'https://docs.google.com/presentation/d/11bxfXe1m5E90PCQ-rZirORxR2mwo96_P/edit',
                    updatedAt: '2026-02-26',
                    sizeOrNote: '簡報 · 7.0 MB · 異常事件告警與應變SOP模組',
                  },
                  {
                    id: '14e4ThwJUsoM0dHZ1ts0_dqZcEDi6cDsl',
                    name: "00Turing Drive's 空白投影片.pptx",
                    kind: 'presentation',
                    driveUrl: 'https://docs.google.com/presentation/d/14e4ThwJUsoM0dHZ1ts0_dqZcEDi6cDsl/edit',
                    updatedAt: '2026-02-26',
                    sizeOrNote: '簡報 · 7.0 MB · 介面設計公版母片',
                  },
                ],
              },
              {
                id: '1AJKmrM-JsEFMJc6glOy3citTns6P6fvi',
                name: 'B. 車輛監控系統-資訊配置層',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1AJKmrM-JsEFMJc6glOy3citTns6P6fvi',
                updatedAt: '2026-02-26',
                sizeOrNote: '站牌 PID 旅客資訊顯示與車內廣播配置層',
              },
              {
                id: '1zGWgWliPPw9Z9NoWZ-1dynPuyE1HqZ8i',
                name: 'C. 車輛監控系統-資通安全層',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1zGWgWliPPw9Z9NoWZ-1dynPuyE1HqZ8i',
                updatedAt: '2026-02-26',
                sizeOrNote: '車聯網通訊加密、權限控管與資安監控儀表板',
              },
              {
                id: '1vDUxwZM6p-_0IK4QSBMgkr5DPeIZ4Pp6',
                name: 'D. 車輛監控系統-後勤管理層',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1vDUxwZM6p-_0IK4QSBMgkr5DPeIZ4Pp6',
                updatedAt: '2026-02-26',
                sizeOrNote: '維保工單、電池健康度 SOH 與零件庫存後勤介面',
              },
            ],
          },
          {
            id: '1GvvezKlj4c0EyZmOr7qOVASSP5vBV5XQ',
            name: '報價資料',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1GvvezKlj4c0EyZmOr7qOVASSP5vBV5XQ',
            updatedAt: '2026-03-23',
            sizeOrNote: '專案預算表與 Turing 報價單（財務／商務機密）',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
            children: [
              {
                id: '1_ICpYfR6cGtvXYzoIJi-C_ljuB1X6eU7',
                name: '2026年度營收.產品專案預算表_T3.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1_ICpYfR6cGtvXYzoIJi-C_ljuB1X6eU7/edit',
                updatedAt: '2026-03-23',
                sizeOrNote: '試算表 · 223 KB · 2026 年度 T3 專案營收與預算編列總表',
                accessScope: 'confidential',
                allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                allowedRoles: ['admin', 'finance'],
                keyTakeaways: [
                  '2026 年度 T3 專案各季認列營收、軟硬體採購成本與人力工時預算配置',
                  '可直接引用此預算表發起請購單或費用支用單',
                ],
              },
              {
                id: '1LAgKKuwSi3Q1YTzaR8jBTN7NVWFAZLl4',
                name: 'T3 PMS案Turing報價_20251020.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1LAgKKuwSi3Q1YTzaR8jBTN7NVWFAZLl4/edit',
                updatedAt: '2026-02-25',
                sizeOrNote: '試算表 · 113 KB · T3 PMS 案 Turing 正式報價明細表',
                accessScope: 'confidential',
                allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                allowedRoles: ['admin', 'finance'],
                keyTakeaways: ['對華電聯網／業主之 T3 PMS 子系統分項報價與軟硬體 BOM 單價明細'],
              },
            ],
          },
          {
            id: '1LrBGBS9kHG69MJHtDr5ca4gpGZBGeGUo',
            name: '會議記錄',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1LrBGBS9kHG69MJHtDr5ca4gpGZBGeGUo',
            updatedAt: '2026-03-11',
            sizeOrNote: '週會與業主協調會議紀錄（含施工協調會簡報）',
            accessScope: 'company_wide',
            children: [
              {
                id: '1DHssHBpJ1OuPa0ycRqhHG8EVIR4F4o36',
                name: '桃園T3 PMS施工協調會20260309 V2.pptx',
                kind: 'presentation',
                driveUrl: 'https://docs.google.com/presentation/d/1DHssHBpJ1OuPa0ycRqhHG8EVIR4F4o36/edit',
                updatedAt: '2026-03-11',
                sizeOrNote: '簡報 · 29.9 MB · 03/09 施工協調會議決議與待辦追蹤',
                keyTakeaways: ['記錄 2026/03/09 與總包商及機場公司之施工介面協調決議事項'],
              },
            ],
          },
          {
            id: '1x0vM7kHB3k6ZA_JSA6TG-2aP8nuv1tXT',
            name: '相關報告',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1x0vM7kHB3k6ZA_JSA6TG-2aP8nuv1tXT',
            updatedAt: '2026-04-16',
            sizeOrNote: '第02584K章施工規範與期末設計報告（含 6 個檔案）',
            accessScope: 'company_wide',
            children: [
              {
                id: '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY',
                name: '01_第02584K章 車輛行車管理系統_20260330v1 資通所與台智駕更新 0413.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY/edit',
                updatedAt: '2026-04-16',
                sizeOrNote: 'Word · 13.6 MB · 04/13 資通所與台智駕聯合更新版規範',
                keyTakeaways: [
                  '第 02584K 章「車輛行車管理系統」最新修訂版（2026/04/13）',
                  '整合工研院資通所與台灣智慧駕駛針對車隊通訊、行控安全與備援機制之更新條文',
                ],
              },
              {
                id: '1wJxIq_5KLsR2Qi3SE0QWCymrAsVOeG0K',
                name: '期末設計報告(0B)_CH4_車輛行車管理系統_0330v1_資通所與台智駕更新 0413.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1wJxIq_5KLsR2Qi3SE0QWCymrAsVOeG0K/edit',
                updatedAt: '2026-04-16',
                sizeOrNote: 'Word · 13.4 MB · 期末設計報告 (0B) 第四章定稿',
                keyTakeaways: ['0B 階段期末設計報告第 4 章完整技術論述與架構圖表'],
              },
              {
                id: '1GFWlDvm4ognF_8xRWjd-1VKRr23BM7CK',
                name: '01_第02584K章 車輛行車管理系統_20260207v1.docx.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1GFWlDvm4ognF_8xRWjd-1VKRr23BM7CK/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 9.5 MB · 02/07 版規範 PDF 簽核定稿本',
                keyTakeaways: ['第 02584K 章 PDF 正式版，適合快速預覽章節結構與驗收標準'],
              },
              {
                id: '1eA_1h9D_m43SmuFffMIYexaoPaM5Wk0A',
                name: '01_第02584K章 車輛行車管理系統_20260207v1.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1eA_1h9D_m43SmuFffMIYexaoPaM5Wk0A/edit',
                updatedAt: '2026-03-11',
                sizeOrNote: 'Word · 13.7 MB · 02/07 版原始可編輯檔',
              },
              {
                id: '18QllB5fWEcRCmo0U1OFssIjaqMIid7y0',
                name: '簡報.pptx',
                kind: 'presentation',
                driveUrl: 'https://docs.google.com/presentation/d/18QllB5fWEcRCmo0U1OFssIjaqMIid7y0/edit',
                updatedAt: '2026-03-11',
                sizeOrNote: '簡報 · 240 KB · 審查報告摘要簡報',
              },
              {
                id: '1unhjr2M8RUPQ9KTGhMZl4xvOn-wfJdbu',
                name: "00Turing Drive's 空白投影片.pptx",
                kind: 'presentation',
                driveUrl: 'https://docs.google.com/presentation/d/1unhjr2M8RUPQ9KTGhMZl4xvOn-wfJdbu/edit',
                updatedAt: '2026-04-14',
                sizeOrNote: '簡報 · 10.4 MB · 2026 官方簡報母片範本',
              },
            ],
          },
        ],
      },
      {
        id: '2026-tier-iv',
        code: 'BD-TIER4',
        name: '1.[專案] TIER IV 短期專案',
        startYear: 2026,
        period: '2026 Q1 – 執行中',
        department: '營業部 BD-Tokyo Drift',
        sharedDriveName: 'BD-Tokyo Drift',
        status: 'active',
        accessScope: 'company_wide',
        accessGroupLabel: 'bd-tokyodrift@turing-drive.com · 全公司可讀',
        summary:
          '與日本自動駕駛領導廠商 TIER IV 合作之短期技術與商務推進專案，包含 LiDAR-to-Vehicle 外參校正報告、日方 PO 訂單與 PI 報價簽署文件。',
        highlights: ['LiDAR-to-Vehicle 外參校正技術報告', '202603 発注 PO 與 PI 簽署單據', '日方商務郵件往來紀錄'],
        driveFolderId: '1hrzS-2-t1moxEPFjiGMcyyf4M4GA20vI',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1hrzS-2-t1moxEPFjiGMcyyf4M4GA20vI',
        files: [
          {
            id: '1PU4gXdfephAyFg4GR-cPwSCgyo93-e_n',
            name: '郵件往來',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1PU4gXdfephAyFg4GR-cPwSCgyo93-e_n',
            updatedAt: '2026-03-09',
            sizeOrNote: 'TIER IV 技術與商務往來信件備份',
          },
          {
            id: '1BI5xMDwpxnI8Ochs1D6-MHKXYwHe1DJr',
            name: 'LiDAR-to-Vehicle (base_link) Extrinsic Calibration_1208.pdf',
            kind: 'pdf',
            driveUrl: 'https://drive.google.com/file/d/1BI5xMDwpxnI8Ochs1D6-MHKXYwHe1DJr/view?usp=drivesdk',
            updatedAt: '2026-03-09',
            sizeOrNote: 'PDF · 675 KB · 感測器外參校正技術文件',
            keyTakeaways: [
              'Autoware base_link 與多顆光達 (LiDAR) 外參矩陣標定方法與精度驗證報告',
              '提供 pitch / roll / yaw 與平移誤差收斂標準',
            ],
          },
          {
            id: '1TEMgzz0x7cKF83-imHnRWMxKwUTpOqaB',
            name: 'TDsigned_PO_202603発注_0228500_Turing Drive Inc.,.pdf',
            kind: 'pdf',
            driveUrl: 'https://drive.google.com/file/d/1TEMgzz0x7cKF83-imHnRWMxKwUTpOqaB/view?usp=drivesdk',
            updatedAt: '2026-03-09',
            sizeOrNote: 'PDF · 377 KB · 2026年3月正式採購訂單（商務機密）',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
            keyTakeaways: ['TIER IV 正式發注採購訂單 (PO #0228500)，雙方已用印簽回'],
          },
          {
            id: '1U9aQviERu2YlRu1PNrRT6oQRM6cOfMZH',
            name: 'TD-Signned-PI260223A.pdf',
            kind: 'pdf',
            driveUrl: 'https://drive.google.com/file/d/1U9aQviERu2YlRu1PNrRT6oQRM6cOfMZH/view?usp=drivesdk',
            updatedAt: '2026-03-09',
            sizeOrNote: 'PDF · 323 KB · Proforma Invoice 簽回單',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
          },
          {
            id: '1RKxkb_7EaQ4f0NYLigOxdixf-bympv6Z',
            name: 'TD_PI260213B.pdf',
            kind: 'pdf',
            driveUrl: 'https://drive.google.com/file/d/1RKxkb_7EaQ4f0NYLigOxdixf-bympv6Z/view?usp=drivesdk',
            updatedAt: '2026-03-09',
            sizeOrNote: 'PDF · 206 KB · PI 報價憑證',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
          },
          {
            id: '1IVRSpHuQA3nVW24G61sTSok_MfBTTxkX',
            name: '2026預算表NSC remote.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/1IVRSpHuQA3nVW24G61sTSok_MfBTTxkX/edit',
            updatedAt: '2026-03-12',
            sizeOrNote: '試算表 · 212 KB · 2026 年度專案預算表',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
          },
        ],
      },
      {
        id: '2026-pj389-nsc',
        code: 'PJ-389',
        name: '2.[專案] PJ-389 NSC Remote 遠端控制專案',
        startYear: 2026,
        period: '2025 Q4 – 2026',
        department: '營業部 BD-Tokyo Drift / 研發部',
        sharedDriveName: 'BD-Tokyo Drift',
        status: 'active',
        accessScope: 'company_wide',
        accessGroupLabel: 'bd-tokyodrift@turing-drive.com · 全公司可讀',
        summary:
          '日本客戶 NSC 遠端監控與操控系統（NSC Remote）專案，整理 API 規格文件、報價單與 Invoice、業務日報、運行數據及客戶郵件往來紀錄。',
        highlights: ['API 相關技術介面規格', '運行數據與業務日報', '報價單以及 Invoice 歸檔'],
        driveFolderId: '1ZURTynW5AWvAcKhFkW9bHEhYsHlmKDZu',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1ZURTynW5AWvAcKhFkW9bHEhYsHlmKDZu',
        files: [
          {
            id: '1fSizUJag4lvvasnC36pSyu8vqUDqncjh',
            name: 'API相關',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1fSizUJag4lvvasnC36pSyu8vqUDqncjh',
            updatedAt: '2026-03-09',
            sizeOrNote: 'NSC Remote 遠端控制 API 規格與客戶回饋（含 8 個檔案）',
            accessScope: 'company_wide',
            children: [
              {
                id: '1vRzPbhVDt93RoN0onBHa-qaRHtIidncX',
                name: 'TuringDrive_NewAPI_0121.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1vRzPbhVDt93RoN0onBHa-qaRHtIidncX/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 50 KB · Turing Drive 新版遠端控制 API 定義書',
                keyTakeaways: ['定義遠端監控中心與自駕車端 WebSocket / REST API 狀態回報與控制指令格式'],
              },
              {
                id: '1AWrBs39jK9v9fBRND0tIoPyTJkZ7ES7m',
                name: 'Calling_Service_API_Documentation_1224.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1AWrBs39jK9v9fBRND0tIoPyTJkZ7ES7m/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 266 KB · Calling Service 叫車派遣 API 規格文件',
                keyTakeaways: ['遠端叫車服務 (Calling Service) 端點規格、派車狀態機與錯誤碼定義'],
              },
              {
                id: '1LxwTfR9JIxz3S2efPAVki62BbFysnXOW',
                name: 'API客戶回饋整理0212.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1LxwTfR9JIxz3S2efPAVki62BbFysnXOW/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 349 KB · 日本客戶 API 串接問題與回饋總整理',
              },
              {
                id: '1IsFRNicmrTkF3pRVxp1YJ6MKdgq7Izwl',
                name: 'API客戶回饋0212：for MaaS.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1IsFRNicmrTkF3pRVxp1YJ6MKdgq7Izwl/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 308 KB · 針對 MaaS 團隊之 API 修改建議',
              },
              {
                id: '12NIP_LIFrZVCuP1sBrhPew3LfGr_fceD',
                name: 'APIテスト中文翻譯註解.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/12NIP_LIFrZVCuP1sBrhPew3LfGr_fceD/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 1.5 MB · 日方 API 測試案例中日對照註解',
              },
              {
                id: '1RJLl2ZA2yRcG7xxCWpqojQ_bcqED4U9w',
                name: 'API-disscusion-0211usecase_a.md',
                kind: 'document',
                driveUrl: 'https://drive.google.com/file/d/1RJLl2ZA2yRcG7xxCWpqojQ_bcqED4U9w/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'Markdown · 5.4 KB · 02/11 Use Case A 技術討論紀錄',
              },
              {
                id: '1MocNDm5mbeKRxKIiYWJPw27SKb8Idcd0',
                name: '天線WLA-EX-2209-0012-F(SPEC).pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1MocNDm5mbeKRxKIiYWJPw27SKb8Idcd0/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 3.6 MB · 車載外接天線硬體規格書',
              },
              {
                id: '1DlhPiDx8ITBJNJMlre6LZR9WMy4g7Nsb',
                name: '（4G-moduel）Quectel_EM06_Series_LTE-A_Specification_V1.7 (4G).pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1DlhPiDx8ITBJNJMlre6LZR9WMy4g7Nsb/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 432 KB · Quectel EM06 4G LTE-A 通訊模組規格書',
              },
            ],
          },
          {
            id: '1y8taWodoihBOdCwXHB9RXxHs3gTnjy1L',
            name: '運行數據',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1y8taWodoihBOdCwXHB9RXxHs3gTnjy1L',
            updatedAt: '2026-03-13',
            sizeOrNote: '日本實車運行與手自動切換次數統計（含 4 個試算表）',
            accessScope: 'company_wide',
            children: [
              {
                id: '1od9Wte6MCY2uhOdBFmWvFCZ6S5OB1KMo',
                name: '手動／自動切替回数260312.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1od9Wte6MCY2uhOdBFmWvFCZ6S5OB1KMo/edit',
                updatedAt: '2026-03-13',
                sizeOrNote: '試算表 · 49 KB · 截至 2026/03/12 手動／自動駕駛接管切換統計',
                keyTakeaways: ['統計日本場域每日自駕里程、手動接管 (Disengagement) 次數與觸發原因分類'],
              },
              {
                id: '18JC_ygzjG3RxQVq-QBl8ljRH9ilDmje_',
                name: '手動／自動切替回数260310.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/18JC_ygzjG3RxQVq-QBl8ljRH9ilDmje_/edit',
                updatedAt: '2026-03-11',
                sizeOrNote: '試算表 · 20 KB · 03/10 切換統計表',
              },
              {
                id: '1J6C6aHkOrVNt7cM5gLiudX5C0TNIgYSr',
                name: '手動／自動切替回数260304.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1J6C6aHkOrVNt7cM5gLiudX5C0TNIgYSr/edit',
                updatedAt: '2026-03-09',
                sizeOrNote: '試算表 · 24 KB · 03/04 切換統計表',
              },
              {
                id: '1b5NJ3ZVvH9VOixymPKUPwbt1xz1lhBgw',
                name: '2026-01-01 ~ 2026-02-14のデータ.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1b5NJ3ZVvH9VOixymPKUPwbt1xz1lhBgw/edit',
                updatedAt: '2026-03-09',
                sizeOrNote: '試算表 · 20 KB · 1月至2月中運行原始數據彙整',
              },
            ],
          },
          {
            id: '1BD6ZaNdn3B8IRbvrneABYAQjgdBvhkn2',
            name: '報價單以及Invoice',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1BD6ZaNdn3B8IRbvrneABYAQjgdBvhkn2',
            updatedAt: '2026-03-09',
            sizeOrNote: '專案報價單與各期請款 Invoice（財務／商務機密）',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
            children: [
              {
                id: '1DBcn3FbndDQoZViN18ztDCzCA-XKVR4Q',
                name: 'TD_IIGA_251107_Invoice.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1DBcn3FbndDQoZViN18ztDCzCA-XKVR4Q/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 292 KB · IIGA 請款 Invoice (2025/11/07)',
                accessScope: 'confidential',
                allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                allowedRoles: ['admin', 'finance'],
              },
              {
                id: '1qXXsU9YD_r6v57HaLT8K-Uo2ClnBdOZZ',
                name: 'TD_IIGA_251128_Invoice.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1qXXsU9YD_r6v57HaLT8K-Uo2ClnBdOZZ/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 224 KB · IIGA 請款 Invoice (2025/11/28)',
                accessScope: 'confidential',
                allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                allowedRoles: ['admin', 'finance'],
              },
              {
                id: '1Zx1QrQJMyL4UoupGG6jjdbqtQplPdSRB',
                name: 'TD_IIGA_251223_Invoice.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1Zx1QrQJMyL4UoupGG6jjdbqtQplPdSRB/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 261 KB · IIGA 請款 Invoice (2025/12/23)',
                accessScope: 'confidential',
                allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                allowedRoles: ['admin', 'finance'],
              },
              {
                id: '1IXpdDWkbTPrVyh06OHn_9cxA3KT942y4',
                name: 'TuringDrive-IIGA-Stamp.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1IXpdDWkbTPrVyh06OHn_9cxA3KT942y4/view?usp=drivesdk',
                updatedAt: '2026-03-09',
                sizeOrNote: 'PDF · 303 KB · 用印版合約與憑證',
                accessScope: 'confidential',
                allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                allowedRoles: ['admin', 'finance'],
              },
              {
                id: '1dDT6DcOua1Iu3Wi6f0M5VrEW9YOn_LnY',
                name: '第一次付款',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1dDT6DcOua1Iu3Wi6f0M5VrEW9YOn_LnY',
                updatedAt: '2026-03-09',
                sizeOrNote: '第一期款請款單據與水單',
              },
              {
                id: '1KaiWi7WDA_DXWomhTIN1PIAOYMX5LAVt',
                name: '第三次付款',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1KaiWi7WDA_DXWomhTIN1PIAOYMX5LAVt',
                updatedAt: '2026-03-09',
                sizeOrNote: '第三期款請款單據',
              },
              {
                id: '1TgZ14addQrOftgJtymYSG0L2j31Fdf0s',
                name: '第三次以及第四次付款變更說明',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1TgZ14addQrOftgJtymYSG0L2j31Fdf0s',
                updatedAt: '2026-03-09',
                sizeOrNote: '付款期程變更協議與說明文件',
              },
            ],
          },
          {
            id: '1N2AQipTwW7NjwuuZ72i5US-cIFgqzYL6',
            name: '業務日報',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1N2AQipTwW7NjwuuZ72i5US-cIFgqzYL6',
            updatedAt: '2026-03-09',
            sizeOrNote: '日本現場與遠端推進日報',
          },
          {
            id: '1F8--VLsfhJZDiCCS02K_zFuASQNF7888',
            name: '其他文件',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1F8--VLsfhJZDiCCS02K_zFuASQNF7888',
            updatedAt: '2026-03-09',
            sizeOrNote: '輔助技術規範與補充資料',
          },
          {
            id: '1vNT_SnRgtxVmhR44PIpwPXCXaO6tb32u',
            name: '郵件往來',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1vNT_SnRgtxVmhR44PIpwPXCXaO6tb32u',
            updatedAt: '2026-03-09',
            sizeOrNote: '客戶信件與會議決議歸檔',
          },
        ],
      },
      {
        id: '2026-boft-subsidy',
        code: 'GOV-BOFT',
        name: '4.[專案] 經濟部國貿署海外市場拓銷補助案',
        startYear: 2026,
        period: '2025 – 2026',
        department: '營業部 BD-Tokyo Drift',
        sharedDriveName: 'BD-Tokyo Drift',
        status: 'active',
        accessScope: 'company_wide',
        accessGroupLabel: 'bd-tokyodrift@turing-drive.com · 全公司可讀',
        summary:
          '經濟部國際貿易署補助計畫，涵蓋三大任務（行銷執行、建立日本據點、建立代理商）、Japan IT Week 參展，以及期中與期末成果報告。',
        highlights: ['任務一：行銷執行 & IT Week', '任務二：建立日本據點 / 任務三：建立代理商', '國貿署執行事項比較表.xlsx'],
        driveFolderId: '1P72BG5NLl4r027NUJTsh4882mmj7KemK',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1P72BG5NLl4r027NUJTsh4882mmj7KemK',
        files: [
          {
            id: '1h960MoUqctjGgD2I5FsoL93BmrBn7Ej7',
            name: '任務一：行銷執行',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1h960MoUqctjGgD2I5FsoL93BmrBn7Ej7',
            updatedAt: '2026-03-09',
            sizeOrNote: '海外行銷宣傳與展會推廣佐證',
          },
          {
            id: '1-W8ktr1Cqe7qByg9_V7AFSoLFe4kvAo3',
            name: '任務二：建立日本據點',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1-W8ktr1Cqe7qByg9_V7AFSoLFe4kvAo3',
            updatedAt: '2026-03-09',
            sizeOrNote: '日本辦公室設立與駐點資料',
          },
          {
            id: '17LuNuojNM55UjCiB06HGBmP4otBmn92q',
            name: '任務三：建立代理商',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/17LuNuojNM55UjCiB06HGBmP4otBmn92q',
            updatedAt: '2026-03-09',
            sizeOrNote: '日本在地代理商開發與合作協議',
          },
          {
            id: '1C_8aiyYe3-0ny7fCL4aegbRP75waOEVn',
            name: 'IT week',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1C_8aiyYe3-0ny7fCL4aegbRP75waOEVn',
            updatedAt: '2026-03-09',
            sizeOrNote: 'Japan IT Week 參展規劃與現場素材',
          },
          {
            id: '199trnIgAVxopxXEbg1XQ680SfKtCyGuj',
            name: '期中報告',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/199trnIgAVxopxXEbg1XQ680SfKtCyGuj',
            updatedAt: '2026-03-09',
            sizeOrNote: '國貿署補助計畫期中審查報告',
          },
          {
            id: '1JrrmYGo9jftzSpl6owzYHgqxdvkkzklX',
            name: '期末報告',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1JrrmYGo9jftzSpl6owzYHgqxdvkkzklX',
            updatedAt: '2026-03-09',
            sizeOrNote: '國貿署補助計畫期末結案與經費核銷',
          },
          {
            id: '1ZKZYDm7pDUGVbiCdsSv2Miw8Nr7iXH4W',
            name: '計畫書等準備文件',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1ZKZYDm7pDUGVbiCdsSv2Miw8Nr7iXH4W',
            updatedAt: '2026-03-09',
            sizeOrNote: '原始申請計畫書與核定公文',
          },
          {
            id: '1-CejmPv8STM32jGeW_Yk1Wjy--phAnyR',
            name: '國貿署執行事項比較表.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/1-CejmPv8STM32jGeW_Yk1Wjy--phAnyR/edit',
            updatedAt: '2026-03-09',
            sizeOrNote: '試算表 · 144 KB · KPI 目標與實際達成比較',
            keyTakeaways: ['國貿署補助案三大任務 KPI 指標、查核點進度與經費執行率對照表'],
          },
        ],
      },
    ],
  },
  {
    year: 2025,
    label: '2025 年起始專案',
    tagline: '桃園機場 T3 專案全系統規劃、Golface 商業合作案、GBGH 自駕接駁 Demo、ADAWARP 跨國合作案',
    projectOverview:
      '聚焦桃園國際機場第三航廈自駕運輸系統（ADS、MaaS、服務建議書華電最終版、RTK基站、行控號控、BIM T3 模型及北市審查委員意見回覆）、Golface 智慧球車新商務案、GBGH 場域實證與 ADAWARP 專案。',
    projects: [
      {
        id: '2025-t3-airport',
        code: 'T3-2025',
        name: '桃園國際機場第三航站區旅客運輸系統（2025 主專案）',
        startYear: 2025,
        period: '2025 Q1 – 2025 Q4',
        department: '專案執行 / 研發部 / 系統工程',
        sharedDriveName: '專案執行',
        status: 'completed',
        accessScope: 'company_wide',
        accessGroupLabel: 'tprogram@turing-drive.com · 全公司可讀',
        summary:
          '完整收錄桃園機場 T3 自駕運輸系統之專案管理分工、服務建議書（華電最終版）、ADS 自駕系統、MaaS 派遣、簡報 QA、RTK 基站示意圖、行控號控示意圖、BIM T3 模型及 1001 北市審查委員意見回覆。',
        highlights: [
          '服務建議書_華電最終版 & T3 document_for 華電_20250523_final',
          '臺灣桃園國際機場第三航站區旅客運輸系統工程專案_Turing內部分工表.xlsx',
          '1001 北市審查委員意見回覆 & BIM T3 模型',
          '行控號控示意圖.pptx & RTK基站設置倉10屋頂示意圖.pptx',
        ],
        driveFolderId: '1wq0SgemEvT8psTyWB8pIhy3bWaE7tZW1',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1wq0SgemEvT8psTyWB8pIhy3bWaE7tZW1',
        files: [
          {
            id: '1PuCSQJ5oqVKA6cds5qd4IpW95QTbZqsF',
            name: '服務建議書_華電最終版',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1PuCSQJ5oqVKA6cds5qd4IpW95QTbZqsF',
            updatedAt: '2025-07-07',
            sizeOrNote: '提交華電聯網之最終版服務建議書（含 5 個檔案）',
            children: [
              {
                id: '1WZtNhxpXibWdan0tZu9VXOFIVw-JNA2J',
                name: 'PMS建議書All-V13-20250606(本100)_浮水印版.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1WZtNhxpXibWdan0tZu9VXOFIVw-JNA2J/view?usp=drivesdk',
                updatedAt: '2025-06-06',
                sizeOrNote: 'PDF · 30.3 MB · PMS 服務建議書全冊 V13 最終版',
                keyTakeaways: ['桃園國際機場第三航站區 PMS 旅客運輸系統服務建議書完整定稿（V13 浮水印版）'],
              },
              {
                id: '1nUNpX_nIC0kZYO9LWqaWZlG9Nf1INywq',
                name: 'PMS第三航站區旅客運輸系統工程建議書附件三v4.0_250606.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1nUNpX_nIC0kZYO9LWqaWZlG9Nf1INywq/view?usp=drivesdk',
                updatedAt: '2025-06-06',
                sizeOrNote: 'PDF · 30.1 MB · 建議書附件三 v4.0',
              },
              {
                id: '1MTXec7pPivKSUCqHLlz3ZqjM6d17SgBv',
                name: 'PMS第三航站區旅客運輸系統工程建議書附件五v1.3_250604.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1MTXec7pPivKSUCqHLlz3ZqjM6d17SgBv/view?usp=drivesdk',
                updatedAt: '2025-06-04',
                sizeOrNote: 'PDF · 48.9 MB · 建議書附件五 v1.3',
              },
              {
                id: '1UB5wYWkLo8wNEbDKkSEbYbB2zysfcQ9e',
                name: 'PMS第三航站區旅客運輸系統工程建議書附件六v1.2_250604.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1UB5wYWkLo8wNEbDKkSEbYbB2zysfcQ9e/view?usp=drivesdk',
                updatedAt: '2025-06-04',
                sizeOrNote: 'PDF · 11.0 MB · 建議書附件六 v1.2',
              },
              {
                id: '1R-NmH4t2FbhhfsQSK1oCT9BR7CPE43_m',
                name: '文件.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1R-NmH4t2FbhhfsQSK1oCT9BR7CPE43_m/edit',
                updatedAt: '2025-07-07',
                sizeOrNote: 'Word · 21 KB · 交付版本說明文件',
              },
            ],
          },
          {
            id: '1Q9j0rQQWT8xq76CF_XdmjI4KBiLROjp_',
            name: 'T3 document_for 華電_20250523_final',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1Q9j0rQQWT8xq76CF_XdmjI4KBiLROjp_',
            updatedAt: '2025-05-28',
            sizeOrNote: '交付華電技術文件定稿包（含 9 個檔案）',
            children: [
              {
                id: '15lGNOk8ZB9eDMq8kyCMnpHutsUO5tDao',
                name: '附件_自動駕駛系統篇_20250523_updated2.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/15lGNOk8ZB9eDMq8kyCMnpHutsUO5tDao/edit',
                updatedAt: '2025-05-28',
                sizeOrNote: 'Word · 19.7 MB · 自動駕駛系統篇定稿',
              },
              {
                id: '1whp35_j_VNM2UZDdOedYGhb_KELDan2G',
                name: '附件_旅客運輸系統營運服務管理計畫0522_updated5.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1whp35_j_VNM2UZDdOedYGhb_KELDan2G/edit',
                updatedAt: '2025-05-28',
                sizeOrNote: 'Word · 13.8 MB · 旅客運輸系統營運服務管理計畫',
              },
              {
                id: '1SqyaqWHZz8yIyXVCQ52gOOaxOIcZ_2--',
                name: '行車管理與監控系統_MaaS_20250523.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1SqyaqWHZz8yIyXVCQ52gOOaxOIcZ_2--/edit',
                updatedAt: '2025-06-16',
                sizeOrNote: 'Word · 7.1 MB · 行車管理與監控系統 MaaS 篇',
              },
              {
                id: '10EpZJY4khv5Gzw4Ef4Su5MxRMof4yxeC',
                name: '附件_TURING簡介與實績_20250522_updated_8.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/10EpZJY4khv5Gzw4Ef4Su5MxRMof4yxeC/view?usp=drivesdk',
                updatedAt: '2025-05-28',
                sizeOrNote: 'PDF · 6.5 MB · Turing 簡介與過往實績彙整',
              },
              {
                id: '1nFplVzHWEZ4c7gSe5442ZxUOyK8x39Z_',
                name: '附件_Tier IV實績_20250522_updated_2.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1nFplVzHWEZ4c7gSe5442ZxUOyK8x39Z_/view?usp=drivesdk',
                updatedAt: '2025-05-28',
                sizeOrNote: 'PDF · 714 KB · Tier IV 國際實績彙整',
              },
              {
                id: '1Xfg4iGXrgSwmXiEIj_EUmX-Ic_Ls2VEG',
                name: 'Turing實績.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1Xfg4iGXrgSwmXiEIj_EUmX-Ic_Ls2VEG/edit',
                updatedAt: '2025-05-28',
                sizeOrNote: 'Word · 553 KB · Turing 實績原稿',
              },
              {
                id: '1Er_oGMwEXUTHGCEl_hIjeaibaqmBOyN_',
                name: 'TIER IV實績.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1Er_oGMwEXUTHGCEl_hIjeaibaqmBOyN_/edit',
                updatedAt: '2025-05-28',
                sizeOrNote: 'Word · 1.1 MB · Tier IV 實績原稿',
              },
              {
                id: '1WEbVXhHQ21shgYrfYr0AIDgy8lro8pPF',
                name: 'T3案人員資料_Turing.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1WEbVXhHQ21shgYrfYr0AIDgy8lro8pPF/edit',
                updatedAt: '2025-05-28',
                sizeOrNote: 'Word · 29 KB · Turing 專案團隊人員學經歷表',
              },
              {
                id: '1T7r_zTTJIqza2sLRipAU3O01MnWAUU42',
                name: 'T3案人員資料_Tier IV.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1T7r_zTTJIqza2sLRipAU3O01MnWAUU42/edit',
                updatedAt: '2025-05-28',
                sizeOrNote: 'Word · 24 KB · Tier IV 專案顧問人員資料',
              },
            ],
          },
          {
            id: '1TawsbneaEDt7ic3PdVpDiOh1zzRBjsZf',
            name: 'ADS（自動駕駛系統技術資料夾）',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1TawsbneaEDt7ic3PdVpDiOh1zzRBjsZf',
            updatedAt: '2025-05-23',
            sizeOrNote: '感知、定位、決策控制與 ODD 規格（含 3 個檔案）',
            children: [
              {
                id: '1NxlQ7Jx8qQooOCu2vynt5xeVQEFjba2Y',
                name: 'Sensor Layout Design.pptx',
                kind: 'presentation',
                driveUrl: 'https://docs.google.com/presentation/d/1NxlQ7Jx8qQooOCu2vynt5xeVQEFjba2Y/edit',
                updatedAt: '2025-05-20',
                sizeOrNote: '簡報 · 1.2 MB · 自駕巴士感測器配置與視野涵蓋設計',
                keyTakeaways: ['定義光達、相機與毫米波雷達安裝角度及盲區覆蓋計算'],
              },
              {
                id: '1vjACTKCsCoo5Ao3FNGKLBlXNV3K9tsC5',
                name: '附冊 - 自動駕駛系統篇_Mei_updated.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1vjACTKCsCoo5Ao3FNGKLBlXNV3K9tsC5/edit',
                updatedAt: '2025-05-23',
                sizeOrNote: 'Word · 19.6 MB · 自動駕駛系統技術附冊 (Mei 修訂版)',
              },
              {
                id: '1wea3XoJ831dcSQGMxX22MRn6aFfP_J0K',
                name: '附冊 - 自動駕駛系統篇_original.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1wea3XoJ831dcSQGMxX22MRn6aFfP_J0K/edit',
                updatedAt: '2025-05-23',
                sizeOrNote: 'Word · 19.9 MB · 自動駕駛系統技術附冊初版',
              },
            ],
          },
          {
            id: '1-DVcJtt78AyGZEQ_NrBq7aDZ0t0ambnE',
            name: 'MaaS（車隊管理與派遣平台）',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1-DVcJtt78AyGZEQ_NrBq7aDZ0t0ambnE',
            updatedAt: '2025-05-23',
            sizeOrNote: 'T3 班表調度、旅客資訊與後台架構（含 2 個檔案）',
            children: [
              {
                id: '1W-y3EC6ENfeXCad33JQ20csPVeTzbiQE',
                name: '行車管理與監控系統_MaaS_20250523_Mei.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/1W-y3EC6ENfeXCad33JQ20csPVeTzbiQE/edit',
                updatedAt: '2025-05-23',
                sizeOrNote: 'Word · 7.1 MB · 行車管理與監控系統 MaaS 架構書 (05/23)',
              },
              {
                id: '16AYKYxFTH9P6SHf3V3zxBe_TKqspKEak',
                name: '行車管理與監控系統_20250521_updated.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/16AYKYxFTH9P6SHf3V3zxBe_TKqspKEak/edit',
                updatedAt: '2025-05-23',
                sizeOrNote: 'Word · 6.4 MB · 行車管理與監控系統 (05/21 更新版)',
              },
            ],
          },
          {
            id: '14GmQIb8K3DGU6a-6WogdaSFF9rs00sxy',
            name: '1001北市審查委員意見回覆',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/14GmQIb8K3DGU6a-6WogdaSFF9rs00sxy',
            updatedAt: '2025-10-15',
            sizeOrNote: '審查委員問題逐項回覆、實驗計畫書 v3 與用印附件（含 7 個項目與第 2 層子目錄）',
            children: [
              {
                id: '1HXZfQq3S--oqyn-gHuji9FZ4XEHb3JON',
                name: '04無人載具科技創新實驗計畫書(送北市修正版本)1151015更新彙整v3無標註版.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1HXZfQq3S--oqyn-gHuji9FZ4XEHb3JON/view?usp=drivesdk',
                updatedAt: '2025-10-15',
                sizeOrNote: 'PDF · 30.9 MB · 創新實驗計畫書 v3 無標註正式版',
                keyTakeaways: ['送交台北市政府審查之無人載具科技創新實驗計畫書 v3 定稿 PDF'],
              },
              {
                id: '1l0GXiBsMyT7q3Tm4XE3NqXyADFPuTWM8',
                name: '信義路自駕公車Ａ階段POC委員意見修正對照表1151015.xlsx',
                kind: 'spreadsheet',
                driveUrl: 'https://docs.google.com/spreadsheets/d/1l0GXiBsMyT7q3Tm4XE3NqXyADFPuTWM8/edit',
                updatedAt: '2025-10-15',
                sizeOrNote: '試算表 · 748 KB · 審查委員意見逐條修正對照表',
                keyTakeaways: ['彙整各審查委員提問、回覆說明與對應計畫書修訂頁碼'],
              },
              {
                id: '1zYeMjXEGZv07xjTMN4fKvuOfuXIqFgyS',
                name: 'Turing Drive北市信義路poc簡報 0929.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1zYeMjXEGZv07xjTMN4fKvuOfuXIqFgyS/view?usp=drivesdk',
                updatedAt: '2025-09-29',
                sizeOrNote: 'PDF · 4.2 MB · 09/29 審查會議簡報 PDF',
              },
              {
                id: '1HAgnLBovq3cHuxx5Z3RIPbfTawYgdrjZ',
                name: '台灣智慧駕駛公司發函及用印附件檔.pdf',
                kind: 'pdf',
                driveUrl: 'https://drive.google.com/file/d/1HAgnLBovq3cHuxx5Z3RIPbfTawYgdrjZ/view?usp=drivesdk',
                updatedAt: '2025-10-15',
                sizeOrNote: 'PDF · 8.8 MB · 正式發函公文與公司大小章用印附件',
              },
              {
                id: '12PaiVDBFRdxO5NRBhDa95cXt506nSZ_j',
                name: '04無人載具科技創新實驗計畫書(送北市修正版本)1151015更新彙整v3.docx',
                kind: 'document',
                driveUrl: 'https://docs.google.com/document/d/12PaiVDBFRdxO5NRBhDa95cXt506nSZ_j/edit',
                updatedAt: '2025-10-15',
                sizeOrNote: 'Word · 25.0 MB · v3 追蹤修訂可編輯版',
              },
              {
                id: '14ZpGbMxYwd5hKLRvbTxyEFssf6pkkZ-k',
                name: '補件資料(初估保險報價單)',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/14ZpGbMxYwd5hKLRvbTxyEFssf6pkkZ-k',
                updatedAt: '2025-10-07',
                sizeOrNote: '創新實驗責任險與場域保險報價補件',
                accessScope: 'confidential',
                allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                allowedRoles: ['admin', 'finance'],
                children: [
                  {
                    id: '13ojdF-uvO_7EjxSIdhsk7UX52QhLiuJr',
                    name: '國泰產險信義路poc報價單.pdf',
                    kind: 'pdf',
                    driveUrl: 'https://drive.google.com/file/d/13ojdF-uvO_7EjxSIdhsk7UX52QhLiuJr/view?usp=drivesdk',
                    updatedAt: '2025-10-06',
                    sizeOrNote: 'PDF · 831 KB · 國泰產險信義路 POC 保險報價單',
                    accessScope: 'confidential',
                    allowedDepartments: ['營業', 'BD', '財務', '總經理'],
                    allowedRoles: ['admin', 'finance'],
                  },
                ],
              },
              {
                id: '1bnIRLdd0gJ9Q0OEm3lJSSLoD2wFLieUt',
                name: '補件資料(第三方瑞其報告）',
                kind: 'folder',
                driveUrl: 'https://drive.google.com/drive/folders/1bnIRLdd0gJ9Q0OEm3lJSSLoD2wFLieUt',
                updatedAt: '2025-10-07',
                sizeOrNote: '第三方安全評估驗證報告補件',
                children: [
                  {
                    id: '116LCyiSt_hrbG4dRQ-tYI1WFgTL_NZnA',
                    name: 'C26-172_台灣智駕_Navya之整車結構CAE靜態分析文件-2026-1007.pdf',
                    kind: 'pdf',
                    driveUrl: 'https://drive.google.com/file/d/116LCyiSt_hrbG4dRQ-tYI1WFgTL_NZnA/view?usp=drivesdk',
                    updatedAt: '2025-10-07',
                    sizeOrNote: 'PDF · 3.0 MB · Navya 自駕巴士整車結構 CAE 靜態分析報告',
                  },
                ],
              },
            ],
          },
          {
            id: '1CdPNneMlCSN4i7kVDZZFelORzzepUWVi',
            name: 'BIM T3模型',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1CdPNneMlCSN4i7kVDZZFelORzzepUWVi',
            updatedAt: '2025-10-15',
            sizeOrNote: '第三航廈路線廊道 3D BIM 圖資與點雲（含 3 個檔案）',
            children: [
              {
                id: '1W9W2oCUKMoLzNXpyH5nliH28fux3tHsw',
                name: '【專案機密與授權使用聲明 Confidentiality and Authorized Use Notice】.txt',
                kind: 'document',
                driveUrl: 'https://drive.google.com/file/d/1W9W2oCUKMoLzNXpyH5nliH28fux3tHsw/view?usp=drivesdk',
                updatedAt: '2025-10-15',
                sizeOrNote: 'TXT · 780 B · BIM 模型授權使用與保密聲明',
              },
              {
                id: '1NHA-IvWOEwcOseV6SR6ot-iqlYS0xbtc',
                name: 'Navisworks Freedom應用軟體資訊(僅windows使用).txt',
                kind: 'document',
                driveUrl: 'https://drive.google.com/file/d/1NHA-IvWOEwcOseV6SR6ot-iqlYS0xbtc/view?usp=drivesdk',
                updatedAt: '2025-10-15',
                sizeOrNote: 'TXT · 49 B · 檢視器軟體開啟說明',
              },
              {
                id: '1Te2SKFE4iirRTGIr_qJJ3CpBTvIrH-sj',
                name: 'all.nwd',
                kind: 'archive',
                driveUrl: 'https://drive.google.com/file/d/1Te2SKFE4iirRTGIr_qJJ3CpBTvIrH-sj/view?usp=drivesdk',
                updatedAt: '2025-10-08',
                sizeOrNote: 'NWD 模型 · 8.4 GB · 桃園機場第三航廈全區 BIM 整合模型檔',
              },
            ],
          },
          {
            id: '12MWdl0eHhya9dU9jm7_MsLFhrouz4u_s',
            name: '2025專案管理分工_20250227.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/12MWdl0eHhya9dU9jm7_MsLFhrouz4u_s/edit',
            updatedAt: '2025-02-27',
            sizeOrNote: '試算表 · T3 各子系統負責人與 WBS 權責分工表',
            keyTakeaways: ['2025 年度 T3 專案各子系統 PM、RD 模組負責人與交付物矩陣'],
          },
          {
            id: '1Z2geXjDqmaq_VFf1j0UkxoseH0YSlam-',
            name: '臺灣桃園國際機場第三航站區旅客運輸系統工程專案_Turing內部分工表_20250417.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/1Z2geXjDqmaq_VFf1j0UkxoseH0YSlam-/edit',
            updatedAt: '2025-05-15',
            sizeOrNote: '試算表 · 33 KB · Turing 內部工程分工明細',
          },
          {
            id: '1Q5W68-HxztVzERjy8AFj7EIoKCdYjvrI',
            name: 'Turing_T3簡報QA_v3_20250620.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/1Q5W68-HxztVzERjy8AFj7EIoKCdYjvrI/edit',
            updatedAt: '2025-06-30',
            sizeOrNote: '試算表 · 22 KB · 評選與審查簡報 Q&A 題庫 v3',
            keyTakeaways: ['彙整業主與委員常見技術提問（續航力、定位精度、號誌優先、颱風應變）標準擬答'],
          },
          {
            id: '1sawsjgRcAypXyFcYgSXAqhOqw1ICbsRd',
            name: '行控號控示意圖.pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/1sawsjgRcAypXyFcYgSXAqhOqw1ICbsRd/edit',
            updatedAt: '2025-05-17',
            sizeOrNote: '簡報 · 1.5 MB · 行控中心與號誌控制連動架構',
            keyTakeaways: ['展示行控中心 (OCC) 與交控號誌控制器之優先號誌觸發邏輯與安全連鎖機制'],
          },
          {
            id: '1UQr6IO3bdFTT-zZWqKA-Ck4fnHn4vuXO',
            name: '20240823_RTK基站設置倉10屋頂示意圖.pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/1UQr6IO3bdFTT-zZWqKA-Ck4fnHn4vuXO/edit',
            updatedAt: '2025-04-30',
            sizeOrNote: '簡報 · 12.2 MB · 機場 RTK 差分定位基站架設位置圖',
          },
        ],
      },
      {
        id: '2025-golface-deal',
        code: 'GF-2025',
        name: '20250224_golface_deal（Golface 智慧高球車合作案）',
        startYear: 2025,
        period: '2025 Q1 – 2025 Q4',
        department: '營業部 / 綠通專案組',
        sharedDriveName: '綠通 / 營業部',
        status: 'completed',
        accessScope: 'confidential',
        accessGroupLabel: '營業部 / 財務部 / 管理層限定',
        allowedDepartments: ['營業', 'BD', '財務', '總經理'],
        allowedRoles: ['admin', 'finance'],
        summary:
          '2025 年度與 Golface 展開之新一代車隊導入與商業合約專案，延續 15 台量產車成果並擴充場域維運與加值服務。',
        highlights: ['2025/02/24 商務條件與合約議定', '球場導入規格與商業分潤架構'],
        driveFolderId: '1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW',
        files: [
          {
            id: '1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW',
            name: '20250224_golface_deal 專案合約與報價資料夾',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1jadiAQRiZgzKRMVZVKWxWVbs7pwPX_bW',
            updatedAt: '2025-02-24',
            sizeOrNote: '商務條件、BOM 成本估算與維護協議（商務機密）',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
          },
        ],
      },
      {
        id: '2025-gbgh-maas',
        code: 'GBGH-2025',
        name: 'GBGH 自駕園區接駁與 MaaS 實證專案',
        startYear: 2025,
        period: '2025',
        department: '交通行動服務部 | Mobility as a Service',
        sharedDriveName: 'GBGH',
        status: 'completed',
        accessScope: 'department_only',
        accessGroupLabel: 'gbgh@turing-drive.com（GBGH 專案群組限定）',
        allowedDepartments: ['交通行動服務', 'MaaS', '專案', '研發'],
        summary:
          'GBGH 場域自動駕駛接駁車與 MaaS 叫車平台整合專案，包含場域路線規劃、預約派遣流程與安全驗證報告。（依 Google Drive 權限：僅開放 gbgh@turing-drive.com 群組與管理員）',
        highlights: ['GBGH 場域路線與站點規劃', 'MaaS 預約叫車整合測試'],
        driveFolderId: '1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue',
        files: [
          {
            id: '1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue',
            name: 'GBGH > 文件 > General',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1WYrU7OCSA_gBvyFMykP0x8vHkBRc46ue',
            updatedAt: '2025-08',
            sizeOrNote: '場勘報告、測試紀錄與客戶簡報',
            accessScope: 'department_only',
            allowedDepartments: ['交通行動服務', 'MaaS', '專案', '研發'],
          },
        ],
      },
      {
        id: '2025-adawarp',
        code: 'EXT-ADAWARP',
        name: '[EXT] ADAWARP 跨國技術合作專案',
        startYear: 2025,
        period: '2024 Q4 – 2025',
        department: '國際市場開發 / 研發部',
        sharedDriveName: '[EXT] ADAWARP',
        status: 'completed',
        accessScope: 'department_only',
        accessGroupLabel: 'extadawarp@turing-drive.com（ADAWARP 專案群組限定）',
        allowedDepartments: ['研發', 'R&D', '國際市場', '營業', 'BD'],
        summary:
          '與海外夥伴 ADAWARP 進行之遠端車隊通訊與自駕系統整合外部協作空間，收錄共同技術規格、API 介面定義與展示影片。（依 Google Drive 權限：僅開放 extadawarp@turing-drive.com 群組與管理員）',
        highlights: ['跨國車聯網低延遲串流整合', '共同技術驗證與聯測報告'],
        driveFolderId: '1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl',
        files: [
          {
            id: '1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl',
            name: '[EXT] ADAWARP > 文件 > General',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1R2_SCyQ8J1L0i3ECoo7AJUih1LHSwktl',
            updatedAt: '2025-07',
            sizeOrNote: '外部共享技術規格與聯測紀錄',
            accessScope: 'department_only',
            allowedDepartments: ['研發', 'R&D', '國際市場', '營業', 'BD'],
          },
        ],
      },
    ],
  },
  {
    year: 2024,
    label: '2024 年起始專案',
    tagline: 'GOLFACE 15 台量產車交付、HTC 高雄港 5G 自駕車、JETRO 日本宮古島自駕案、EVE Auto-BAL',
    projectOverview:
      '公司量產落地與海外示範關鍵年份：完成綠通 GOLFACE 15 台量產自駕球車硬體點交與多球場場勘、HTC 高雄港區自駕實證、日本 JETRO 宮古島自駕運行與日文版 HMI，以及 EVE Auto-BAL 專案。',
    projects: [
      {
        id: '2024-golface-15cars',
        code: 'GF-15MASS',
        name: '2024_GOLFACE_15台量產車（綠通量產交付案）',
        startYear: 2024,
        period: '2024 Q1 – 2024 Q4',
        department: '客戶專案執行 / 綠通專案組',
        sharedDriveName: '綠通 / 專案執行',
        status: 'completed',
        accessScope: 'company_wide',
        accessGroupLabel: 'tprogram@turing-drive.com · 全公司可讀',
        summary:
          '完成 15 台綠通（GreenTrans）底盤自駕高爾夫球車量產改裝、0716 車輛硬體點交、斑芝花/敏實/台北港等場域驗收，以及 1.0 智慧球車產品文件 v5 與球場維護保養建議。',
        highlights: [
          '0716 車輛硬體點交 & 智慧球車車輛狀態及系統點交表.docx',
          '1.0 智慧球車產品文件 v5（含球場須知維護保養建議 PDF）',
          '0612 斑芝花、0614 台北港、0624 敏實(含驗收影片)、0702 斑芝花南峰',
        ],
        driveFolderId: '1kj7NHEZnn-a80VfgrQBOkRqCJizQ0EZ6',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1kj7NHEZnn-a80VfgrQBOkRqCJizQ0EZ6',
        files: [
          {
            id: '1I1HYDSaM3RMxZJg8Bh3TIeEPmd2ECLwE',
            name: '0716車輛硬體點交',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1I1HYDSaM3RMxZJg8Bh3TIeEPmd2ECLwE',
            updatedAt: '2024-07-16',
            sizeOrNote: '15 台量產車逐車硬體點交實況照片與影片（含實機點交照片集）',
            children: [
              {
                id: '1DwVhUYkJMy1gL11PLZF71KrR_69kd4-i',
                name: 'IMG_20240716_141508.jpg',
                kind: 'image',
                driveUrl: 'https://drive.google.com/file/d/1DwVhUYkJMy1gL11PLZF71KrR_69kd4-i/view?usp=drivesdk',
                updatedAt: '2024-07-16',
                sizeOrNote: 'JPG 圖檔 · 3.6 MB · 07/16 量產球車硬體點交現場照片 #1',
              },
              {
                id: '1avLVS2NwLM6eJjgUsHhStb2TrJNNElxh',
                name: 'IMG_20240716_141515.jpg',
                kind: 'image',
                driveUrl: 'https://drive.google.com/file/d/1avLVS2NwLM6eJjgUsHhStb2TrJNNElxh/view?usp=drivesdk',
                updatedAt: '2024-07-16',
                sizeOrNote: 'JPG 圖檔 · 3.6 MB · 07/16 量產球車硬體點交現場照片 #2',
              },
              {
                id: '1gBT_JYjIRveJQyvUym9dGZsfTEOjtiOj',
                name: 'IMG_20240716_141516.jpg',
                kind: 'image',
                driveUrl: 'https://drive.google.com/file/d/1gBT_JYjIRveJQyvUym9dGZsfTEOjtiOj/view?usp=drivesdk',
                updatedAt: '2024-07-16',
                sizeOrNote: 'JPG 圖檔 · 3.8 MB · 07/16 量產球車感測器與車體檢視 #3',
              },
              {
                id: '1fLJbhoyNPEYVqYlJwkphs16s2RG1b5z2',
                name: 'VID_20240716_141806.mp4',
                kind: 'archive',
                driveUrl: 'https://drive.google.com/file/d/1fLJbhoyNPEYVqYlJwkphs16s2RG1b5z2/view?usp=drivesdk',
                updatedAt: '2024-07-16',
                sizeOrNote: 'MP4 影片 · 335 MB · 07/16 現場實車動態點交測試影片',
              },
            ],
          },
          {
            id: '1gB7W-WikNjIwBaOWB5GWAFP5XJFJgn8Z',
            name: '0624敏實(含驗收影片)',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1gB7W-WikNjIwBaOWB5GWAFP5XJFJgn8Z',
            updatedAt: '2024-06-27',
            sizeOrNote: '敏實場域實車測試與驗收影片',
          },
          {
            id: '1SGY88eytz_ApImSbRt28IrhB57NIvjJd',
            name: '0612斑之花 & 0702斑之花南峰',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1SGY88eytz_ApImSbRt28IrhB57NIvjJd',
            updatedAt: '2024-07-04',
            sizeOrNote: '斑芝花高爾夫球場球道測試資料夾',
          },
          {
            id: '1Q2GA85BuLVM_I0d7N3GyM9C4QWdqFP9y',
            name: '0614台北港',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1Q2GA85BuLVM_I0d7N3GyM9C4QWdqFP9y',
            updatedAt: '2024-06-17',
            sizeOrNote: '台北港場域測試紀錄',
          },
          {
            id: '1LWjGnO5ToxuqXN88I9UcnDjiVtAD1ANc',
            name: '1.0智慧球車產品文件_v5_20240905.pdf',
            kind: 'pdf',
            driveUrl: 'https://drive.google.com/file/d/1LWjGnO5ToxuqXN88I9UcnDjiVtAD1ANc/view?usp=drivesdk',
            updatedAt: '2024-09-05',
            sizeOrNote: 'PDF · 905 KB · 1.0 智慧球車完整產品規格書 v5',
          },
          {
            id: '1hMhSEM67AmrAMoXnZ49li03yACW1mRG3',
            name: '1.0智慧球車產品文件_v5_20240905_球場須知維護保養建議.pdf',
            kind: 'pdf',
            driveUrl: 'https://drive.google.com/file/d/1hMhSEM67AmrAMoXnZ49li03yACW1mRG3/view?usp=drivesdk',
            updatedAt: '2024-09-05',
            sizeOrNote: 'PDF · 334 KB · 球場維運與保養 SOP 手冊',
          },
          {
            id: '1qXB6QqYWNnNiUczPhuzHg96qCisRb1hq',
            name: '智慧球車車輛狀態及系統點交表_20240627調整簽名欄.docx',
            kind: 'document',
            driveUrl: 'https://docs.google.com/document/d/1qXB6QqYWNnNiUczPhuzHg96qCisRb1hq/edit',
            updatedAt: '2024-08-21',
            sizeOrNote: 'Word · 43 KB · 正式交付點交簽認表單',
          },
        ],
      },
      {
        id: '2024-htc-kaohsiung-port',
        code: 'HTC-KHP',
        name: 'HTC 高港自駕車（高雄港 5G 智慧港灣自駕專案）',
        startYear: 2024,
        period: '2024 Q1 – 2024 Q4',
        department: '客戶專案執行 / 交通行動服務部',
        sharedDriveName: 'HTC高港自駕車',
        status: 'completed',
        summary:
          '與 HTC 合作於高雄港區導入 5G 智慧自駕接駁與巡檢載具，包含 2024/01/29 高雄港區實地場勘紀錄、待確認事項簡報與專案執行資料夾。',
        highlights: ['20240129_智駕車場勘紀錄.pptx', '1月29日高雄場勘待確認事項_0131.pptx', '3_客戶專案執行 > HTC高港自駕車'],
        driveFolderId: '16IuZudQ1fQqGpE35CqRpINvobiqpIHIx',
        driveFolderUrl: 'https://drive.google.com/drive/folders/16IuZudQ1fQqGpE35CqRpINvobiqpIHIx',
        files: [
          {
            id: '12x6d86fqeIde5mWzspLUixjBBNsbSwF4',
            name: '20240129_智駕車場勘紀錄.pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/12x6d86fqeIde5mWzspLUixjBBNsbSwF4/edit',
            updatedAt: '2024-01-30',
            sizeOrNote: '簡報 · 9.1 MB · 高雄港實地路線與環境場勘報告',
          },
          {
            id: '15-2fisPDM-6DccISZsKeiWhg29BV-pz6',
            name: '1月29日高雄場勘待確認事項_0131 .pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/15-2fisPDM-6DccISZsKeiWhg29BV-pz6/edit',
            updatedAt: '2024-02-02',
            sizeOrNote: '簡報 · 11.8 MB · 港區工程介面與待確認議題清單',
          },
          {
            id: '1Bkv9CRYJnBMXXzyVVYbJAmNLZ3fYjRWm',
            name: '3_客戶專案執行 > HTC高港自駕車（專案執行主目錄）',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1Bkv9CRYJnBMXXzyVVYbJAmNLZ3fYjRWm',
            updatedAt: '2024-12',
            sizeOrNote: '專案管理、里程碑交付與客戶簽收文件',
          },
        ],
      },
      {
        id: '2024-jetro-miyakojima',
        code: 'JP-JETRO',
        name: '1.[專案] JETRO 日本宮古島自動駕駛示範案',
        startYear: 2024,
        period: '2024 – 2025',
        department: '國際市場開發 / BD-Tokyo Drift',
        sharedDriveName: 'BD-Tokyo Drift',
        status: 'completed',
        summary:
          '日本貿易振興機構（JETRO）合作推進之沖繩縣宮古島市自動駕駛示範計畫，完整收錄宮古島市役所自動駕駛說明簡報、手機叫車服務、車載 HMI 日文版操作說明書、預算表與車輛健檢報告。',
        highlights: [
          '宮古島市説明用自動運転202501.pptx & 宮古島路徑、影片、照片.pptx',
          'HMI（修正）日文版操作說明+Xtran_20241104_jp.pptx',
          '1206藉由手機達成叫車服務.pptx & 車輛健檢檢測項目檢查報告0918.xlsx',
        ],
        driveFolderId: '16Aq9l_MXIRyVHeQ5Kvf16YBxaEbxbDOR',
        driveFolderUrl: 'https://drive.google.com/drive/folders/16Aq9l_MXIRyVHeQ5Kvf16YBxaEbxbDOR',
        files: [
          {
            id: '1siZY3jAUn-DpQm2tAkU_OQ0Kda_0Rlwv',
            name: '宮古島市説明用自動運転202501.pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/1siZY3jAUn-DpQm2tAkU_OQ0Kda_0Rlwv/edit',
            updatedAt: '2025-01',
            sizeOrNote: '簡報 · 84.6 MB · 向日本宮古島市政府簡報之自動駕駛方案',
          },
          {
            id: '1jjEr2TDAajZXJTCh2v6_YCWJcfqG8eV7',
            name: 'HMI （修正）日文版操作說明+Xtran_20241104_jp.pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/1jjEr2TDAajZXJTCh2v6_YCWJcfqG8eV7/edit',
            updatedAt: '2024-11-04',
            sizeOrNote: '簡報 · 20.3 MB · 車載 HMI 日文版操作手冊',
          },
          {
            id: '1Q8pyCO0Jtm3Nu_PcKO0rQt8IlLplnPR_',
            name: '1206藉由手機達成叫車服務.pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/1Q8pyCO0Jtm3Nu_PcKO0rQt8IlLplnPR_/edit',
            updatedAt: '2024-12-06',
            sizeOrNote: '簡報 · 187 KB · 手機預約叫車與派遣流程說明',
          },
          {
            id: '119ucgyVuG4-lzg-w8wXKHYhGt50_PmRV',
            name: '宮古島路徑、影片、照片.pptx',
            kind: 'presentation',
            driveUrl: 'https://docs.google.com/presentation/d/119ucgyVuG4-lzg-w8wXKHYhGt50_PmRV/edit',
            updatedAt: '2024-11',
            sizeOrNote: '簡報 · 425 MB · 宮古島實地運行路線影像紀錄',
          },
          {
            id: '1UTamjj95gLo_9xhvY4H3v2Pz_Zgh7i68',
            name: '營收及研發專案預算表_Jetro 20241018.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/1UTamjj95gLo_9xhvY4H3v2Pz_Zgh7i68/edit',
            updatedAt: '2024-10-18',
            sizeOrNote: '試算表 · 218 KB · JETRO 專案營收與研發預算表',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
          },
          {
            id: '1Y38CzwYD5OKQd9E2PVne1H7P0JY4Uq41',
            name: '車輛健檢檢測項目檢查報告0918.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/1Y38CzwYD5OKQd9E2PVne1H7P0JY4Uq41/edit',
            updatedAt: '2024-09-18',
            sizeOrNote: '試算表 · 1.5 MB · 出車前全車健檢檢測報告',
          },
          {
            id: '1eTc13a7A-t-TS1cYQbHkEuucO6LDKKhu',
            name: 'TuringDrive-Demo project DM.pdf',
            kind: 'pdf',
            driveUrl: 'https://drive.google.com/file/d/1eTc13a7A-t-TS1cYQbHkEuucO6LDKKhu/view?usp=drivesdk',
            updatedAt: '2024-10',
            sizeOrNote: 'PDF · 510 KB · 日本展演用宣傳 DM',
          },
        ],
      },
      {
        id: '2024-eve-autobal',
        code: 'EVE-BAL',
        name: 'EVE Auto-BAL 專案',
        startYear: 2024,
        period: '2024',
        department: '客戶專案執行 / 研發部',
        sharedDriveName: '專案執行',
        status: 'completed',
        summary:
          'EVE Auto-BAL 自動駕駛載具控制與系統整合專案，包含底盤通訊協定、感測器校準與場域測試資料。',
        highlights: ['Auto-BAL 系統架構與控制介面', '實車測試與驗收紀錄'],
        driveFolderId: '1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r',
        files: [
          {
            id: '1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r',
            name: '3_客戶專案執行 > EVE Auto-BAL',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1SJoAGG5p4hEAmVpwbbWlpNao2wDzSz6r',
            updatedAt: '2024-08',
            sizeOrNote: '專案規格書與測試報告',
          },
        ],
      },
    ],
  },
  {
    year: 2023,
    label: '2023 年起始專案',
    tagline: 'BigMac Program 核心架構研發、智慧球車 v1.0 / v2.0、亞勁 Robobus、T3 前期規劃',
    projectOverview:
      '核心產品化與自駕平台架構升級年：完成 BigMac Program 系統區塊與作動流程設計、智慧高爾夫球車 v1.0 至 v2.0 世代演進、亞勁 Robobus 自駕小巴合作案，以及 T3 專案早期技術評估。',
    projects: [
      {
        id: '2023-bigmac-program',
        code: 'RD-BIGMAC',
        name: 'BigMac Program（自駕核心平台架構專案）',
        startYear: 2023,
        period: '2022 Q4 – 2023',
        department: '研發部 | R&D',
        sharedDriveName: '研發部 | R&D',
        status: 'completed',
        summary:
          'Turing Drive 新世代自駕軟硬體平台「BigMac Program」，包含主要系統架構圖、作動流程圖、功能圖、系統區塊圖、網頁認證流程、Milestone 1 驗證與實車 Demo 影片。',
        highlights: [
          '主要架構圖-系統區塊圖.drawio.png & 作動流程圖.drawio.png',
          'Milestone 1 研發驗證與實車 Demo 資料夾',
          'BigMac 實車展示影片與會議記錄',
        ],
        driveFolderId: '1cWGdTvKcm8JuXJh22qUuk_6yfq9KMhWW',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1cWGdTvKcm8JuXJh22qUuk_6yfq9KMhWW',
        files: [
          {
            id: '1_toGmgOKWI1jGHPl6lVuq51w-aTN4nsV',
            name: 'Milestone 1',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1_toGmgOKWI1jGHPl6lVuq51w-aTN4nsV',
            updatedAt: '2023-01',
            sizeOrNote: '第一階段里程碑驗證文件',
          },
          {
            id: '124nj5tKn8GlbphE9VrWYZUOv-Gvj85Ur',
            name: 'Demo',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/124nj5tKn8GlbphE9VrWYZUOv-Gvj85Ur',
            updatedAt: '2023-03-23',
            sizeOrNote: 'BigMac 平台實車展示與測試紀錄',
          },
          {
            id: '1c7Ae2MqW_NnaI3UNRdNp1zBf7z93nrAX',
            name: 'BigMac影片',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1c7Ae2MqW_NnaI3UNRdNp1zBf7z93nrAX',
            updatedAt: '2023-03-30',
            sizeOrNote: '系統實測影片庫',
          },
          {
            id: '17vBydfN9IqT9TKYp25pIi15TMQYcZOm-',
            name: '主要架構圖-作動流程圖.drawio.png',
            kind: 'image',
            driveUrl: 'https://drive.google.com/file/d/17vBydfN9IqT9TKYp25pIi15TMQYcZOm-/view?usp=drivesdk',
            updatedAt: '2022-12-06',
            sizeOrNote: 'PNG 圖檔 · 964 KB · 系統狀態與作動流程圖',
          },
          {
            id: '1s-vl9FNlB9Off7nA56OAhU3ESeDzoQEE',
            name: '主要架構圖-系統區塊圖.drawio.png',
            kind: 'image',
            driveUrl: 'https://drive.google.com/file/d/1s-vl9FNlB9Off7nA56OAhU3ESeDzoQEE/view?usp=drivesdk',
            updatedAt: '2022-11-22',
            sizeOrNote: 'PNG 圖檔 · 289 KB · 軟硬體模組系統區塊圖',
          },
          {
            id: '1wOZzTU5lAwmjY_vlmGsDq4VplvVdB9ep',
            name: '主要架構圖-功能圖.drawio.png',
            kind: 'image',
            driveUrl: 'https://drive.google.com/file/d/1wOZzTU5lAwmjY_vlmGsDq4VplvVdB9ep/view?usp=drivesdk',
            updatedAt: '2022-11-21',
            sizeOrNote: 'PNG 圖檔 · 480 KB · 核心功能架構圖',
          },
        ],
      },
      {
        id: '2023-smart-golf-cart',
        code: 'PROD-GOLF',
        name: '智慧球車 v1.0 & v2.0 產品開發案（含 PaC-Man / SmartKart）',
        startYear: 2023,
        period: '2023 Q1 – 2024 Q1',
        department: '產品開發 / 研發部',
        sharedDriveName: 'SmartKart / 營業部',
        status: 'completed',
        summary:
          '自駕高爾夫球車 v1.0 與 v2.0 產品研發專案，整合感知定位、球場專用圖資、車隊管理後台與 SmartKart / PaC-Man 載具平台。',
        highlights: ['智慧球車 v1.0 / v2.0 軟硬體規格', 'SmartKart 機構與電控設計', 'PaC-Man 模組化控制單元'],
        driveFolderId: '1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6',
        files: [
          {
            id: '1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6',
            name: '5_產品開發 > 智慧球車v1.0',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1E849ItT9HB9ygNFtmxeuljAP9rwZJ0X6',
            updatedAt: '2023-09',
            sizeOrNote: '第一代智慧球車 BOM、電路與測試報告',
          },
          {
            id: '1NAr-ujseSAb8RhjMg2ptFMF2a5G_Hyg0',
            name: '5_產品開發（含 PaC-Man、智慧球車 v1.0、智慧球車 v2.0）',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1NAr-ujseSAb8RhjMg2ptFMF2a5G_Hyg0',
            updatedAt: '2023-12',
            sizeOrNote: '產品開發總目錄',
          },
          {
            id: '1uWeQMg0vQQ-CxkZUfzM0AwuMkUVKbJZa',
            name: 'SmartKart > 文件 > General',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1uWeQMg0vQQ-CxkZUfzM0AwuMkUVKbJZa',
            updatedAt: '2023-10',
            sizeOrNote: 'SmartKart 車體與控制技術文件',
          },
        ],
      },
      {
        id: '2023-yajing-robobus',
        code: 'RB-YAJING',
        name: '亞勁 Robobus 自駕小巴專案',
        startYear: 2023,
        period: '2023',
        department: '客戶專案執行',
        sharedDriveName: '專案執行',
        status: 'completed',
        summary:
          '與亞勁車電合作之 Robobus 自動駕駛小型巴士整合專案，包含底盤 CAN Bus 介面、感測器配置與場域試運行規劃。',
        highlights: ['Robobus 線控底盤對接', '感測器支架與工控機配置'],
        driveFolderId: '1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI',
        files: [
          {
            id: '1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI',
            name: '3_客戶專案執行 > 亞勁 Robobus',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1wMuXNXVE7VctuXXQC4NBf-0GZeF1qrVI',
            updatedAt: '2023-08',
            sizeOrNote: '技術規範、介面定義與測試紀錄',
          },
        ],
      },
      {
        id: '2023-t3-early',
        code: 'T3-2023',
        name: 'T3 專案前期規劃與技術可行性評估（2023 old）',
        startYear: 2023,
        period: '2023',
        department: '專案執行 / 系統工程',
        sharedDriveName: 'T3 projects',
        status: 'archived',
        summary:
          '桃園機場 T3 旅客運輸系統早期備標、路線廊道研究與自駕車隊容量模擬歸檔資料夾。',
        highlights: ['T3 早期路線與運量評估', '前期廠商訪談與規格草案'],
        driveFolderId: '1fARcQv88_NY3imjGmY774sn08qvusLdv',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1fARcQv88_NY3imjGmY774sn08qvusLdv',
        files: [
          {
            id: '1fARcQv88_NY3imjGmY774sn08qvusLdv',
            name: 'T3 projects > 2023 old',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1fARcQv88_NY3imjGmY774sn08qvusLdv',
            updatedAt: '2023-12',
            sizeOrNote: '2023 年前期評估歸檔文件',
          },
        ],
      },
    ],
  },
  {
    year: 2021,
    label: '2021–2022 年起始專案',
    tagline: '台北市信義路自駕巴士夜間實證（ADRTS）、台北港 5G 科專、桃園青埔二期營運案',
    projectOverview:
      '台灣指標性自駕開放道路與港區實證時期：執行台北市信義路公車專用道自駕巴士創新實驗計畫（ADRTS）、台北港 5G 科專計畫，以及桃園青埔自駕電動巴士試運行計畫。',
    projects: [
      {
        id: '2021-xinyi-adrts',
        code: 'TPE-ADRTS',
        name: '20210501_信義路自駕巴士_ADRTS實證運行計畫',
        startYear: 2021,
        period: '2021 – 2022',
        department: '交通行動服務部 / 客戶專案執行',
        sharedDriveName: '交通行動服務部 | MaaS',
        status: 'archived',
        summary:
          '台北市信義路雙向公車專用道夜間自駕巴士實證運行計畫，包含試車牌展延申請、公文收寄、工作會議、每月通報單、查核點項目、異業合作與無人載具補助計畫分工經費表。',
        highlights: [
          '01 試車牌展延申請 / 07 每月通報單 / 08 查核點項目',
          '無人載具補助計畫分工+經費20210415.xlsx',
          '3_客戶專案執行 > (closed)信義路專案 完整歸檔',
        ],
        driveFolderId: '1_fjkOLgZZ-_keR5ezK-Arq44NeH-EJuU',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1_fjkOLgZZ-_keR5ezK-Arq44NeH-EJuU',
        files: [
          {
            id: '1u0TYTDWhVZQ7OuSvqEbzmHBC62VuJljK',
            name: '01 試車牌展延申請',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1u0TYTDWhVZQ7OuSvqEbzmHBC62VuJljK',
            updatedAt: '2021-05-14',
            sizeOrNote: '自動駕駛試車牌照申請與展延核准函',
          },
          {
            id: '19saRSSTX-IRgAdmWKKTF6F51oVNmfCvR',
            name: '04 工作紀錄 & 03 工作會議',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/19saRSSTX-IRgAdmWKKTF6F51oVNmfCvR',
            updatedAt: '2021-05-14',
            sizeOrNote: '夜間道路測試紀錄與跨單位工作會議',
          },
          {
            id: '1FxSzl9u3rXyUvRz_b8FASJHRLemVY0x_',
            name: '07 每月通報單',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1FxSzl9u3rXyUvRz_b8FASJHRLemVY0x_',
            updatedAt: '2021-05-14',
            sizeOrNote: '創新實驗每月運行里程與安全通報單',
          },
          {
            id: '1mgMXA4HqhC7N5z6SkWEzTYCrvTWD2wJF',
            name: '08 查核點項目',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1mgMXA4HqhC7N5z6SkWEzTYCrvTWD2wJF',
            updatedAt: '2021-05-14',
            sizeOrNote: '主管機關期中與期末查核點佐證資料',
          },
          {
            id: '10QUN_nmquuxY1GZSA9rEY8vIRh6-eKO-',
            name: '申請計劃書',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/10QUN_nmquuxY1GZSA9rEY8vIRh6-eKO-',
            updatedAt: '2021-05-14',
            sizeOrNote: '信義路自駕巴士創新實驗申請計畫書全文',
          },
          {
            id: '1ee7lqEYui8HnD-KsH0yf83BuZ2blaSrU',
            name: '無人載具補助計畫分工+經費20210415.xlsx',
            kind: 'spreadsheet',
            driveUrl: 'https://docs.google.com/spreadsheets/d/1ee7lqEYui8HnD-KsH0yf83BuZ2blaSrU/edit',
            updatedAt: '2021-04-23',
            sizeOrNote: '試算表 · 40 KB · 補助計畫團隊分工與預算配置表',
          },
          {
            id: '1w-ibps5H_HWRfgL9xbhPIqmObzoLDnC7',
            name: '3_客戶專案執行 > (closed)信義路專案',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1w-ibps5H_HWRfgL9xbhPIqmObzoLDnC7',
            updatedAt: '2022-08',
            sizeOrNote: '專案結案報告與運行里程統計',
          },
        ],
      },
      {
        id: '2021-taipei-port-5g',
        code: 'PORT-5G',
        name: '(closed) 台北港 5G 科專自駕計畫',
        startYear: 2021,
        period: '2021 – 2022',
        department: '客戶專案執行',
        sharedDriveName: '專案執行',
        status: 'archived',
        summary:
          '台北港區 5G 車聯網與自動駕駛技術科專實證計畫，驗證港區物流路線自駕運行、5G 專網通訊品質與遠端監控中心整合。',
        highlights: ['台北港區自駕路線實測', '5G 科專期末驗收與成果報告'],
        driveFolderId: '1NL_EaAYofuetP8VKBciTUsozymeCU4iv',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1NL_EaAYofuetP8VKBciTUsozymeCU4iv',
        files: [
          {
            id: '1NL_EaAYofuetP8VKBciTUsozymeCU4iv',
            name: '3_客戶專案執行 > (closed)台北港5G科專',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1NL_EaAYofuetP8VKBciTUsozymeCU4iv',
            updatedAt: '2022-10',
            sizeOrNote: '科專計畫書、期中期末簡報與測試數據',
          },
        ],
      },
    ],
  },
  {
    year: 2020,
    label: '2019–2020 年起始專案',
    tagline: '桃園青埔自駕電動巴士試運行計畫、揚昇高爾夫球自駕車開發案、新加坡 CFC 與南洋理工學院案',
    projectOverview:
      '公司奠基期代表作：涵蓋桃園青埔自駕電動巴士試運行（含招標契約、創新實驗管理、路側設備規劃與青埔技術文件）、揚昇高爾夫球場自動駕駛球車首發開發案，以及 2019–2020 新加坡 CFC 與 Republic Polytechnic 海外專案。',
    projects: [
      {
        id: '2020-taoyuan-qingpu-bus',
        code: 'TYN-QINGPU',
        name: '20200717_桃園市自動駕駛電動巴士系統試運行計畫（青埔運行計畫）',
        startYear: 2020,
        period: '2020 – 2022',
        department: '交通行動服務部 / 客戶專案執行',
        sharedDriveName: '交通行動服務部 | MaaS',
        status: 'archived',
        summary:
          '桃園高鐵青埔特區自動駕駛電動巴士試運行計畫，包含 01 招標文件與契約、02 報告書、05 創新實驗管理、08 驗收、80 路側設備規劃與 90 青埔技術文件，並延伸青埔二期、緯創 A+ 與資策會 RSU 子案。',
        highlights: [
          '01_招標文件與契約 / 05_創新實驗管理 / 08_驗收',
          '80_路側設備規劃 & 90_青埔技術文件',
          '3_客戶專案執行 > (closed)青埔運行計畫（含青埔二期、緯創A+、資策會RSU）',
        ],
        driveFolderId: '1xBE9KD5s5XP9UUcMfKALI-tHbcJwK8Gx',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1xBE9KD5s5XP9UUcMfKALI-tHbcJwK8Gx',
        files: [
          {
            id: '1rzjn2PVOiYF_SzfzEqw3GjV19dY5ctmR',
            name: '01_招標文件與契約',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1rzjn2PVOiYF_SzfzEqw3GjV19dY5ctmR',
            updatedAt: '2021-03-19',
            sizeOrNote: '桃園市政府標案契約與需求規範書',
          },
          {
            id: '1pro256NxzA8Fn1lm2Y9b5hj1o1IOeic9',
            name: '02_報告書',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1pro256NxzA8Fn1lm2Y9b5hj1o1IOeic9',
            updatedAt: '2021-03-19',
            sizeOrNote: '工作執行計畫書與歷次期中/期末報告',
          },
          {
            id: '1anN5JzWdG1Alxva-nG1xFag8r1uKIQzy',
            name: '05_創新實驗管理',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1anN5JzWdG1Alxva-nG1xFag8r1uKIQzy',
            updatedAt: '2021-04-20',
            sizeOrNote: '經濟部無人載具創新實驗審查與運行管理',
          },
          {
            id: '1dbNEZgZz92urJe2XHKnRA4SbRrEeIPk7',
            name: '08_驗收',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1dbNEZgZz92urJe2XHKnRA4SbRrEeIPk7',
            updatedAt: '2021-03-19',
            sizeOrNote: '驗收紀錄與結案證明文件',
          },
          {
            id: '1s4ibgZlKThBbjShLDSh9M3AIlQb_cvAn',
            name: '80_路側設備規劃',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1s4ibgZlKThBbjShLDSh9M3AIlQb_cvAn',
            updatedAt: '2021-05-14',
            sizeOrNote: '青埔路線 RSU 路側感測與號誌連動配置',
          },
          {
            id: '1-cJbn8kF1HSPfWTBoFiokJKuH5IEmiDz',
            name: '90_青埔技術文件',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1-cJbn8kF1HSPfWTBoFiokJKuH5IEmiDz',
            updatedAt: '2021-03-19',
            sizeOrNote: '自駕電動巴士系統架構與測試規範',
          },
          {
            id: '1YBfyPjEIq6_RYcNxnaU7DFdoGEmoCF20',
            name: '3_客戶專案執行 > (closed)青埔運行計畫（含青埔二期、緯創A+、資策會RSU）',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1YBfyPjEIq6_RYcNxnaU7DFdoGEmoCF20',
            updatedAt: '2022-03',
            sizeOrNote: '客戶專案執行完整結案資料夾',
          },
        ],
      },
      {
        id: '2019-sunrise-golf-cart',
        code: 'GOLF-SUNRISE',
        name: '20190719_揚昇高爾夫球自動駕駛車開發案',
        startYear: 2019,
        period: '2019 – 2020',
        department: '交通行動服務部 / 研發部',
        sharedDriveName: '交通行動服務部 | MaaS',
        status: 'archived',
        summary:
          '台灣首創高爾夫球場自動駕駛球車實地開發與場域驗證案（揚昇高爾夫鄉村俱樂部），包含合約管理、系統開發、測試驗收、照片影片與 90 揚昇技術文件，奠定後續智慧球車 v1/v2 與 Golface 量產車之技術基礎。',
        highlights: ['06_系統開發 & 90_揚昇技術文件', '07_測試驗收 & 08_照片影片', '03_合約管理 & 04_詢價報價'],
        driveFolderId: '1fJhV90XrcK9ojTdl6FZDTFGtrI_fV19l',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1fJhV90XrcK9ojTdl6FZDTFGtrI_fV19l',
        files: [
          {
            id: '1QDyBpl1DWlxgN-qZ7DLCWtkvIb9sMCj2',
            name: '03_合約管理',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1QDyBpl1DWlxgN-qZ7DLCWtkvIb9sMCj2',
            updatedAt: '2021-03-10',
            sizeOrNote: '專案合作契約與保密協議',
            accessScope: 'confidential',
            allowedDepartments: ['營業', 'BD', '財務', '總經理'],
            allowedRoles: ['admin', 'finance'],
          },
          {
            id: '1FjvYm0wTXPBBaLNLxl8guDofsaEjMAsM',
            name: '06_系統開發',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1FjvYm0wTXPBBaLNLxl8guDofsaEjMAsM',
            updatedAt: '2021-03-23',
            sizeOrNote: '球道自駕感知、定位與控制系統研發資料',
          },
          {
            id: '11bBA_yHsS5I66BnynRc4vnym-g1sgKZy',
            name: '07_測試驗收',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/11bBA_yHsS5I66BnynRc4vnym-g1sgKZy',
            updatedAt: '2021-03-25',
            sizeOrNote: '揚昇球場坡道與球道實車驗收測試紀錄',
          },
          {
            id: '1BBQUzgJUrsqPSMekNjEDycuGm-OlOxyT',
            name: '08_照片影片',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1BBQUzgJUrsqPSMekNjEDycuGm-OlOxyT',
            updatedAt: '2021-04-16',
            sizeOrNote: '實車運行照片與展示影片歸檔',
          },
          {
            id: '1fp4OXuo8JSpVF-90RViMyTrIT0UDnLCu',
            name: '90_揚昇技術文件',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1fp4OXuo8JSpVF-90RViMyTrIT0UDnLCu',
            updatedAt: '2021-03-23',
            sizeOrNote: '第一代自駕球車核心技術規格與圖面',
          },
        ],
      },
      {
        id: '2019-singapore-cfc',
        code: 'SG-CFC2019',
        name: '2019 Singapore CFC & 2020 Republic Polytechnic（新加坡海外市場開發）',
        startYear: 2019,
        period: '2019 – 2020',
        department: '國際市場開發',
        sharedDriveName: '營業部 Business Development',
        status: 'archived',
        summary:
          '2019 年參與新加坡自動駕駛 Call for Collaboration (CFC) 國際徵案，以及 2020 年新加坡 Republic Polytechnic (Tron-e SG) 自駕合作專案之技術提案與商務檔案。',
        highlights: ['2019 Singapore CFC 提案資料夾', '2020 Republic Polytechnic (Tron-e SG) 專案資料夾'],
        driveFolderId: '1-kOU1QmmG6hoCQN6v9IMeKum-5qJfyKv',
        driveFolderUrl: 'https://drive.google.com/drive/folders/1-kOU1QmmG6hoCQN6v9IMeKum-5qJfyKv',
        files: [
          {
            id: '1ze7VUYilZiXT28_wP4Qpgkxng4X8pLeJ',
            name: '2019 Singapore CFC',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1ze7VUYilZiXT28_wP4Qpgkxng4X8pLeJ',
            updatedAt: '2021-04-26',
            sizeOrNote: '英文提案簡報、規格書與新加坡法規整理',
          },
          {
            id: '1Iwv6parn2TxpzMZSSzbOkyxZ0xKXs9X0',
            name: '2020 Republic Polytechnic (Tron-e SG)',
            kind: 'folder',
            driveUrl: 'https://drive.google.com/drive/folders/1Iwv6parn2TxpzMZSSzbOkyxZ0xKXs9X0',
            updatedAt: '2021-04-26',
            sizeOrNote: '新加坡共和理工學院自駕電動巴士合作案',
          },
        ],
      },
    ],
  },
];
