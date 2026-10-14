import { and, asc, desc, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { DOCUMENT_TYPE_LABELS } from '@/lib/contract-seals/constants';
import { getDb } from '@/lib/db';
import { approvalSteps, contractSealRequests, departments, employees, procurementCases } from '@/lib/db/schema';
import { getSealSteps, type SealListItem, type SealQueueItem, type SealStep } from '@/lib/seal-requests/queries';

const FORM = 'contract_seal_request' as const;

export type ContractSealDetail = {
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
  seals: string[];
  periodStart: string;
  periodEnd: string;
  totalAmount: string;
  counterparty: string;
  subject: string;
  ndaChecks: string[];
  mouChecks: string[];
  legalReviewConfirmed: boolean;
  lendSeal: boolean;
  lendSealNote: string;
  steps: SealStep[];
};

/** Requests where I am the applicant or the one who filed it. */
export async function getMyContractSealRequests(): Promise<SealListItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const rows = await getDb()
    .select({
      id: contractSealRequests.id,
      caseNumber: procurementCases.caseNumber,
      status: contractSealRequests.status,
      documentType: contractSealRequests.documentType,
      counterparty: contractSealRequests.counterparty,
      subject: contractSealRequests.subject,
      applicantName: employees.name,
      expectedCompletionDate: contractSealRequests.expectedCompletionDate,
      urgency: contractSealRequests.urgency,
      totalAmount: contractSealRequests.totalAmount,
      createdAt: contractSealRequests.createdAt,
    })
    .from(contractSealRequests)
    .innerJoin(procurementCases, eq(procurementCases.id, contractSealRequests.procurementCaseId))
    .innerJoin(employees, eq(employees.id, contractSealRequests.applicantEmployeeId))
    .where(
      or(eq(contractSealRequests.applicantEmployeeId, employee.id), eq(procurementCases.createdByEmployeeId, employee.id))
    )
    .orderBy(desc(contractSealRequests.createdAt));
  return rows.map(({ documentType, counterparty, subject, totalAmount, ...r }) => ({
    ...r,
    formType: FORM,
    title: `${counterparty}｜${subject}`,
    documentLabel: DOCUMENT_TYPE_LABELS[documentType] ?? documentType,
    totalAmount: Number(totalAmount),
  }));
}

export async function getMyContractSealApprovalQueue(): Promise<SealQueueItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const applicant = alias(employees, 'applicant');
  const rows = await getDb()
    .select({
      id: contractSealRequests.id,
      caseNumber: procurementCases.caseNumber,
      applicantName: applicant.name,
      totalAmount: contractSealRequests.totalAmount,
    })
    .from(approvalSteps)
    .innerJoin(contractSealRequests, eq(contractSealRequests.id, approvalSteps.formId))
    .innerJoin(procurementCases, eq(procurementCases.id, contractSealRequests.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, contractSealRequests.applicantEmployeeId))
    .where(
      and(
        eq(approvalSteps.formType, FORM),
        eq(approvalSteps.approverEmployeeId, employee.id),
        eq(approvalSteps.status, 'pending'),
        eq(contractSealRequests.status, 'pending_approval'),
        eq(contractSealRequests.currentStepOrder, approvalSteps.stepOrder)
      )
    )
    .orderBy(asc(contractSealRequests.createdAt));
  return rows.map((r) => ({ ...r, formType: FORM, totalAmount: Number(r.totalAmount) }));
}

export async function getContractSealDetail(id: string): Promise<ContractSealDetail | null> {
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, FORM, id))) return null;
  const applicant = alias(employees, 'applicant');
  const filer = alias(employees, 'filer');
  const [row] = await getDb()
    .select({
      f: contractSealRequests,
      caseNumber: procurementCases.caseNumber,
      filerId: filer.id,
      filerName: filer.name,
      applicantName: applicant.name,
      departmentName: departments.name,
    })
    .from(contractSealRequests)
    .innerJoin(procurementCases, eq(procurementCases.id, contractSealRequests.procurementCaseId))
    .innerJoin(filer, eq(filer.id, procurementCases.createdByEmployeeId))
    .innerJoin(applicant, eq(applicant.id, contractSealRequests.applicantEmployeeId))
    .innerJoin(departments, eq(departments.id, contractSealRequests.departmentId))
    .where(eq(contractSealRequests.id, id));
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
    seals: f.seals,
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    totalAmount: f.totalAmount,
    counterparty: f.counterparty,
    subject: f.subject,
    ndaChecks: f.ndaChecks,
    mouChecks: f.mouChecks,
    legalReviewConfirmed: f.legalReviewConfirmed,
    lendSeal: f.lendSeal,
    lendSealNote: f.lendSealNote,
    steps: await getSealSteps(FORM, id),
  };
}
