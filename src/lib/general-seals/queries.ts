import { and, asc, desc, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { approvalSteps, departments, employees, generalSealRequests, procurementCases } from '@/lib/db/schema';
import { GENERAL_DOCUMENT_TYPE_LABELS } from '@/lib/general-seals/constants';
import { getSealSteps, type SealListItem, type SealQueueItem, type SealStep } from '@/lib/seal-requests/queries';

const FORM = 'general_seal_request' as const;

export type GeneralSealDetail = {
  id: string;
  caseNumber: string;
  status: string;
  version: number;
  currentStepOrder: number | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentId: string;
  departmentName: string;
  filerEmployeeId: string;
  filerName: string;
  applicationDate: string;
  urgency: string;
  expectedCompletionDate: string;
  remark: string;
  documentType: string;
  documentDescription: string;
  seals: string[];
  lendSeal: boolean;
  lendSealNote: string;
  steps: SealStep[];
};

/** Requests where I am the applicant or the one who filed it. */
export async function getMyGeneralSealRequests(): Promise<SealListItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const rows = await getDb()
    .select({
      id: generalSealRequests.id,
      caseNumber: procurementCases.caseNumber,
      status: generalSealRequests.status,
      documentType: generalSealRequests.documentType,
      documentDescription: generalSealRequests.documentDescription,
      applicantName: employees.name,
      expectedCompletionDate: generalSealRequests.expectedCompletionDate,
      urgency: generalSealRequests.urgency,
      createdAt: generalSealRequests.createdAt,
    })
    .from(generalSealRequests)
    .innerJoin(procurementCases, eq(procurementCases.id, generalSealRequests.procurementCaseId))
    .innerJoin(employees, eq(employees.id, generalSealRequests.applicantEmployeeId))
    .where(or(eq(generalSealRequests.applicantEmployeeId, employee.id), eq(procurementCases.createdByEmployeeId, employee.id)))
    .orderBy(desc(generalSealRequests.createdAt));
  return rows.map(({ documentType, documentDescription, ...r }) => ({
    ...r,
    formType: FORM,
    title: documentDescription,
    documentLabel: GENERAL_DOCUMENT_TYPE_LABELS[documentType] ?? documentType,
    totalAmount: null,
  }));
}

export async function getMyGeneralSealApprovalQueue(): Promise<SealQueueItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const applicant = alias(employees, 'applicant');
  const rows = await getDb()
    .select({ id: generalSealRequests.id, caseNumber: procurementCases.caseNumber, applicantName: applicant.name })
    .from(approvalSteps)
    .innerJoin(generalSealRequests, eq(generalSealRequests.id, approvalSteps.formId))
    .innerJoin(procurementCases, eq(procurementCases.id, generalSealRequests.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, generalSealRequests.applicantEmployeeId))
    .where(
      and(
        eq(approvalSteps.formType, FORM),
        eq(approvalSteps.approverEmployeeId, employee.id),
        eq(approvalSteps.status, 'pending'),
        eq(generalSealRequests.status, 'pending_approval'),
        eq(generalSealRequests.currentStepOrder, approvalSteps.stepOrder)
      )
    )
    .orderBy(asc(generalSealRequests.createdAt));
  return rows.map((r) => ({ ...r, formType: FORM, totalAmount: null }));
}

export async function getGeneralSealDetail(id: string): Promise<GeneralSealDetail | null> {
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, FORM, id))) return null;
  const applicant = alias(employees, 'applicant');
  const filer = alias(employees, 'filer');
  const [row] = await getDb()
    .select({
      f: generalSealRequests,
      caseNumber: procurementCases.caseNumber,
      filerId: filer.id,
      filerName: filer.name,
      applicantName: applicant.name,
      departmentName: departments.name,
    })
    .from(generalSealRequests)
    .innerJoin(procurementCases, eq(procurementCases.id, generalSealRequests.procurementCaseId))
    .innerJoin(filer, eq(filer.id, procurementCases.createdByEmployeeId))
    .innerJoin(applicant, eq(applicant.id, generalSealRequests.applicantEmployeeId))
    .innerJoin(departments, eq(departments.id, generalSealRequests.departmentId))
    .where(eq(generalSealRequests.id, id));
  if (!row) return null;

  const f = row.f;
  return {
    id: f.id,
    caseNumber: row.caseNumber,
    status: f.status,
    version: f.version,
    currentStepOrder: f.currentStepOrder,
    applicantEmployeeId: f.applicantEmployeeId,
    applicantName: row.applicantName,
    departmentId: f.departmentId,
    departmentName: row.departmentName,
    filerEmployeeId: row.filerId,
    filerName: row.filerName,
    applicationDate: f.applicationDate,
    urgency: f.urgency,
    expectedCompletionDate: f.expectedCompletionDate,
    remark: f.remark,
    documentType: f.documentType,
    documentDescription: f.documentDescription,
    seals: f.seals,
    lendSeal: f.lendSeal,
    lendSealNote: f.lendSealNote,
    steps: await getSealSteps(FORM, id),
  };
}
