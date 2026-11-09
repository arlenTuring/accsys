import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  ensureNativeGoogleDocForLiveEditing,
  getCandidateDriveWriteTokens,
} from '@/lib/projects/drive-doc-writer';

export const dynamic = 'force-dynamic';

export type DriveBreadcrumbItem = {
  id: string;
  name: string;
};

export type DriveFolderItem = {
  id: string;
  name: string;
};

async function fetchFolderInfo(
  folderId: string,
  token: string
): Promise<{ id: string; name: string; parents?: string[] } | null> {
  if (folderId === 'root') {
    return { id: 'root', name: '我的雲端硬碟 (My Drive)' };
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        folderId
      )}?fields=id,name,parents&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6_000),
        cache: 'no-store',
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as { id: string; name: string; parents?: string[] };
  } catch {
    return null;
  }
}

async function buildFolderPath(
  startFolderId: string,
  token: string
): Promise<DriveBreadcrumbItem[]> {
  const trail: DriveBreadcrumbItem[] = [];
  let currentId: string | undefined = startFolderId;
  let depth = 0;

  while (currentId && depth < 6) {
    depth++;
    const info = await fetchFolderInfo(currentId, token);
    if (!info) break;
    // Detect if this is the user's root Drive folder
    const isRoot =
      currentId === 'root' ||
      info.name === 'My Drive' ||
      info.name === '我的雲端硬碟' ||
      !info.parents ||
      info.parents.length === 0;
    trail.unshift({
      id: isRoot ? 'root' : info.id,
      name: isRoot ? '我的雲端硬碟 (My Drive)' : info.name,
    });
    if (isRoot) break;
    currentId = info.parents?.[0];
  }

  if (trail.length === 0 || trail[0].id !== 'root') {
    trail.unshift({ id: 'root', name: '我的雲端硬碟 (My Drive)' });
  }
  return trail;
}

async function listChildFolders(
  parentId: string,
  token: string
): Promise<DriveFolderItem[]> {
  try {
    const escapedParent = parentId.replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `'${escapedParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: DriveFolderItem[] };
    return data.files ?? [];
  } catch {
    return [];
  }
}

/**
 * GET /api/projects/drive-location?fileId=...&browseFolderId=...
 * - Returns the file's current Drive storage location (parent folder + full breadcrumb path)
 * - Returns the list of subfolders inside `browseFolderId` (defaults to the file's current parent folder or `root`)
 */
export async function GET(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawFileId = searchParams.get('fileId')?.trim() || '';
  const browseFolderIdParam = searchParams.get('browseFolderId')?.trim() || '';

  const tokens = await getCandidateDriveWriteTokens(employee.email);
  const token = tokens[0];
  if (!token) {
    return NextResponse.json({
      accountEmail: employee.email,
      currentFolderId: 'root',
      currentPath: [{ id: 'root', name: '我的雲端硬碟 (My Drive)' }],
      browseFolderId: 'root',
      browsePath: [{ id: 'root', name: '我的雲端硬碟 (My Drive)' }],
      folders: [],
      needsAuth: true,
    });
  }

  let effectiveFileId = rawFileId;
  if (rawFileId) {
    effectiveFileId = await ensureNativeGoogleDocForLiveEditing({
      driveFileId: rawFileId,
      userEmail: employee.email,
    });
  }

  let currentFolderId = 'root';
  if (effectiveFileId) {
    try {
      const fileRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          effectiveFileId
        )}?fields=id,name,parents&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(6_000),
          cache: 'no-store',
        }
      );
      if (fileRes.ok) {
        const fileData = (await fileRes.json()) as { parents?: string[] };
        if (fileData.parents && fileData.parents[0]) {
          currentFolderId = fileData.parents[0];
        }
      }
    } catch {
      // fallback to root
    }
  }

  const targetBrowseId = browseFolderIdParam || currentFolderId || 'root';

  const [currentPath, browsePath, folders] = await Promise.all([
    buildFolderPath(currentFolderId, token),
    targetBrowseId === currentFolderId
      ? Promise.resolve(null)
      : buildFolderPath(targetBrowseId, token),
    listChildFolders(targetBrowseId, token),
  ]);

  const normalizedCurrentId =
    currentPath[currentPath.length - 1]?.id || currentFolderId || 'root';
  const finalBrowsePath = browsePath ?? currentPath;
  const normalizedBrowseId =
    finalBrowsePath[finalBrowsePath.length - 1]?.id || targetBrowseId || 'root';

  return NextResponse.json({
    accountEmail: employee.email,
    effectiveFileId,
    currentFolderId: normalizedCurrentId,
    currentPath,
    browseFolderId: normalizedBrowseId,
    browsePath: finalBrowsePath,
    folders,
  });
}

/**
 * POST /api/projects/drive-location
 * Actions:
 * 1. `{ action: 'create_folder', parentFolderId: string, folderName: string }`
 *    Creates a new folder in the user's Google Drive under `parentFolderId`.
 * 2. `{ action: 'delete_folder', folderId: string, parentFolderId?: string }`
 *    Deletes (or trashes) a folder in the user's Google Drive and returns the updated folder list.
 * 3. `{ action: 'move_file', fileId: string, targetFolderId: string }`
 *    Moves the file to `targetFolderId` in the user's Google Drive.
 */
export async function POST(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tokens = await getCandidateDriveWriteTokens(employee.email);
  const token = tokens[0];
  if (!token) {
    return NextResponse.json(
      { ok: false, error: '尚未取得雲端硬碟寫入權限' },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as
      | {
          action: 'create_folder';
          parentFolderId?: string;
          folderName?: string;
        }
      | {
          action: 'delete_folder';
          folderId?: string;
          parentFolderId?: string;
        }
      | {
          action: 'move_file';
          fileId?: string;
          targetFolderId?: string;
        };

    if (body.action === 'create_folder') {
      const name = (body.folderName ?? '').trim();
      if (!name) {
        return NextResponse.json(
          { ok: false, error: '請輸入資料夾名稱' },
          { status: 400 }
        );
      }
      const parentId = (body.parentFolderId ?? 'root').trim() || 'root';
      const createRes = await fetch(
        'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,parents',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!createRes.ok) {
        return NextResponse.json(
          { ok: false, error: `建立資料夾失敗 (${createRes.status})` },
          { status: 400 }
        );
      }

      const created = (await createRes.json()) as { id: string; name: string };
      const [browsePath, rawFolders] = await Promise.all([
        buildFolderPath(parentId, token),
        listChildFolders(parentId, token),
      ]);

      // Ensure the newly created folder appears immediately even if Drive search index lags by a split second
      const folders = rawFolders.some((f) => f.id === created.id)
        ? rawFolders
        : [...rawFolders, { id: created.id, name: created.name }].sort((a, b) =>
            a.name.localeCompare(b.name, 'zh-Hant')
          );

      const normalizedBrowseId =
        browsePath[browsePath.length - 1]?.id || parentId;

      return NextResponse.json({
        ok: true,
        createdFolder: created,
        browseFolderId: normalizedBrowseId,
        browsePath,
        folders,
      });
    }

    if (body.action === 'delete_folder') {
      const folderId = (body.folderId ?? '').trim();
      if (!folderId || folderId === 'root') {
        return NextResponse.json(
          { ok: false, error: '無法刪除雲端硬碟根目錄' },
          { status: 400 }
        );
      }

      // First move to trash (works across My Drive & Shared Drives), then attempt permanent DELETE
      const trashRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          folderId
        )}?supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ trashed: true }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!trashRes.ok) {
        const delRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            folderId
          )}?supportsAllDrives=true`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          }
        );
        if (!delRes.ok) {
          return NextResponse.json(
            { ok: false, error: `刪除資料夾失敗 (${trashRes.status})` },
            { status: 400 }
          );
        }
      }

      const parentId = (body.parentFolderId ?? 'root').trim() || 'root';
      const [browsePath, rawFolders] = await Promise.all([
        buildFolderPath(parentId, token),
        listChildFolders(parentId, token),
      ]);
      const folders = rawFolders.filter((f) => f.id !== folderId);
      const normalizedBrowseId =
        browsePath[browsePath.length - 1]?.id || parentId;

      return NextResponse.json({
        ok: true,
        deletedFolderId: folderId,
        browseFolderId: normalizedBrowseId,
        browsePath,
        folders,
      });
    }

    if (body.action === 'move_file') {
      const rawFileId = (body.fileId ?? '').trim();
      const targetFolderId = (body.targetFolderId ?? 'root').trim() || 'root';
      if (!rawFileId) {
        return NextResponse.json(
          { ok: false, error: '缺少檔案 ID' },
          { status: 400 }
        );
      }

      const effectiveFileId = await ensureNativeGoogleDocForLiveEditing({
        driveFileId: rawFileId,
        userEmail: employee.email,
      });

      // Fetch existing parents so we can move the file cleanly
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          effectiveFileId
        )}?fields=id,parents&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(6_000),
          cache: 'no-store',
        }
      );

      let previousParents = '';
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as { parents?: string[] };
        previousParents = (meta.parents ?? []).join(',');
      }

      const moveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        effectiveFileId
      )}?addParents=${encodeURIComponent(targetFolderId)}${
        previousParents ? `&removeParents=${encodeURIComponent(previousParents)}` : ''
      }&supportsAllDrives=true&fields=id,parents`;

      const moveRes = await fetch(moveUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });

      if (!moveRes.ok) {
        return NextResponse.json(
          { ok: false, error: `移動檔案位置失敗 (${moveRes.status})` },
          { status: 400 }
        );
      }

      const currentPath = await buildFolderPath(targetFolderId, token);
      const normalizedCurrentId =
        currentPath[currentPath.length - 1]?.id || targetFolderId;

      return NextResponse.json({
        ok: true,
        currentFolderId: normalizedCurrentId,
        currentPath,
      });
    }

    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '操作失敗' },
      { status: 500 }
    );
  }
}
