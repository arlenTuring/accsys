import { and, asc, desc, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import {
  approvalSteps,
  departments,
  employees,
  invoiceSealRequestItems,
  invoiceSealRequests,
  procurementCases,
} from '@/lib/db/schema';
import { INVOICE_TYPE_LABELS } from '@/lib/invoice-seals/constants';
import { centsToNumber, toCents } from '@/lib/money';
import { getSealSteps, type SealListItem, type SealQueueItem, type SealStep } from '@/lib/seal-requests/queries';

const FORM = 'invoice_seal_request' as const;

const amount = (value: string) => centsToNumber(toCents(value));

export type InvoiceSealItem = {
  lineNo: number;
  itemName: string;
  quantity: number;
  currency: string;
  /** Decimal strings as stored, e.g. "45000.00". */
  unitPrice: string;
  amount: string;
};

export type InvoiceSealDetail = {
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
  invoiceType: string;
  seal: string;
  customerName: string;
  customerTaxId: string;
  customerAddress: string;
  customerPhone: string;
  currency: string;
  untaxedTotal: string;
  totalAmount: string;
  items: InvoiceSealItem[];
  steps: SealStep[];
};

/** Requests where I am the applicant or the one who filed it. */
export async function getMyInvoiceSealRequests(): Promise<SealListItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const rows = await getDb()
    .select({
      id: invoiceSealRequests.id,
      caseNumber: procurementCases.caseNumber,
      status: invoiceSealRequests.status,
      invoiceType: invoiceSealRequests.invoiceType,
      customerName: invoiceSealRequests.customerName,
      applicantName: employees.name,
      currency: invoiceSealRequests.currency,
      totalAmount: invoiceSealRequests.totalAmount,
      createdAt: invoiceSealRequests.createdAt,
    })
    .from(invoiceSealRequests)
    .innerJoin(procurementCases, eq(procurementCases.id, invoiceSealRequests.procurementCaseId))
    .innerJoin(employees, eq(employees.id, invoiceSealRequests.applicantEmployeeId))
    .where(or(eq(invoiceSealRequests.applicantEmployeeId, employee.id), eq(procurementCases.createdByEmployeeId, employee.id)))
    .orderBy(desc(invoiceSealRequests.createdAt));
  return rows.map(({ invoiceType, customerName, totalAmount, ...r }) => ({
    ...r,
    formType: FORM,
    title: customerName,
    documentLabel: INVOICE_TYPE_LABELS[invoiceType] ?? invoiceType,
    expectedCompletionDate: null,
    urgency: null,
    totalAmount: amount(totalAmount),
  }));
}

export async function getMyInvoiceSealApprovalQueue(): Promise<SealQueueItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const applicant = alias(employees, 'applicant');
  const rows = await getDb()
    .select({
      id: invoiceSealRequests.id,
      caseNumber: procurementCases.caseNumber,
      applicantName: applicant.name,
      currency: invoiceSealRequests.currency,
      totalAmount: invoiceSealRequests.totalAmount,
    })
    .from(approvalSteps)
    .innerJoin(invoiceSealRequests, eq(invoiceSealRequests.id, approvalSteps.formId))
    .innerJoin(procurementCases, eq(procurementCases.id, invoiceSealRequests.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, invoiceSealRequests.applicantEmployeeId))
    .where(
      and(
        eq(approvalSteps.formType, FORM),
        eq(approvalSteps.approverEmployeeId, employee.id),
        eq(approvalSteps.status, 'pending'),
        eq(invoiceSealRequests.status, 'pending_approval'),
        eq(invoiceSealRequests.currentStepOrder, approvalSteps.stepOrder)
      )
    )
    .orderBy(asc(invoiceSealRequests.createdAt));
  return rows.map((r) => ({ ...r, formType: FORM, totalAmount: amount(r.totalAmount) }));
}

export async function getInvoiceSealDetail(id: string): Promise<InvoiceSealDetail | null> {
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, FORM, id))) return null;
  const applicant = alias(employees, 'applicant');
  const filer = alias(employees, 'filer');
  const db = getDb();
  const [row] = await db
    .select({
      f: invoiceSealRequests,
      caseNumber: procurementCases.caseNumber,
      filerId: filer.id,
      filerName: filer.name,
      applicantName: applicant.name,
      departmentName: departments.name,
    })
    .from(invoiceSealRequests)
    .innerJoin(procurementCases, eq(procurementCases.id, invoiceSealRequests.procurementCaseId))
    .innerJoin(filer, eq(filer.id, procurementCases.createdByEmployeeId))
    .innerJoin(applicant, eq(applicant.id, invoiceSealRequests.applicantEmployeeId))
    .innerJoin(departments, eq(departments.id, invoiceSealRequests.departmentId))
    .where(eq(invoiceSealRequests.id, id));
  if (!row) return null;

  const [items, steps] = await Promise.all([
    db
      .select({
        lineNo: invoiceSealRequestItems.lineNo,
        itemName: invoiceSealRequestItems.itemName,
        quantity: invoiceSealRequestItems.quantity,
        currency: invoiceSealRequestItems.currency,
        unitPrice: invoiceSealRequestItems.unitPrice,
        amount: invoiceSealRequestItems.amount,
      })
      .from(invoiceSealRequestItems)
      .where(eq(invoiceSealRequestItems.invoiceSealRequestId, id))
      .orderBy(asc(invoiceSealRequestItems.lineNo)),
    getSealSteps(FORM, id),
  ]);

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
    invoiceType: f.invoiceType,
    seal: f.seal,
    customerName: f.customerName,
    customerTaxId: f.customerTaxId,
    customerAddress: f.customerAddress,
    customerPhone: f.customerPhone,
    currency: f.currency,
    untaxedTotal: f.untaxedTotal,
    totalAmount: f.totalAmount,
    items,
    steps,
  };
}
