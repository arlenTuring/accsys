import { createSupabaseServerClient } from '@/lib/supabase/server';

export type BudgetCodeListItem = {
  id: string;
  code: string;
  departmentCode: string | null;
  projectCode: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number | null;
  ownerEmployeeCode: string | null;
  ownerName: string | null;
};

export async function getBudgetCodeList(): Promise<BudgetCodeListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('budget_codes')
    .select(
      'id, code, project_code, category, fiscal_year, annual_budget_amount, department:departments(code), owner:employees!owner_employee_id(employee_code, name)'
    )
    .order('code');

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    departmentCode: (row.department as unknown as { code: string } | null)?.code ?? null,
    projectCode: row.project_code,
    category: row.category,
    fiscalYear: row.fiscal_year,
    annualBudgetAmount: row.annual_budget_amount,
    ownerEmployeeCode:
      (row.owner as unknown as { employee_code: string } | null)?.employee_code ?? null,
    ownerName: (row.owner as unknown as { name: string } | null)?.name ?? null,
  }));
}
