import { and, eq, sql } from 'drizzle-orm';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import { aiNudgeEvents, notifications } from '@/lib/db/schema';
import { FORM_TABLE, type FormType, FORM_TYPES } from '@/lib/procurement/form-registry';
import { taipeiToday } from '@/lib/taipei-date';
import { runInTransaction, abort, type Outbox } from '@/lib/workflow/tx';
import { getFormApprovalSnapshot } from './approval-snapshot';

export type NudgePreview = {
  formType: FormType;
  formId: string;
  caseNumber: string;
  recipientIds: string[];
  recipientNames: string[];
  alreadyNudgedToday: boolean;
  nudgedAtIso: string | null;
  canNudge: boolean;
  reason?: string;
};

function isFormType(v: string): v is FormType {
  return (FORM_TYPES as readonly string[]).includes(v);
}

async function loadApplicantId(formType: FormType, formId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.execute<{ applicant_employee_id: string }>(sql`
    select applicant_employee_id from ${sql.identifier(FORM_TABLE[formType])} where id = ${formId} limit 1`);
  return row?.applicant_employee_id ?? null;
}

export async function previewNudge(formTypeRaw: string, formId: string): Promise<NudgePreview | null> {
  if (!isFormType(formTypeRaw) || !/^[0-9a-f-]{36}$/i.test(formId)) return null;
  const formType = formTypeRaw;
  const actor = await getCurrentEmployee();
  if (!actor) return null;
  if (!(await canReadForm(actor, formType, formId))) return null;

  const applicantId = await loadApplicantId(formType, formId);
  // Default policy: only the applicant may nudge.
  if (!applicantId || applicantId !== actor.id) {
    return {
      formType,
      formId,
      caseNumber: '',
      recipientIds: [],
      recipientNames: [],
      alreadyNudgedToday: false,
      nudgedAtIso: null,
      canNudge: false,
      reason: '僅申請人可催簽。',
    };
  }

  const snap = await getFormApprovalSnapshot(formType, formId);
  if (!snap || snap.status !== 'pending_approval' || snap.pendingApproverIds.length === 0) {
    return {
      formType,
      formId,
      caseNumber: snap?.caseNumber ?? '',
      recipientIds: [],
      recipientNames: [],
      alreadyNudgedToday: false,
      nudgedAtIso: null,
      canNudge: false,
      reason: '目前沒有待簽核節點，無法催簽。',
    };
  }

  const businessDate = taipeiToday();
  const db = getDb();
  const [existing] = await db
    .select({ id: aiNudgeEvents.id, createdAt: aiNudgeEvents.createdAt, status: aiNudgeEvents.status })
    .from(aiNudgeEvents)
    .where(
      and(
        eq(aiNudgeEvents.formType, formType),
        eq(aiNudgeEvents.formId, formId),
        eq(aiNudgeEvents.businessDate, businessDate)
      )
    )
    .limit(1);

  return {
    formType,
    formId,
    caseNumber: snap.caseNumber ?? '',
    recipientIds: snap.pendingApproverIds,
    recipientNames: snap.pendingApproverNames,
    alreadyNudgedToday: Boolean(existing),
    nudgedAtIso: existing?.createdAt?.toISOString?.() ?? null,
    canNudge: !existing,
    reason: existing ? '此單今日已催簽過（Asia/Taipei 曆日）。' : undefined,
  };
}

/**
 * One nudge per (formType, formId, Taipei businessDate) system-wide.
 * Creates in-app notifications with a date-scoped event_key so workflow
 * approval_requested dedupe does not swallow daily reminders.
 */
export async function executeNudge(input: {
  formType: string;
  formId: string;
}): Promise<
  | {
      ok: true;
      status: 'notified' | 'already_today';
      eventId: string;
      recipientNames: string[];
      businessDate: string;
    }
  | { ok: false; error: string; code?: string }
> {
  const preview = await previewNudge(input.formType, input.formId);
  if (!preview) return { ok: false, error: '找不到單據或無權限。', code: 'forbidden' };
  if (!preview.canNudge && preview.alreadyNudgedToday) {
    const db = getDb();
    const [row] = await db
      .select({ id: aiNudgeEvents.id })
      .from(aiNudgeEvents)
      .where(
        and(
          eq(aiNudgeEvents.formType, preview.formType),
          eq(aiNudgeEvents.formId, preview.formId),
          eq(aiNudgeEvents.businessDate, taipeiToday())
        )
      )
      .limit(1);
    return {
      ok: true,
      status: 'already_today',
      eventId: row?.id ?? '',
      recipientNames: preview.recipientNames,
      businessDate: taipeiToday(),
    };
  }
  if (!preview.canNudge) {
    return { ok: false, error: preview.reason ?? '無法催簽。', code: 'forbidden' };
  }

  const actor = await getCurrentEmployee();
  if (!actor) return { ok: false, error: '請先登入。', code: 'unauthenticated' };

  const businessDate = taipeiToday();
  const result = await runInTransaction('ai_chat.nudge', async (tx, outbox) => {
    // Re-check status inside the transaction.
    const snap = await getFormApprovalSnapshot(preview.formType, preview.formId);
    if (!snap || snap.status !== 'pending_approval' || snap.pendingApproverIds.length === 0) {
      abort('conflict', '簽核狀態已變更，無法催簽。');
    }

    const inserted = await tx
      .insert(aiNudgeEvents)
      .values({
        formType: preview.formType,
        formId: preview.formId,
        businessDate,
        actorEmployeeId: actor.id,
        recipients: snap!.pendingApproverIds.map((id, i) => ({
          employeeId: id,
          name: snap!.pendingApproverNames[i] ?? null,
        })),
        status: 'queued',
      })
      .onConflictDoNothing()
      .returning({ id: aiNudgeEvents.id });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ id: aiNudgeEvents.id })
        .from(aiNudgeEvents)
        .where(
          and(
            eq(aiNudgeEvents.formType, preview.formType),
            eq(aiNudgeEvents.formId, preview.formId),
            eq(aiNudgeEvents.businessDate, businessDate)
          )
        )
        .limit(1);
      return {
        ok: true as const,
        status: 'already_today' as const,
        eventId: existing!.id,
        recipientNames: preview.recipientNames,
        businessDate,
      };
    }

    const eventId = inserted[0].id;
    const caseNumber = snap!.caseNumber ?? preview.caseNumber;
    const version = snap!.version ?? 1;

    for (let i = 0; i < snap!.pendingApproverIds.length; i++) {
      const recipientEmployeeId = snap!.pendingApproverIds[i];
      const eventKey = `${preview.formType}:${preview.formId}:v${version}:approval_requested:${recipientEmployeeId}:nudge:${businessDate}`;
      const message = `提醒：${caseNumber} 仍待您簽核（申請人透過 AI 助手催簽）`;
      const notified = await tx
        .insert(notifications)
        .values({
          recipientEmployeeId,
          type: 'approval_requested',
          formType: preview.formType,
          formId: preview.formId,
          caseNumber,
          message,
          eventKey,
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (notified.length > 0) {
        (outbox as Outbox).push({
          recipientEmployeeId,
          subject: `【催簽提醒】${caseNumber}`,
          text: message,
        });
      }
    }

    await tx
      .update(aiNudgeEvents)
      .set({ status: 'notified' })
      .where(eq(aiNudgeEvents.id, eventId));

    await recordAudit(tx, {
      actorEmployeeId: actor.id,
      action: 'ai_assistant.nudge',
      entityType: preview.formType,
      entityId: preview.formId,
      details: {
        eventId,
        businessDate,
        recipients: snap!.pendingApproverIds,
        caseNumber,
      },
    });

    return {
      ok: true as const,
      status: 'notified' as const,
      eventId,
      recipientNames: snap!.pendingApproverNames,
      businessDate,
    };
  });

  if (!result.ok) return { ok: false, error: result.error, code: result.code };
  return result;
}
