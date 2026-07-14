import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FORM_TYPES, FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';
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
  const supabase = await createSupabaseServerClient();

  const validFrom = isValidDate(filters.dateFrom) ? filters.dateFrom : undefined;
  const validTo = isValidDate(filters.dateTo) ? filters.dateTo : undefined;
  const dateRangeIsValid = !(validFrom && validTo && validFrom > validTo);

  let caseQuery = supabase
    .from('procurement_cases')
    .select('id, case_number')
    .order('created_at', { ascending: false });
  if (dateRangeIsValid && validFrom) {
    caseQuery = caseQuery.gte('created_at', validFrom);
  }
  if (dateRangeIsValid && validTo) {
    caseQuery = caseQuery.lte('created_at', `${validTo}T23:59:59`);
  }

  const { data: cases } = await caseQuery;
  if (!cases || cases.length === 0) return [];

  const caseIds = cases.map((c) => c.id);

  const formResultsByType = await Promise.all(
    FORM_TYPES.map(async (formType) => {
      const { data } = await supabase
        .from(FORM_TABLE[formType])
        .select(
          'id, procurement_case_id, status, departments(code, name), applicant:employees!applicant_employee_id(name)'
        )
        .in('procurement_case_id', caseIds);
      return { formType, rows: (data ?? []) as unknown as FormQueryRow[] };
    })
  );

  const formsByCaseId = new Map<string, Partial<Record<FormType, FormQueryRow>>>();
  for (const { formType, rows } of formResultsByType) {
    for (const row of rows) {
      const existing = formsByCaseId.get(row.procurement_case_id) ?? {};
      existing[formType] = row;
      formsByCaseId.set(row.procurement_case_id, existing);
    }
  }

  const rows: CaseTrackingRow[] = cases.map((c) => {
    const formsForCase = formsByCaseId.get(c.id) ?? {};
    const forms: CaseFormState[] = FORM_TYPES.map((formType) => {
      const row = formsForCase[formType];
      return { formType, exists: !!row, status: row?.status ?? null };
    });
    const firstExisting = FORM_TYPES.map((t) => formsForCase[t]).find(
      (row): row is FormQueryRow => row !== undefined
    );
    return {
      caseNumber: c.case_number,
      department: firstExisting?.departments ?? null,
      applicant: firstExisting?.applicant?.name ?? null,
      forms,
      bucket: determineCaseBucket(forms),
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
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('departments').select('code, name').order('code');
  return data ?? [];
}
