'use server';

import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  MAX_BUDGET_FILE_BYTES,
  parseBudgetWorkbook,
  type ParsedBudgetRow,
} from '@/lib/budget-codes/parse-budget-workbook';

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

const MAX_BUDGET_AMOUNT = 999_999_999_999;

function badText(value: unknown, max: number, required: boolean): boolean {
  if (value === null || value === undefined) return required;
  if (typeof value !== 'string' || value.length > max) return true;
  return required && value.trim() === '';
}

/** Budget-code changes decide who signs as 預算負責人, so every change is audited. */
async function auditBudget(actorId: string, action: string, entityId: string | null, details: Record<string, unknown>) {
  await recordAudit(getDb(), { actorEmployeeId: actorId, action, entityType: 'budget_code', entityId, details });
}

async function upsertOneBudgetCode(
  db: ReturnType<typeof createAppDb>,
  input: BudgetCodeInput,
  actorId: string
): Promise<UpsertResult> {
  if (!input || typeof input !== 'object') return { ok: false, error: '資料格式不正確' };
  if (
    badText(input.code, 50, false) ||
    badText(input.departmentCode, 50, false) ||
    badText(input.projectCode, 50, false) ||
    badText(input.category, 100, false) ||
    badText(input.fiscalYear, 20, false) ||
    badText(input.ownerEmployeeCode, 50, false)
  ) {
    return { ok: false, error: '欄位格式不正確或過長' };
  }
  if (!input.code?.trim()) return { ok: false, error: '預算編號為必填' };
  const hasDept = !!input.departmentCode;
  const hasProject = !!input.projectCode;
  if (hasDept === hasProject) {
    return { ok: false, error: '部門代碼與專案代碼必須恰填一項' };
  }
  if (!input.category?.trim()) return { ok: false, error: '類別為必填' };
  if (!input.fiscalYear?.trim()) return { ok: false, error: '年度為必填' };
  const amount = input.annualBudgetAmount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !(amount > 0)) {
    return { ok: false, error: '年度預算金額必須為正數' };
  }
  if (amount > MAX_BUDGET_AMOUNT) return { ok: false, error: '年度預算金額超出上限' };

  let departmentId: string | null = null;
  let projectId: string | null = null;
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
  } else {
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('code', input.projectCode)
      .maybeSingle();
    if (!project) {
      return { ok: false, error: `專案代碼「${input.projectCode}」查無此專案，請先在專案管理新增` };
    }
    projectId = project.id;
  }

  if (input.ownerEmployeeCode) {
    const { data: owner } = await db
      .from('employees')
      .select('id, access_enabled')
      .eq('employee_code', input.ownerEmployeeCode)
      .maybeSingle();
    if (!owner) return { ok: false, error: `負責人工號「${input.ownerEmployeeCode}」查無此員工` };
    if (!owner.access_enabled) return { ok: false, error: `負責人工號「${input.ownerEmployeeCode}」的帳號已停用` };
    ownerEmployeeId = owner.id;
  }

  const { data: previous } = await db
    .from('budget_codes')
    .select('id, department_id, project_id, category, fiscal_year, annual_budget_amount, owner_employee_id')
    .eq('code', input.code)
    .maybeSingle();

  const { data, error } = await db
    .from('budget_codes')
    .upsert(
      {
        code: input.code,
        department_id: departmentId,
        project_id: projectId,
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
  await auditBudget(actorId, previous ? 'budget_code.updated' : 'budget_code.created', data.id, {
    code: input.code,
    before: previous ?? null,
    after: {
      department_id: departmentId,
      project_id: projectId,
      category: input.category,
      fiscal_year: input.fiscalYear,
      annual_budget_amount: input.annualBudgetAmount,
      owner_employee_id: ownerEmployeeId,
    },
  });
  return { ok: true, budgetCodeId: data.id };
}

export async function upsertBudgetCode(input: BudgetCodeInput): Promise<UpsertResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護預算編號' };
  }

  const db = createAppDb();
  const result = await upsertOneBudgetCode(db, input, employee.id);
  if (result.ok) revalidatePath('/budget-codes');
  return result;
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteBudgetCode(budgetCodeId: string): Promise<DeleteResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護預算編號' };
  }

  if (!isUuid(budgetCodeId)) return { ok: false, error: '找不到這個預算編號' };

  const db = createAppDb();
  const { count } = await db
    .from('purchase_request_items')
    .select('id', { count: 'exact', head: true })
    .eq('budget_code_id', budgetCodeId);
  if ((count ?? 0) > 0) {
    return { ok: false, error: '此預算編號已被請購單使用，無法刪除' };
  }

  const { data: previous } = await db
    .from('budget_codes')
    .select('id, code, department_id, project_id, category, fiscal_year, annual_budget_amount, owner_employee_id')
    .eq('id', budgetCodeId)
    .maybeSingle();
  const { error } = await db.from('budget_codes').delete().eq('id', budgetCodeId);
  if (error) return { ok: false, error: '刪除預算編號失敗' };
  if (previous) await auditBudget(employee.id, 'budget_code.deleted', budgetCodeId, { before: previous });
  revalidatePath('/budget-codes');
  return { ok: true };
}

export type ImportRowError = { row: number; reason: string };
export type ImportSummary = { successCount: number; errors: ImportRowError[] };
export type ImportOutcome = { ok: true; summary: ImportSummary } | { ok: false; error: string };

export async function importBudgetCodesFromExcel(formData: FormData): Promise<ImportOutcome> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護預算編號' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: '請選擇檔案' };
  if (file.size > MAX_BUDGET_FILE_BYTES) return { ok: false, error: 'Excel 檔案不可超過 5 MB' };

  let rows: ParsedBudgetRow[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    rows = await parseBudgetWorkbook(buffer);
  } catch {
    return { ok: false, error: '無法解析此 Excel 檔案，請確認格式是否正確' };
  }

  const db = createAppDb();
  const errors: ImportRowError[] = [];
  let successCount = 0;

  for (const row of rows) {
    if (row.annualBudgetAmount === null) {
      errors.push({ row: row.rowNumber, reason: '年度預算金額必須為正數' });
      continue;
    }
    const result = await upsertOneBudgetCode(
      db,
      {
        code: row.code,
        departmentCode: row.departmentCode,
        projectCode: row.projectCode,
        category: row.category,
        fiscalYear: row.fiscalYear,
        annualBudgetAmount: Math.abs(row.annualBudgetAmount),
        ownerEmployeeCode: row.ownerEmployeeCode,
      },
      employee.id
    );
    if (result.ok) {
      successCount += 1;
    } else {
      errors.push({ row: row.rowNumber, reason: result.error });
    }
  }

  revalidatePath('/budget-codes');
  return { ok: true, summary: { successCount, errors } };
}
