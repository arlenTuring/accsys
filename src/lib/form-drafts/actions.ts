'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  deleteFormDraftForOwner,
  saveFormDraftForOwner,
  type SavedFormDraft,
} from './service';

export async function saveFormDraftAction(input: {
  draftId?: string | null;
  applicantEmployeeId?: string | null;
  formType?: string;
  formKey: string;
  formLabel: string;
  title?: string;
  data: Record<string, unknown>;
}): Promise<{ ok: true; draft: SavedFormDraft } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return { ok: false, error: '請先登入後再暫存草稿' };
  }
  const result = await saveFormDraftForOwner({
    ...input,
    ownerEmployeeId: employee.id,
  });
  if (result.ok) {
    revalidatePath('/applications');
    revalidatePath('/approvals');
    revalidatePath(`/f/${input.formKey}`);
    revalidatePath(`/f/${input.formKey}/new`);
  }
  return result;
}

export async function deleteFormDraftAction(
  draftId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return { ok: false, error: '請先登入' };
  }
  const deleted = await deleteFormDraftForOwner(draftId, employee.id);
  if (!deleted) {
    return { ok: false, error: '找不到此暫存草稿或已刪除' };
  }
  revalidatePath('/applications');
  revalidatePath('/approvals');
  return { ok: true };
}
