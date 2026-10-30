import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { aiChatStagedAttachments, aiConversations } from '@/lib/db/schema';
import { scanBytes, scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { quarantineKey, readNoFollow, removeKey, writeNew } from '@/lib/attachments/storage';

import { MAX_ATTACHMENTS_PER_FORM, MAX_FILE_SIZE_BYTES, formatBytesLabel } from '@/lib/attachments/policy';
import { sniffAllowedType } from '@/lib/attachments/validate';

/** Aligned with form attachment policy (no separate 3 MB / 3-file chat ceiling). */
export const AI_IMAGE_MAX_BYTES = MAX_FILE_SIZE_BYTES;
export const AI_IMAGE_MAX_COUNT = Math.min(10, MAX_ATTACHMENTS_PER_FORM);
export const AI_IMAGE_MAX_PIXELS = 40_000_000;
export const AI_IMAGE_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

export type StagedImageRow = {
  id: string;
  clientAttachmentId: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  scanStatus: 'pending' | 'scanning' | 'ready' | 'failed' | 'purged';
  createdAt: Date;
};

function sniffImageMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Minimal dimension probe — rejects absurd pixel counts without full decode libraries. */
function probeDimensions(mime: string, bytes: Uint8Array): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && bytes.length >= 24) {
      const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
      const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
      if (width > 0 && height > 0) return { width, height };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) break;
        const marker = bytes[i + 1]!;
        if (marker === 0xd9 || marker === 0xda) break;
        const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
        if (len < 2) break;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
          const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
          const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
          if (width > 0 && height > 0) return { width, height };
        }
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function assertConversationOwner(conversationId: string, ownerEmployeeId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!row) throw new Error('conversation_forbidden');
}

export async function stageAiChatImage(input: {
  ownerEmployeeId: string;
  conversationId: string;
  clientAttachmentId: string;
  fileName: string;
  bytes: Uint8Array;
}): Promise<
  | { ok: true; staged: StagedImageRow }
  | { ok: false; error: string; code: string }
> {
  if (!/^[0-9a-f-]{36}$/i.test(input.clientAttachmentId)) {
    return { ok: false, error: '附件識別無效。', code: 'client_id_invalid' };
  }
  await assertConversationOwner(input.conversationId, input.ownerEmployeeId);

  if (input.bytes.length === 0 || input.bytes.length > AI_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `附件不可超過 ${formatBytesLabel(AI_IMAGE_MAX_BYTES)}。`,
      code: 'too_large',
    };
  }
  const sniffed = sniffAllowedType(input.bytes);
  const mime = sniffed?.mime ?? sniffImageMime(input.bytes);
  if (!mime || !AI_IMAGE_ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      error: '僅支援 JPEG、PNG、WebP、HEIC／HEIF 與 PDF。',
      code: 'unsupported_type',
    };
  }
  const dims =
    mime.startsWith('image/') && mime !== 'image/heic' && mime !== 'image/heif'
      ? probeDimensions(mime as 'image/jpeg' | 'image/png' | 'image/webp', input.bytes)
      : null;
  if (dims && dims.width * dims.height > AI_IMAGE_MAX_PIXELS) {
    return { ok: false, error: '圖片解析度過高，請縮小後再試。', code: 'too_many_pixels' };
  }

  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiChatStagedAttachments)
    .where(
      and(
        eq(aiChatStagedAttachments.conversationId, input.conversationId),
        eq(aiChatStagedAttachments.ownerEmployeeId, input.ownerEmployeeId),
        isNull(aiChatStagedAttachments.purgedAt),
        sql`${aiChatStagedAttachments.scanStatus} <> 'purged'`
      )
    );
  if (n >= AI_IMAGE_MAX_COUNT) {
    return { ok: false, error: `同一則訊息最多 ${AI_IMAGE_MAX_COUNT} 個附件。`, code: 'too_many' };
  }

  const [existing] = await db
    .select()
    .from(aiChatStagedAttachments)
    .where(
      and(
        eq(aiChatStagedAttachments.ownerEmployeeId, input.ownerEmployeeId),
        eq(aiChatStagedAttachments.clientAttachmentId, input.clientAttachmentId)
      )
    )
    .limit(1);
  if (existing && existing.scanStatus === 'ready' && !existing.purgedAt) {
    return { ok: true, staged: mapRow(existing) };
  }

  let scanner;
  try {
    scanner = scannerConfig();
  } catch (err) {
    if (err instanceof ScannerUnavailable) {
      return { ok: false, error: '附件掃描服務未設定，暫時無法上傳。', code: 'scanner_unavailable' };
    }
    throw err;
  }

  const id = existing?.id ?? randomUUID();
  const storagePath = `ai-chat-staging/${input.ownerEmployeeId}/${id}`;
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const fileName = (input.fileName || 'image').replace(/[\\/:*?"<>|#%&]+/g, '_').slice(0, 180);

  if (existing) {
    await db
      .update(aiChatStagedAttachments)
      .set({
        fileName,
        mimeType: mime,
        fileSizeBytes: input.bytes.length,
        storagePath,
        sha256,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        scanStatus: 'scanning',
        purgedAt: null,
      })
      .where(eq(aiChatStagedAttachments.id, existing.id));
  } else {
    await db.insert(aiChatStagedAttachments).values({
      id,
      ownerEmployeeId: input.ownerEmployeeId,
      conversationId: input.conversationId,
      clientAttachmentId: input.clientAttachmentId,
      fileName,
      mimeType: mime,
      fileSizeBytes: input.bytes.length,
      storagePath,
      sha256,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      scanStatus: 'scanning',
    });
  }

  await writeNew(quarantineKey(id), input.bytes);
  const verdict = await scanBytes(input.bytes, scanner);
  if (verdict === 'infected') {
    await removeKey(quarantineKey(id)).catch(() => undefined);
    await db
      .update(aiChatStagedAttachments)
      .set({ scanStatus: 'failed', purgedAt: sql`now()` })
      .where(eq(aiChatStagedAttachments.id, id));
    return { ok: false, error: '檔案未通過安全掃描。', code: 'infected' };
  }
  if (verdict === 'scan_failed') {
    await db.update(aiChatStagedAttachments).set({ scanStatus: 'failed' }).where(eq(aiChatStagedAttachments.id, id));
    return { ok: false, error: '檔案安全掃描失敗，請重試。', code: 'scan_failed' };
  }

  const { promote } = await import('@/lib/attachments/storage');
  await promote(quarantineKey(id), storagePath);
  await db
    .update(aiChatStagedAttachments)
    .set({ scanStatus: 'ready' })
    .where(eq(aiChatStagedAttachments.id, id));

  const [row] = await db.select().from(aiChatStagedAttachments).where(eq(aiChatStagedAttachments.id, id)).limit(1);
  return { ok: true, staged: mapRow(row!) };
}

export async function getReadyStagedImagesForOwner(
  ownerEmployeeId: string,
  conversationId: string,
  ids: string[]
): Promise<Array<StagedImageRow & { bytes: Uint8Array }>> {
  if (ids.length === 0) return [];
  const db = getDb();
  const out: Array<StagedImageRow & { bytes: Uint8Array }> = [];
  for (const id of ids.slice(0, AI_IMAGE_MAX_COUNT)) {
    const [row] = await db
      .select()
      .from(aiChatStagedAttachments)
      .where(
        and(
          eq(aiChatStagedAttachments.id, id),
          eq(aiChatStagedAttachments.ownerEmployeeId, ownerEmployeeId),
          eq(aiChatStagedAttachments.conversationId, conversationId),
          eq(aiChatStagedAttachments.scanStatus, 'ready'),
          isNull(aiChatStagedAttachments.purgedAt)
        )
      )
      .limit(1);
    if (!row) continue;
    const bytes = await readNoFollow(row.storagePath);
    out.push({ ...mapRow(row), bytes });
  }
  return out;
}

export async function purgeStagedImage(ownerEmployeeId: string, stagedId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiChatStagedAttachments)
    .where(
      and(eq(aiChatStagedAttachments.id, stagedId), eq(aiChatStagedAttachments.ownerEmployeeId, ownerEmployeeId))
    )
    .limit(1);
  if (!row) return false;
  await removeKey(row.storagePath).catch(() => undefined);
  await removeKey(quarantineKey(row.id)).catch(() => undefined);
  await db
    .update(aiChatStagedAttachments)
    .set({ scanStatus: 'purged', purgedAt: sql`now()` })
    .where(eq(aiChatStagedAttachments.id, stagedId));
  return true;
}

export async function readStagedImageForOwner(
  ownerEmployeeId: string,
  stagedId: string
): Promise<{ mimeType: string; fileName: string; bytes: Uint8Array } | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiChatStagedAttachments)
    .where(
      and(
        eq(aiChatStagedAttachments.id, stagedId),
        eq(aiChatStagedAttachments.ownerEmployeeId, ownerEmployeeId),
        eq(aiChatStagedAttachments.scanStatus, 'ready'),
        isNull(aiChatStagedAttachments.purgedAt)
      )
    )
    .limit(1);
  if (!row) return null;
  const bytes = await readNoFollow(row.storagePath);
  return { mimeType: row.mimeType, fileName: row.fileName, bytes };
}

function mapRow(row: {
  id: string;
  clientAttachmentId: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  scanStatus: string;
  createdAt: Date;
}): StagedImageRow {
  return {
    id: row.id,
    clientAttachmentId: row.clientAttachmentId,
    conversationId: row.conversationId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    width: row.width,
    height: row.height,
    scanStatus: row.scanStatus as StagedImageRow['scanStatus'],
    createdAt: row.createdAt,
  };
}
