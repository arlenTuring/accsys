'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as service from '@/lib/purchase-orders/service';
import type { ActionResult } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts.

export type { ActionResult };
export type NewPurchaseOrder = service.CreatePurchaseOrderInput;
export type ResubmitPurchaseOrderInput = service.EditPurchaseOrderInput;
export type CreateResult = service.CreateResult;

export async function createPurchaseOrder(input: service.CreatePurchaseOrderInput): Promise<CreateResult> {
  const result = await service.createPurchaseOrder(await getCurrentEmployee(), input);
  if (result.ok) {
    revalidatePath('/purchase-orders');
    revalidatePath('/approvals');
  }
  return result;
}

export async function approvePurchaseOrderStep(orderId: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approvePurchaseOrderStep(await getCurrentEmployee(), orderId, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return result;
}

export async function returnPurchaseOrderStep(orderId: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnPurchaseOrderStep(await getCurrentEmployee(), orderId, reason, expectedVersion);
  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return result;
}

export async function updatePurchaseOrder(orderId: string, input: service.EditPurchaseOrderInput): Promise<ActionResult> {
  const result = await service.updatePurchaseOrder(await getCurrentEmployee(), orderId, input);
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${orderId}`);
  return result;
}

export async function resubmitPurchaseOrder(orderId: string, input: service.EditPurchaseOrderInput): Promise<ActionResult> {
  const result = await service.resubmitPurchaseOrder(await getCurrentEmployee(), orderId, input);
  revalidatePath('/approvals');
  revalidatePath(`/purchase-orders/${orderId}`);
  return result;
}

export async function withdrawPurchaseOrder(orderId: string): Promise<ActionResult> {
  const result = await service.withdrawPurchaseOrder(await getCurrentEmployee(), orderId);
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${orderId}`);
  return result;
}
