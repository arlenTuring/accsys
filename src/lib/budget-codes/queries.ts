import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { createAppDb } from '@/lib/db/app-client';
import { isFinanceOrAdmin } from '@/lib/authz/forms';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

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
  active?: boolean;
  /** 第 2 條：統計此預算代號被單據（請購、費用、資產異動、通用表單、草稿）引用的總次數；> 0 時僅可停用不可刪除。 */
  usageCount?: number;
};

/** Everyone may pick active budget codes on forms; only finance/admin see the budget amounts and inactive codes in management. */
export async function getBudgetCodeList(opts?: {
  includeInactive?: boolean;
  includeUsage?: boolean;
}): Promise<BudgetCodeListItem[]> {
  const actor = await getCurrentEmployee();
  if (!actor) return [];
  const showAmounts = isFinanceOrAdmin(actor);
  const includeInactive = opts?.includeInactive === true;
  const includeUsage = opts?.includeUsage === true;
  const supabase = createAppDb();
  let query = supabase
    .from('budget_codes')
    .select(
      'id, code, category, fiscal_year, annual_budget_amount, active, department:departments(code, name), project:projects(code, name), owner:employees!owner_employee_id(employee_code, name)'
    );
  if (!includeInactive) {
    query = query.eq('active', true);
  }
  const { data } = await query
    .order('fiscal_year', { ascending: false })
    .order('code', { ascending: true });

  let usageByCodeId = new Map<string, number>();
  if (includeUsage && data && data.length > 0) {
    try {
      const db = getDb();
      const usageRows = await db.execute<{ budget_code_id: string; cnt: number }>(sql`
        with refs as (
          select budget_code_id from purchase_request_items where budget_code_id is not null
          union all
          select budget_code_id from expense_claims where budget_code_id is not null
          union all
          select use_budget_code_id as budget_code_id from asset_transfers where use_budget_code_id is not null
          union all
          select budget_code_id from form_submissions where budget_code_id is not null
        )
        select budget_code_id::text as budget_code_id, count(*)::int as cnt
        from refs
        group by budget_code_id
      `);
      usageByCodeId = new Map(usageRows.map((r) => [r.budget_code_id, Number(r.cnt)]));
    } catch {
      usageByCodeId = new Map();
    }
  }

  return (data ?? [])
    .filter((row) => includeInactive || (row as { active?: boolean }).active !== false)
    .map((row) => {
      const base: BudgetCodeListItem = {
        id: row.id,
        code: row.code,
        departmentCode: (row.department as unknown as { code: string; name: string } | null)?.code ?? null,
        departmentName: (row.department as unknown as { code: string; name: string } | null)?.name ?? null,
        projectCode: (row.project as unknown as { code: string; name: string } | null)?.code ?? null,
        projectName: (row.project as unknown as { code: string; name: string } | null)?.name ?? null,
        category: row.category,
        fiscalYear: row.fiscal_year,
        // numeric(14,2) arrives as a decimal string; preserve exact sign so negative values are never silently flipped.
        annualBudgetAmount:
          showAmounts && row.annual_budget_amount !== null ? Number(row.annual_budget_amount) : null,
        ownerEmployeeCode:
          (row.owner as unknown as { employee_code: string } | null)?.employee_code ?? null,
        ownerName: (row.owner as unknown as { name: string } | null)?.name ?? null,
      };
      if (includeInactive) {
        base.active = (row as { active?: boolean }).active !== false;
      }
      if (includeUsage) {
        base.usageCount = usageByCodeId.get(row.id) ?? 0;
      }
      return base;
    });
}
