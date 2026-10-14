'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  applyDirectoryChanges,
  createEmployeeFromDirectory,
  type DirectoryChangeItem,
  type EmployeeActionResult,
} from '@/lib/admin/employees/service';

// Thin wrappers: the actor always comes from the server-side session. Checks live in service.ts.

async function done(result: EmployeeActionResult): Promise<EmployeeActionResult> {
  if (result.ok) {
    revalidatePath('/admin/org/directory');
    revalidatePath('/admin/accounts');
  }
  return result;
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
