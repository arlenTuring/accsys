'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { saveAccessRole, setAccessRoleActive, type AccessRoleResult } from './service';

async function me() {
  const e = await getCurrentEmployee();
  return e ? { id: e.id, role: e.role, permissions: e.permissions, authenticatedAt: e.authenticatedAt } : null;
}

function done<T extends object>(r: AccessRoleResult<T>): AccessRoleResult<T> {
  if (r.ok) revalidatePath('/admin/org/access-roles');
  return r;
}

export async function saveAccessRoleAction(id: string | null, raw: unknown, expectedVersion?: number) {
  return done(await saveAccessRole(await me(), id, raw, expectedVersion ?? 1));
}

export async function setAccessRoleActiveAction(id: string, active: boolean, expectedVersion: number) {
  return done(await setAccessRoleActive(await me(), id, active, expectedVersion));
}
