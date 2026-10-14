'use server';

import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { checkUploadBatch } from '@/lib/attachments/batch';
import { canReadForm } from '@/lib/authz/forms';
import * as service from '@/lib/invoice-seals/service';
import {
  attachmentCount,
  readSealRequest,
  refreshSealLists,
  scannerReady,
  storeSealFiles,
  type SubmitResult,
} from '@/lib/seal-requests/submission';
import { fail, type ActionResult } from '@/lib/workflow/tx';

// Thin server-action wrappers: the actor always comes from the session; all
// rules and the transaction live in service.ts.

export type { ActionResult, SubmitResult };

const FORM = 'invoice_seal_request';
const NO_FILES = '請上傳開立依據（合約或報價單）';

export async function submitInvoiceSealRequest(formData: FormData): Promise<SubmitResult> {
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  const req = await readSealRequest(formData);
  if ('error' in req) return req.error;
  const check = checkUploadBatch(req.files, { emptyError: NO_FILES });
  if (!check.ok) return fail('validation', check.error);
  const scanner = scannerReady();
  if (scanner) return scanner;

  const result = await service.createInvoiceSealRequest(actor, req.payload as service.CreateInvoiceSealInput);
  if (!result.ok) return result;
  // A replayed submit (double click / retry) already stored its files.
  const attachmentErrors =
    result.replayed || (await attachmentCount(FORM, result.sealRequestId)) > 0
      ? []
      : await storeSealFiles(actor, FORM, result.sealRequestId, req.files);
  refreshSealLists(FORM, result.sealRequestId);
  return { ok: true, sealRequestId: result.sealRequestId, caseNumber: result.caseNumber, attachmentErrors };
}

/** Edit before the first decision, or resubmit after a return; extra files may be added. */
export async function reviseInvoiceSealRequest(id: string, mode: 'update' | 'resubmit', formData: FormData): Promise<SubmitResult> {
  if (mode !== 'update' && mode !== 'resubmit') return fail('validation', '操作不正確');
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料');
  if (!(await canReadForm(actor, FORM, id))) return fail('not_found', '找不到這張用印申請單');
  const req = await readSealRequest(formData);
  if ('error' in req) return req.error;
  const check = checkUploadBatch(req.files, { existing: await attachmentCount(FORM, id), emptyError: NO_FILES });
  if (!check.ok) return fail('validation', check.error);
  if (req.files.length > 0) {
    const scanner = scannerReady();
    if (scanner) return scanner;
  }

  const input = req.payload as unknown as service.EditInvoiceSealInput;
  const result =
    mode === 'update'
      ? await service.updateInvoiceSealRequest(actor, id, input)
      : await service.resubmitInvoiceSealRequest(actor, id, input);
  if (!result.ok) return result;
  const attachmentErrors = await storeSealFiles(actor, FORM, id, req.files);
  refreshSealLists(FORM, id);
  return { ok: true, sealRequestId: id, attachmentErrors };
}

export async function approveInvoiceSealStep(id: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approveInvoiceSealStep(await getCurrentEmployee(), id, expectedVersion);
  refreshSealLists(FORM, id);
  return result;
}

export async function returnInvoiceSealStep(id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnInvoiceSealStep(await getCurrentEmployee(), id, reason, expectedVersion);
  refreshSealLists(FORM, id);
  return result;
}

export async function withdrawInvoiceSealRequest(id: string): Promise<ActionResult> {
  const result = await service.withdrawInvoiceSealRequest(await getCurrentEmployee(), id);
  refreshSealLists(FORM, id);
  return result;
}
