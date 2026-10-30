import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  MAX_FILE_SIZE_BYTES,
  UPLOAD_CHUNK_BYTES,
  formatBytesLabel,
} from '@/lib/attachments/policy';
import { sniffAllowedType, sanitizeFileName } from '@/lib/attachments/validate';
import { getDb } from '@/lib/db';
import { attachmentUploadSessions } from '@/lib/db/schema';
import { readNoFollow, removeKey, writeNew } from '@/lib/attachments/storage';
import type { Actor } from '@/lib/authz/forms';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export async function createUploadSession(input: {
  actor: Actor;
  purpose: 'form' | 'ai_chat' | 'draft';
  clientUploadId: string;
  fileName: string;
  declaredSizeBytes: number;
  declaredMime?: string | null;
  formType?: string | null;
  formId?: string | null;
  conversationId?: string | null;
  chunkSizeBytes?: number;
}): Promise<{ ok: true; sessionId: string; chunkSizeBytes: number; totalChunks: number } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{8,64}$/i.test(input.clientUploadId)) {
    return { ok: false, error: 'clientUploadId 無效' };
  }
  if (input.declaredSizeBytes <= 0 || input.declaredSizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `檔案大小須介於 1 與 ${formatBytesLabel(MAX_FILE_SIZE_BYTES)}` };
  }
  const chunkSize = Math.min(
    Math.max(input.chunkSizeBytes ?? UPLOAD_CHUNK_BYTES, 256 * 1024),
    UPLOAD_CHUNK_BYTES
  );
  const totalChunks = Math.ceil(input.declaredSizeBytes / chunkSize);
  const id = randomUUID();
  const tempPrefix = `upload-sessions/${input.actor.id}/${id}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    await getDb()
      .insert(attachmentUploadSessions)
      .values({
        id,
        ownerEmployeeId: input.actor.id,
        purpose: input.purpose,
        formType: input.formType ?? null,
        formId: input.formId ?? null,
        conversationId: input.conversationId ?? null,
        clientUploadId: input.clientUploadId,
        fileName: input.fileName.slice(0, 180),
        declaredMime: input.declaredMime ?? null,
        declaredSizeBytes: input.declaredSizeBytes,
        chunkSizeBytes: chunkSize,
        totalChunks,
        receivedChunks: 0,
        tempStoragePrefix: tempPrefix,
        status: 'receiving',
        expiresAt,
      });
  } catch {
    const [existing] = await getDb()
      .select()
      .from(attachmentUploadSessions)
      .where(
        and(
          eq(attachmentUploadSessions.ownerEmployeeId, input.actor.id),
          eq(attachmentUploadSessions.clientUploadId, input.clientUploadId)
        )
      )
      .limit(1);
    if (existing && existing.status === 'receiving' && existing.expiresAt > new Date()) {
      return {
        ok: true,
        sessionId: existing.id,
        chunkSizeBytes: existing.chunkSizeBytes,
        totalChunks: existing.totalChunks,
      };
    }
    return { ok: false, error: '無法建立上傳工作階段' };
  }

  return { ok: true, sessionId: id, chunkSizeBytes: chunkSize, totalChunks };
}

export async function putUploadChunk(input: {
  actor: Actor;
  sessionId: string;
  chunkIndex: number;
  bytes: Uint8Array;
}): Promise<{ ok: true; receivedChunks: number; totalChunks: number } | { ok: false; error: string }> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(attachmentUploadSessions)
    .where(
      and(
        eq(attachmentUploadSessions.id, input.sessionId),
        eq(attachmentUploadSessions.ownerEmployeeId, input.actor.id)
      )
    )
    .limit(1);
  if (!session || session.status !== 'receiving') return { ok: false, error: '上傳工作階段無效' };
  if (session.expiresAt.getTime() < Date.now()) {
    await db.update(attachmentUploadSessions).set({ status: 'expired' }).where(eq(attachmentUploadSessions.id, session.id));
    return { ok: false, error: '上傳工作階段已過期' };
  }
  if (input.chunkIndex < 0 || input.chunkIndex >= session.totalChunks) {
    return { ok: false, error: '分段編號無效' };
  }
  const expected =
    input.chunkIndex === session.totalChunks - 1
      ? session.declaredSizeBytes - session.chunkSizeBytes * (session.totalChunks - 1)
      : session.chunkSizeBytes;
  if (input.bytes.length !== expected) {
    return { ok: false, error: `分段大小不符（預期 ${expected} bytes）` };
  }

  const key = `${session.tempStoragePrefix}/chunk-${input.chunkIndex}`;
  await writeNew(key, input.bytes);

  // Count distinct chunks by probing — store received bitmask in DB as increment when new.
  // Simple approach: rewrite receivedChunks as max(index)+1 only if sequential; track via re-read.
  const received = Math.max(session.receivedChunks, input.chunkIndex + 1);
  await db
    .update(attachmentUploadSessions)
    .set({ receivedChunks: received })
    .where(eq(attachmentUploadSessions.id, session.id));

  return { ok: true, receivedChunks: received, totalChunks: session.totalChunks };
}

export async function completeUploadSession(input: {
  actor: Actor;
  sessionId: string;
}): Promise<
  | { ok: true; bytes: Uint8Array; fileName: string; mime: string; sha256: string }
  | { ok: false; error: string }
> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(attachmentUploadSessions)
    .where(
      and(
        eq(attachmentUploadSessions.id, input.sessionId),
        eq(attachmentUploadSessions.ownerEmployeeId, input.actor.id)
      )
    )
    .limit(1);
  if (!session) return { ok: false, error: '上傳工作階段無效' };
  if (session.status === 'ready' && session.assembledSha256) {
    // Idempotent complete: re-assemble from chunks if still present.
  }
  if (session.status !== 'receiving' && session.status !== 'ready') {
    return { ok: false, error: '上傳工作階段狀態無法完成' };
  }

  await db
    .update(attachmentUploadSessions)
    .set({ status: 'assembling' })
    .where(eq(attachmentUploadSessions.id, session.id));

  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (let i = 0; i < session.totalChunks; i++) {
      const chunk = await readNoFollow(`${session.tempStoragePrefix}/chunk-${i}`);
      parts.push(chunk);
      total += chunk.length;
    }
  } catch {
    await db.update(attachmentUploadSessions).set({ status: 'failed' }).where(eq(attachmentUploadSessions.id, session.id));
    return { ok: false, error: '缺少分段，請重試上傳' };
  }

  if (total !== session.declaredSizeBytes) {
    await db.update(attachmentUploadSessions).set({ status: 'failed' }).where(eq(attachmentUploadSessions.id, session.id));
    return { ok: false, error: '組裝後大小與宣告不符' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  const mime = sniffAllowedType(bytes);
  if (!mime) {
    await db.update(attachmentUploadSessions).set({ status: 'failed' }).where(eq(attachmentUploadSessions.id, session.id));
    return { ok: false, error: '檔案格式不支援' };
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fileName = sanitizeFileName(session.fileName, mime);

  await db
    .update(attachmentUploadSessions)
    .set({ status: 'ready', assembledSha256: sha256, completedAt: new Date() })
    .where(eq(attachmentUploadSessions.id, session.id));

  // Best-effort cleanup of chunks (assembled bytes returned to caller).
  for (let i = 0; i < session.totalChunks; i++) {
    await removeKey(`${session.tempStoragePrefix}/chunk-${i}`).catch(() => undefined);
  }

  return { ok: true, bytes, fileName, mime, sha256 };
}

export async function abortUploadSession(actor: Actor, sessionId: string): Promise<void> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(attachmentUploadSessions)
    .where(
      and(eq(attachmentUploadSessions.id, sessionId), eq(attachmentUploadSessions.ownerEmployeeId, actor.id))
    )
    .limit(1);
  if (!session) return;
  for (let i = 0; i < session.totalChunks; i++) {
    await removeKey(`${session.tempStoragePrefix}/chunk-${i}`).catch(() => undefined);
  }
  await db.update(attachmentUploadSessions).set({ status: 'purged' }).where(eq(attachmentUploadSessions.id, session.id));
}
