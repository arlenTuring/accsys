'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { MAX_EMPLOYEE_FILE_BYTES } from '@/lib/admin/employees/import';
import {
  applyDirectoryChanges,
  applyEmployeeImport,
  createEmployee,
  createEmployeeFromDirectory,
  previewEmployeeImport,
  updateEmployee,
  type DirectoryChangeItem,
  type EmployeeActionResult,
  type ImportPreviewResult,
} from '@/lib/admin/employees/service';

// Thin wrappers: the actor always comes from the server-side session. Checks live in service.ts.

async function done(result: EmployeeActionResult): Promise<EmployeeActionResult> {
  if (result.ok) {
    revalidatePath('/admin/org/directory');
    revalidatePath('/admin/org/employees');
    revalidatePath('/admin/accounts');
  }
  return result;
}

async function uploaded(formData: FormData): Promise<Buffer | null> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_EMPLOYEE_FILE_BYTES) return null;
  return Buffer.from(await file.arrayBuffer());
}

export async function createEmployeeAction(input: Record<string, unknown>) {
  return done(await createEmployee(await getCurrentEmployee(), input));
}

export async function updateEmployeeAction(input: { employeeId: string } & Record<string, unknown>) {
  return done(await updateEmployee(await getCurrentEmployee(), input));
}

export async function previewEmployeeImportAction(formData: FormData): Promise<ImportPreviewResult> {
  const buffer = await uploaded(formData);
  if (!buffer) return { ok: false, error: 'invalid_input', detail: '請選擇 5 MB 以內的 Excel 檔案' };
  return previewEmployeeImport(await getCurrentEmployee(), buffer);
}

export async function applyEmployeeImportAction(formData: FormData) {
  const buffer = await uploaded(formData);
  const sha256 = formData.get('sha256');
  let include: unknown;
  try {
    include = JSON.parse(String(formData.get('include') ?? '[]'));
  } catch {
    include = null;
  }
  if (!buffer || typeof sha256 !== 'string' || !Array.isArray(include)) return { ok: false as const, error: 'invalid_input' as const };
  return done(await applyEmployeeImport(await getCurrentEmployee(), { buffer, sha256, include }));
}

export async function createEmployeeFromDirectoryAction(input: {
  directoryUserId: string;
  employeeCode: string;
  departmentId: string;
  role?: string;
}) {
  return done(await createEmployeeFromDirectory(await getCurrentEmployee(), input));
}

export async function applyDirectoryChangesAction(items: DirectoryChangeItem[]) {
  return done(await applyDirectoryChanges(await getCurrentEmployee(), { items }));
}
