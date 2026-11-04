import { and, asc, eq, inArray, lt, max, sql } from 'drizzle-orm';
import { ROLE_LABELS } from '@/app/components/form-labels';
import { getDb } from '@/lib/db';
import { approvalSteps, employees } from '@/lib/db/schema';
import { FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';

export type ApprovalStepNodeState = 'done' | 'current' | 'waiting' | 'returned';

export type ApprovalStepNode = {
  key: string;
  /** Role / gate label, e.g. 申請單位主管. */
  label: string;
  /** Approver display name when known. */
  name: string | null;
  state: ApprovalStepNodeState;
};

export type ApprovalProgress = {
  /** Steps already finished (approved / auto / skipped). */
  done: number;
  /** All steps on the chain. */
  total: number;
  /** Steps still pending (including the current one). */
  remaining: number;
  /** 0–100 */
  percent: number;
  /** Ordered gates for the stepper UI. */
  steps: ApprovalStepNode[];
};

export type ApprovalSnapshot = {
  formType: FormType;
  formId: string;
  status: string;
  currentStepOrder: number | null;
  currentNodeLabel: string | null;
  pendingApproverNames: string[];
  pendingApproverIds: string[];
  waitingSinceIso: string | null;
  caseNumber: string | null;
  version: number | null;
  progress: ApprovalProgress;
};

function progressFromSteps(
  formStatus: string,
  currentStepOrder: number | null,
  steps: Array<{
    stepOrder: number;
    status: string;
    label: string;
    name: string | null;
  }>
): ApprovalProgress {
  const total = steps.length;
  if (total === 0) {
    if (formStatus === 'approved') {
      return {
        done: 1,
        total: 1,
        remaining: 0,
        percent: 100,
        steps: [{ key: '1', label: '簽核', name: null, state: 'done' }],
      };
    }
    return { done: 0, total: 0, remaining: 0, percent: 0, steps: [] };
  }

  const nodes: ApprovalStepNode[] = steps.map((s) => {
    let state: ApprovalStepNodeState;
    if (s.status === 'returned') state = 'returned';
    else if (s.status === 'approved' || s.status === 'auto_approved' || s.status === 'skipped') state = 'done';
    else if (formStatus === 'approved') state = 'done';
    else if (formStatus === 'pending_approval' && currentStepOrder != null && s.stepOrder === currentStepOrder) {
      state = 'current';
    } else state = 'waiting';
    return { key: String(s.stepOrder), label: s.label, name: s.name, state };
  });

  if (formStatus === 'approved') {
    return { done: total, total, remaining: 0, percent: 100, steps: nodes.map((n) => ({ ...n, state: 'done' })) };
  }
  const done = nodes.filter((n) => n.state === 'done').length;
  const remaining = nodes.filter((n) => n.state === 'current' || n.state === 'waiting').length;
  const percent = Math.min(100, Math.round((done / total) * 100));
  return { done, total, remaining, percent, steps: nodes };
}

/**
 * Waiting-since = max(acted_at) of prior steps, else header created_at / submitted_at.
 * Does not use the current step's created_at (future steps are often pre-inserted).
 */
export async function getFormApprovalSnapshot(
  formType: FormType,
  formId: string
): Promise<ApprovalSnapshot | null> {
  if (!FORM_TABLE[formType] || !/^[0-9a-f-]{36}$/i.test(formId)) return null;
  const db = getDb();
  const table = FORM_TABLE[formType];

  // Custom forms use form_number; legacy headers typically expose case_number.
  const [header] = await db.execute<{
    status: string;
    current_step_order: number | null;
    created_at: string;
    submitted_at: string | null;
    case_number: string | null;
    version: number | null;
  }>(
    formType === 'custom'
      ? sql`
    select f.status,
           f.current_step_order,
           f.created_at::text as created_at,
           f.submitted_at::text as submitted_at,
           f.form_number::text as case_number,
           f.version
      from form_submissions f
     where f.id = ${formId}
     limit 1`
      : sql`
    select f.status,
           f.current_step_order,
           f.created_at::text as created_at,
           null::text as submitted_at,
           coalesce(pc.case_number, '')::text as case_number,
           f.version
      from ${sql.identifier(table)} f
      left join procurement_cases pc on pc.id = f.procurement_case_id
     where f.id = ${formId}
     limit 1`
  );

  if (!header) return null;

  const allSteps = await db
    .select({
      stepOrder: approvalSteps.stepOrder,
      approverEmployeeId: approvalSteps.approverEmployeeId,
      approverRole: approvalSteps.approverRole,
      stepLabel: approvalSteps.stepLabel,
      status: approvalSteps.status,
    })
    .from(approvalSteps)
    .where(and(eq(approvalSteps.formType, formType), eq(approvalSteps.formId, formId)))
    .orderBy(asc(approvalSteps.stepOrder));

  const nameIds = [
    ...new Set(allSteps.map((s) => s.approverEmployeeId).filter((id): id is string => Boolean(id))),
  ];
  const nameRows =
    nameIds.length > 0
      ? await db
          .select({ id: employees.id, name: employees.name })
          .from(employees)
          .where(inArray(employees.id, nameIds))
      : [];
  const names = new Map(nameRows.map((r) => [r.id, r.name]));

  const labeledSteps = allSteps.map((s) => ({
    stepOrder: s.stepOrder,
    status: s.status,
    label: s.stepLabel ?? ROLE_LABELS[s.approverRole] ?? s.approverRole,
    name: s.approverEmployeeId ? (names.get(s.approverEmployeeId) ?? null) : null,
  }));

  const progress = progressFromSteps(header.status, header.current_step_order, labeledSteps);

  if (header.status !== 'pending_approval' || header.current_step_order == null) {
    return {
      formType,
      formId,
      status: header.status,
      currentStepOrder: header.current_step_order,
      currentNodeLabel: null,
      pendingApproverNames: [],
      pendingApproverIds: [],
      waitingSinceIso: null,
      caseNumber: header.case_number,
      version: header.version,
      progress,
    };
  }

  const stepOrder = header.current_step_order;
  const current = allSteps.find((s) => s.stepOrder === stepOrder) ?? null;

  const [waitRow] = await db
    .select({ waitingSince: max(approvalSteps.actedAt) })
    .from(approvalSteps)
    .where(
      and(
        eq(approvalSteps.formType, formType),
        eq(approvalSteps.formId, formId),
        lt(approvalSteps.stepOrder, stepOrder)
      )
    );

  const waitingSince =
    waitRow?.waitingSince ??
    (header.submitted_at ? new Date(header.submitted_at) : new Date(header.created_at));

  let pendingApproverNames: string[] = [];
  let pendingApproverIds: string[] = [];
  if (current?.approverEmployeeId && current.status === 'pending') {
    pendingApproverIds = [current.approverEmployeeId];
    const n = names.get(current.approverEmployeeId);
    if (n) pendingApproverNames = [n];
  }

  const currentNodeLabel = current
    ? current.stepLabel ?? ROLE_LABELS[current.approverRole] ?? current.approverRole
    : null;

  return {
    formType,
    formId,
    status: header.status,
    currentStepOrder: stepOrder,
    currentNodeLabel,
    pendingApproverNames,
    pendingApproverIds,
    waitingSinceIso: waitingSince ? new Date(waitingSince).toISOString() : null,
    caseNumber: header.case_number,
    version: header.version,
    progress,
  };
}

export function formatWaitingDuration(waitingSinceIso: string | null, now = new Date()): string | null {
  if (!waitingSinceIso) return null;
  const ms = now.getTime() - new Date(waitingSinceIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return '未滿 1 小時';
  if (hours < 48) return `${hours} 小時`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
}

/** Batch snapshots for inbox enrichment (best-effort per item). */
export async function enrichWithSnapshots<
  T extends { formType: string; id: string },
>(items: T[]): Promise<Array<T & { snapshot: ApprovalSnapshot | null }>> {
  const results = await Promise.all(
    items.map(async (item) => {
      try {
        const snapshot = await getFormApprovalSnapshot(item.formType as FormType, item.id);
        return { ...item, snapshot };
      } catch {
        return { ...item, snapshot: null };
      }
    })
  );
  return results;
}
