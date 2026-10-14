import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { isFinanceOrAdmin } from '@/lib/authz/forms';
import { designerProcurementForms } from '@/lib/procurement/designer-forms';
import { FORM_TABLE, PROCUREMENT_FORM_TYPES, type ProcurementFormType } from '@/lib/procurement/form-registry';
import { determineCaseBucket, type CaseBucket, type CaseFormState } from './determine-bucket';

export type CaseTrackingFilters = {
  departmentCode?: string;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
};

export type CaseTrackingRow = {
  caseNumber: string;
  department: { code: string; name: string } | null;
  applicant: string | null;
  forms: CaseFormState[];
  bucket: CaseBucket;
};

export type DepartmentOption = { code: string; name: string };

type FormQueryRow = {
  id: string;
  procurement_case_id: string;
  status: string;
  departments: { code: string; name: string } | null;
  applicant: { name: string } | null;
};

function isValidDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function getFinanceCaseTracking(
  filters: CaseTrackingFilters
): Promise<CaseTrackingRow[]> {
  // Company-wide view: finance and admin only, enforced here as well as on the page.
  if (!isFinanceOrAdmin(await getCurrentEmployee())) return [];
  const supabase = createAppDb();

  const validFrom = isValidDate(filters.dateFrom) ? filters.dateFrom : undefined;
  const validTo = isValidDate(filters.dateTo) ? filters.dateTo : undefined;
  const dateRangeIsValid = !(validFrom && validTo && validFrom > validTo);

  let caseQuery = supabase
    .from('procurement_cases')
    .select('id, case_number, case_type')
    // Travel expenses carry a case number but are not procurement cases.
    .in('case_type', ['standard', 'standalone_expense'])
    .order('created_at', { ascending: false });
  if (dateRangeIsValid && validFrom) {
    caseQuery = caseQuery.gte('created_at', `${validFrom}T00:00:00+08:00`);
  }
  if (dateRangeIsValid && validTo) {
    caseQuery = caseQuery.lte('created_at', `${validTo}T23:59:59+08:00`);
  }

  const { data: cases, error: casesError } = await caseQuery;
  if (casesError) throw casesError;
  if (!cases || cases.length === 0) return [];

  const caseIds = cases.map((c) => c.id);

  const formResultsByType = await Promise.all(
    PROCUREMENT_FORM_TYPES.map(async (formType) => {
      const { data, error } = await supabase
        .from(FORM_TABLE[formType])
        .select(
          'id, procurement_case_id, status, departments(code, name), applicant:employees!applicant_employee_id(name)'
        )
        .in('procurement_case_id', caseIds);
      if (error) throw error;
      return { formType, rows: (data ?? []) as unknown as FormQueryRow[] };
    })
  );

  const formsByCaseId = new Map<string, Partial<Record<ProcurementFormType, FormQueryRow>>>();
  for (const { formType, rows } of formResultsByType) {
    for (const row of rows) {
      const existing = formsByCaseId.get(row.procurement_case_id) ?? {};
      existing[formType] = row;
      formsByCaseId.set(row.procurement_case_id, existing);
    }
  }
  for (const f of await designerProcurementForms(caseIds)) {
    const existing = formsByCaseId.get(f.caseId) ?? {};
    existing[f.slot] ??= {
      id: f.id,
      procurement_case_id: f.caseId,
      status: f.status,
      departments: f.department,
      applicant: f.applicantName === null ? null : { name: f.applicantName },
    };
    formsByCaseId.set(f.caseId, existing);
  }

  const rows: CaseTrackingRow[] = cases.map((c) => {
    const formsForCase = formsByCaseId.get(c.id) ?? {};
    const forms: CaseFormState[] = PROCUREMENT_FORM_TYPES.map((formType) => {
      const row = formsForCase[formType];
      return { formType, exists: !!row, status: row?.status ?? null };
    });
    const firstExisting = PROCUREMENT_FORM_TYPES.map((t) => formsForCase[t]).find(
      (row): row is FormQueryRow => row !== undefined
    );
    return {
      caseNumber: c.case_number,
      department: firstExisting?.departments ?? null,
      applicant: firstExisting?.applicant?.name ?? null,
      forms,
      bucket: determineCaseBucket(forms, c.case_type as 'standard' | 'standalone_expense'),
    };
  });

  const keyword = filters.keyword?.trim();

  return rows.filter((row) => {
    if (filters.departmentCode && row.department?.code !== filters.departmentCode) return false;
    if (keyword && !row.caseNumber.includes(keyword) && !(row.applicant ?? '').includes(keyword)) {
      return false;
    }
    return true;
  });
}

export async function getDepartmentFilterOptions(): Promise<DepartmentOption[]> {
  const supabase = createAppDb();
  const { data, error } = await supabase.from('departments').select('code, name').order('code');
  if (error) throw error;
  return (data ?? []) as DepartmentOption[];
}
