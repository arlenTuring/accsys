import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { departments, employees, formDefinitions, formSubmissions } from '@/lib/db/schema';
import type { ProcurementFormType } from './form-registry';

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
