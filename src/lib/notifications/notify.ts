import type { AppDb } from '@/lib/db/app-client';
import { sendEmail } from '@/lib/email/send';

export type NotifyInput = {
  recipientEmployeeId: string;
  type: 'approval_requested' | 'request_returned' | 'request_approved';
  formType: string;
  formId: string;
  caseNumber: string;
  message: string;
};

export type NotifyResult = { ok: true } | { ok: false; error: string };

const EMAIL_SUBJECT_PREFIX: Record<NotifyInput['type'], string> = {
  approval_requested: '【待簽核】',
  request_returned: '【已退回】',
  request_approved: '【已核准】',
};

export async function notifyAndEmail(db: AppDb, input: NotifyInput): Promise<NotifyResult> {
  const { error } = await db.from('notifications').insert({
    recipient_employee_id: input.recipientEmployeeId,
    type: input.type,
    form_type: input.formType,
    form_id: input.formId,
    case_number: input.caseNumber,
    message: input.message,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  const { data: recipient } = await db
    .from('employees')
    .select('google_email')
    .eq('id', input.recipientEmployeeId)
    .maybeSingle();
  if (!recipient?.google_email) {
    return { ok: true };
  }

  try {
    await sendEmail({
      to: recipient.google_email,
      subject: `${EMAIL_SUBJECT_PREFIX[input.type]}${input.caseNumber}`,
      text: input.message,
    });
  } catch {
    // Email is best-effort — the in-app notification row above is the source of truth.
  }
  return { ok: true };
}
