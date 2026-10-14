'use server';

import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { checkUploadBatch } from '@/lib/attachments/batch';
import { scannerConfig, ScannerUnavailable } from '@/lib/attachments/scan';
import { uploadAttachmentFor } from '@/lib/attachments/service';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { attachments } from '@/lib/db/schema';
import { EDITIONS, isExpenseEdition, type ExpenseEdition } from '@/lib/expense-claims/editions';
import * as service from '@/lib/expense-claims/service';
import type { ExpenseClaimInput } from '@/lib/expense-claims/validate';
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';
import { fail, type ActionResult, type Failure } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts. Form fields travel as a JSON
// `payload` next to the files in one multipart request. The edition arrives
// from the client, so every action checks it.

export type { ActionResult };
export type SubmitResult = { ok: true; claimId: string; caseNumber?: string; attachmentErrors: string[] } | Failure;

const NO_FILES = '請上傳相關費用報支附件';
const BAD_EDITION = fail('validation', '表單種類不正確');

function refreshLists(edition: ExpenseEdition, id?: string) {
  revalidatePath('/expense-claims');
  revalidatePath('/approvals');
  if (id) revalidatePath(`${FORM_ROUTE_PREFIX[EDITIONS[edition].formType]}/${id}`);
}

async function readRequest(formData: FormData) {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { error: fail('validation', '表單內容不正確，請重新整理頁面後再試') };
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const uploads = await Promise.all(files.map(async (f) => ({ file: f, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  return { payload: payload as Record<string, unknown>, uploads };
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

async function attachmentCount(edition: ExpenseEdition, formId: string): Promise<number> {
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(attachments)
    .where(and(eq(attachments.formType, EDITIONS[edition].formType), eq(attachments.formId, formId)));
  return n;
}

/** Files are stored after the form commits; a failed file is reported, the form stays submitted. */
async function storeFiles(
  edition: ExpenseEdition,
  actor: Awaited<ReturnType<typeof getCurrentEmployee>>,
  formId: string,
  uploads: { file: File; name: string }[]
): Promise<string[]> {
  const errors: string[] = [];
  for (const u of uploads) {
    const result = await uploadAttachmentFor(actor, EDITIONS[edition].formType, formId, u.file);
    if (!result.ok) errors.push(`${u.name}：${result.error}`);
  }
  return errors;
}

export async function submitExpenseClaim(edition: ExpenseEdition, formData: FormData): Promise<SubmitResult> {
  if (!isExpenseEdition(edition)) return BAD_EDITION;
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  const req = await readRequest(formData);
  if ('error' in req) return req.error!;
  const check = checkUploadBatch(req.uploads, { emptyError: NO_FILES });
  if (!check.ok) return fail('validation', check.error);
  const scanner = scannerReady();
  if (scanner) return scanner;

  const result = await service.createExpenseClaim(edition, actor, req.payload as service.CreateExpenseClaimInput);
  if (!result.ok) return result;
  // A replayed submit (double click / retry) already stored its files.
  const attachmentErrors =
    result.replayed || (await attachmentCount(edition, result.claimId)) > 0
      ? []
      : await storeFiles(edition, actor, result.claimId, req.uploads);
  refreshLists(edition, result.claimId);
  return { ok: true, claimId: result.claimId, caseNumber: result.caseNumber, attachmentErrors };
}

/** Edit before the first decision, or resubmit after a return; extra files may be added. */
export async function reviseExpenseClaim(
  edition: ExpenseEdition,
  id: string,
  mode: 'update' | 'resubmit',
  formData: FormData
): Promise<SubmitResult> {
  if (!isExpenseEdition(edition) || (mode !== 'update' && mode !== 'resubmit')) return BAD_EDITION;
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料');
  if (!(await canReadForm(actor, EDITIONS[edition].formType, id))) return fail('not_found', `找不到這張${EDITIONS[edition].label}`);
  const req = await readRequest(formData);
  if ('error' in req) return req.error!;
  const check = checkUploadBatch(req.uploads, { existing: await attachmentCount(edition, id), emptyError: NO_FILES });
  if (!check.ok) return fail('validation', check.error);
  if (req.uploads.length > 0) {
    const scanner = scannerReady();
    if (scanner) return scanner;
  }

  const result = await service.reviseExpenseClaim(edition, actor, id, req.payload as unknown as service.EditExpenseClaimInput, mode);
  if (!result.ok) return result;
  const attachmentErrors = await storeFiles(edition, actor, id, req.uploads);
  refreshLists(edition, id);
  return { ok: true, claimId: id, attachmentErrors };
}

export async function approveExpenseClaimStep(edition: ExpenseEdition, id: string, expectedVersion: number): Promise<ActionResult> {
  if (!isExpenseEdition(edition)) return BAD_EDITION;
  const result = await service.approveExpenseClaimStep(edition, await getCurrentEmployee(), id, expectedVersion);
  refreshLists(edition, id);
  return result;
}

export async function returnExpenseClaimStep(
  edition: ExpenseEdition,
  id: string,
  reason: string,
  expectedVersion: number
): Promise<ActionResult> {
  if (!isExpenseEdition(edition)) return BAD_EDITION;
  const result = await service.returnExpenseClaimStep(edition, await getCurrentEmployee(), id, reason, expectedVersion);
  refreshLists(edition, id);
  return result;
}

export async function withdrawExpenseClaim(edition: ExpenseEdition, id: string): Promise<ActionResult> {
  if (!isExpenseEdition(edition)) return BAD_EDITION;
  const result = await service.withdrawExpenseClaim(edition, await getCurrentEmployee(), id);
  refreshLists(edition, id);
  return result;
}

export type { ExpenseClaimInput };
