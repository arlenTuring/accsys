'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildDriveEmbedPreviewUrl,
  canViewerAccessScope,
  canViewerEditFile,
  filterYearGroupsForViewer,
  isEditableDocumentKind,
  type AccessScopeLevel,
  type DriveItemKind,
  type HistoricalDriveItem,
  type HistoricalProject,
  type HistoricalYearGroup,
  type ProjectViewerContext,
} from '@/lib/projects/historical-projects-data';
import { TrackpadZoomFrame } from './trackpad-zoom-frame';
import {
  buildCoAuthorDocFromDriveItem,
  ProjectLiveCoAuthor,
} from './project-live-coauthor';
import type { CoAuthorDocument } from '@/lib/projects/project-coauthor-seed';

function ItemIcon({ kind, isOpen }: { kind: DriveItemKind; isOpen?: boolean }) {
  switch (kind) {
    case 'folder':
      return (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-200/70">
          {isOpen ? '📂' : '📁'}
        </span>
      );
    case 'spreadsheet':
      return (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70">
          📊
        </span>
      );
    case 'presentation':
      return (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-orange-200/70">
          📽️
        </span>
      );
    case 'image':
      return (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-700 ring-1 ring-purple-200/70">
          🖼️
        </span>
      );
    case 'archive':
      return (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-200/70">
          🎬
        </span>
      );
    case 'document':
    case 'pdf':
    default:
      return (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-td-blue ring-1 ring-blue-200/70">
          📄
        </span>
      );
  }
}

const STATUS_META: Record<
  HistoricalProject['status'],
  { label: string; badgeClass: string }
> = {
  active: {
    label: '執行中',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  },
  completed: {
    label: '已結案交付',
    badgeClass: 'bg-blue-50 text-td-blue ring-1 ring-blue-200',
  },
  archived: {
    label: '歷史歸檔',
    badgeClass: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
  },
};

const SCOPE_BADGE: Record<
  AccessScopeLevel,
  { label: string; shortLabel: string; badgeClass: string }
> = {
  company_wide: {
    label: '🌐 全公司可看',
    shortLabel: '🌐 全公司可看',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80',
  },
  department_only: {
    label: '🔒 部門／專案群組限定',
    shortLabel: '🔒 群組限定',
    badgeClass: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80',
  },
  confidential: {
    label: '🔐 商務／財務機密',
    shortLabel: '🔐 機密權限',
    badgeClass: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80',
  },
};

/** Collects all folder IDs recursively so we can expand/collapse all at any depth */
function collectAllFolderIds(items: HistoricalDriveItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === 'folder') {
      ids.push(item.id);
      if (item.children && item.children.length > 0) {
        ids.push(...collectAllFolderIds(item.children));
      }
    }
  }
  return ids;
}

/** Counts total items (folders + files) across all nested levels */
function countTotalNestedItems(items: HistoricalDriveItem[]): { folders: number; files: number } {
  let folders = 0;
  let files = 0;
  for (const item of items) {
    if (item.kind === 'folder') {
      folders += 1;
      if (item.children && item.children.length > 0) {
        const sub = countTotalNestedItems(item.children);
        folders += sub.folders;
        files += sub.files;
      }
    } else {
      files += 1;
    }
  }
  return { folders, files };
}

function defaultFormatLabelForItem(item: HistoricalDriveItem): string {
  const lower = item.name.toLowerCase();
  if (lower.endsWith('.pdf') || item.kind === 'pdf') return 'PDF';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv') || item.kind === 'spreadsheet') {
    return '試算表';
  }
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt') || item.kind === 'presentation') {
    return '簡報';
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'Word';
  if (lower.endsWith('.md')) return 'Markdown';
  if (lower.endsWith('.txt')) return 'TXT';
  if (lower.endsWith('.png')) return 'PNG 圖檔';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'JPG 圖檔';
  if (lower.endsWith('.mp4') || lower.endsWith('.mov')) return 'MP4 影片';
  if (item.kind === 'image') return '圖檔';
  if (item.kind === 'archive') return '封存檔';
  return '文件';
}

/**
 * Extracts only the file format and file size (e.g. "PDF · 4.7 MB", "試算表 · 27 KB"),
 * stripping out any one-sentence content summary. Returns null for folders.
 */
function formatFileFormatAndSize(item: HistoricalDriveItem): string | null {
  if (item.kind === 'folder') return null;
  const raw = item.sizeOrNote?.trim();
  if (!raw) return defaultFormatLabelForItem(item);

  const parts = raw
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  const sizeRegex = /^\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)$/i;

  if (parts.length >= 2 && sizeRegex.test(parts[1])) {
    return `${parts[0]} · ${parts[1]}`;
  }
  if (parts.length >= 1 && sizeRegex.test(parts[0])) {
    return `${defaultFormatLabelForItem(item)} · ${parts[0]}`;
  }
  if (parts.length >= 2) {
    return parts[0];
  }
  return defaultFormatLabelForItem(item);
}

export function ProjectAssistantClient({
  groups,
  viewer,
}: {
  groups: HistoricalYearGroup[];
  viewer: ProjectViewerContext;
}) {
  // Default tab is 'live' (即時助手), with 'history' (歷史文件) right alongside it
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live');
  const [externalCoAuthorDoc, setExternalCoAuthorDoc] = useState<CoAuthorDocument | null>(null);
  const [isCoAuthorDocOpen, setIsCoAuthorDocOpen] = useState<boolean>(false);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  /**
   * By default, ALL folders at ALL levels are expanded (`collapsedFolderIds` starts empty).
   * Users only need to click a folder to collapse/re-expand it.
   */
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<HistoricalDriveItem | null>(null);
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | AccessScopeLevel>('all');
  const [liveFilesByProject, setLiveFilesByProject] = useState<
    Record<string, HistoricalDriveItem[]>
  >({});
  const [driveAuthUser, setDriveAuthUser] = useState<string>(() => viewer.email || '');
  const hideLocked = true;
  const effectiveViewer = viewer;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('td_drive_auth_user');
      if (saved && saved.trim()) {
        setDriveAuthUser(saved.trim());
      }
    } catch {
      // ignore storage errors
    }
  }, [activeTab]);

  // Every time a user enters a project, immediately check Google Drive for new/updated files
  useEffect(() => {
    if (!selectedProjectId) return;
    let cancelled = false;
    fetch(`/api/projects/live-files?projectId=${encodeURIComponent(selectedProjectId)}`, {
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { synced?: boolean; files?: HistoricalDriveItem[] } | null) => {
        if (cancelled || !data || !Array.isArray(data.files)) return;
        setLiveFilesByProject((prev) => ({
          ...prev,
          [selectedProjectId]: data.files!,
        }));
      })
      .catch(() => {
        // Fallback to baseline tree on network error
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  // Merge any live-synced files and strictly prune all unauthorized projects, folders, and files
  // so an account without permission never sees confidential filenames, folders, or counts.
  const authorizedGroups = useMemo(() => {
    const mergedGroups = groups.map((g) => ({
      ...g,
      projects: g.projects.map((p) =>
        liveFilesByProject[p.id] ? { ...p, files: liveFilesByProject[p.id] } : p
      ),
    }));
    return filterYearGroupsForViewer(mergedGroups, effectiveViewer);
  }, [groups, liveFilesByProject, effectiveViewer]);

  const allProjects = useMemo(
    () => authorizedGroups.flatMap((g) => g.projects),
    [authorizedGroups]
  );

  const accessibleProjectsCount = allProjects.length;

  const selectedProject = useMemo(
    () => allProjects.find((p) => p.id === selectedProjectId) ?? null,
    [allProjects, selectedProjectId]
  );

  const projectTreeStats = useMemo(() => {
    if (!selectedProject) return { folders: 0, files: 0 };
    return countTotalNestedItems(selectedProject.files);
  }, [selectedProject]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return authorizedGroups
      .filter((g) => selectedYear === 'all' || g.year === selectedYear)
      .map((g) => {
        const matched = g.projects.filter((p) => {
          const projScope = p.accessScope ?? 'company_wide';
          if (scopeFilter !== 'all' && projScope !== scopeFilter) return false;
          if (!q) return true;
          return (
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            p.summary.toLowerCase().includes(q) ||
            p.department.toLowerCase().includes(q) ||
            p.highlights.some((h) => h.toLowerCase().includes(q)) ||
            p.files.some(
              (f) =>
                f.name.toLowerCase().includes(q) ||
                (f.children ?? []).some(
                  (c) =>
                    c.name.toLowerCase().includes(q) ||
                    (c.children ?? []).some((cc) => cc.name.toLowerCase().includes(q))
                )
            )
          );
        });
        return { ...g, projects: matched };
      })
      .filter((g) => g.projects.length > 0);
  }, [authorizedGroups, selectedYear, query, scopeFilter]);

  function openProject(projId: string) {
    setSelectedProjectId(projId);
    // Empty set = all folders at all levels expanded immediately upon entering
    setCollapsedFolderIds(new Set());
    setActiveFile(null);
    setIsEditingFile(false);
  }

  function toggleFolderCollapse(folderId: string) {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  function expandAllFolders() {
    setCollapsedFolderIds(new Set());
  }

  function collapseAllFolders() {
    if (!selectedProject) return;
    setCollapsedFolderIds(new Set(collectAllFolderIds(selectedProject.files)));
  }

  function handleFolderClick(item: HistoricalDriveItem, allowed: boolean) {
    if (!allowed) return;
    if (item.kind === 'folder' && item.children && item.children.length > 0) {
      toggleFolderCollapse(item.id);
    }
  }

  function handleOpenNodePreview(item: HistoricalDriveItem, allowed: boolean) {
    if (!allowed) return;
    if (item.kind === 'folder') {
      if (item.children && item.children.length > 0) {
        toggleFolderCollapse(item.id);
      }
      return;
    }
    setActiveFile((prev) => {
      const next = prev?.id === item.id ? null : item;
      setIsEditingFile(false);
      return next;
    });
  }

  /**
   * Recursive tree renderer: renders folders and their nested children at any depth,
   * all expanded by default so the user never has to click to drill into a new page.
   */
  function renderTreeNodes(
    items: HistoricalDriveItem[],
    depth: number,
    parentTrail: string[],
    inheritedScope?: AccessScopeLevel,
    inheritedDepts?: string[],
    inheritedRoles?: string[]
  ) {
    if (!selectedProject) return null;

    const visibleItems = items.filter((item) => {
      const access = canViewerAccessScope(effectiveViewer, {
        accessScope: item.accessScope ?? inheritedScope ?? selectedProject.accessScope,
        allowedDepartments:
          item.allowedDepartments ?? inheritedDepts ?? selectedProject.allowedDepartments,
        allowedRoles: item.allowedRoles ?? inheritedRoles ?? selectedProject.allowedRoles,
      });
      if (hideLocked && !access.allowed) return false;
      return true;
    });

    if (visibleItems.length === 0) return null;

    return (
      <div
        className={
          depth === 0
            ? 'divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white'
            : 'border-l-2 border-amber-200/80 bg-slate-50/50 pl-3 sm:pl-5'
        }
      >
        {visibleItems.map((item) => {
          const itemScope =
            item.accessScope ?? inheritedScope ?? selectedProject.accessScope ?? 'company_wide';
          const itemDepts =
            item.allowedDepartments ?? inheritedDepts ?? selectedProject.allowedDepartments;
          const itemRoles = item.allowedRoles ?? inheritedRoles ?? selectedProject.allowedRoles;

          const access = canViewerAccessScope(effectiveViewer, {
            accessScope: itemScope,
            allowedDepartments: itemDepts,
            allowedRoles: itemRoles,
          });

          const isFolder = item.kind === 'folder';
          const hasChildren = isFolder && Boolean(item.children && item.children.length > 0);
          const isExpanded = hasChildren && !collapsedFolderIds.has(item.id);
          const isSelected = activeFile?.id === item.id;
          const isEditableDoc = !isFolder && isEditableDocumentKind(item);
          const editPermission = isEditableDoc
            ? canViewerEditFile(effectiveViewer, selectedProject, item, {
                accessScope: itemScope,
                allowedDepartments: itemDepts,
                allowedRoles: itemRoles,
              })
            : { canEdit: false, reason: '' };
          const activeEditMode = isSelected && isEditingFile && editPermission.canEdit;
          const itemEmbedUrl =
            isSelected && !isFolder
              ? buildDriveEmbedPreviewUrl(
                  item,
                  activeEditMode ? 'edit' : 'drive_preview',
                  driveAuthUser
                )
              : null;
          const fullPageViewerHref = itemEmbedUrl
            ? `/tools/project-assistant/viewer?src=${encodeURIComponent(itemEmbedUrl)}&title=${encodeURIComponent(item.name)}&mode=${activeEditMode ? 'edit' : 'preview'}`
            : item.driveUrl;

          return (
            <div key={item.id} className="border-b border-slate-100 last:border-b-0">
              <div
                onClick={() => {
                  if (isFolder && hasChildren) {
                    handleFolderClick(item, access.allowed);
                  }
                }}
                onDoubleClick={() => {
                  if (!isFolder) {
                    handleOpenNodePreview(item, access.allowed);
                  }
                }}
                role="button"
                tabIndex={access.allowed ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenNodePreview(item, access.allowed);
                  }
                }}
                title={
                  !access.allowed
                    ? access.reason
                    : isFolder && hasChildren
                    ? '點擊展開或收合資料夾'
                    : '點兩下開啟檔案預覽'
                }
                className={`flex w-full select-none flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 text-left transition ${
                  !access.allowed
                    ? 'cursor-not-allowed bg-slate-100/80 opacity-65'
                    : isSelected
                    ? 'cursor-pointer bg-blue-50/95 ring-1 ring-inset ring-td-blue/40'
                    : isFolder && hasChildren
                    ? 'cursor-pointer bg-amber-50/35 hover:bg-amber-50/70'
                    : 'cursor-pointer bg-white hover:bg-blue-50/40'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {/* Collapse / Expand Chevron for Folders */}
                  {isFolder ? (
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold transition ${
                        hasChildren
                          ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300/70'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                      title={
                        hasChildren ? (isExpanded ? '點擊收合子目錄' : '點擊展開子目錄') : '雲端資料夾'
                      }
                    >
                      {hasChildren ? (isExpanded ? '▼' : '▶') : '•'}
                    </span>
                  ) : (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[10px] text-slate-300">
                      └
                    </span>
                  )}

                  <ItemIcon kind={item.kind} isOpen={isExpanded} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p
                        className={`truncate text-sm ${
                          isFolder ? 'font-bold text-slate-900' : 'font-semibold text-td-blue-dark'
                        }`}
                      >
                        {item.name}
                      </p>
                      {depth > 0 && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                          L{depth + 1}
                        </span>
                      )}
                      {hasChildren && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          {isExpanded ? `已展開 (${item.children!.length})` : `已收合 (${item.children!.length})`}
                        </span>
                      )}
                      {itemScope !== 'company_wide' && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            SCOPE_BADGE[itemScope].badgeClass
                          }`}
                        >
                          {SCOPE_BADGE[itemScope].shortLabel}
                        </span>
                      )}
                    </div>
                    {!isFolder && (
                      <p className="mt-0.5 truncate text-xs text-td-muted">
                        {formatFileFormatAndSize(item)}
                      </p>
                    )}
                    {!access.allowed && (
                      <p className="mt-0.5 text-[11px] font-medium text-rose-600">
                        {access.reason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {item.updatedAt && (
                    <span className="hidden font-mono text-slate-400 sm:inline">
                      {item.updatedAt}
                    </span>
                  )}
                  {!access.allowed ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-200 px-2.5 py-1 font-semibold text-slate-600">
                      🔒 權限限定
                    </span>
                  ) : isFolder && hasChildren ? (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 shadow-2xs">
                      <span>{isExpanded ? '收合 ▲' : '展開 ▼'}</span>
                    </span>
                  ) : isEditableDoc ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const doc = buildCoAuthorDocFromDriveItem(
                          item,
                          selectedProject.code,
                          selectedProject.name,
                          selectedProject.id
                        );
                        setExternalCoAuthorDoc(doc);
                        setActiveTab('live');
                      }}
                      title="在即時助手開啟此檔案"
                      className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-bold text-indigo-700 shadow-2xs transition hover:bg-indigo-600 hover:text-white"
                    >
                      <span>協作編輯</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Inline File Preview / Editor directly underneath the selected file item */}
              {isSelected && itemEmbedUrl && (
                <div className="border-t border-slate-200 bg-slate-900">
                  <div className="flex items-center justify-end gap-1.5 bg-slate-950 px-3 py-2">
                    {isEditableDoc && (
                      <button
                        type="button"
                        disabled={!editPermission.canEdit}
                        onClick={() => {
                          if (editPermission.canEdit) {
                            setIsEditingFile((v) => !v);
                          }
                        }}
                        title={
                          editPermission.canEdit
                            ? activeEditMode
                              ? `正在編輯模式（${editPermission.reason}）— 點擊切回預覽模式`
                              : `切換為編輯模式（${editPermission.reason}）`
                            : `無編輯權限：${editPermission.reason}`
                        }
                        aria-label={
                          editPermission.canEdit
                            ? activeEditMode
                              ? '切回預覽模式'
                              : '切換為編輯模式'
                            : '無編輯權限'
                        }
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                          !editPermission.canEdit
                            ? 'cursor-not-allowed border-slate-800 bg-slate-900 text-slate-600 opacity-60'
                            : activeEditMode
                            ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm hover:bg-emerald-500'
                            : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-td-blue hover:text-white'
                        }`}
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                    )}
                    <a
                      href={fullPageViewerHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={activeEditMode ? '另開分頁編輯檔案' : '另開分頁預覽檔案'}
                      aria-label={activeEditMode ? '另開分頁編輯檔案' : '另開分頁預覽檔案'}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 transition hover:bg-slate-700 hover:text-white"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFile(null);
                        setIsEditingFile(false);
                      }}
                      title="關閉預覽"
                      aria-label="關閉預覽"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 transition hover:bg-rose-600 hover:text-white"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                  <TrackpadZoomFrame
                    key={`${item.id}:${activeEditMode ? 'edit' : 'preview'}`}
                    src={itemEmbedUrl}
                    title={item.name}
                    kind={item.kind}
                    isEditMode={activeEditMode}
                    heightClassName="h-[640px]"
                  />
                </div>
              )}

              {/* Recursively render nested children when expanded */}
              {hasChildren && isExpanded && access.allowed && (
                <div className="bg-slate-50/30 pb-1">
                  {renderTreeNodes(
                    item.children!,
                    depth + 1,
                    [...parentTrail, item.name],
                    itemScope,
                    itemDepts,
                    itemRoles
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Top Dual-Tab Navigation Header: 即時助手 (Default) & 歷史文件 — Auto-hidden when editing a document to maximize vertical document space */}
      {!(activeTab === 'live' && isCoAuthorDocOpen) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200/90 bg-white px-5 py-2.5 shadow-2xs">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-extrabold tracking-tight text-td-blue-dark">
              專案助手
            </h1>
            <div className="h-4 w-px bg-slate-200" />
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('live')}
                className={`inline-flex items-center rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                  activeTab === 'live'
                    ? 'bg-td-blue text-white shadow-xs'
                    : 'text-slate-600 hover:text-td-blue-dark'
                }`}
              >
                即時助手
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`inline-flex items-center rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                  activeTab === 'history'
                    ? 'bg-td-blue text-white shadow-xs'
                    : 'text-slate-600 hover:text-td-blue-dark'
                }`}
              >
                歷史文件
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'live' ? (
        <ProjectLiveCoAuthor
          groups={authorizedGroups}
          viewer={viewer}
          externalDocToOpen={externalCoAuthorDoc}
          onClearExternalDoc={() => setExternalCoAuthorDoc(null)}
          onSwitchToHistoryTab={() => setActiveTab('history')}
          onActiveDocChange={setIsCoAuthorDocOpen}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-7xl space-y-5">
            {/* Top Filter & Search Bar */}
            <div className="flex flex-col gap-3 rounded-2xl border border-td-border bg-white p-4 shadow-2xs lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScopeFilter('all')}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
              scopeFilter === 'all'
                ? 'bg-td-blue text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            全部權限範圍 ({allProjects.length})
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('company_wide')}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              scopeFilter === 'company_wide'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            🌐 全公司可看
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('department_only')}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              scopeFilter === 'department_only'
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            🔒 部門／群組限定
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('confidential')}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              scopeFilter === 'confidential'
                ? 'bg-rose-600 text-white shadow-2xs'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            🔐 商務／報價機密
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selectedProjectId) {
                setSelectedProjectId(null);
                setActiveFile(null);
              }
            }}
            placeholder="搜尋專案、子資料夾或檔案 (如 時程表、02584K、Invoice、API)…"
            className="w-full rounded-lg border border-td-border bg-slate-50/70 px-3 py-1.5 text-xs text-td-blue-dark placeholder:text-slate-400 focus:border-td-blue focus:bg-white focus:outline-none sm:w-80"
          />
        </div>
      </div>

      {/* Year Folder Filter Strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-7">
        <button
          type="button"
          onClick={() => {
            setSelectedYear('all');
            setSelectedProjectId(null);
            setActiveFile(null);
          }}
          className={`flex flex-col items-start justify-between rounded-xl border p-3 text-left transition ${
            selectedYear === 'all' && !selectedProject
              ? 'border-td-blue bg-td-blue-light/50 shadow-2xs ring-1 ring-td-blue/30'
              : 'border-td-border bg-white hover:border-td-blue/40'
          }`}
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-base">🗂️</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-td-blue-dark">
              {accessibleProjectsCount} 案可看
            </span>
          </div>
          <p className="mt-2 text-xs font-bold text-td-blue-dark">全部起始年份</p>
          <p className="mt-0.5 text-[11px] text-td-muted">2019 – 2026 總覽</p>
        </button>

        {authorizedGroups.map((g) => {
          const isActive = selectedYear === g.year;
          const visibleCount = g.projects.length;
          return (
            <button
              key={g.year}
              type="button"
              onClick={() => {
                setSelectedYear(g.year);
                setSelectedProjectId(null);
                setActiveFile(null);
              }}
              className={`flex flex-col items-start justify-between rounded-xl border p-3 text-left transition ${
                isActive
                  ? 'border-td-blue bg-td-blue-light/50 shadow-2xs ring-1 ring-td-blue/30'
                  : 'border-td-border bg-white hover:border-td-blue/40'
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-base">📁</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-800 ring-1 ring-amber-200/70">
                  {visibleCount} 案
                </span>
              </div>
              <p className="mt-2 text-xs font-bold text-td-blue-dark">{g.label}</p>
              <p className="mt-0.5 line-clamp-1 text-[11px] text-td-muted">
                {g.projects.map((p) => p.code).join(' · ')}
              </p>
            </button>
          );
        })}
      </div>

      {/* Selected Project Detail View (All Subfolders Auto-Expanded Tree + In-App File Viewer Workbench) */}
      {selectedProject ? (
        <section className="rounded-2xl border border-td-border bg-white p-5 shadow-card">
          {/* Top Navigation Bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <nav className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId(null);
                  setActiveFile(null);
                }}
                className="font-semibold text-td-blue hover:underline"
              >
                歷史資料
              </button>
              <span className="text-slate-300">/</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedYear(selectedProject.startYear);
                  setSelectedProjectId(null);
                  setActiveFile(null);
                }}
                className="font-semibold text-td-blue hover:underline"
              >
                {selectedProject.startYear} 年起始專案
              </button>
              <span className="text-slate-300">/</span>
              <span className="font-bold text-td-blue-dark">{selectedProject.name}</span>
            </nav>

            <button
              type="button"
              onClick={() => {
                setSelectedProjectId(null);
                setActiveFile(null);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              ← 返回年份專案列表
            </button>
          </div>

          {/* Project Header Summary */}
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-td-blue-dark px-2 py-0.5 font-mono text-xs font-bold text-white">
                  {selectedProject.code}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    STATUS_META[selectedProject.status].badgeClass
                  }`}
                >
                  {STATUS_META[selectedProject.status].label}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    SCOPE_BADGE[selectedProject.accessScope ?? 'company_wide'].badgeClass
                  }`}
                >
                  {SCOPE_BADGE[selectedProject.accessScope ?? 'company_wide'].label}
                </span>
                <span className="text-xs text-td-muted">
                  執行期間：{selectedProject.period}
                </span>
                <span className="text-xs text-td-muted">
                  · 權責部門：{selectedProject.department}
                </span>
              </div>

              <h2 className="text-xl font-bold text-td-blue-dark">
                {selectedProject.name}
              </h2>
            </div>
          </div>

          {/* Full-Width Multi-Level Expanded Tree (Inline File Preview opens right below the file item) */}
          <div className="mt-6">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-td-muted">
                  專案完整目錄樹（共 {projectTreeStats.folders} 個資料夾 · {projectTreeStats.files} 個檔案）
                </h3>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                  預設全層級展開
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={expandAllFolders}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-td-blue-dark hover:border-td-blue hover:text-td-blue"
                >
                  ▼ 全部展開
                </button>
                <button
                  type="button"
                  onClick={collapseAllFolders}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                >
                  ▶ 全部收合
                </button>
              </div>
            </div>

            {renderTreeNodes(selectedProject.files, 0, []) ?? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
                <p className="text-sm font-semibold text-slate-600">
                  目前檢視身份無此專案下之授權檔案，或已被權限過濾隱藏
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  您可以點擊上方「顯示所有項目」檢視權限鎖定說明，或切換不同部門視角測試。
                </p>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* Year Groups & Project Overview Cards */
        <div className="space-y-6">
          {filteredGroups.map((group) => (
            <section
              key={group.year}
              className="overflow-hidden rounded-2xl border border-td-border bg-white shadow-2xs"
            >
              {/* Year Group Banner */}
              <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-blue-50/40 to-white px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100/80 text-lg shadow-2xs">
                      📁
                    </span>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-extrabold text-td-blue-dark">
                        {group.label}
                      </h2>
                      <span className="rounded-full bg-td-blue/10 px-2.5 py-0.5 text-xs font-bold text-td-blue">
                        {group.projects.length} 個專案
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Projects Grid inside the Year Group */}
              <div className="grid gap-3.5 p-4 sm:grid-cols-2">
                {group.projects.map((proj) => {
                  const statusMeta = STATUS_META[proj.status];
                  const projScope = proj.accessScope ?? 'company_wide';
                  const scopeMeta = SCOPE_BADGE[projScope];
                  const access = canViewerAccessScope(effectiveViewer, {
                    accessScope: proj.accessScope,
                    allowedDepartments: proj.allowedDepartments,
                    allowedRoles: proj.allowedRoles,
                  });
                  const stats = countTotalNestedItems(proj.files);

                  return (
                    <div
                      key={proj.id}
                      role={access.allowed ? 'button' : undefined}
                      tabIndex={access.allowed ? 0 : -1}
                      onClick={() => {
                        if (access.allowed) openProject(proj.id);
                      }}
                      onKeyDown={(e) => {
                        if (access.allowed && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          openProject(proj.id);
                        }
                      }}
                      className={`group flex flex-col justify-between rounded-xl border p-4 text-left transition ${
                        access.allowed
                          ? 'cursor-pointer border-slate-200/90 bg-white hover:border-td-blue hover:bg-blue-50/20 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-td-blue/40'
                          : 'cursor-not-allowed border-slate-200 bg-slate-50/80 opacity-75'
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-td-blue-dark">
                              {proj.code}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${scopeMeta.badgeClass}`}
                            >
                              {scopeMeta.shortLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusMeta.badgeClass}`}
                            >
                              {statusMeta.label}
                            </span>
                          </div>
                        </div>

                        <h3 className="mt-2 text-sm font-bold text-td-blue-dark group-hover:text-td-blue">
                          {proj.name}
                        </h3>

                        {/* Quick file / highlight tags */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {proj.highlights.slice(0, 3).map((h) => (
                            <span
                              key={h}
                              className="rounded bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200/70"
                            >
                              {h}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-2.5">
                        <span className="text-[11px] text-td-muted">
                          共 {stats.folders} 個資料夾 · {stats.files} 個檔案
                        </span>
                        {!access.allowed && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                            🔒 無存取權限
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
          </div>
        </div>
      )}
    </div>
  );
}
