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
import * as service from '@/lib/travel-expenses/service';
import type { TravelExpenseInput } from '@/lib/travel-expenses/validate';
import { fail, type ActionResult, type Failure } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts. Form fields travel as a JSON
// `payload` next to the receipt files in one multipart request.

export type { ActionResult };
export type SubmitResult =
  | { ok: true; travelExpenseId: string; caseNumber?: string; attachmentErrors: string[] }
  | Failure;

const FORM = 'travel_expense';
const NO_RECEIPTS = '請上傳至少一個附件（報支單據、購票證明等）';

function refreshLists(id?: string) {
  revalidatePath('/travel-expenses');
  revalidatePath('/approvals');
  if (id) revalidatePath(`/travel-expenses/${id}`);
}

async function readRequest(formData: FormData) {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { error: fail('validation', '表單內容不正確，請重新整理頁面後再試') };
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const receipts = await Promise.all(files.map(async (f) => ({ file: f, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  return { payload: payload as Record<string, unknown>, receipts };
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
async function storeReceipts(
  actor: Awaited<ReturnType<typeof getCurrentEmployee>>,
  formId: string,
  receipts: { file: File; name: string }[]
): Promise<string[]> {
  const errors: string[] = [];
  for (const r of receipts) {
    const result = await uploadAttachmentFor(actor, FORM, formId, r.file);
    if (!result.ok) errors.push(`${r.name}：${result.error}`);
  }
  return errors;
}

export async function submitTravelExpense(formData: FormData): Promise<SubmitResult> {
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  const req = await readRequest(formData);
  if ('error' in req) return req.error!;
  const check = checkUploadBatch(req.receipts, { emptyError: NO_RECEIPTS });
  if (!check.ok) return fail('validation', check.error);
  const scanner = scannerReady();
  if (scanner) return scanner;

  const result = await service.createTravelExpense(actor, req.payload as service.CreateTravelExpenseInput);
  if (!result.ok) return result;
  // A replayed submit (double click / retry) already stored its files.
  const attachmentErrors =
    result.replayed || (await attachmentCount(result.travelExpenseId)) > 0
      ? []
      : await storeReceipts(actor, result.travelExpenseId, req.receipts);
  refreshLists(result.travelExpenseId);
  return { ok: true, travelExpenseId: result.travelExpenseId, caseNumber: result.caseNumber, attachmentErrors };
}

/** Edit before the first decision, or resubmit after a return; extra receipts may be added. */
export async function reviseTravelExpense(id: string, mode: 'update' | 'resubmit', formData: FormData): Promise<SubmitResult> {
  if (mode !== 'update' && mode !== 'resubmit') return fail('validation', '操作不正確');
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料');
  if (!(await canReadForm(actor, FORM, id))) return fail('not_found', '找不到這張出差報告暨旅費報支單');
  const req = await readRequest(formData);
  if ('error' in req) return req.error!;
  const check = checkUploadBatch(req.receipts, { existing: await attachmentCount(id), emptyError: NO_RECEIPTS });
  if (!check.ok) return fail('validation', check.error);
  if (req.receipts.length > 0) {
    const scanner = scannerReady();
    if (scanner) return scanner;
  }

  const input = req.payload as unknown as service.EditTravelExpenseInput;
  const result =
    mode === 'update'
      ? await service.updateTravelExpense(actor, id, input)
      : await service.resubmitTravelExpense(actor, id, input);
  if (!result.ok) return result;
  const attachmentErrors = await storeReceipts(actor, id, req.receipts);
  refreshLists(id);
  return { ok: true, travelExpenseId: id, attachmentErrors };
}

export async function approveTravelExpenseStep(id: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approveTravelExpenseStep(await getCurrentEmployee(), id, expectedVersion);
  refreshLists(id);
  return result;
}

export async function returnTravelExpenseStep(id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnTravelExpenseStep(await getCurrentEmployee(), id, reason, expectedVersion);
  refreshLists(id);
  return result;
}

export async function withdrawTravelExpense(id: string): Promise<ActionResult> {
  const result = await service.withdrawTravelExpense(await getCurrentEmployee(), id);
  refreshLists(id);
  return result;
}

export type { TravelExpenseInput };
