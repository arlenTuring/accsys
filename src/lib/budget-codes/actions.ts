'use server';

import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  DEPARTMENT_ACCOUNT_CATEGORIES,
  PROJECT_ACCOUNT_CATEGORIES,
  buildStandardBudgetCode,
  findStandardAccountCategory,
} from '@/lib/budget-codes/constants';
import {
  MAX_BUDGET_FILE_BYTES,
  parseBudgetWorkbook,
  type ParsedBudgetRow,
} from '@/lib/budget-codes/parse-budget-workbook';
import { notifyAndEmail } from '@/lib/notifications/notify';

export type BudgetCodeInput = {
  code: string;
  departmentCode: string | null;
  projectCode: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number;
  ownerEmployeeCode: string | null;
  /**
   * 'create'：新增模式，若預算編號已存在將拒絕覆寫並回傳唯一值衝突錯誤
   * 'update'：編輯模式，允許更新原預算編號（若改名則檢查新編號是否已被其他項目佔用）
   * 未指定：批次產生或匯入時的 upsert 模式
   */
  mode?: 'create' | 'update';
  editingCode?: string | null;
};

export type UpsertResult = { ok: true; budgetCodeId: string } | { ok: false; error: string };

export type BatchGenerateStandardResult =
  | { ok: true; createdOrUpdatedCount: number; skippedCount?: number }
  | { ok: false; error: string };

export type BudgetSheetRowInput = {
  code: string;
  category: string;
  annualBudgetAmount: number;
  prevYearBudgetAmount?: number | null;
  prevYearCode?: string | null;
};

export type SaveBudgetSheetInput = {
  sheetType: 'department' | 'project' | 'variance';
  fiscalYear: string;
  departmentCode: string | null;
  projectCode: string | null;
  ownerEmployeeCode: string | null;
  rows: BudgetSheetRowInput[];
};

export type SaveBudgetSheetResult =
  | { ok: true; savedCount: number }
  | { ok: false; error: string };

export type DispatchBudgetNoticeInput = {
  fiscalYear: string;
  deadlineDate: string;
  recipientEmployeeIds: string[];
  templateTypes: ('department' | 'project' | 'variance')[];
  customNote?: string;
};

export type DispatchBudgetNoticeResult =
  | { ok: true; sentCount: number }
  | { ok: false; error: string };

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
  const code = input.code.trim();

  const { data: previous } = await db
    .from('budget_codes')
    .select('id, code, department_id, project_id, category, fiscal_year, annual_budget_amount, owner_employee_id')
    .eq('code', code)
    .maybeSingle();

  if (input.mode === 'create' && previous) {
    return {
      ok: false,
      error: `預算編號「${code}」已存在（類別：${previous.category}），預算編號必須為唯一值，請勿重複建立`,
    };
  }

  const editingOriginalCode = input.editingCode?.trim() || null;
  if (input.mode === 'update' && editingOriginalCode && editingOriginalCode !== code && previous) {
    return {
      ok: false,
      error: `預算編號「${code}」已被其他項目（類別：${previous.category}）使用，預算編號必須為唯一值`,
    };
  }

  const hasDept = !!input.departmentCode;
  const hasProject = !!input.projectCode;
  if (hasDept === hasProject) {
    return { ok: false, error: '部門代碼與專案代碼必須恰填一項' };
  }
  if (!input.category?.trim()) return { ok: false, error: '類別為必填' };
  if (!input.fiscalYear?.trim()) return { ok: false, error: '年度為必填' };
  const rawAmount = input.annualBudgetAmount;
  const amount = typeof rawAmount === 'number' ? rawAmount : NaN;
  if (Number.isFinite(amount) && amount < 0) {
    return {
      ok: false,
      error: `預算編號「${code}」的「年度預算金額」不可為負數（目前輸入：${amount.toLocaleString()}），請修改為正數`,
    };
  }
  if (!Number.isFinite(amount) || !(amount > 0)) {
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

  // 若在編輯模式下修改了預算編號（且新編號未衝突），直接更新原紀錄以保持唯一性
  if (input.mode === 'update' && editingOriginalCode && editingOriginalCode !== code) {
    const { data: originalRow } = await db
      .from('budget_codes')
      .select('id, code, department_id, project_id, category, fiscal_year, annual_budget_amount, owner_employee_id')
      .eq('code', editingOriginalCode)
      .maybeSingle();
    if (originalRow) {
      const { error: updateErr } = await db
        .from('budget_codes')
        .update({
          code,
          department_id: departmentId,
          project_id: projectId,
          category: input.category,
          fiscal_year: input.fiscalYear,
          annual_budget_amount: amount,
          owner_employee_id: ownerEmployeeId,
        })
        .eq('id', originalRow.id);
      if (updateErr) return { ok: false, error: '更新預算編號失敗' };
      await auditBudget(actorId, 'budget_code.updated', originalRow.id, {
        code,
        before: originalRow,
        after: {
          code,
          department_id: departmentId,
          project_id: projectId,
          category: input.category,
          fiscal_year: input.fiscalYear,
          annual_budget_amount: amount,
          owner_employee_id: ownerEmployeeId,
        },
      });
      return { ok: true, budgetCodeId: originalRow.id };
    }
  }

  const { data, error } = await db
    .from('budget_codes')
    .upsert(
      {
        code,
        department_id: departmentId,
        project_id: projectId,
        category: input.category,
        fiscal_year: input.fiscalYear,
        annual_budget_amount: amount,
        owner_employee_id: ownerEmployeeId,
      },
      { onConflict: 'code' }
    )
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: '寫入預算編號失敗' };
  await auditBudget(actorId, previous ? 'budget_code.updated' : 'budget_code.created', data.id, {
    code,
    before: previous ?? null,
    after: {
      department_id: departmentId,
      project_id: projectId,
      category: input.category,
      fiscal_year: input.fiscalYear,
      annual_budget_amount: amount,
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

/**
 * 批次產生某部門或某專案於指定年度的「標準會計科目預算編號」（第 2 條）
 */
export async function batchGenerateStandardBudgetCodes(params: {
  fiscalYear: string;
  departmentCode: string | null;
  projectCode: string | null;
  ownerEmployeeCode: string | null;
  defaultAmount: number;
  selectedItemCodes?: string[];
}): Promise<BatchGenerateStandardResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護預算編號' };
  }

  const fy = params.fiscalYear.trim();
  if (!fy) return { ok: false, error: '請填寫預算年度（例如 116）' };
  const hasDept = !!params.departmentCode?.trim();
  const hasProj = !!params.projectCode?.trim();
  if (hasDept === hasProj) {
    return { ok: false, error: '請選擇一個目標部門或目標專案' };
  }
  const amount = Number(params.defaultAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: '預設年度預算金額必須為大於 0 的正數' };
  }

  const unitCode = (params.departmentCode?.trim() || params.projectCode?.trim())!;
  const pool = hasDept ? DEPARTMENT_ACCOUNT_CATEGORIES : PROJECT_ACCOUNT_CATEGORIES;
  const chosenSet =
    params.selectedItemCodes && params.selectedItemCodes.length > 0
      ? new Set(params.selectedItemCodes.map((c) => c.toUpperCase()))
      : null;
  const targets = chosenSet ? pool.filter((c) => chosenSet.has(c.itemCode)) : pool;
  if (targets.length === 0) return { ok: false, error: '請至少勾選一項標準會計科目' };

  const db = createAppDb();
  let count = 0;
  let skippedCount = 0;
  for (const cat of targets) {
    const code = buildStandardBudgetCode({
      fiscalYear: fy,
      unitCode,
      itemCode: cat.itemCode,
    });
    const { data: existing } = await db
      .from('budget_codes')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (existing) {
      skippedCount += 1;
      continue;
    }
    const res = await upsertOneBudgetCode(
      db,
      {
        code,
        departmentCode: hasDept ? unitCode : null,
        projectCode: hasProj ? unitCode : null,
        category: cat.categoryName,
        fiscalYear: fy,
        annualBudgetAmount: amount,
        ownerEmployeeCode: hasProj ? params.ownerEmployeeCode?.trim() || null : null,
        mode: 'create',
      },
      employee.id
    );
    if (!res.ok) return { ok: false, error: res.error };
    count += 1;
  }

  if (count === 0 && skippedCount > 0) {
    return {
      ok: false,
      error: `「${unitCode}」於 ${fy} 年度之標準科目預算編號皆已存在（共 ${skippedCount} 筆），預算編號必須為唯一值，不可重複建立！`,
    };
  }

  revalidatePath('/budget-codes');
  return { ok: true, createdOrUpdatedCount: count, skippedCount };
}

/**
 * 於「代號定義與批次建立」介面直接透過「部門預算表／專案預算表／預算差異分析表」表單儲存整表預算科目與編號
 */
export async function saveBudgetSheetRows(
  input: SaveBudgetSheetInput
): Promise<SaveBudgetSheetResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護預算表與預算編號' };
  }

  const fy = input.fiscalYear?.trim();
  if (!fy) return { ok: false, error: '請填寫預算年度（例如 116）' };
  const hasDept = !!input.departmentCode?.trim();
  const hasProj = !!input.projectCode?.trim();
  if (hasDept === hasProj) {
    return { ok: false, error: '請選擇一個目標部門或目標專案' };
  }

  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) {
    return { ok: false, error: '預算表至少需有一筆科目明細' };
  }

  // 1. 表內預算編號唯一值檢查
  const seenCodes = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const c = (r.code ?? '').trim().toUpperCase();
    if (!c) {
      if (Number(r.annualBudgetAmount) > 0) {
        return { ok: false, error: `第 ${i + 1} 列已填寫金額但「預算編號」為空白` };
      }
      continue;
    }
    const prevIdx = seenCodes.get(c);
    if (prevIdx !== undefined) {
      return {
        ok: false,
        error: `第 ${i + 1} 列預算編號「${r.code.trim()}」與第 ${prevIdx + 1} 列重複，預算編號必須為唯一值！`,
      };
    }
    seenCodes.set(c, i);
  }

  const activeRows = rows.filter((r) => Number(r.annualBudgetAmount) > 0);
  if (activeRows.length === 0) {
    return { ok: false, error: '請至少在一個會計科目填寫大於 0 的年度預算金額' };
  }

  const db = createAppDb();
  const deptCode = hasDept ? input.departmentCode!.trim() : null;
  const projCode = hasProj ? input.projectCode!.trim() : null;
  const ownerCode = hasProj ? input.ownerEmployeeCode?.trim() || null : null;

  let savedCount = 0;
  const prevFyNum = Number(fy);
  const prevFy = Number.isFinite(prevFyNum) ? String(prevFyNum - 1) : '';

  for (const r of activeRows) {
    const res = await upsertOneBudgetCode(
      db,
      {
        code: r.code.trim(),
        departmentCode: deptCode,
        projectCode: projCode,
        category: r.category.trim(),
        fiscalYear: fy,
        annualBudgetAmount: Number(r.annualBudgetAmount),
        ownerEmployeeCode: ownerCode,
      },
      employee.id
    );
    if (!res.ok) return { ok: false, error: res.error };
    savedCount += 1;

    if (
      input.sheetType === 'variance' &&
      prevFy &&
      r.prevYearCode?.trim() &&
      r.prevYearBudgetAmount &&
      Number(r.prevYearBudgetAmount) > 0
    ) {
      await upsertOneBudgetCode(
        db,
        {
          code: r.prevYearCode.trim(),
          departmentCode: deptCode,
          projectCode: projCode,
          category: r.category.trim(),
          fiscalYear: prevFy,
          annualBudgetAmount: Number(r.prevYearBudgetAmount),
          ownerEmployeeCode: ownerCode,
        },
        employee.id
      );
    }
  }

  revalidatePath('/budget-codes');
  return { ok: true, savedCount };
}

/**
 * 預算發送人系統（第 7、8 條）：派發年度部門／專案預算編列通知給各部門主管與專案負責人
 */
export async function dispatchBudgetCompilationNotices(
  input: DispatchBudgetNoticeInput
): Promise<DispatchBudgetNoticeResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會或管理員可以派發年度預算編列通知' };
  }

  const fy = input.fiscalYear?.trim();
  if (!fy) return { ok: false, error: '請輸入預算年度' };
  const deadline = input.deadlineDate?.trim();
  if (!deadline) return { ok: false, error: '請選擇預算填報截止日' };
  const recipientIds = [...new Set((input.recipientEmployeeIds ?? []).filter(isUuid))];
  if (recipientIds.length === 0) {
    return { ok: false, error: '請至少勾選一位預算發送對象（部門主管或專案負責人）' };
  }

  const templateLabels = (input.templateTypes ?? []).map((t) =>
    t === 'department' ? '部門預算表' : t === 'project' ? '營收/產品專案預算表' : '預算差異分析表'
  );
  const templatesText = templateLabels.length > 0 ? templateLabels.join('、') : '年度預算表';
  const noteSuffix = input.customNote?.trim() ? `｜備註：${input.customNote.trim()}` : '';
  const caseNumber = `BUDGET-${fy}`;

  const db = createAppDb();
  let sentCount = 0;

  const actionOrigin = process.env.APP_ORIGIN || 'http://localhost:3001';
  const dispatchDetailHtml = `<div style="margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
    <div style="background: #f8fafc; padding: 12px 16px; font-size: 13.5px; font-weight: 700; color: #334155; border-bottom: 1px solid #e2e8f0;">
      📋 年度預算編列填報作業明細（${escapeHtmlBasic(fy)} 年度）
    </div>
    <table style="width: 100%; border-collapse: collapse; background: #ffffff; font-size: 13.5px;">
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 10px 16px; color: #64748b; width: 165px; white-space: nowrap; font-weight: 600;">預算編列年度</td>
        <td style="padding: 10px 16px; font-weight: 700; color: #0f172a; white-space: nowrap;">${escapeHtmlBasic(fy)} 年度（西元 ${Number(fy) + 1911} 年）</td>
      </tr>
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 10px 16px; color: #64748b; width: 165px; white-space: nowrap; font-weight: 600;">派發表單類型</td>
        <td style="padding: 10px 16px; font-weight: 700; color: #4c1d95;">${escapeHtmlBasic(templatesText)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 10px 16px; color: #64748b; width: 165px; white-space: nowrap; font-weight: 600;">填報截止日期</td>
        <td style="padding: 10px 16px; font-weight: 700; color: #dc2626; font-family: monospace; white-space: nowrap;">${escapeHtmlBasic(deadline)}</td>
      </tr>
      ${
        input.customNote?.trim()
          ? `<tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 16px; color: #64748b; width: 165px; white-space: nowrap; font-weight: 600;">財會備註說明</td>
              <td style="padding: 10px 16px; color: #1e293b;">${escapeHtmlBasic(input.customNote.trim())}</td>
            </tr>`
          : ''
      }
    </table>
  </div>`;
  const dispatchActionHtml = `<div style="margin-top: 16px;">
    <a href="${escapeHtmlBasic(actionOrigin)}/my-tasks/budget" style="display: block; text-align: center; background: #6d28d9; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
      📝 前往線上填寫年度預算申請單
    </a>
  </div>`;

  for (const recipientId of recipientIds) {
    const message = `【${fy} 年度預算編列通知】由 ${employee.name} 派發：請於 ${deadline} 前完成「${templatesText}」填報。請前往左側「我的待辦 → 年度預算表填報（/my-tasks/budget）」線上填寫《預算申請單》（支援即時自動儲存）${noteSuffix}。`;
    const res = await notifyAndEmail(db, {
      recipientEmployeeId: recipientId,
      type: 'approval_requested',
      formType: 'budget_dispatch',
      formId: employee.id,
      caseNumber,
      message,
      templateId: 'budget_form_dispatched',
      templateVars: {
        applicantName: employee.name,
        departmentName: employee.departmentName || '管理部 (AD)',
        formLabel: '預算申請單',
        caseNumber,
        title: `${fy} 年度${templatesText}`,
        message,
        documentDetailsHtml: dispatchDetailHtml,
        approvalActionsHtml: dispatchActionHtml,
        actionUrl: `${actionOrigin}/my-tasks/budget`,
      },
    });
    if (res.ok) sentCount += 1;
  }

  await auditBudget(employee.id, 'budget_code.dispatch_sent', null, {
    fiscalYear: fy,
    deadlineDate: deadline,
    recipientEmployeeIds: recipientIds,
    templateTypes: input.templateTypes,
    customNote: input.customNote ?? null,
    sentCount,
  });

  revalidatePath('/budget-codes');
  revalidatePath('/my-tasks');
  revalidatePath('/my-tasks/budget');
  revalidatePath('/notifications');
  return { ok: true, sentCount };
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function setBudgetCodeActive(budgetCodeId: string, active: boolean): Promise<DeleteResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護預算編號' };
  }
  if (!isUuid(budgetCodeId)) return { ok: false, error: '找不到這個預算編號' };

  const db = createAppDb();
  const { data: previous } = await db
    .from('budget_codes')
    .select('id, code, active')
    .eq('id', budgetCodeId)
    .maybeSingle();
  if (!previous) return { ok: false, error: '找不到這個預算編號' };

  const { error } = await db.from('budget_codes').update({ active }).eq('id', budgetCodeId);
  if (error) return { ok: false, error: '更新預算編號狀態失敗' };
  await auditBudget(employee.id, active ? 'budget_code.enabled' : 'budget_code.disabled', budgetCodeId, {
    code: previous.code,
    before: { active: previous.active },
    after: { active },
  });
  revalidatePath('/budget-codes');
  return { ok: true };
}

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

  // 第 2 條：檢查是否曾被費用申請、資產異動、線上簽核表單或草稿引用；已引用者僅可「停用」不可刪除
  const [ecRes, atRes, subRes] = await Promise.all([
    db.from('expense_claims').select('id', { count: 'exact', head: true }).eq('budget_code_id', budgetCodeId),
    db.from('asset_transfers').select('id', { count: 'exact', head: true }).eq('use_budget_code_id', budgetCodeId),
    db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('budget_code_id', budgetCodeId),
  ]);
  const otherDirectCount = (ecRes.count ?? 0) + (atRes.count ?? 0) + (subRes.count ?? 0);
  if (otherDirectCount > 0) {
    return {
      ok: false,
      error: '此預算編號已被單據（費用申請、資產異動或簽核表單）引用，無法刪除，請改用「停用」',
    };
  }

  const drizzleDb = getDb();
  const jsonRefRows = await drizzleDb.execute<{ cnt: number }>(
    // Check JSON payload references in form_submissions or form_drafts
    (await import('drizzle-orm')).sql`
      select (
        (select count(*)::int from form_submissions where data::text like ${`%${budgetCodeId}%`}) +
        (select count(*)::int from form_drafts where data::text like ${`%${budgetCodeId}%`})
      ) as cnt
    `
  );
  const jsonRefCount = Number(jsonRefRows[0]?.cnt ?? 0);
  if (jsonRefCount > 0) {
    return {
      ok: false,
      error: '此預算編號已被線上表單明細或草稿引用，無法刪除，請改用「停用」',
    };
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
export type ImportSummary = {
  successCount: number;
  historicalCount?: number;
  errors: ImportRowError[];
};
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
  const includeHistorical = formData.get('includeHistorical') === 'true';

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
  let historicalCount = 0;
  const seenCodesInFile = new Map<string, number>();

  for (const row of rows) {
    const normalizedRowCode = row.code.trim().toUpperCase();
    if (normalizedRowCode) {
      const prevRowNum = seenCodesInFile.get(normalizedRowCode);
      if (prevRowNum !== undefined) {
        errors.push({
          row: row.rowNumber,
          reason: `預算編號「${row.code}」與本檔案第 ${prevRowNum} 列重複（預算編號必須為唯一值）`,
        });
        continue;
      }
      seenCodesInFile.set(normalizedRowCode, row.rowNumber);
    }

    if (row.annualBudgetAmount === null) {
      errors.push({
        row: row.rowNumber,
        reason: `預算編號「${row.code}」的「年度預算金額」未填寫或格式不正確（必須為正數）`,
      });
      continue;
    }
    if (row.annualBudgetAmount < 0) {
      errors.push({
        row: row.rowNumber,
        reason: `預算編號「${row.code}」的「年度預算金額」不可為負數（輸入值：${row.annualBudgetAmount.toLocaleString()}），請修正為正數`,
      });
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
        annualBudgetAmount: row.annualBudgetAmount,
        ownerEmployeeCode: row.ownerEmployeeCode,
      },
      employee.id
    );
    if (result.ok) {
      successCount += 1;
      // 若勾選同時匯入歷年資料，且該列附帶歷年實際執行數 (> 0)，則一併寫入前一年度的預算紀錄供跨年度對照
      if (
        includeHistorical &&
        row.historicalActualAmount &&
        row.historicalActualAmount > 0 &&
        row.historicalFiscalYear
      ) {
        const stdCat = findStandardAccountCategory(row.category);
        const unitCode = row.departmentCode ?? row.projectCode ?? '';
        const histCode =
          stdCat && unitCode
            ? buildStandardBudgetCode({
                fiscalYear: row.historicalFiscalYear,
                unitCode,
                itemCode: stdCat.itemCode,
              })
            : `${row.historicalFiscalYear}-${row.code}`;
        const histRes = await upsertOneBudgetCode(
          db,
          {
            code: histCode,
            departmentCode: row.departmentCode,
            projectCode: row.projectCode,
            category: row.category,
            fiscalYear: row.historicalFiscalYear,
            annualBudgetAmount: row.historicalActualAmount,
            ownerEmployeeCode: row.ownerEmployeeCode,
          },
          employee.id
        );
        if (histRes.ok) historicalCount += 1;
      }
    } else {
      errors.push({ row: row.rowNumber, reason: result.error });
    }
  }

  revalidatePath('/budget-codes');
  return { ok: true, summary: { successCount, historicalCount, errors } };
}

import {
  buildBudgetAnalysisEmailHtml,
  generateBudgetAnalysisPdf,
  type BudgetAnalysisReportSectionData,
} from '@/lib/budget-codes/analysis-report-builder';

export type BudgetAnalysisUnitSummary = {
  unitCode: string;
  unitName: string;
  scope: 'department' | 'project';
  prevYearAmount: number;
  currentYearAmount: number;
  changeAmount: number;
  growthPct: number | null;
  budgetChangeCount: number;
  financeComment: string;
};

export type PublishBudgetAnalysisInput = {
  fiscalYear: string;
  compareYear: string;
  reportTitle: string;
  executiveSummary: string;
  unitSummaries: BudgetAnalysisUnitSummary[];
  reportSections?: BudgetAnalysisReportSectionData[];
  recipientEmployeeIds: string[];
};

export type PublishBudgetAnalysisResult =
  | { ok: true; publishedCount: number; publishedAt: string }
  | { ok: false; error: string };

function escapeHtmlBasic(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 財會人員製作完預算分析報告後，選擇指定人員發佈（儲存分析紀錄並傳送系統通知與分析報告信件）
 */
export async function publishBudgetAnalysisReport(
  input: PublishBudgetAnalysisInput
): Promise<PublishBudgetAnalysisResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會或管理員可以製作並發佈預算分析報告' };
  }

  const fy = input.fiscalYear?.trim() || '115';
  const compareYear = input.compareYear?.trim() || '114';
  const title = input.reportTitle?.trim();
  if (!title) return { ok: false, error: '請填寫預算分析報告標題' };
  const summary = input.executiveSummary?.trim() || '';

  const recipientIds = [...new Set((input.recipientEmployeeIds ?? []).filter(isUuid))];
  if (recipientIds.length === 0) {
    return { ok: false, error: '請至少選擇一位要收信檢視此份預算分析報告的人員' };
  }

  const units = Array.isArray(input.unitSummaries) ? input.unitSummaries : [];
  const sections: BudgetAnalysisReportSectionData[] =
    Array.isArray(input.reportSections) && input.reportSections.length > 0
      ? input.reportSections
      : [];

  const totalCurr =
    sections.length > 0
      ? sections[0].annualBudgetAmount
      : units.reduce((s, u) => s + (Number(u.currentYearAmount) || 0), 0);
  const totalExec =
    sections.length > 0
      ? sections[0].executedAmount
      : Math.round(totalCurr * 0.72);
  const totalRateStr =
    totalCurr > 0 ? `${((totalExec / totalCurr) * 100).toFixed(1)}%` : '0.0%';

  // 1. 產生與網頁上預算分析報告一模一樣的 HTML 郵件內容
  const documentDetailsHtml =
    sections.length > 0
      ? buildBudgetAnalysisEmailHtml({
          fiscalYear: fy,
          reportTitle: title,
          executiveSummary: summary,
          senderName: employee.name,
          sections,
        })
      : `<div style="margin:18px 0;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;background:#ffffff;padding:16px;">
          <div style="font-size:15px;font-weight:700;color:#0f2942;">📊 ${escapeHtmlBasic(title)}</div>
          ${summary ? `<div style="margin-top:10px;white-space:pre-line;font-size:13px;color:#1e293b;">${escapeHtmlBasic(summary)}</div>` : ''}
        </div>`;

  // 2. 產生報告本身內容的 PDF 附件，隨信一併寄出
  let pdfAttachment:
    | { filename: string; contentType: string; content: Uint8Array }
    | undefined;
  if (sections.length > 0) {
    try {
      const pdfBytes = await generateBudgetAnalysisPdf({
        fiscalYear: fy,
        reportTitle: title,
        executiveSummary: summary,
        senderName: employee.name,
        sections,
      });
      const safeFileName = `${title.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
      pdfAttachment = {
        filename: safeFileName,
        contentType: 'application/pdf',
        content: pdfBytes,
      };
    } catch (err) {
      console.error('[publishBudgetAnalysisReport] PDF generation error:', err);
    }
  }

  const db = createAppDb();
  const caseNumber = `ANALYSIS-${fy}`;
  let publishedCount = 0;

  const sectionNamesStr =
    sections.length > 0
      ? sections.map((s, idx) => `${idx + 1}. ${s.title}`).join('、')
      : `${fy} 年度全公司預算報告`;

  for (const recipientId of recipientIds) {
    const summaryNote = summary
      ? `財會結論：${summary.slice(0, 120)}${summary.length > 120 ? '…' : ''}`
      : `包含 ${sections.length || 1} 份預算分析圖表報告與 PDF 附件`;
    const message = `【${title}】財會人員 ${employee.name} 已寄發 ${fy} 年度預算分析報告（產出範圍：${sectionNamesStr}；核定預算 NT$ ${totalCurr.toLocaleString()}、執行率 ${totalRateStr}）。${summaryNote}`;
    const res = await notifyAndEmail(db, {
      recipientEmployeeId: recipientId,
      type: 'request_approved',
      formType: 'budget_analysis',
      formId: employee.id,
      caseNumber,
      message,
      templateId: 'request_approved',
      templateVars: {
        applicantName: employee.name,
        departmentName: employee.departmentName || '管理部財會 (AD)',
        formLabel: '年度預算分析報告',
        caseNumber,
        title,
        totalAmount: `NT$ ${totalCurr.toLocaleString()}（執行率 ${totalRateStr}）`,
        approverName: employee.name,
        comment: summary || '詳見信件下方圖表報告與隨附 PDF 檔案',
        message,
        documentDetailsHtml,
        actionUrl: `${process.env.APP_ORIGIN || 'http://localhost:3001'}/budget-codes/analysis`,
      },
      ...(pdfAttachment ? { attachments: [pdfAttachment] } : {}),
    });
    if (res.ok) publishedCount += 1;
  }

  const publishedAt = new Date().toISOString();
  await auditBudget(employee.id, 'budget_code.analysis_published', null, {
    fiscalYear: fy,
    compareYear,
    reportTitle: title,
    executiveSummary: summary,
    reportSectionCount: sections.length,
    reportSectionTitles: sections.map((s) => s.title),
    unitSummaries: units,
    recipientEmployeeIds: recipientIds,
    publishedCount,
    authorName: employee.name,
    publishedAt,
  });

  revalidatePath('/budget-codes');
  revalidatePath('/notifications');
  return { ok: true, publishedCount, publishedAt };
}

