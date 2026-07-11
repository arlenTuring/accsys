import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedByName: string;
  createdAt: string;
};

export async function getAttachments(formType: string, formId: string): Promise<AttachmentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('attachments')
    .select(
      'id, file_name, mime_type, file_size_bytes, created_at, uploader:employees!uploaded_by_employee_id(name)'
    )
    .eq('form_type', formType)
    .eq('form_id', formId)
    .order('created_at', { ascending: false });
  return (data ?? []).map((a) => ({
    id: a.id,
    fileName: a.file_name,
    mimeType: a.mime_type,
    fileSizeBytes: a.file_size_bytes,
    uploadedByName: (a.uploader as unknown as { name: string }).name,
    createdAt: a.created_at,
  }));
}
