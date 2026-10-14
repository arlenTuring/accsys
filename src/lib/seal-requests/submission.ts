import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { getCurrentEmployee } from '@/lib/auth/current-employee';
import { scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { uploadAttachmentFor } from '@/lib/attachments/service';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { FORM_ROUTE_PREFIX, type FormType, type SealFormType } from '@/lib/procurement/form-registry';
import { fail, type Failure } from '@/lib/workflow/tx';

// Request plumbing for server actions that take files with the form (seal
// requests, designer forms): form fields travel as a JSON `payload` next to the
// files in one multipart request.

export type SubmitResult = { ok: true; sealRequestId: string; caseNumber?: string; attachmentErrors: string[] } | Failure;
type PendingFile = { file: File; name: string; bytes: Uint8Array };

export function refreshSealLists(formType: SealFormType, id?: string) {
  revalidatePath('/seal-requests');
  revalidatePath('/approvals');
  if (id) revalidatePath(`${FORM_ROUTE_PREFIX[formType]}/${id}`);
}

export async function readSealRequest(
  formData: FormData
): Promise<{ payload: Record<string, unknown>; files: PendingFile[] } | { error: Failure }> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { error: fail('validation', '表單內容不正確，請重新整理頁面後再試') };
  }
  const picked = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const files = await Promise.all(picked.map(async (f) => ({ file: f, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  return { payload: payload as Record<string, unknown>, files };
}

export function scannerReady(): Failure | null {
  try {
    scannerConfig();
    return null;
  } catch (err) {
    if (err instanceof ScannerUnavailable) return fail('unavailable', '附件掃描服務未設定，暫時無法送出，請聯絡系統管理員');
    throw err;
  }
}

export async function attachmentCount(formType: FormType, formId: string): Promise<number> {
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(attachments)
    .where(and(eq(attachments.formType, formType), eq(attachments.formId, formId)));
  return n;
}

/** Files are stored after the form commits; a failed file is reported, the form stays submitted. */
export async function storeSealFiles(
  actor: Awaited<ReturnType<typeof getCurrentEmployee>>,
  formType: FormType,
  formId: string,
  files: { file: File; name: string }[]
): Promise<string[]> {
  const errors: string[] = [];
  for (const f of files) {
    const result = await uploadAttachmentFor(actor, formType, formId, f.file);
    if (!result.ok) errors.push(`${f.name}：${result.error}`);
  }
  return errors;
}
