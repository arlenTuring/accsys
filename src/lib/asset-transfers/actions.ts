'use server';

import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { PHOTO_PREFIX } from '@/lib/asset-transfers/constants';
import * as service from '@/lib/asset-transfers/service';
import type { AssetTransferInput } from '@/lib/asset-transfers/validate';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { checkUploadBatch } from '@/lib/attachments/batch';
import { scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { uploadAttachmentFor } from '@/lib/attachments/service';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { fail, type ActionResult, type Failure } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts. Form fields travel as a JSON
// `payload`; 資產照片 (`photos`, required on a new form) and 其他附件
// (`files`) are stored as attachments of the form, photos with a name prefix.

export type { ActionResult };
export type SubmitResult = { ok: true; transferId: string; caseNumber?: string; attachmentErrors: string[] } | Failure;

const FORM = 'asset_transfer';
const NO_PHOTOS = '請上傳資產照片（需拍到「財產編號」及「完整資產外觀」）';

function refreshLists(id?: string) {
  revalidatePath('/asset-transfers');
  revalidatePath('/assets');
  revalidatePath('/approvals');
  if (id) revalidatePath(`/asset-transfers/${id}`);
}

type Upload = { file: File; name: string; bytes: Uint8Array };

async function readUploads(formData: FormData, field: string, prefix = ''): Promise<Upload[]> {
  const files = formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
  return Promise.all(
    files.map(async (f) => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const name = prefix && !f.name.startsWith(prefix) ? `${prefix}${f.name}` : f.name;
      return { file: name === f.name ? f : new File([bytes], name, { type: f.type }), name, bytes };
    })
  );
}

async function readRequest(formData: FormData) {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { error: fail('validation', '表單內容不正確，請重新整理頁面後再試') };
  }
  const photos = await readUploads(formData, 'photos', PHOTO_PREFIX);
  const others = await readUploads(formData, 'files');
  return { payload: payload as Record<string, unknown>, photos, uploads: [...photos, ...others] };
}

function scannerReady(): Failure | null {
  try {
    scannerConfig();
    return null;
  } catch (err) {
    if (err instanceof ScannerUnavailable) return fail('unavailable', '附件掃描服務未設定，暫時無法送出，請聯絡系統管理員');
    throw err;
  }
}

async function attachmentCount(formId: string): Promise<number> {
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(attachments)
    .where(and(eq(attachments.formType, FORM), eq(attachments.formId, formId)));
  return n;
}

/** Files are stored after the form commits; a failed file is reported, the form stays submitted. */
async function storeFiles(actor: Awaited<ReturnType<typeof getCurrentEmployee>>, formId: string, uploads: Upload[]): Promise<string[]> {
  const errors: string[] = [];
  for (const u of uploads) {
    const result = await uploadAttachmentFor(actor, FORM, formId, u.file);
    if (!result.ok) errors.push(`${u.name}：${result.error}`);
  }
  return errors;
}

export async function submitAssetTransfer(formData: FormData): Promise<SubmitResult> {
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  const req = await readRequest(formData);
  if ('error' in req) return req.error!;
  if (req.photos.length === 0) return fail('validation', NO_PHOTOS);
  const check = checkUploadBatch(req.uploads, { emptyError: NO_PHOTOS });
  if (!check.ok) return fail('validation', check.error);
  const scanner = scannerReady();
  if (scanner) return scanner;

  const result = await service.createAssetTransfer(actor, req.payload as service.CreateAssetTransferInput);
  if (!result.ok) return result;
  // A replayed submit (double click / retry) already stored its files.
  const attachmentErrors =
    result.replayed || (await attachmentCount(result.transferId)) > 0 ? [] : await storeFiles(actor, result.transferId, req.uploads);
  refreshLists(result.transferId);
  return { ok: true, transferId: result.transferId, caseNumber: result.caseNumber, attachmentErrors };
}

/** Edit before the first decision, or resubmit after a return; extra files may be added. */
export async function reviseAssetTransfer(id: string, mode: 'update' | 'resubmit', formData: FormData): Promise<SubmitResult> {
  if (mode !== 'update' && mode !== 'resubmit') return fail('validation', '操作不正確');
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料');
  if (!(await canReadForm(actor, FORM, id))) return fail('not_found', '找不到這張資產異動申請單');
  const req = await readRequest(formData);
  if ('error' in req) return req.error!;
  const check = checkUploadBatch(req.uploads, { existing: await attachmentCount(id), emptyError: NO_PHOTOS });
  if (!check.ok) return fail('validation', check.error);
  if (req.uploads.length > 0) {
    const scanner = scannerReady();
    if (scanner) return scanner;
  }

  const result = await service.reviseAssetTransfer(actor, id, req.payload as unknown as service.EditAssetTransferInput, mode);
  if (!result.ok) return result;
  const attachmentErrors = await storeFiles(actor, id, req.uploads);
  refreshLists(id);
  return { ok: true, transferId: id, attachmentErrors };
}

export async function approveAssetTransferStep(id: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approveAssetTransferStep(await getCurrentEmployee(), id, expectedVersion);
  refreshLists(id);
  return result;
}

export async function returnAssetTransferStep(id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnAssetTransferStep(await getCurrentEmployee(), id, reason, expectedVersion);
  refreshLists(id);
  return result;
}

export async function withdrawAssetTransfer(id: string): Promise<ActionResult> {
  const result = await service.withdrawAssetTransfer(await getCurrentEmployee(), id);
  refreshLists(id);
  return result;
}

export type { AssetTransferInput };
