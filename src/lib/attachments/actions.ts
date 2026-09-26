'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { uploadAttachmentFor, type UploadResult } from '@/lib/attachments/service';
import { canReadForm, isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { eq } from 'drizzle-orm';

export type { UploadResult };

export async function uploadAttachment(formType: string, formId: string, formData: FormData): Promise<UploadResult> {
  const result = await uploadAttachmentFor(await getCurrentEmployee(), formType, formId, formData.get('file'));
  if (result.ok) revalidatePath(`${FORM_ROUTE_PREFIX[formType as FormType]}/${formId}`);
  return result;
}

/** Download link for an attachment the caller may read; the route re-checks everything. */
export async function getAttachmentDownloadUrl(attachmentId: string): Promise<string | null> {
  const actor = await getCurrentEmployee();
  if (!actor || !isUuid(attachmentId)) return null;
  const [row] = await getDb()
    .select({ formType: attachments.formType, formId: attachments.formId })
    .from(attachments)
    .where(eq(attachments.id, attachmentId));
  if (!row || !(await canReadForm(actor, row.formType, row.formId))) return null;
  return `/api/attachments/${attachmentId}`;
}
