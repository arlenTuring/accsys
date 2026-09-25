'use server';

import { revalidatePath } from 'next/cache';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { validateAttachmentFile } from '@/lib/attachments/validate';
import { createSignedAttachmentUrl, uploadAttachmentFile } from '@/lib/attachments/storage';
import { FORM_ROUTE_PREFIX, FORM_TABLE, type FormType } from '@/lib/procurement/form-registry';

export type UploadResult = { ok: true; attachmentId: string } | { ok: false; error: string };

async function isFormParticipant(
  db: ReturnType<typeof createAppDb>,
  formType: string,
  formId: string,
  employee: { id: string; role: string }
): Promise<boolean> {
  if (employee.role === 'finance' || employee.role === 'admin') return true;
  const table = FORM_TABLE[formType as FormType];
  if (!table) return false;
  const { data: form } = await db
    .from(table)
    .select('applicant_employee_id')
    .eq('id', formId)
    .maybeSingle();
  if (form?.applicant_employee_id === employee.id) return true;
  const { data: step } = await db
    .from('approval_steps')
    .select('id')
    .eq('form_type', formType)
    .eq('form_id', formId)
    .eq('approver_employee_id', employee.id)
    .limit(1)
    .maybeSingle();
  return !!step;
}

export async function uploadAttachment(
  formType: string,
  formId: string,
  formData: FormData
): Promise<UploadResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false, error: '找不到您的員工資料' };

  const db = createAppDb();
  if (!(await isFormParticipant(db, formType, formId, employee))) {
    return { ok: false, error: '您沒有權限為此表單上傳附件' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, error: '請選擇檔案' };
  }
  const validation = validateAttachmentFile({ mimeType: file.type, sizeBytes: file.size });
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const storagePath = `${formType}/${formId}/${Date.now()}-${file.name}`;
  const uploadResult = await uploadAttachmentFile(storagePath, file);
  if (!uploadResult.ok) {
    return { ok: false, error: uploadResult.error };
  }

  const { data, error } = await db
    .from('attachments')
    .insert({
      form_type: formType,
      form_id: formId,
      uploaded_by_employee_id: employee.id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    })
    .select()
    .single();
  if (error || !data) {
    return { ok: false, error: '建立附件記錄失敗' };
  }

  revalidatePath(`${FORM_ROUTE_PREFIX[formType as FormType]}/${formId}`);
  return { ok: true, attachmentId: data.id };
}

export async function getAttachmentDownloadUrl(attachmentId: string): Promise<string | null> {
  const employee = await getCurrentEmployee();
  if (!employee) return null;

  const db = createAppDb();
  const { data: attachment } = await db
    .from('attachments')
    .select('storage_path, form_type, form_id')
    .eq('id', attachmentId)
    .maybeSingle();
  if (!attachment) return null;
  if (!(await isFormParticipant(db, attachment.form_type, attachment.form_id, employee))) {
    return null;
  }
  return createSignedAttachmentUrl(attachment.storage_path);
}
