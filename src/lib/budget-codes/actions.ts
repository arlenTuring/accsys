'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type BudgetCodeInput = {
  code: string;
  departmentCode: string | null;
  projectCode: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number;
  ownerEmployeeCode: string | null;
};

export type UpsertResult = { ok: true; budgetCodeId: string } | { ok: false; error: string };

async function upsertOneBudgetCode(
  db: ReturnType<typeof createSupabaseServiceRoleClient>,
  input: BudgetCodeInput
): Promise<UpsertResult> {
  if (!input.code.trim()) return { ok: false, error: '預算編號為必填' };
  const hasDept = !!input.departmentCode;
  const hasProject = !!input.projectCode;
  if (hasDept === hasProject) {
    return { ok: false, error: '部門代碼與專案代碼必須恰填一項' };
  }
  if (!input.category.trim()) return { ok: false, error: '類別為必填' };
  if (!input.fiscalYear.trim()) return { ok: false, error: '年度為必填' };
  if (!(input.annualBudgetAmount > 0)) {
    return { ok: false, error: '年度預算金額必須為正數' };
  }

  let departmentId: string | null = null;
  let ownerEmployeeId: string | null = null;

  if (hasDept) {
    const { data: dept } = await db
      .from('departments')
      .select('id, manager_employee_id')
      .eq('code', input.departmentCode)
      .maybeSingle();
    if (!dept) return { ok: false, error: `部門代碼「${input.departmentCode}」查無此部門` };
    departmentId = dept.id;
    ownerEmployeeId = dept.manager_employee_id;
  }

  if (input.ownerEmployeeCode) {
    const { data: owner } = await db
      .from('employees')
      .select('id')
      .eq('employee_code', input.ownerEmployeeCode)
      .maybeSingle();
    if (!owner) return { ok: false, error: `負責人工號「${input.ownerEmployeeCode}」查無此員工` };
    ownerEmployeeId = owner.id;
  }

  const { data, error } = await db
    .from('budget_codes')
    .upsert(
      {
        code: input.code,
        department_id: departmentId,
        project_code: hasProject ? input.projectCode : null,
        category: input.category,
        fiscal_year: input.fiscalYear,
        annual_budget_amount: input.annualBudgetAmount,
        owner_employee_id: ownerEmployeeId,
      },
      { onConflict: 'code' }
    )
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: '寫入預算編號失敗' };
  return { ok: true, budgetCodeId: data.id };
}

export async function upsertBudgetCode(input: BudgetCodeInput): Promise<UpsertResult> {
  const employee = await getCurrentEmployee(await createSupabaseServerClient());
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance') return { ok: false, error: '只有財會人員可以維護預算編號' };

  const db = createSupabaseServiceRoleClient();
  const result = await upsertOneBudgetCode(db, input);
  if (result.ok) revalidatePath('/budget-codes');
  return result;
}
