import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { aiAssistantEventAcks, notifications } from '@/lib/db/schema';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';

export type LauncherEventItem = {
  eventKey: string;
  title: string;
  body: string;
  caseNumber?: string;
  href?: string;
};

export type LauncherEvent = {
  eventKey: string;
  kind: 'approval_requested' | 'request_returned' | 'request_approved' | 'digest';
  title: string;
  body: string;
  formType?: string;
  formId?: string;
  caseNumber?: string;
  href?: string;
  /** When kind=digest: per-form lines with action links */
  items?: LauncherEventItem[];
  createdAt: string;
  /** System-generated vs model-rewritten */
  source: 'system';
};

function kindTitle(kind: LauncherEvent['kind']): string {
  if (kind === 'approval_requested') return '有新的待簽核事項';
  if (kind === 'request_returned') return '單據已退回';
  if (kind === 'request_approved') return '單據已核准';
  if (kind === 'digest') return '系統通知';
  return '系統通知';
}

function formHref(formType: string, formId: string): string | undefined {
  if (formType in FORM_ROUTE_PREFIX) {
    return `${FORM_ROUTE_PREFIX[formType as FormType]}/${formId}`;
  }
  if (formType === 'custom') return `/f/_/${formId}`;
  return undefined;
}

function formLabel(formType: string): string {
  return formType in FORM_LABELS ? FORM_LABELS[formType as FormType] : formType === 'custom' ? '表單' : formType;
}

/**
 * Incremental poll of durable notifications for the global compact helper.
 * No model calls — simple receipts only.
 */
export async function pollLauncherEvents(input: {
  employeeId: string;
  cursorCreatedAt?: string | null;
  limit?: number;
}): Promise<{ events: LauncherEvent[]; nextCursor: string | null }> {
  const db = getDb();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 40);
  const clauses = [eq(notifications.recipientEmployeeId, input.employeeId)];
  if (input.cursorCreatedAt) {
    const d = new Date(input.cursorCreatedAt);
    if (!Number.isNaN(d.getTime())) {
      clauses.push(gt(notifications.createdAt, d));
    }
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...clauses))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  // Newest first from query; present oldest-first for UI merge.
  const chronological = [...rows].reverse();

  const ackKeys = chronological.map((r) => r.eventKey ?? `notif:${r.id}`);
  const acked = new Set<string>();
  if (ackKeys.length > 0) {
    const ackRows = await db
      .select({ eventKey: aiAssistantEventAcks.eventKey })
      .from(aiAssistantEventAcks)
      .where(
        and(
          eq(aiAssistantEventAcks.employeeId, input.employeeId),
          inArray(aiAssistantEventAcks.eventKey, ackKeys)
        )
      );
    for (const a of ackRows) acked.add(a.eventKey);
  }

  const events: LauncherEvent[] = [];
  for (const r of chronological) {
    const eventKey = r.eventKey ?? `notif:${r.id}`;
    if (acked.has(eventKey)) continue;
    const label = formLabel(r.formType);
    const href = formHref(r.formType, r.formId);
    const kind = r.type as LauncherEvent['kind'];
    const casePart = r.caseNumber ? `${r.caseNumber} ` : '';
    const message = (r.message || '').trim();
    // Prefer human message; never leave body as bare case numbers only.
    const body =
      message.length > 0
        ? message.slice(0, 280)
        : `${label} ${casePart}`.trim() || kindTitle(kind);

    events.push({
      eventKey,
      kind: kind === 'digest' ? 'approval_requested' : kind,
      title: kindTitle(kind === 'digest' ? 'approval_requested' : kind),
      body,
      formType: r.formType,
      formId: r.formId,
      caseNumber: r.caseNumber ?? undefined,
      href,
      createdAt: r.createdAt.toISOString(),
      source: 'system',
    });
  }

  // Soft merge when many: keep readable per-item lines + links (not bare IDs).
  let out = events;
  if (events.length > 3) {
    const items: LauncherEventItem[] = events.map((e) => ({
      eventKey: e.eventKey,
      title: e.title,
      body: e.body,
      caseNumber: e.caseNumber,
      href: e.href,
    }));
    out = [
      {
        eventKey: `digest:${events
          .map((e) => e.eventKey)
          .join('|')
          .slice(0, 180)}`,
        kind: 'digest',
        title: `有 ${events.length} 則新進度`,
        body: `共 ${events.length} 則待處理通知，請點各單連結查看。`,
        items,
        createdAt: events[events.length - 1]!.createdAt,
        source: 'system',
      },
    ];
  }

  const newest = chronological[chronological.length - 1];
  return {
    events: out,
    nextCursor: newest ? newest.createdAt.toISOString() : input.cursorCreatedAt ?? null,
  };
}

export async function ackLauncherEvents(input: {
  employeeId: string;
  eventKeys: string[];
  state: 'viewed' | 'dismissed' | 'muted';
}): Promise<void> {
  const db = getDb();
  const keys = [...new Set(input.eventKeys.map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 200))].slice(
    0,
    40
  );
  for (const eventKey of keys) {
    await db
      .insert(aiAssistantEventAcks)
      .values({
        employeeId: input.employeeId,
        eventKey,
        state: input.state,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [aiAssistantEventAcks.employeeId, aiAssistantEventAcks.eventKey],
        set: { state: input.state, updatedAt: sql`now()` },
      });
  }
}
