'use server';

import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { confirmAttachDespiteReminder } from '@/lib/attachments/confirm';

export async function confirmAttachDespiteReminderAction(input: {
  attachmentId: string;
  draftId?: string | null;
  formType?: string | null;
  formId?: string | null;
  analysisId?: string | null;
  reminderCode:
    | 'tax_id_mismatch'
    | 'tax_id_missing'
    | 'unclear'
    | 'analysis_failed'
    | 'not_invoice'
    | 'company_unset'
    | 'other';
  reminderSummary: string;
  userNote?: string | null;
  corrections?: Record<string, unknown> | null;
  expectedContentSha256: string;
  companyProfileVersion?: number | null;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  return confirmAttachDespiteReminder({
    actor: { id: employee.id, role: employee.role },
    ...input,
  });
}
