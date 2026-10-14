import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { departments, employees, formDefinitions, formSubmissions } from '@/lib/db/schema';
import { taipeiToday } from '@/lib/taipei-date';
import type { ProcurementFormType } from './form-registry';
import { checkPaymentTermsConsistency } from './payment-terms';

/** Designer forms (by their legacy form type) that take a step of the procurement chain. */
export const PROCUREMENT_SLOT_OF_LEGACY: Record<string, ProcurementFormType> = {
  purchase_request: 'purchase_request',
  purchase_order: 'purchase_order',
  acceptance: 'acceptance',
  expense_request: 'expense_request',
  standalone_expense_request: 'expense_request',
};

export type DesignerCaseForm = {
  caseId: string;
  id: string;
  status: string;
  slot: ProcurementFormType;
  department: { code: string; name: string } | null;
  applicantName: string | null;
};

/** Designer submissions of the procurement chain in these cases (callers check who may see them). */
export async function designerProcurementForms(caseIds: string[]): Promise<DesignerCaseForm[]> {
  if (caseIds.length === 0) return [];
  const rows = await getDb()
    .select({
      caseId: formSubmissions.procurementCaseId,
      id: formSubmissions.id,
      status: formSubmissions.status,
      legacyFormType: formDefinitions.legacyFormType,
      departmentCode: departments.code,
      departmentName: departments.name,
      applicantName: employees.name,
    })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .leftJoin(departments, eq(departments.id, formSubmissions.departmentId))
    .leftJoin(employees, eq(employees.id, formSubmissions.applicantEmployeeId))
    .where(and(inArray(formSubmissions.procurementCaseId, caseIds), inArray(formDefinitions.legacyFormType, Object.keys(PROCUREMENT_SLOT_OF_LEGACY))));
  return rows.map((r) => ({
    caseId: r.caseId,
    id: r.id,
    status: r.status,
    slot: PROCUREMENT_SLOT_OF_LEGACY[r.legacyFormType!],
    department: r.departmentCode && r.departmentName ? { code: r.departmentCode, name: r.departmentName } : null,
    applicantName: r.applicantName,
  }));
}

export type PaymentTermsCheck = { terms: string; consistent: boolean };

/**
 * 付款條件提醒 of a payment in this case: the approved designer 採購單's
 * 付款條件 (counted from its approval date) against the 期望付款日, within the
 * legacy tolerance. Null when the case has no approved designer 採購單.
 */
export async function designerPaymentTermsCheck(caseId: string, expectedPaymentDate: string | null): Promise<PaymentTermsCheck | null> {
  const [order] = await getDb()
    .select({ data: formSubmissions.data, updatedAt: formSubmissions.updatedAt })
    .from(formSubmissions)
    .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
    .where(
      and(
        eq(formSubmissions.procurementCaseId, caseId),
        eq(formSubmissions.status, 'approved'),
        eq(formDefinitions.legacyFormType, 'purchase_order')
      )
    )
    .orderBy(desc(formSubmissions.updatedAt))
    .limit(1);
  const terms = (order?.data as Record<string, unknown> | undefined)?.paymentTerms;
  if (!order || typeof terms !== 'string') return null;
  const { consistent } = checkPaymentTermsConsistency({
    paymentTerms: terms,
    orderApprovedDate: taipeiToday(order.updatedAt),
    expectedPaymentDate,
  });
  return { terms, consistent };
}
