'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as service from '@/lib/expense-requests/service';
import type { ActionResult } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts.

export type { ActionResult };
export type NewExpenseRequest = service.CreateExpenseRequestInput;
export type NewStandaloneExpenseRequest = service.CreateStandaloneExpenseRequestInput;
export type ResubmitExpenseRequestInput = service.EditExpenseRequestInput;
export type CreateResult = service.CreateResult;

function refreshLists() {
  revalidatePath('/expense-requests');
  revalidatePath('/approvals');
}

export async function createExpenseRequest(input: service.CreateExpenseRequestInput): Promise<CreateResult> {
  const result = await service.createExpenseRequest(await getCurrentEmployee(), input);
  if (result.ok) refreshLists();
  return result;
}

export async function createStandaloneExpenseRequest(input: service.CreateStandaloneExpenseRequestInput): Promise<CreateResult> {
  const result = await service.createStandaloneExpenseRequest(await getCurrentEmployee(), input);
  if (result.ok) refreshLists();
  return result;
}

export async function approveExpenseRequestStep(id: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approveExpenseRequestStep(await getCurrentEmployee(), id, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${id}`);
  return result;
}

export async function returnExpenseRequestStep(id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnExpenseRequestStep(await getCurrentEmployee(), id, reason, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/expense-requests/${id}`);
  return result;
}

export async function updateExpenseRequest(id: string, input: service.EditExpenseRequestInput): Promise<ActionResult> {
  const result = await service.updateExpenseRequest(await getCurrentEmployee(), id, input);
  refreshLists();
  revalidatePath(`/expense-requests/${id}`);
  return result;
}

export async function resubmitExpenseRequest(id: string, input: service.EditExpenseRequestInput): Promise<ActionResult> {
  const result = await service.resubmitExpenseRequest(await getCurrentEmployee(), id, input);
  refreshLists();
  revalidatePath(`/expense-requests/${id}`);
  return result;
}

export async function withdrawExpenseRequest(id: string): Promise<ActionResult> {
  const result = await service.withdrawExpenseRequest(await getCurrentEmployee(), id);
  revalidatePath('/expense-requests');
  revalidatePath(`/expense-requests/${id}`);
  return result;
}
