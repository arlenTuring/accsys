'use server';

import { revalidatePath } from 'next/cache';
import { checkUploadBatch } from '@/lib/attachments/batch';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import * as service from '@/lib/custom-forms/service';
import { attachmentCount, readSealRequest, scannerReady, storeSealFiles } from '@/lib/seal-requests/submission';
import { fail, type ActionResult, type Failure } from '@/lib/workflow/tx';

// Thin server-action wrappers for designer forms: the actor always comes from
// the session; every rule and the transaction live in service.ts. Files are
// stored after the form commits (a failed file is reported, the form stays).

export type SubmitResult = { ok: true; submissionId: string; key: string; attachmentErrors: string[] } | Failure;

const FORM = 'custom';

function refresh() {
  revalidatePath('/approvals');
  revalidatePath('/f', 'layout');
}

async function checkFiles(files: { name: string; bytes: Uint8Array }[], existing: number): Promise<Failure | null> {
  if (files.length === 0) return null;
  const check = checkUploadBatch(files, { existing, emptyError: '' });
  if (!check.ok) return fail('validation', check.error);
  return scannerReady();
}

export async function submitCustomForm(key: string, formData: FormData): Promise<SubmitResult> {
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  const req = await readSealRequest(formData);
  if ('error' in req) return req.error;
  const fileProblem = await checkFiles(req.files, 0);
  if (fileProblem) return fileProblem;

  const result = await service.createSubmission(actor, key, {
    data: req.payload.data,
    idempotencyKey: req.payload.idempotencyKey as string,
    fileCount: req.files.length,
    applicantEmployeeId: req.payload.applicantEmployeeId,
  });
  if (!result.ok) return result;
  // A replayed submit (double click / retry) already stored its files.
  const attachmentErrors =
    result.replayed || (await attachmentCount(FORM, result.submissionId)) > 0
      ? []
      : await storeSealFiles(actor, FORM, result.submissionId, req.files);
  refresh();
  return { ok: true, submissionId: result.submissionId, key, attachmentErrors };
}

export async function reviseCustomForm(key: string, id: string, mode: 'update' | 'resubmit', formData: FormData): Promise<SubmitResult> {
  if (mode !== 'update' && mode !== 'resubmit') return fail('validation', '操作不正確');
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料');
  if (!(await canReadForm(actor, FORM, id))) return fail('not_found', '找不到這張申請單');
  const req = await readSealRequest(formData);
  if ('error' in req) return req.error;
  const fileProblem = await checkFiles(req.files, await attachmentCount(FORM, id));
  if (fileProblem) return fileProblem;

  const result = await service.reviseSubmission(actor, id, mode, {
    data: req.payload.data,
    expectedVersion: req.payload.expectedVersion as number,
    newFileCount: req.files.length,
  });
  if (!result.ok) return result;
  const attachmentErrors = await storeSealFiles(actor, FORM, id, req.files);
  refresh();
  return { ok: true, submissionId: id, key, attachmentErrors };
}

export async function approveCustomFormStep(id: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.approveSubmissionStep(await getCurrentEmployee(), id, expectedVersion);
  refresh();
  return result;
}

export async function returnCustomFormStep(id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  const result = await service.returnSubmissionStep(await getCurrentEmployee(), id, reason, expectedVersion);
  refresh();
  return result;
}

export async function setCustomFormFinanceCell(id: string, input: service.FinanceCellInput): Promise<ActionResult> {
  const actor = await getCurrentEmployee();
  if (!actor) return fail('unauthenticated', '找不到您的員工資料');
  if (!(await canReadForm(actor, FORM, id))) return fail('not_found', '找不到這張申請單');
  const result = await service.setFinanceCell(actor, id, input);
  refresh();
  return result;
}

export async function withdrawCustomForm(id: string): Promise<ActionResult> {
  const result = await service.withdrawSubmission(await getCurrentEmployee(), id);
  refresh();
  return result;
}
