'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as org from '@/lib/admin/org/service';
import { simulateForm } from '@/lib/admin/org/simulate';

// Thin wrappers: the actor always comes from the server-side session, never
// from the client. Authorization, recent-login and rate checks live in service.ts.

async function done<T extends { ok: boolean }>(result: T): Promise<T> {
  if (result.ok) revalidatePath('/admin/org', 'layout');
  return result;
}

const me = () => getCurrentEmployee();

export async function createLevelAction(input: unknown) {
  return done(await org.createLevel(await me(), input));
}

export async function updateLevelAction(id: string, input: unknown) {
  return done(await org.updateLevel(await me(), id, input));
}

export async function deleteLevelAction(id: string) {
  return done(await org.deleteLevel(await me(), id));
}

export async function saveDepartmentAction(id: string | null, input: unknown) {
  return done(await org.saveDepartment(await me(), id, input));
}

export async function setDepartmentActiveAction(id: string, active: boolean) {
  return done(await org.setDepartmentActive(await me(), id, active));
}

export async function saveJobRoleAction(id: string | null, input: unknown) {
  return done(await org.saveJobRole(await me(), id, input));
}

export async function setJobRoleActiveAction(id: string, active: boolean) {
  return done(await org.setJobRoleActive(await me(), id, active));
}

export async function addRoleHolderAction(input: unknown) {
  return done(await org.addRoleHolder(await me(), input));
}

export async function removeRoleHolderAction(bindingId: string) {
  return done(await org.removeRoleHolder(await me(), bindingId));
}

export async function setPrimaryHolderAction(bindingId: string) {
  return done(await org.setPrimaryHolder(await me(), bindingId));
}

export async function saveGroupAction(id: string | null, input: unknown) {
  return done(await org.saveGroup(await me(), id, input));
}

export async function setGroupActiveAction(id: string, active: boolean) {
  return done(await org.setGroupActive(await me(), id, active));
}

export async function setGroupMembersAction(id: string, employeeIds: string[]) {
  return done(await org.setGroupMembers(await me(), id, employeeIds));
}

export async function createDelegationAction(input: unknown) {
  return done(await org.createDelegation(await me(), input));
}

export async function revokeDelegationAction(id: string) {
  return done(await org.revokeDelegation(await me(), id));
}

export async function simulateFormAction(input: unknown) {
  return simulateForm(await me(), input);
}
