import { and, asc, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import { aiConversations, aiMessages } from '@/lib/db/schema';

export type StoredMessage = {
  id: string;
  role: 'user' | 'model' | 'system';
  contentText: string;
  blocks: unknown[];
  toolsUsed: string[];
  clientMessageId: string | null;
  createdAt: Date;
};

export type ConversationRow = {
  id: string;
  ownerEmployeeId: string;
  title: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Create a brand-new conversation. Never reuses an existing row. */
export async function createConversation(
  ownerEmployeeId: string,
  title = '新對話'
): Promise<ConversationRow> {
  const db = getDb();
  const [created] = await db
    .insert(aiConversations)
    .values({ ownerEmployeeId, title: title.slice(0, 120) })
    .returning();
  await recordAudit(db, {
    actorEmployeeId: ownerEmployeeId,
    action: 'ai.conversation_created',
    entityType: 'ai_conversation',
    entityId: created.id,
    details: {
      title: created.title || '新對話',
      createdAt: created.createdAt.toISOString(),
    },
  });
  return mapConversation(created);
}

/**
 * Load a conversation the employee owns.
 * Returns null when missing / unauthorized / archived (unless includeArchived).
 * Does NOT create a replacement conversation.
 */
export async function getOwnedConversation(
  ownerEmployeeId: string,
  conversationId: string,
  opts?: { includeArchived?: boolean }
): Promise<ConversationRow | null> {
  if (!isUuid(conversationId)) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!row) return null;
  if (row.archivedAt && !opts?.includeArchived) return null;
  return mapConversation(row);
}

/**
 * @deprecated Prefer createConversation / getOwnedConversation.
 * Kept for bootstrap: if conversationId given and owned → return it;
 * if conversationId given but invalid → throw conversation_not_found;
 * if omitted → create new only when createIfMissing.
 */
export async function getOrCreateConversation(
  ownerEmployeeId: string,
  conversationId?: string | null,
  opts?: { createIfMissing?: boolean }
) {
  if (conversationId) {
    const owned = await getOwnedConversation(ownerEmployeeId, conversationId, { includeArchived: true });
    if (owned) return owned;
    throw new Error('conversation_not_found');
  }
  if (opts?.createIfMissing === false) {
    throw new Error('conversation_required');
  }
  return createConversation(ownerEmployeeId);
}

export async function listRecentConversation(ownerEmployeeId: string): Promise<ConversationRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.ownerEmployeeId, ownerEmployeeId), isNull(aiConversations.archivedAt)))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(1);
  return row ? mapConversation(row) : null;
}

export async function listConversations(input: {
  ownerEmployeeId: string;
  query?: string;
  limit?: number;
  cursorUpdatedAt?: string | null;
  cursorId?: string | null;
  includeArchived?: boolean;
}): Promise<{ items: ConversationRow[]; nextCursor: { updatedAt: string; id: string } | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const db = getDb();
  const clauses = [eq(aiConversations.ownerEmployeeId, input.ownerEmployeeId)];
  if (!input.includeArchived) {
    clauses.push(isNull(aiConversations.archivedAt));
  }
  if (input.query?.trim()) {
    const q = `%${input.query.trim().slice(0, 80)}%`;
    clauses.push(ilike(aiConversations.title, q));
  }
  if (input.cursorUpdatedAt && input.cursorId && isUuid(input.cursorId)) {
    const cursorDate = new Date(input.cursorUpdatedAt);
    if (!Number.isNaN(cursorDate.getTime())) {
      clauses.push(
        or(
          lt(aiConversations.updatedAt, cursorDate),
          and(eq(aiConversations.updatedAt, cursorDate), lt(aiConversations.id, input.cursorId))
        )!
      );
    }
  }

  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(...clauses))
    .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).map(mapConversation);
  const extra = rows[limit];
  return {
    items: page,
    nextCursor: extra
      ? { updatedAt: mapConversation(extra).updatedAt.toISOString(), id: extra.id }
      : null,
  };
}

export async function renameConversation(
  ownerEmployeeId: string,
  conversationId: string,
  title: string
): Promise<ConversationRow | null> {
  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) return null;
  const owned = await getOwnedConversation(ownerEmployeeId, conversationId, { includeArchived: true });
  if (!owned) return null;
  const db = getDb();
  const [row] = await db
    .update(aiConversations)
    .set({ title: trimmed, updatedAt: sql`now()` })
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .returning();
  return row ? mapConversation(row) : null;
}

/** Soft-delete (archive) conversation for the user while keeping it in system logs for admins. */
export async function archiveConversation(
  ownerEmployeeId: string,
  conversationId: string
): Promise<boolean> {
  const owned = await getOwnedConversation(ownerEmployeeId, conversationId);
  if (!owned) return false;
  const db = getDb();
  const [updated] = await db
    .update(aiConversations)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .returning({ archivedAt: aiConversations.archivedAt });
  await recordAudit(db, {
    actorEmployeeId: ownerEmployeeId,
    action: 'ai.conversation_deleted',
    entityType: 'ai_conversation',
    entityId: conversationId,
    details: {
      title: owned.title,
      createdAt: owned.createdAt.toISOString(),
      deletedAt: (updated?.archivedAt ?? new Date()).toISOString(),
    },
  });
  return true;
}

/**
 * Recent messages for model context / UI.
 * IMPORTANT: order by createdAt DESC + limit, then reverse — so long threads keep the latest turns.
 */
export async function listMessages(
  conversationId: string,
  ownerEmployeeId: string,
  limit = 40,
  opts?: { beforeCreatedAt?: Date | null; beforeId?: string | null }
): Promise<{ messages: StoredMessage[]; hasOlder: boolean }> {
  const db = getDb();
  const [owned] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!owned) return { messages: [], hasOlder: false };

  const take = Math.min(Math.max(limit, 1), 100);
  const clauses = [eq(aiMessages.conversationId, conversationId)];
  if (opts?.beforeCreatedAt && opts.beforeId && isUuid(opts.beforeId)) {
    clauses.push(
      or(
        lt(aiMessages.createdAt, opts.beforeCreatedAt),
        and(eq(aiMessages.createdAt, opts.beforeCreatedAt), lt(aiMessages.id, opts.beforeId))
      )!
    );
  }

  const rows = await db
    .select()
    .from(aiMessages)
    .where(and(...clauses))
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(take + 1);

  const hasOlder = rows.length > take;
  const page = rows.slice(0, take).reverse();
  return {
    messages: page.map((r) => ({
      id: r.id,
      role: r.role as StoredMessage['role'],
      contentText: r.contentText,
      blocks: (r.blocks as unknown[]) ?? [],
      toolsUsed: (r.toolsUsed as string[]) ?? [],
      clientMessageId: r.clientMessageId,
      createdAt: r.createdAt,
    })),
    hasOlder,
  };
}

/** @deprecated Use listMessages(...).messages — kept for call sites during migration. */
export async function listMessagesFlat(
  conversationId: string,
  ownerEmployeeId: string,
  limit = 40
): Promise<StoredMessage[]> {
  const { messages } = await listMessages(conversationId, ownerEmployeeId, limit);
  return messages;
}

/** Model message in this conversation that the owner may quote as a reply target. */
export async function getOwnedModelMessage(
  conversationId: string,
  ownerEmployeeId: string,
  messageId: string
): Promise<{ id: string; contentText: string } | null> {
  if (!isUuid(messageId)) return null;
  const db = getDb();
  const [owned] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!owned) return null;
  const [row] = await db
    .select({ id: aiMessages.id, contentText: aiMessages.contentText, role: aiMessages.role })
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), eq(aiMessages.conversationId, conversationId)))
    .limit(1);
  if (!row || row.role !== 'model') return null;
  return { id: row.id, contentText: row.contentText };
}

export async function appendMessage(input: {
  conversationId: string;
  ownerEmployeeId: string;
  role: 'user' | 'model' | 'system';
  contentText: string;
  clientMessageId?: string | null;
  blocks?: unknown[];
  toolsUsed?: string[];
}): Promise<{ id: string; replayed: boolean }> {
  const db = getDb();
  const [owned] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(eq(aiConversations.id, input.conversationId), eq(aiConversations.ownerEmployeeId, input.ownerEmployeeId))
    )
    .limit(1);
  if (!owned) throw new Error('conversation_forbidden');

  if (input.clientMessageId) {
    const [existing] = await db
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.conversationId, input.conversationId),
          eq(aiMessages.clientMessageId, input.clientMessageId)
        )
      )
      .limit(1);
    if (existing) return { id: existing.id, replayed: true };
  }

  const [row] = await db
    .insert(aiMessages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      contentText: input.contentText.slice(0, 20000),
      clientMessageId: input.clientMessageId ?? null,
      blocks: input.blocks ?? [],
      toolsUsed: input.toolsUsed ?? [],
    })
    .returning({ id: aiMessages.id });

  await db
    .update(aiConversations)
    .set({ updatedAt: sql`now()` })
    .where(eq(aiConversations.id, input.conversationId));

  return { id: row.id, replayed: false };
}

export async function conversationHasMessages(
  conversationId: string,
  ownerEmployeeId: string
): Promise<boolean> {
  const db = getDb();
  const [owned] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!owned) return false;
  const [row] = await db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.createdAt))
    .limit(1);
  return Boolean(row);
}

function mapConversation(row: {
  id: string;
  ownerEmployeeId: string;
  title: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ConversationRow {
  return {
    id: row.id,
    ownerEmployeeId: row.ownerEmployeeId,
    title: row.title || '對話',
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
