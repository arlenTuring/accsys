import { createAppDb } from '@/lib/db/app-client';

export type BudgetCodeListItem = {
  id: string;
  code: string;
  departmentCode: string | null;
  departmentName: string | null;
  projectCode: string | null;
  projectName: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number | null;
  ownerEmployeeCode: string | null;
  ownerName: string | null;
};

export async function getBudgetCodeList(): Promise<BudgetCodeListItem[]> {
  const supabase = createAppDb();
  const { data } = await supabase
    .from('budget_codes')
    .select(
      'id, code, category, fiscal_year, annual_budget_amount, department:departments(code, name), project:projects(code, name), owner:employees!owner_employee_id(employee_code, name)'
    )
    .order('code');

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    departmentCode: (row.department as unknown as { code: string; name: string } | null)?.code ?? null,
    departmentName: (row.department as unknown as { code: string; name: string } | null)?.name ?? null,
    projectCode: (row.project as unknown as { code: string; name: string } | null)?.code ?? null,
    projectName: (row.project as unknown as { code: string; name: string } | null)?.name ?? null,
    category: row.category,
    fiscalYear: row.fiscal_year,
    annualBudgetAmount: row.annual_budget_amount,
    ownerEmployeeCode:
      (row.owner as unknown as { employee_code: string } | null)?.employee_code ?? null,
    ownerName: (row.owner as unknown as { name: string } | null)?.name ?? null,
  }));
}
