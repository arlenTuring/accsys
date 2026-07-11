import type { SupabaseClient } from '@supabase/supabase-js';
import { CHAIRMAN_THRESHOLD, generateApprovalChain, type ApprovalChainStep } from './chain';

export type BuildChainResult =
  | { ok: true; chain: ApprovalChainStep[] }
  | { ok: false; error: string };

export async function buildApprovalChainForForm(
  db: SupabaseClient,
  input: {
    applicantEmployeeId: string;
    departmentId: string;
    budgetOwnerEmployeeId: string;
    totalAmount: number;
  }
): Promise<BuildChainResult> {
  const { data: dept, error: deptError } = await db
    .from('departments')
    .select('manager_employee_id')
    .eq('id', input.departmentId)
    .single();
  if (deptError || !dept) {
    return { ok: false, error: '找不到申請單位資料，請聯絡系統管理員' };
  }
  if (!dept.manager_employee_id) {
    return { ok: false, error: '申請單位尚未設定主管，無法送出簽核，請聯絡系統管理員' };
  }

  const { data: gm, error: gmError } = await db
    .from('employees')
    .select('id')
    .eq('is_general_manager', true)
    .limit(1)
    .single();
  if (gmError || !gm) {
    return { ok: false, error: '系統尚未設定總經理，請聯絡系統管理員' };
  }

  let chairmanId = input.applicantEmployeeId;
  if (input.totalAmount > CHAIRMAN_THRESHOLD) {
    const { data: chairman, error: chairmanError } = await db
      .from('employees')
      .select('id')
      .eq('is_chairman', true)
      .limit(1)
      .single();
    if (chairmanError || !chairman) {
      return { ok: false, error: '系統尚未設定董事長，無法送出逾 10 萬元的表單，請聯絡系統管理員' };
    }
    chairmanId = chairman.id;
  }

  const chain = generateApprovalChain({
    applicantEmployeeId: input.applicantEmployeeId,
    departmentManagerEmployeeId: dept.manager_employee_id,
    budgetOwnerEmployeeId: input.budgetOwnerEmployeeId,
    generalManagerEmployeeId: gm.id,
    chairmanEmployeeId: chairmanId,
    totalAmount: input.totalAmount,
  });
  return { ok: true, chain };
}
