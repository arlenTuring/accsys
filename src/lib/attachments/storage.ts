import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { getRequiredEnv } from '@/lib/env';

function storageRoot() {
  return getRequiredEnv('STORAGE_LOCAL_PATH');
}

export async function uploadAttachmentFile(
  storagePath: string,
  file: File
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const fullPath = path.join(storageRoot(), storagePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'upload_failed' };
  }
}

/** Local: app route that streams the file. Swap to GCS signed URLs in production. */
export async function createSignedAttachmentUrl(storagePath: string): Promise<string | null> {
  try {
    const fullPath = path.join(storageRoot(), storagePath);
    await readFile(fullPath);
    return `/api/attachments/file?path=${encodeURIComponent(storagePath)}`;
  } catch {
    return null;
  }
}

export async function readAttachmentBytes(storagePath: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(storageRoot(), storagePath));
  } catch {
    return null;
  }
}
