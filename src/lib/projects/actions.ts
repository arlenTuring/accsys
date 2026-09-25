'use server';

import { revalidatePath } from 'next/cache';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type ProjectInput = {
  code: string;
  name: string;
};

export type UpsertProjectResult = { ok: true; projectId: string } | { ok: false; error: string };

export async function upsertProject(input: ProjectInput): Promise<UpsertProjectResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料，請聯絡系統管理員' };
  if (employee.role !== 'finance' && employee.role !== 'admin') {
    return { ok: false, error: '只有財會人員可以維護專案' };
  }

  if (!input.code.trim()) return { ok: false, error: '專案代碼為必填' };
  if (!input.name.trim()) return { ok: false, error: '專案名稱為必填' };

  const db = createAppDb();
  const { data, error } = await db
    .from('projects')
    .upsert({ code: input.code, name: input.name }, { onConflict: 'code' })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: '寫入專案失敗' };

  revalidatePath('/budget-codes');
  return { ok: true, projectId: data.id };
}
