import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { canReadForm, type Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { aiAssistantEventAcks, notifications } from '@/lib/db/schema';
import { FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { factsFor, factsLine, loadFormFacts, loadReturnReason, type FormFacts } from './form-facts';

export type LauncherEvent = {
  eventKey: string;
  kind: 'approval_requested' | 'nudge' | 'request_returned' | 'request_rejected' | 'request_approved';
  title: string;
  body: string;
  formType?: string;
  formId?: string;
  caseNumber?: string;
  href?: string;
  /** Returned or rejected: what the approver wrote, or `missing` when nothing was recorded. */
  reason?: { short: string; full: string; missing: boolean };
  /** Only a form still in `returned` can be corrected by its owner. */
  canResubmit?: boolean;
  /** First time any tab or device received this event; only fresh events open the panel. */
  fresh: boolean;
  createdAt: string;
  /** System-generated vs model-rewritten */
  source: 'system';
};

const REASON_MAX = 60;
const NO_REASON = '退回時未提供原因';

function formHref(formType: string, formId: string): string | undefined {
  if (formType in FORM_ROUTE_PREFIX) return `${FORM_ROUTE_PREFIX[formType as FormType]}/${formId}`;
  return undefined;
}

/** Older rows keep the reason only in the message text. */
function reasonFromMessage(message: string): string | null {
  const at = message.indexOf('已被退回：');
  if (at < 0) return null;
  const text = message.slice(at + '已被退回：'.length).trim();
  return text && text !== 'undefined' ? text : null;
}

export function describeEvent(input: {
  type: string;
  nudge: boolean;
  message: string;
  facts: FormFacts | null;
  reason: string | null;
  viewerId: string;
}): Pick<LauncherEvent, 'kind' | 'title' | 'body' | 'reason' | 'canResubmit'> {
  const { facts, message } = input;
  const label = facts?.label ?? '單據';
  const line = facts ? factsLine(facts) : '';

  if (input.type === 'request_returned') {
    const rejected = facts?.status === 'rejected';
    const full = input.reason ?? reasonFromMessage(message);
    const reason = full
      ? { short: full.length > REASON_MAX ? `${full.slice(0, REASON_MAX - 1)}…` : full, full, missing: false }
      : { short: NO_REASON, full: NO_REASON, missing: true };
    const owner = Boolean(facts && (facts.applicantId === input.viewerId || facts.filerId === input.viewerId));
    return {
      kind: rejected ? 'request_rejected' : 'request_returned',
      title: `${label}${rejected ? '已被拒絕' : '已被退回'}`,
      body: [line, `原因：${reason.short}`].filter(Boolean).join('\n'),
      reason,
      canResubmit: !rejected && facts?.status === 'returned' && owner,
    };
  }
  if (input.type === 'request_approved') {
    return { kind: 'request_approved', title: `${label}已核准`, body: line || message.slice(0, 280) };
  }
  const who = facts?.applicantName ? `${facts.applicantName} 申請` : '';
  const body = [who, line].filter(Boolean).join('｜') || message.slice(0, 280);
  return input.nudge
    ? { kind: 'nudge', title: `催簽提醒：${label}`, body }
    : { kind: 'approval_requested', title: `待您簽核：${label}`, body };
}

const eventKeyOf = sql<string>`coalesce(${notifications.eventKey}, 'notif:' || ${notifications.id}::text)`;

const PAGE = 40;

/**
 * One page of unread reminders. `fresh` returns those no tab or device has
 * received yet and marks them delivered in the same statement, so a reconnect
 * or a second device cannot pop the same event twice. `delivered` restores what
 * is still open after a reload, without popping. Discovery does not depend on a
 * time cursor: rows with equal timestamps, or committed late, are still found.
 * No model calls.
 */
export async function pollLauncherEvents(input: {
  actor: NonNullable<Actor>;
  scope: 'fresh' | 'delivered';
  after?: string | null;
  limit?: number;
}): Promise<{ events: LauncherEvent[]; hasMore: boolean; nextAfter: string | null }> {
  const db = getDb();
  const limit = Math.min(Math.max(input.limit ?? PAGE, 1), PAGE);
  const clauses = [
    eq(notifications.recipientEmployeeId, input.actor.id),
    eq(notifications.isRead, false),
    input.scope === 'fresh' ? isNull(aiAssistantEventAcks.eventKey) : eq(aiAssistantEventAcks.state, 'delivered'),
  ];
  const [afterTs, afterId] = (input.after ?? '').split('|');
  if (afterTs && afterId) {
    clauses.push(sql`(${notifications.createdAt}, ${notifications.id}) > (${afterTs}::timestamptz, ${afterId}::uuid)`);
  }

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      formType: notifications.formType,
      formId: notifications.formId,
      caseNumber: notifications.caseNumber,
      message: notifications.message,
      eventKey: eventKeyOf,
      createdAt: notifications.createdAt,
      createdAtText: sql<string>`${notifications.createdAt}::text`,
    })
    .from(notifications)
    .leftJoin(
      aiAssistantEventAcks,
      and(eq(aiAssistantEventAcks.employeeId, input.actor.id), eq(aiAssistantEventAcks.eventKey, eventKeyOf))
    )
    .where(and(...clauses))
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  let claimed = new Set<string>();
  if (input.scope === 'fresh' && page.length > 0) {
    const inserted = await db
      .insert(aiAssistantEventAcks)
      .values(page.map((r) => ({ employeeId: input.actor.id, eventKey: r.eventKey, state: 'delivered', updatedAt: sql`now()` })))
      .onConflictDoNothing()
      .returning({ eventKey: aiAssistantEventAcks.eventKey });
    claimed = new Set(inserted.map((r) => r.eventKey));
  }
  const visible = input.scope === 'fresh' ? page.filter((r) => claimed.has(r.eventKey)) : page;

  // A summary is shown only while the person can still read the form.
  const readable = [];
  for (const r of visible) {
    if (await canReadForm(input.actor, r.formType, r.formId)) readable.push(r);
  }
  const facts = await loadFormFacts(readable);

  const events: LauncherEvent[] = [];
  for (const r of visible) {
    const f = readable.includes(r) ? factsFor(facts, r) : null;
    const reason = f && r.type === 'request_returned' ? await loadReturnReason(r) : null;
    events.push({
      eventKey: r.eventKey,
      ...describeEvent({ type: r.type, nudge: r.eventKey.includes(':nudge:'), message: r.message ?? '', facts: f, reason, viewerId: input.actor.id }),
      formType: r.formType,
      formId: r.formId,
      caseNumber: r.caseNumber ?? undefined,
      href: formHref(r.formType, r.formId),
      fresh: input.scope === 'fresh',
      createdAt: r.createdAt.toISOString(),
      source: 'system',
    });
  }

  return {
    events,
    hasMore: rows.length > limit,
    nextAfter: last ? `${last.createdAtText}|${last.id}` : (input.after ?? null),
  };
}

export async function ackLauncherEvents(input: {
  employeeId: string;
  eventKeys: string[];
  state: 'viewed' | 'dismissed' | 'muted';
}): Promise<void> {
  const keys = [...new Set(input.eventKeys.map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 200))].slice(0, 500);
  if (keys.length === 0) return;
  await getDb()
    .insert(aiAssistantEventAcks)
    .values(keys.map((eventKey) => ({ employeeId: input.employeeId, eventKey, state: input.state, updatedAt: sql`now()` })))
    .onConflictDoUpdate({
      target: [aiAssistantEventAcks.employeeId, aiAssistantEventAcks.eventKey],
      set: { state: input.state, updatedAt: sql`now()` },
    });
}
