import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ROLE_LABELS } from '@/app/components/form-labels';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { approvalSteps, auditEvents, employees } from '@/lib/db/schema';
import { FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';

export type TimelineNodeState = 'approved' | 'returned' | 'current' | 'waiting' | 'auto_approved' | 'skipped';

export type TimelineNode = {
  key: string;
  label: string;
  /** 指定員工 / 職務類別 / … for configured flows; null for the hard-coded chains. */
  sourceLabel: string | null;
  approverName: string | null;
  delegatedFromName: string | null;
  state: TimelineNodeState;
  actedAt: string | null;
  comment: string | null;
  systemNote: string | null;
};

export type TimelineRound = { submittedAt: string | null; endedAt: string; nodes: TimelineNode[] };

export type ApprovalTimelineData = {
  formStatus: string;
  applicantName: string;
  submittedAt: string | null;
  nodes: TimelineNode[];
  /** Earlier rounds that someone actually decided on (returned and resubmitted), oldest first. */
  previousRounds: TimelineRound[];
};

const SOURCE_LABELS: Record<string, string> = {
  employee: '指定員工',
  department_manager: '部門主管',
  department_members: '部門成員',
  org_chain: '組織層級',
  form_party: '表單關係人',
  employee_group: '員工群組',
  job_role: '職務類別',
};

type StepLike = {
  stepOrder: number;
  approverEmployeeId: string | null;
  approverRole: string;
  status: string;
  comment: string | null;
  actedAt: string | Date | null;
  stepLabel?: string | null;
  sourceKind?: string | null;
  delegatedFromEmployeeId?: string | null;
  systemNote?: string | null;
};

const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);

function toNodes(steps: StepLike[], names: Map<string, string>, live: { status: string; currentStepOrder: number | null } | null): TimelineNode[] {
  return steps.map((s) => {
    let state: TimelineNodeState;
    if (s.status === 'approved' || s.status === 'returned' || s.status === 'auto_approved' || s.status === 'skipped') state = s.status;
    else if (live && live.status === 'pending_approval' && live.currentStepOrder === s.stepOrder) state = 'current';
    else state = 'waiting';
    return {
      key: `${s.stepOrder}`,
      label: s.stepLabel ?? ROLE_LABELS[s.approverRole] ?? s.approverRole,
      sourceLabel: s.sourceKind ? (SOURCE_LABELS[s.sourceKind] ?? null) : null,
      approverName: s.approverEmployeeId ? (names.get(s.approverEmployeeId) ?? null) : null,
      delegatedFromName: s.delegatedFromEmployeeId ? (names.get(s.delegatedFromEmployeeId) ?? null) : null,
      state,
      actedAt: iso(s.actedAt),
      comment: s.comment,
      systemNote: s.systemNote ?? null,
    };
  });
}

/**
 * Approval progress of one form for the timeline: current steps plus earlier
 * rounds recovered from the audit trail (replaceSteps snapshots the previous
 * steps before each resubmission). Returns null when the viewer may not read
 * the form.
 */
export async function getApprovalTimeline(formType: FormType, formId: string): Promise<ApprovalTimelineData | null> {
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, formType, formId))) return null;
  const db = getDb();

  const [header] = await db.execute<{ status: string; current_step_order: number | null; created_at: string; applicant_name: string }>(sql`
    select f.status, f.current_step_order, f.created_at, a.name as applicant_name
      from ${sql.identifier(FORM_TABLE[formType])} f
      join employees a on a.id = f.applicant_employee_id
     where f.id = ${formId}`);
  if (!header) return null;

  const [steps, rounds] = await Promise.all([
    db
      .select({
        stepOrder: approvalSteps.stepOrder,
        approverEmployeeId: approvalSteps.approverEmployeeId,
        approverRole: approvalSteps.approverRole,
        status: approvalSteps.status,
        comment: approvalSteps.comment,
        actedAt: approvalSteps.actedAt,
        stepLabel: approvalSteps.stepLabel,
        sourceKind: approvalSteps.sourceKind,
        delegatedFromEmployeeId: approvalSteps.delegatedFromEmployeeId,
        systemNote: approvalSteps.systemNote,
      })
      .from(approvalSteps)
      .where(and(eq(approvalSteps.formType, formType), eq(approvalSteps.formId, formId)))
      .orderBy(asc(approvalSteps.stepOrder)),
    db
      .select({ occurredAt: auditEvents.occurredAt, details: auditEvents.details })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, formType),
          eq(auditEvents.entityId, formId),
          sql`${auditEvents.details} ? 'previousSteps'`
        )
      )
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id)),
  ]);

  const previous = rounds.map((r) => {
    const raw = (r.details as { previousSteps?: unknown }).previousSteps;
    return { endedAt: r.occurredAt, steps: Array.isArray(raw) ? (raw as StepLike[]) : [] };
  });

  const ids = new Set<string>();
  for (const s of [...steps, ...previous.flatMap((p) => p.steps)]) {
    if (s.approverEmployeeId) ids.add(s.approverEmployeeId);
    if (s.delegatedFromEmployeeId) ids.add(s.delegatedFromEmployeeId);
  }
  const names = new Map<string, string>();
  if (ids.size > 0) {
    const rows = await db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, [...ids]));
    for (const r of rows) names.set(r.id, r.name);
  }

  const previousRounds: TimelineRound[] = [];
  previous.forEach((p, i) => {
    if (!p.steps.some((s) => s.status === 'approved' || s.status === 'returned')) return;
    previousRounds.push({
      submittedAt: iso(i === 0 ? header.created_at : previous[i - 1].endedAt),
      endedAt: iso(p.endedAt)!,
      nodes: toNodes(p.steps, names, null),
    });
  });

  return {
    formStatus: header.status,
    applicantName: header.applicant_name,
    submittedAt: iso(previous.length > 0 ? previous[previous.length - 1].endedAt : header.created_at),
    nodes: toNodes(steps, names, { status: header.status, currentStepOrder: header.current_step_order }),
    previousRounds,
  };
}
