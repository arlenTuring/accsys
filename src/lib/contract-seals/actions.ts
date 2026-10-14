'use server';

import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { checkUploadBatch } from '@/lib/attachments/batch';
import { canReadForm } from '@/lib/authz/forms';
import * as service from '@/lib/contract-seals/service';
import type { ContractSealInput } from '@/lib/contract-seals/validate';
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

const FORM = 'contract_seal_request';
const NO_FILES = '請上傳至少一個附件（用印文件；合約類另附法律顧問確認完成信件）';

export async function submitContractSealRequest(formData: FormData): Promise<SubmitResult> {
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  const req = await readSealRequest(formData);
  if ('error' in req) return req.error;
  const check = checkUploadBatch(req.files, { emptyError: NO_FILES });
  if (!check.ok) return fail('validation', check.error);
  const scanner = scannerReady();
  if (scanner) return scanner;

  const result = await service.createContractSealRequest(actor, req.payload as service.CreateContractSealInput);
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
export async function reviseContractSealRequest(id: string, mode: 'update' | 'resubmit', formData: FormData): Promise<SubmitResult> {
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

  const input = req.payload as unknown as service.EditContractSealInput;
  const result =
    mode === 'update'
      ? await service.updateContractSealRequest(actor, id, input)
      : await service.resubmitContractSealRequest(actor, id, input);
  if (!result.ok) return result;
  const attachmentErrors = await storeSealFiles(actor, FORM, id, req.files);
  refreshSealLists(FORM, id);
  return { ok: true, sealRequestId: id, attachmentErrors };
}

export async function approveContractSealStep(id: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approveContractSealStep(await getCurrentEmployee(), id, expectedVersion);
  refreshSealLists(FORM, id);
  return result;
}

export async function returnContractSealStep(id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnContractSealStep(await getCurrentEmployee(), id, reason, expectedVersion);
  refreshSealLists(FORM, id);
  return result;
}

export async function withdrawContractSealRequest(id: string): Promise<ActionResult> {
  const result = await service.withdrawContractSealRequest(await getCurrentEmployee(), id);
  refreshSealLists(FORM, id);
  return result;
}

export type { ContractSealInput };
