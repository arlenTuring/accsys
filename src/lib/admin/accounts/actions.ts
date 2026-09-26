'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  approveLinkRequest,
  rejectLinkRequest,
  revokeIdentity,
  setEmployeeAccess,
  setEmployeeRole,
  type AccountActionResult,
} from '@/lib/admin/accounts/service';

// Thin wrappers: the actor always comes from the server-side session, never
// from the client. Authorization, recent-login and rate checks live in service.ts.

async function done(result: AccountActionResult): Promise<AccountActionResult> {
  if (result.ok) revalidatePath('/admin/accounts');
  return result;
}

export async function approveLinkRequestAction(requestId: string, employeeId: string) {
  return done(await approveLinkRequest(await getCurrentEmployee(), { requestId, employeeId }));
}

export async function rejectLinkRequestAction(requestId: string) {
  return done(await rejectLinkRequest(await getCurrentEmployee(), { requestId }));
}

export async function revokeIdentityAction(employeeId: string) {
  return done(await revokeIdentity(await getCurrentEmployee(), { employeeId }));
}

export async function setEmployeeAccessAction(employeeId: string, enabled: boolean, reason?: string) {
  return done(await setEmployeeAccess(await getCurrentEmployee(), { employeeId, enabled, reason }));
}

export async function setEmployeeRoleAction(employeeId: string, role: string) {
  return done(await setEmployeeRole(await getCurrentEmployee(), { employeeId, role }));
}
