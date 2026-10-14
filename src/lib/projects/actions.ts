'use server';

import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { isProjectKind, type ProjectKind } from '@/lib/expense-claims/editions';

export type ProjectInput = {
  code: string;
  name: string;
  kind: ProjectKind;
};

export type UpsertProjectResult = { ok: true; projectId: string } | { ok: false; error: string };

export async function upsertProject(input: ProjectInput): Promise<UpsertProjectResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護專案' };
  }

  if (!input || typeof input.code !== 'string' || typeof input.name !== 'string') {
    return { ok: false, error: '資料格式不正確' };
  }
  if (!input.code.trim()) return { ok: false, error: '專案代碼為必填' };
  if (!input.name.trim()) return { ok: false, error: '專案名稱為必填' };
  if (input.code.length > 50 || input.name.length > 200) return { ok: false, error: '專案代碼或名稱過長' };
  if (!isProjectKind(input.kind)) return { ok: false, error: '請選擇專案類型' };

  const db = createAppDb();
  const { data: previous } = await db.from('projects').select('id, name, kind').eq('code', input.code).maybeSingle();
  const { data, error } = await db
    .from('projects')
    .upsert({ code: input.code, name: input.name, kind: input.kind }, { onConflict: 'code' })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: '寫入專案失敗' };
  // The project kind picks the 費用申請單 edition (and its per-line caps).
  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: previous ? 'project.updated' : 'project.created',
    entityType: 'project',
    entityId: data.id,
    details: { code: input.code, before: previous ?? null, after: { name: input.name, kind: input.kind } },
  });

  revalidatePath('/budget-codes');
  return { ok: true, projectId: data.id };
}
