import { and, eq, lt, max, sql } from 'drizzle-orm';
import { ROLE_LABELS } from '@/app/components/form-labels';
import { getDb } from '@/lib/db';
import { approvalSteps, employees } from '@/lib/db/schema';
import { FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';

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
};

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
    };
  }

  const stepOrder = header.current_step_order;
  const [current] = await db
    .select({
      stepOrder: approvalSteps.stepOrder,
      approverEmployeeId: approvalSteps.approverEmployeeId,
      approverRole: approvalSteps.approverRole,
      stepLabel: approvalSteps.stepLabel,
      status: approvalSteps.status,
    })
    .from(approvalSteps)
    .where(
      and(
        eq(approvalSteps.formType, formType),
        eq(approvalSteps.formId, formId),
        eq(approvalSteps.stepOrder, stepOrder)
      )
    )
    .limit(1);

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
    const [emp] = await db
      .select({ name: employees.name })
      .from(employees)
      .where(eq(employees.id, current.approverEmployeeId))
      .limit(1);
    if (emp?.name) pendingApproverNames = [emp.name];
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
