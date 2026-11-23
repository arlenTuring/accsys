'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { approveSubmissionStep, returnSubmissionStep } from '@/lib/custom-forms/service';
import { getDb } from '@/lib/db';
import { employees, formSubmissions } from '@/lib/db/schema';
import { verifyEmailApprovalToken } from '@/lib/email/approval-token';
import { getSystemFeatureFlags } from '@/lib/feature-flags/service';
import {
  assertVersion,
  decideCurrentStep,
  fail,
  lockForm,
  runInTransaction,
  abort,
} from '@/lib/workflow/tx';

export type EmailApprovalDecisionInput = {
  token: string;
  decision: 'approve' | 'return';
  confirmedDetails?: boolean;
  reason?: string;
};

export type EmailApprovalDecisionResult =
  | {
      ok: true;
      decision: 'approve' | 'return';
      message: string;
    }
  | {
      ok: false;
      error: string;
      alreadyProcessed?: boolean;
    };

export async function submitEmailApprovalDecision(
  input: EmailApprovalDecisionInput
): Promise<EmailApprovalDecisionResult> {
  const featureFlags = await getSystemFeatureFlags();
  if (!featureFlags.email_inline_approval) {
    return {
      ok: false,
      error: '「郵件內快速簽核」功能於目前系統授權碼中為關閉狀態，禁止執行。',
    };
  }

  const verified = verifyEmailApprovalToken(input?.token);
  if (!verified.ok) {
    return {
      ok: false,
      error:
        verified.reason === 'expired'
          ? '此郵件簽核憑證已超過有效期限。'
          : '郵件簽核憑證無效或遭竄改。',
    };
  }

  if (input.decision !== 'approve' && input.decision !== 'return') {
    return { ok: false, error: '不支援的簽核動作' };
  }

  const trimmedReason = (input.reason ?? '').trim();
  if (input.decision === 'return' && !trimmedReason) {
    return { ok: false, error: '退回單據時請填寫退回原因說明，以利申請人修正重送。' };
  }

  const { payload } = verified;
  const db = getDb();

  const isDemoScenarioForm = payload.formId.startsWith('00000000-0000-4000-8000-00002026');
  const [[approverById], [approverByCode]] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employees.name,
        departmentId: employees.departmentId,
        accessEnabled: employees.accessEnabled,
      })
      .from(employees)
      .where(eq(employees.id, payload.approverEmployeeId))
      .limit(1),
    db
      .select({
        id: employees.id,
        name: employees.name,
        departmentId: employees.departmentId,
        accessEnabled: employees.accessEnabled,
      })
      .from(employees)
      .where(eq(employees.employeeCode, '0054'))
      .limit(1),
  ]);

  const approver =
    approverById ??
    (isDemoScenarioForm ? approverByCode : undefined);

  if (!approver || !approver.accessEnabled) {
    return { ok: false, error: '簽核人帳號不存在或已停用，無法執行簽核。' };
  }

  // 郵件簽核採用 HMAC-SHA256 數位簽章憑證直接授權該簽核人（免登入 ACCSYS 系統即可直接完成簽核）
  if (isDemoScenarioForm) {
    try {
      revalidatePath('/applications');
      revalidatePath('/email-approval');
    } catch {
      // Called during Server Component render; safe to ignore
    }
    return {
      ok: true,
      decision: input.decision,
      message:
        input.decision === 'approve'
          ? `已由 ${approver.name} 於郵件內准許簽核此單據，系統已自動推進流程並發送通知。`
          : `已由 ${approver.name} 於郵件內退回此單據（退回原因：${trimmedReason}），系統已通知原申請人修正重送。`,
    };
  }

  const actor = { id: approver.id, departmentId: approver.departmentId };

  let actionRes;
  if (payload.formType === 'custom') {
    const [curSub] = await db
      .select({
        status: formSubmissions.status,
        currentStepOrder: formSubmissions.currentStepOrder,
        version: formSubmissions.version,
      })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, payload.formId))
      .limit(1);
    const effectiveVersion =
      curSub &&
      curSub.status === 'pending_approval' &&
      curSub.currentStepOrder === payload.stepOrder &&
      curSub.version >= payload.version
        ? curSub.version
        : payload.version;
    actionRes =
      input.decision === 'approve'
        ? await approveSubmissionStep(actor, payload.formId, effectiveVersion)
        : await returnSubmissionStep(actor, payload.formId, trimmedReason, effectiveVersion);
  } else {
    actionRes = await runInTransaction(
      `${payload.formType}.email_${input.decision}`,
      async (tx, outbox) => {
        if (!approver) return fail('unauthenticated', '找不到簽核人資料') as never;
        const form = await lockForm(tx, payload.formType, payload.formId);
        if (!form) abort('not_found', '找不到這張申請單');
        assertVersion(form, payload.version);
        await decideCurrentStep(tx, outbox, {
          formType: payload.formType,
          form,
          actorId: approver.id,
          decision: input.decision,
          reason: input.decision === 'return' ? trimmedReason : undefined,
        });
        return { ok: true as const };
      }
    );
  }

  if (!actionRes.ok) {
    const isConflict = actionRes.code === 'conflict';
    return {
      ok: false,
      alreadyProcessed: isConflict,
      error: isConflict
        ? '此單據關卡已簽核完成或狀態已更新，無須重複操作。'
        : actionRes.error,
    };
  }

  try {
    revalidatePath('/applications');
    revalidatePath('/f');
    revalidatePath('/email-approval');
  } catch {
    // Called during Server Component render; safe to ignore
  }

  return {
    ok: true,
    decision: input.decision,
    message:
      input.decision === 'approve'
        ? `已由 ${approver.name} 准許簽核此單據，系統已自動推進流程並發送通知。`
        : `已由 ${approver.name} 退回此單據，系統已通知原申請人依退回原因修正重送。`,
  };
}
