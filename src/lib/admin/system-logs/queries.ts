import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { aiConversations, aiMessages, auditEvents, departments, employees } from '@/lib/db/schema';

const timeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatLogTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return timeFmt.format(typeof d === 'string' ? new Date(d) : d);
}

export type AiUserSummary = {
  employeeId: string;
  employeeCode: string;
  name: string;
  departmentName: string | null;
  conversationCount: number;
  messageCount: number;
  lastActivityAt: Date | null;
};

/** People who have AI conversations, newest activity first. */
export async function listAiUsers(opts: { query?: string; limit?: number } = {}): Promise<AiUserSummary[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const q = opts.query?.trim();

  const rows = await db
    .select({
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      departmentName: departments.name,
      conversationCount: sql<number>`count(distinct ${aiConversations.id})::int`,
      messageCount: sql<number>`count(${aiMessages.id})::int`,
      lastActivityAt: sql<Date | null>`max(greatest(${aiConversations.updatedAt}, ${aiMessages.createdAt}))`,
    })
    .from(aiConversations)
    .innerJoin(employees, eq(employees.id, aiConversations.ownerEmployeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(aiMessages, eq(aiMessages.conversationId, aiConversations.id))
    .where(
      q
        ? or(
            ilike(employees.name, `%${q}%`),
            ilike(employees.employeeCode, `%${q}%`),
            ilike(departments.name, `%${q}%`)
          )
        : undefined
    )
    .groupBy(employees.id, employees.employeeCode, employees.name, departments.name)
    .orderBy(sql`max(greatest(${aiConversations.updatedAt}, ${aiMessages.createdAt})) desc nulls last`)
    .limit(limit);

  return rows.map((r) => ({
    employeeId: r.employeeId,
    employeeCode: r.employeeCode,
    name: r.name,
    departmentName: r.departmentName,
    conversationCount: r.conversationCount,
    messageCount: r.messageCount,
    lastActivityAt: r.lastActivityAt,
  }));
}

export type ConversationSummary = {
  id: string;
  title: string;
  archivedAt: Date | null;
  updatedAt: Date;
  messageCount: number;
};

export async function listConversationsForEmployee(employeeId: string, limit = 40): Promise<ConversationSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      archivedAt: aiConversations.archivedAt,
      updatedAt: aiConversations.updatedAt,
      messageCount: sql<number>`count(${aiMessages.id})::int`,
    })
    .from(aiConversations)
    .leftJoin(aiMessages, eq(aiMessages.conversationId, aiConversations.id))
    .where(eq(aiConversations.ownerEmployeeId, employeeId))
    .groupBy(aiConversations.id)
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);
  return rows;
}

export type ConversationMessage = {
  id: string;
  role: string;
  contentText: string;
  toolsUsed: unknown;
  blocks: unknown;
  createdAt: Date;
};

export async function listMessagesForConversation(
  conversationId: string,
  ownerEmployeeId: string
): Promise<{ conversation: ConversationSummary | null; messages: ConversationMessage[] }> {
  const db = getDb();
  const [conv] = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      archivedAt: aiConversations.archivedAt,
      updatedAt: aiConversations.updatedAt,
      messageCount: sql<number>`0::int`,
    })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!conv) return { conversation: null, messages: [] };

  const messages = await db
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      contentText: aiMessages.contentText,
      toolsUsed: aiMessages.toolsUsed,
      blocks: aiMessages.blocks,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt)
    .limit(500);

  return {
    conversation: { ...conv, messageCount: messages.length },
    messages,
  };
}

export type AuditRow = {
  id: number;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
};

export async function listAuditForEmployee(
  employeeId: string,
  opts: { limit?: number; actionPrefix?: string } = {}
): Promise<AuditRow[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 300);
  const prefix = opts.actionPrefix?.trim();

  return db
    .select({
      id: auditEvents.id,
      occurredAt: auditEvents.occurredAt,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      details: auditEvents.details,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorEmployeeId, employeeId),
        prefix ? sql`${auditEvents.action} like ${`${prefix}%`}` : undefined
      )
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit);
}

export async function getEmployeeBrief(employeeId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      departmentName: departments.name,
      role: employees.role,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, employeeId))
    .limit(1);
  return row ?? null;
}

export function actionLabel(action: string): string {
  if (action === 'ai.approve_submission') return 'AI 代為簽核';
  if (action === 'ai.return_submission') return 'AI 代為退回';
  if (action.endsWith('.step_approved')) return '簽核核准';
  if (action.endsWith('.step_returned')) return '簽核退回';
  return action;
}

export function roleLabel(role: string): string {
  if (role === 'admin') return '系統管理員';
  if (role === 'finance') return '財會';
  if (role === 'staff') return '一般員工';
  return role;
}
