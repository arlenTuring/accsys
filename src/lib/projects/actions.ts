'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { isProjectKind, type ProjectKind } from '@/lib/expense-claims/editions';

export type ProjectInput = {
  /** 指定要修改的專案 UUID（編輯模式） */
  id?: string | null;
  code: string;
  name: string;
  kind: ProjectKind;
  /** 'create' 新增模式（檢查代碼不重複）｜'update' 修改模式（依 id 更新）｜未指定為相容 upsert */
  mode?: 'create' | 'update';
};

export type UpsertProjectResult = { ok: true; projectId: string } | { ok: false; error: string };
export type ProjectActionResult = { ok: true } | { ok: false; error: string };

function canMaintainProjects(employee: {
  role?: string | null;
  permissions?: readonly string[] | null;
}): boolean {
  if (employee.role === 'finance' || employee.role === 'admin') return true;
  if (
    Array.isArray(employee.permissions) &&
    (employee.permissions.includes('finance.budget') ||
      employee.permissions.includes('master_data.manage'))
  ) {
    return true;
  }
  return false;
}

function revalidateProjectPaths() {
  try {
    revalidatePath('/budget-codes', 'layout');
    revalidatePath('/budget-codes/projects');
    revalidatePath('/admin/master-data');
  } catch {
    // Ignore revalidatePath errors outside Next request context (e.g. vitest)
  }
}

export async function upsertProject(input: ProjectInput): Promise<UpsertProjectResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (!canMaintainProjects(employee)) {
    return { ok: false, error: '只有財會人員可以維護專案' };
  }

  if (!input || typeof input.code !== 'string' || typeof input.name !== 'string') {
    return { ok: false, error: '資料格式不正確' };
  }
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) return { ok: false, error: '專案代碼為必填' };
  if (!name) return { ok: false, error: '專案名稱為必填' };
  if (code.length > 50 || name.length > 200) return { ok: false, error: '專案代碼或名稱過長' };
  if (!isProjectKind(input.kind)) return { ok: false, error: '請選擇專案類型' };

  const db = createAppDb();

  // 1. 明確編輯模式（有帶入 project id）
  if (input.id && isUuid(input.id)) {
    const { data: existingById } = await db
      .from('projects')
      .select('id, code, name, kind')
      .eq('id', input.id)
      .maybeSingle();

    if (!existingById) {
      return { ok: false, error: '找不到要修改的專案資料' };
    }

    if (existingById.code !== code) {
      const { data: conflict } = await db
        .from('projects')
        .select('id, code, name')
        .eq('code', code)
        .maybeSingle();
      if (conflict && conflict.id !== existingById.id) {
        return {
          ok: false,
          error: `專案代碼「${code}」已被其他專案（${conflict.name}）使用，專案代碼必須為唯一值`,
        };
      }
    }

    const { data: updated, error: updateErr } = await db
      .from('projects')
      .update({
        code,
        name,
        kind: input.kind,
      })
      .eq('id', existingById.id)
      .select('id')
      .single();

    if (updateErr || !updated) {
      return { ok: false, error: '更新專案資料失敗' };
    }

    // 若專案代碼有變更，同步更新線上預算單／草稿 JSON 內的 projectCode
    if (existingById.code !== code) {
      try {
        const drizzleDb = getDb();
        await drizzleDb.execute(sql`
          update form_submissions
          set data = jsonb_set(data, '{projectCode}', to_jsonb(${code}::text), false)
          where data->>'projectCode' = ${existingById.code}
        `);
        await drizzleDb.execute(sql`
          update form_drafts
          set data = jsonb_set(data, '{projectCode}', to_jsonb(${code}::text), false)
          where data->>'projectCode' = ${existingById.code}
        `);
      } catch {
        // Non-fatal if JSON sync fails
      }
    }

    await recordAudit(getDb(), {
      actorEmployeeId: employee.id,
      action: 'project.updated',
      entityType: 'project',
      entityId: updated.id,
      details: {
        code,
        before: existingById,
        after: { code, name, kind: input.kind },
      },
    });

    revalidateProjectPaths();
    return { ok: true, projectId: updated.id };
  }

  // 2. 新增模式或相容 upsert 模式
  const { data: previous } = await db
    .from('projects')
    .select('id, code, name, kind')
    .eq('code', code)
    .maybeSingle();

  if (input.mode === 'create' && previous) {
    return {
      ok: false,
      error: `專案代碼「${code}」已存在（名稱：${previous.name}），請勿重複新增；如需修改請點擊列表右側的「編輯」按鈕`,
    };
  }

  const { data, error } = await db
    .from('projects')
    .upsert(
      {
        code,
        name,
        kind: input.kind,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'code' }
    )
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: '寫入專案失敗' };
  // The project kind picks the 費用申請單 edition (and its per-line caps).
  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: previous ? 'project.updated' : 'project.created',
    entityType: 'project',
    entityId: data.id,
    details: { code, before: previous ?? null, after: { name, kind: input.kind } },
  });

  revalidateProjectPaths();
  return { ok: true, projectId: data.id };
}

/**
 * 停用或重新啟用專案（已建立預算單的專案不可刪除，須使用停用功能）
 */
export async function setProjectActive(
  projectId: string,
  active: boolean
): Promise<ProjectActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (!canMaintainProjects(employee)) {
    return { ok: false, error: '只有財會人員可以維護專案' };
  }
  if (!isUuid(projectId)) return { ok: false, error: '找不到這個專案' };

  const db = createAppDb();
  const { data: project } = await db
    .from('projects')
    .select('id, code, name, kind')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: '找不到這個專案' };

  // 同步將此專案旗下的預算編號一併停用／啟用，避免停用專案仍於新申請單被選用
  await db.from('budget_codes').update({ active }).eq('project_id', projectId);

  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: active ? 'project.enabled' : 'project.disabled',
    entityType: 'project',
    entityId: projectId,
    details: {
      code: project.code,
      name: project.name,
      active,
    },
  });

  revalidateProjectPaths();
  return { ok: true };
}

/**
 * 刪除專案：
 * 若該專案已經建立了預算單（含專案預算科目代號、預算申請單、預算變更單或草稿）或已被單據引用，
 * 則嚴格禁止刪除，並提示改用「停用」功能。
 */
export async function deleteProject(projectId: string): Promise<ProjectActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (!canMaintainProjects(employee)) {
    return { ok: false, error: '只有財會人員可以維護專案' };
  }
  if (!isUuid(projectId)) return { ok: false, error: '找不到這個專案' };

  const db = createAppDb();
  const { data: project } = await db
    .from('projects')
    .select('id, code, name, kind')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: '找不到這個專案' };

  // 1. 檢查是否已建立專案預算科目代號（budget_codes）
  const { count: bcCount } = await db
    .from('budget_codes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);

  // 2. 檢查是否已建立預算申請單、預算變更單、預算草稿或其他關聯單據
  const drizzleDb = getDb();
  const refRows = await drizzleDb.execute<{
    submission_cnt: number;
    draft_cnt: number;
    ai_cnt: number;
  }>(sql`
    select
      (
        select count(*)::int from form_submissions fs
        where fs.project_id = ${projectId}::uuid
           or fs.data->>'projectCode' = ${project.code}
           or fs.budget_code_id in (select bc.id from budget_codes bc where bc.project_id = ${projectId}::uuid)
      ) as submission_cnt,
      (
        select count(*)::int from form_drafts fd
        where fd.data->>'projectCode' = ${project.code}
      ) as draft_cnt,
      (
        select count(*)::int from ai_project_usage apu
        where apu.project_id = ${projectId}::uuid
      ) as ai_cnt
  `);

  const budgetCodeCount = bcCount ?? 0;
  const submissionCount = Number(refRows[0]?.submission_cnt ?? 0);
  const draftCount = Number(refRows[0]?.draft_cnt ?? 0);
  const aiUsageCount = Number(refRows[0]?.ai_cnt ?? 0);

  if (budgetCodeCount > 0 || submissionCount > 0 || draftCount > 0) {
    return {
      ok: false,
      error: `專案「${project.code}（${project.name}）」已經建立了預算單或預算科目（共 ${budgetCodeCount} 筆預算科目、${submissionCount + draftCount} 筆預算表單），不可刪除，請改用「停用」功能！`,
    };
  }

  if (aiUsageCount > 0) {
    return {
      ok: false,
      error: `專案「${project.code}（${project.name}）」已有專案使用紀錄，不可刪除，請改用「停用」功能！`,
    };
  }

  // 先清理可能存在的 project_members 關聯
  await db.from('project_members').delete().eq('project_id', projectId);

  const { error: delErr } = await db.from('projects').delete().eq('id', projectId);
  if (delErr) {
    return {
      ok: false,
      error: '刪除此專案失敗（可能已被其他資料引用），請改用「停用」功能',
    };
  }

  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: 'project.deleted',
    entityType: 'project',
    entityId: projectId,
    details: { before: project },
  });

  revalidateProjectPaths();
  return { ok: true };
}
