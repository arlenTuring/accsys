import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

const BUCKET = 'attachments';
const SIGNED_URL_EXPIRY_SECONDS = 300;

export async function uploadAttachmentFile(
  storagePath: string,
  file: File
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createSupabaseServiceRoleClient();
  const { error } = await db.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createSignedAttachmentUrl(storagePath: string): Promise<string | null> {
  const db = createSupabaseServiceRoleClient();
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
