'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as service from '@/lib/acceptances/service';
import type { ActionResult } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts.

export type { ActionResult };
export type NewAcceptance = service.CreateAcceptanceInput;
export type ResubmitAcceptanceInput = service.EditAcceptanceInput;
export type CreateResult = service.CreateResult;

export async function createAcceptance(input: service.CreateAcceptanceInput): Promise<CreateResult> {
  const result = await service.createAcceptance(await getCurrentEmployee(), input);
  if (result.ok) {
    revalidatePath('/acceptances');
    revalidatePath('/approvals');
  }
  return result;
}

export async function approveAcceptanceStep(acceptanceId: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approveAcceptanceStep(await getCurrentEmployee(), acceptanceId, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return result;
}

export async function returnAcceptanceStep(acceptanceId: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnAcceptanceStep(await getCurrentEmployee(), acceptanceId, reason, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return result;
}

export async function updateAcceptance(acceptanceId: string, input: service.EditAcceptanceInput): Promise<ActionResult> {
  const result = await service.updateAcceptance(await getCurrentEmployee(), acceptanceId, input);
  revalidatePath('/acceptances');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return result;
}

export async function resubmitAcceptance(acceptanceId: string, input: service.EditAcceptanceInput): Promise<ActionResult> {
  const result = await service.resubmitAcceptance(await getCurrentEmployee(), acceptanceId, input);
  revalidatePath('/approvals');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return result;
}

export async function withdrawAcceptance(acceptanceId: string): Promise<ActionResult> {
  const result = await service.withdrawAcceptance(await getCurrentEmployee(), acceptanceId);
  revalidatePath('/acceptances');
  revalidatePath(`/acceptances/${acceptanceId}`);
  return result;
}

export async function updateAcceptanceItemPropertyTag(itemId: string, propertyTag: string): Promise<ActionResult> {
  const result = await service.updateAcceptanceItemPropertyTag(await getCurrentEmployee(), itemId, propertyTag);
  revalidatePath('/acceptances');
  return result;
}
