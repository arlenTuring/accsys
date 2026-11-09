import { GoogleAuth } from 'google-auth-library';
import {
  filterDriveItemsForViewer,
  HISTORICAL_YEAR_GROUPS,
  type AccessScopeLevel,
  type DriveItemKind,
  type HistoricalDriveItem,
  type HistoricalProject,
  type ProjectViewerContext,
} from './historical-projects-data';
import { ingestDriveTreeIntoKnowledgeGraph } from './company-knowledge-graph';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 12_000;
const MAX_DEPTH = 4;

type RawDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
};

/**
 * Resolves a live Google Drive API access token using:
 * 1. Explicit Drive OAuth refresh token (`GWS_DRIVE_REFRESH_TOKEN` or `GOOGLE_DRIVE_REFRESH_TOKEN`)
 * 2. Application Default Credentials (`gcloud auth application-default login` or attached GCP Service Account)
 */
async function getDriveAccessToken(): Promise<string | null> {
  const refreshToken =
    process.env.GWS_DRIVE_REFRESH_TOKEN?.trim() ||
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  const clientId =
    process.env.GWS_DRIVE_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.GWS_DIRECTORY_CLIENT_ID?.trim();
  const clientSecret =
    process.env.GWS_DRIVE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GWS_DIRECTORY_CLIENT_SECRET?.trim();

  if (refreshToken && clientId && clientSecret) {
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as { access_token?: string };
        if (data.access_token) return data.access_token;
      }
    } catch {
      // Fall through to ADC
    }
  }

  // 2. Service Account JSON (inline JSON string, file path via GOOGLE_APPLICATION_CREDENTIALS, or automatic GCP Metadata Server)
  try {
    const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON?.trim();
    const credentials = inlineJson ? (JSON.parse(inlineJson) as Record<string, unknown>) : undefined;
    const auth = new GoogleAuth({
      scopes: [DRIVE_READONLY_SCOPE],
      ...(credentials ? { credentials } : {}),
    });
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();
    const token = typeof tokenRes === 'string' ? tokenRes : tokenRes?.token ?? null;
    if (token) return token;
  } catch {
    // Service Account / ADC not configured or lacks Drive scope
  }

  return null;
}

function mapMimeTypeToKind(mimeType: string, fileName: string): DriveItemKind {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
  if (
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.csv')
  ) {
    return 'spreadsheet';
  }
  if (
    mimeType === 'application/vnd.google-apps.presentation' ||
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint') ||
    lower.endsWith('.pptx') ||
    lower.endsWith('.ppt')
  ) {
    return 'presentation';
  }
  if (
    mimeType === 'application/vnd.google-apps.document' ||
    mimeType.includes('wordprocessingml') ||
    mimeType.includes('msword') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.doc')
  ) {
    return 'document';
  }
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    return 'pdf';
  }
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (
    mimeType.startsWith('video/') ||
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.zip')
  ) {
    return 'archive';
  }
  return 'document';
}

function formatKindAndByteSize(kind: DriveItemKind, fileName: string, sizeStr?: string): string | undefined {
  if (kind === 'folder') return undefined;
  const lower = fileName.toLowerCase();
  let formatLabel = '文件';
  if (lower.endsWith('.pdf') || kind === 'pdf') formatLabel = 'PDF';
  else if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv') || kind === 'spreadsheet') formatLabel = '試算表';
  else if (lower.endsWith('.pptx') || lower.endsWith('.ppt') || kind === 'presentation') formatLabel = '簡報';
  else if (lower.endsWith('.docx') || lower.endsWith('.doc')) formatLabel = 'Word';
  else if (lower.endsWith('.md')) formatLabel = 'Markdown';
  else if (lower.endsWith('.txt')) formatLabel = 'TXT';
  else if (lower.endsWith('.png')) formatLabel = 'PNG 圖檔';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) formatLabel = 'JPG 圖檔';
  else if (lower.endsWith('.mp4') || lower.endsWith('.mov')) formatLabel = 'MP4 影片';
  else if (kind === 'image') formatLabel = '圖檔';
  else if (kind === 'archive') formatLabel = '封存檔';

  if (!sizeStr) return formatLabel;
  const bytes = Number(sizeStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return formatLabel;
  let sizePart: string;
  if (bytes < 1024) sizePart = `${bytes} B`;
  else if (bytes < 1024 * 1024) sizePart = `${(bytes / 1024).toFixed(0)} KB`;
  else sizePart = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${formatLabel} · ${sizePart}`;
}

function buildDefaultDriveUrl(id: string, kind: DriveItemKind, webViewLink?: string): string {
  if (webViewLink) return webViewLink;
  if (kind === 'folder') return `https://drive.google.com/drive/folders/${id}`;
  return `https://drive.google.com/file/d/${id}/view`;
}

function indexExistingItemsById(items: HistoricalDriveItem[]): Map<string, HistoricalDriveItem> {
  const map = new Map<string, HistoricalDriveItem>();
  function walk(list: HistoricalDriveItem[]) {
    for (const item of list) {
      map.set(item.id, item);
      if (item.children) walk(item.children);
    }
  }
  walk(items);
  return map;
}

async function listFolderChildrenFromDrive(
  folderId: string,
  accessToken: string
): Promise<RawDriveFile[] | null> {
  const url = new URL(DRIVE_FILES_ENDPOINT);
  url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  url.searchParams.set('corpora', 'allDrives');
  url.searchParams.set('pageSize', '200');
  url.searchParams.set('orderBy', 'folder,name');
  url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime,size)');

  const res = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { files?: RawDriveFile[] };
  return Array.isArray(data.files) ? data.files : null;
}

const CONFIDENTIAL_NAME_PATTERN = /報價|預算|invoice|請款|発注|合約|機密|詢價/i;

async function fetchDriveSubtreeRecursive(
  folderId: string,
  accessToken: string,
  existingMap: Map<string, HistoricalDriveItem>,
  depth: number,
  inherited?: {
    accessScope?: AccessScopeLevel;
    allowedDepartments?: string[];
    allowedRoles?: string[];
  }
): Promise<HistoricalDriveItem[] | null> {
  const rawFiles = await listFolderChildrenFromDrive(folderId, accessToken);
  if (!rawFiles) return null;

  const items: HistoricalDriveItem[] = await Promise.all(
    rawFiles.map(async (raw) => {
      const existing = existingMap.get(raw.id);
      const kind = mapMimeTypeToKind(raw.mimeType, raw.name);
      const updatedAt = raw.modifiedTime
        ? raw.modifiedTime.slice(0, 10)
        : existing?.updatedAt;
      const sizeLabel = formatKindAndByteSize(kind, raw.name, raw.size);

      const isConfidentialName = CONFIDENTIAL_NAME_PATTERN.test(raw.name);
      const resolvedScope: AccessScopeLevel | undefined =
        existing?.accessScope ??
        inherited?.accessScope ??
        (isConfidentialName ? 'confidential' : undefined);
      const resolvedDepts =
        existing?.allowedDepartments ??
        inherited?.allowedDepartments ??
        (resolvedScope === 'confidential' ? ['營業', 'BD', '財務', '總經理'] : undefined);
      const resolvedRoles =
        existing?.allowedRoles ??
        inherited?.allowedRoles ??
        (resolvedScope === 'confidential' ? ['admin', 'finance'] : undefined);

      let children: HistoricalDriveItem[] | undefined = existing?.children;
      if (kind === 'folder' && depth + 1 < MAX_DEPTH) {
        const liveChildren = await fetchDriveSubtreeRecursive(
          raw.id,
          accessToken,
          existingMap,
          depth + 1,
          {
            accessScope: resolvedScope,
            allowedDepartments: resolvedDepts,
            allowedRoles: resolvedRoles,
          }
        );
        if (liveChildren !== null) {
          children = liveChildren;
        }
      }

      return {
        id: raw.id,
        name: raw.name,
        kind,
        driveUrl: buildDefaultDriveUrl(raw.id, kind, raw.webViewLink),
        updatedAt,
        sizeOrNote: sizeLabel ?? (kind === 'folder' ? undefined : existing?.sizeOrNote),
        accessScope: resolvedScope,
        allowedDepartments: resolvedDepts,
        allowedRoles: resolvedRoles,
        editAllowedDepartments: existing?.editAllowedDepartments,
        editAllowedRoles: existing?.editAllowedRoles,
        keyTakeaways: existing?.keyTakeaways,
        ...(children ? { children } : {}),
      };
    })
  );

  return items;
}

/**
 * Fetches the live, up-to-date file & subfolder tree for a specific project directly
 * from Google Drive API v3 (`files.list`), preserving permission rules while immediately
 * picking up any newly added, renamed, or deleted files in Google Drive, and strictly
 * filtering out any confidential/restricted files that the viewer cannot access.
 */
export async function syncProjectFilesFromDrive(
  projectId: string,
  viewer: ProjectViewerContext
): Promise<{
  synced: boolean;
  checkedAt: string;
  files: HistoricalDriveItem[];
}> {
  const allProjects: HistoricalProject[] = HISTORICAL_YEAR_GROUPS.flatMap((g) => g.projects);
  const project = allProjects.find((p) => p.id === projectId);
  if (!project) {
    return { synced: false, checkedAt: new Date().toISOString(), files: [] };
  }

  const projectInherited = {
    accessScope: project.accessScope,
    allowedDepartments: project.allowedDepartments,
    allowedRoles: project.allowedRoles,
  };

  const accessToken = await getDriveAccessToken();
  if (!accessToken) {
    return {
      synced: false,
      checkedAt: new Date().toISOString(),
      files: filterDriveItemsForViewer(project.files, viewer, projectInherited),
    };
  }

  const existingMap = indexExistingItemsById(project.files);
  const liveFiles = await fetchDriveSubtreeRecursive(
    project.driveFolderId,
    accessToken,
    existingMap,
    0,
    projectInherited
  );

  if (!liveFiles) {
    return {
      synced: false,
      checkedAt: new Date().toISOString(),
      files: filterDriveItemsForViewer(project.files, viewer, projectInherited),
    };
  }

  // Automatically ingest newly discovered or updated Drive files into the Company Knowledge Graph
  // and re-optimize graph centrality & IDF index weights.
  ingestDriveTreeIntoKnowledgeGraph(project.id, project.code, liveFiles);

  return {
    synced: true,
    checkedAt: new Date().toISOString(),
    files: filterDriveItemsForViewer(liveFiles, viewer, projectInherited),
  };
}
