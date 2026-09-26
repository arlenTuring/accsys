'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as service from '@/lib/purchase-requests/service';
import type { ActionResult } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts.

export type { ActionResult };
export type NewPurchaseRequest = service.PurchaseRequestInput;
export type CreateResult = service.CreateResult;

export async function createPurchaseRequest(input: service.CreatePurchaseRequestInput): Promise<CreateResult> {
  const result = await service.createPurchaseRequest(await getCurrentEmployee(), input);
  if (result.ok) {
    revalidatePath('/requests');
    revalidatePath('/approvals');
  }
  return result;
}

export async function approvePurchaseRequestStep(requestId: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approvePurchaseRequestStep(await getCurrentEmployee(), requestId, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return result;
}

export async function returnPurchaseRequestStep(
  requestId: string,
  reason: string,
  expectedVersion: number
): Promise<ActionResult> {
  const result = await service.returnPurchaseRequestStep(await getCurrentEmployee(), requestId, reason, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return result;
}

export async function updatePurchaseRequest(
  requestId: string,
  input: service.EditPurchaseRequestInput
): Promise<ActionResult> {
  const result = await service.updatePurchaseRequest(await getCurrentEmployee(), requestId, input);
  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);
  return result;
}

export async function resubmitPurchaseRequest(
  requestId: string,
  input: service.EditPurchaseRequestInput
): Promise<ActionResult> {
  const result = await service.resubmitPurchaseRequest(await getCurrentEmployee(), requestId, input);
  revalidatePath('/approvals');
  revalidatePath(`/requests/${requestId}`);
  return result;
}

export async function withdrawPurchaseRequest(requestId: string): Promise<ActionResult> {
  const result = await service.withdrawPurchaseRequest(await getCurrentEmployee(), requestId);
  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);
  return result;
}
