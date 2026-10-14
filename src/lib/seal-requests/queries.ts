import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { approvalSteps, departments, employees } from '@/lib/db/schema';
import type { SealFormType } from '@/lib/procurement/form-registry';

export type SealPartyOptions = {
  employees: { id: string; name: string; departmentId: string; departmentName: string }[];
  departments: { id: string; name: string }[];
};

export type SealStep = {
  stepOrder: number;
  approverEmployeeId: string | null;
  approverName: string;
  approverRole: string;
  status: string;
  comment: string | null;
};

/** One row of the 用印申請 list, whichever form it is. */
export type SealListItem = {
  formType: SealFormType;
  id: string;
  caseNumber: string;
  status: string;
  title: string;
  documentLabel: string;
  applicantName: string;
  /** Invoice seal requests have no deadline or urgency. */
  expectedCompletionDate: string | null;
  urgency: string | null;
  /** Null for non-contract seal requests, which carry no amount. */
  totalAmount: number | null;
  /** ISO code of totalAmount; absent means NT$. */
  currency?: string;
  createdAt: Date;
};

export type SealQueueItem = {
  formType: SealFormType;
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number | null;
  currency?: string;
};

/** 申請人 / 部門 choices (active employees only). */
export async function getSealPartyOptions(): Promise<SealPartyOptions> {
  const db = getDb();
  const [people, depts] = await Promise.all([
    db
      .select({ id: employees.id, name: employees.name, departmentId: employees.departmentId, departmentName: departments.name })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.accessEnabled, true))
      .orderBy(asc(departments.name), asc(employees.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.name)),
  ]);
  return { employees: people, departments: depts };
}

/** Keeps a since-disabled applicant selectable when editing their form. */
export function withApplicant(
  parties: SealPartyOptions,
  form: { applicantEmployeeId: string; applicantName: string; departmentId: string; departmentName: string }
): SealPartyOptions {
  if (parties.employees.some((e) => e.id === form.applicantEmployeeId)) return parties;
  const applicant = {
    id: form.applicantEmployeeId,
    name: form.applicantName,
    departmentId: form.departmentId,
    departmentName: form.departmentName,
  };
  return { ...parties, employees: [applicant, ...parties.employees] };
}

/** Caller must have checked read access to the form. */
export function getSealSteps(formType: SealFormType, formId: string): Promise<SealStep[]> {
  return getDb()
    .select({
      stepOrder: approvalSteps.stepOrder,
      approverEmployeeId: approvalSteps.approverEmployeeId,
      approverName: employees.name,
      approverRole: approvalSteps.approverRole,
      status: approvalSteps.status,
      comment: approvalSteps.comment,
    })
    .from(approvalSteps)
    .innerJoin(employees, eq(employees.id, approvalSteps.approverEmployeeId))
    .where(and(eq(approvalSteps.formType, formType), eq(approvalSteps.formId, formId)))
    .orderBy(asc(approvalSteps.stepOrder));
}