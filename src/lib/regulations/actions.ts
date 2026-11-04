'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as attachments from '@/lib/regulations/attachments';
import * as service from '@/lib/regulations/service';

function revalidateAll(id?: string) {
  revalidatePath('/regulations');
  revalidatePath('/admin/regulations');
  if (id) {
    revalidatePath(`/regulations/${id}`);
    revalidatePath(`/admin/regulations/${id}/edit`);
  }
}

export async function createRegulationAction(input: service.RegulationInput) {
  const actor = await getCurrentEmployee();
  const res = await service.createRegulation(actor, input);
  if (res.ok) revalidateAll(res.regulation.id);
  return res;
}

export async function updateRegulationAction(id: string, input: service.RegulationInput) {
  const actor = await getCurrentEmployee();
  const res = await service.updateRegulation(actor, id, input);
  if (res.ok) revalidateAll(id);
  return res;
}

export async function deleteRegulationAction(id: string) {
  const actor = await getCurrentEmployee();
  const res = await service.deleteRegulation(actor, id);
  if (res.ok) revalidateAll(id);
  return res;
}

export async function syncDefaultRegulationsAction() {
  const actor = await getCurrentEmployee();
  const res = await service.syncDefaultRegulationsActionHelper(actor);
  if (res.ok) revalidateAll();
  return res;
}

export async function uploadRegulationAttachmentAction(regulationId: string, formData: FormData) {
  const actor = await getCurrentEmployee();
  const file = formData.get('file');
  const res = await attachments.uploadRegulationAttachment(actor, regulationId, file);
  if (res.ok) revalidateAll(regulationId);
  return res;
}

export async function deleteRegulationAttachmentAction(regulationId: string, attachmentId: string) {
  const actor = await getCurrentEmployee();
  const res = await attachments.deleteRegulationAttachment(actor, regulationId, attachmentId);
  if (res.ok) revalidateAll(regulationId);
  return res;
}
