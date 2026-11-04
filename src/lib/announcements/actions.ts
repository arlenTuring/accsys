'use server';

import { revalidatePath } from 'next/cache';
import { notifyAiKnowledgeUpdated } from '@/lib/ai-chat/knowledge-sync';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as attachments from '@/lib/announcements/attachments';
import * as service from '@/lib/announcements/service';

function revalidateAnnouncementPaths(id?: string, reason = 'announcement_updated') {
  notifyAiKnowledgeUpdated('announcements', reason);
  revalidatePath('/announcements');
  revalidatePath('/admin/announcements');
  if (id) {
    revalidatePath(`/announcements/${id}`);
    revalidatePath(`/admin/announcements/${id}/edit`);
  }
}

export async function createAnnouncementAction(input: service.AnnouncementInput) {
  const actor = await getCurrentEmployee();
  const result = await service.createAnnouncement(actor, input);
  if (result.ok) revalidateAnnouncementPaths(result.announcement.id);
  return result;
}

export async function uploadAnnouncementAttachmentAction(announcementId: string, formData: FormData) {
  const actor = await getCurrentEmployee();
  const result = await attachments.uploadAnnouncementAttachment(actor, announcementId, formData.get('file'));
  if (result.ok) revalidateAnnouncementPaths(announcementId);
  return result;
}

export async function removeAnnouncementAttachmentAction(announcementId: string, attachmentId: string) {
  const actor = await getCurrentEmployee();
  const result = await attachments.removeAnnouncementAttachment(actor, announcementId, attachmentId);
  if (result.ok) revalidateAnnouncementPaths(announcementId);
  return result;
}

export async function updateAnnouncementAction(id: string, input: service.AnnouncementInput) {
  const actor = await getCurrentEmployee();
  const result = await service.updateAnnouncement(actor, id, input);
  if (result.ok) revalidateAnnouncementPaths(id);
  return result;
}

export async function publishAnnouncementAction(id: string, expectedVersion: number) {
  const actor = await getCurrentEmployee();
  const result = await service.publishAnnouncement(actor, id, expectedVersion);
  if (result.ok) revalidateAnnouncementPaths(id);
  return result;
}

export async function withdrawAnnouncementAction(id: string, expectedVersion: number) {
  const actor = await getCurrentEmployee();
  const result = await service.withdrawAnnouncement(actor, id, expectedVersion);
  if (result.ok) revalidateAnnouncementPaths(id);
  return result;
}

export async function markReadAction(id: string) {
  const actor = await getCurrentEmployee();
  if (!actor) return { ok: false as const };
  await service.markAnnouncementRead(actor.id, id);
  revalidatePath(`/announcements/${id}`);
  return { ok: true as const };
}

export async function acknowledgeAction(id: string) {
  const actor = await getCurrentEmployee();
  if (!actor) return { ok: false as const };
  await service.acknowledgeAnnouncement(actor.id, id);
  revalidatePath(`/announcements/${id}`);
  return { ok: true as const };
}
