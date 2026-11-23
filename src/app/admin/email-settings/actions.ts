'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ADMIN_NAV_PERMISSIONS, hasAnyPermission } from '@/lib/authz/permissions';
import {
  getEmailSystemConfig,
  HARD_LOCKED_TEST_RECIPIENT,
  parseServiceAccountKey,
  saveEmailSystemConfig,
  toPublicEmailConfig,
  type PublicEmailSystemConfig,
} from '@/lib/email/config';
import { sendViaGmailServiceAccount } from '@/lib/email/gmail-sender';
import {
  DEFAULT_EMAIL_TEMPLATES,
  renderTemplateString,
  SAMPLE_APPROVAL_ACTIONS_HTML,
  SAMPLE_DOCUMENT_DETAILS_HTML,
  type EmailTemplateDefinition,
} from '@/lib/email/templates';
import {
  executeAllWorkScenariosWithEmail,
  executeWorkScenarioWithEmail,
  type WorkScenarioExecutionResult,
} from '@/lib/email/work-scenarios';

async function requireAdminActor() {
  const employee = await getCurrentEmployee();
  if (!employee) return null;
  if (
    employee.role === 'admin' ||
    hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS)
  ) {
    return employee;
  }
  return null;
}

export async function updateEmailConnectionSettingsAction(input: {
  enabled: boolean;
  delegatedUser: string;
  displayFromEmail: string;
  displayFromName: string;
  testModeOnly: boolean;
  allowedTestRecipients: string[];
  serviceAccountJsonInput?: string;
}): Promise<
  | { ok: true; config: PublicEmailSystemConfig; message: string }
  | { ok: false; error: string }
> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: '需要系統管理員權限' };

  const current = await getEmailSystemConfig();
  let nextSaJson = current.serviceAccountJson;

  if (input.serviceAccountJsonInput && input.serviceAccountJsonInput.trim()) {
    const parsed = parseServiceAccountKey(input.serviceAccountJsonInput.trim());
    if (!parsed) {
      return {
        ok: false,
        error:
          '憑證金鑰 JSON 格式不正確：必須為 Google Cloud Service Account Key (包含 type="service_account"、project_id、client_email 與 private_key)。',
      };
    }
    nextSaJson = JSON.stringify(parsed, null, 2);
  }

  const delegatedUser = input.delegatedUser.trim().toLowerCase();
  if (!delegatedUser || !delegatedUser.includes('@')) {
    return { ok: false, error: '請輸入有效的委派發信信箱地址（例如 turing-drive_mis@turing-drive.com 或 no-reply@turing-drive.com）' };
  }

  const displayFromEmail =
    input.displayFromEmail.trim().toLowerCase() || delegatedUser;
  const displayFromName =
    input.displayFromName.trim() || 'TURING DRIVE ACCSYS 系統通知';

  // 安全規則：在目前測試階段，確保測試白名單信箱有效
  const cleanedRecipients = Array.from(
    new Set(
      (input.allowedTestRecipients.length > 0
        ? input.allowedTestRecipients
        : [HARD_LOCKED_TEST_RECIPIENT]
      )
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r.includes('@'))
    )
  );
  if (cleanedRecipients.length === 0) {
    cleanedRecipients.push(HARD_LOCKED_TEST_RECIPIENT);
  }

  const updated = {
    ...current,
    enabled: Boolean(input.enabled),
    delegatedUser,
    displayFromEmail,
    displayFromName,
    testModeOnly: Boolean(input.testModeOnly),
    allowedTestRecipients: cleanedRecipients,
    serviceAccountJson: nextSaJson,
    updatedAt: new Date().toISOString(),
    updatedByEmail: actor.email,
  };

  await saveEmailSystemConfig(updated);
  revalidatePath('/admin/email-settings');

  return {
    ok: true,
    config: toPublicEmailConfig(updated),
    message: '已儲存 Google Service Account 與信箱發送設定',
  };
}

export async function updateEmailTemplatesAction(input: {
  templates: Array<{
    id: string;
    enabled: boolean;
    subjectTemplate: string;
    bodyTextTemplate: string;
    bodyHtmlTemplate: string;
  }>;
}): Promise<
  | { ok: true; config: PublicEmailSystemConfig; message: string }
  | { ok: false; error: string }
> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: '需要系統管理員權限' };

  const current = await getEmailSystemConfig();
  const patchMap = new Map(input.templates.map((t) => [t.id, t]));

  const nextTemplates: EmailTemplateDefinition[] = current.templates.map((tpl) => {
    const patch = patchMap.get(tpl.id);
    if (!patch) return tpl;
    return {
      ...tpl,
      enabled: Boolean(patch.enabled),
      subjectTemplate: patch.subjectTemplate.trim() || tpl.subjectTemplate,
      bodyTextTemplate: patch.bodyTextTemplate.trim() || tpl.bodyTextTemplate,
      bodyHtmlTemplate: patch.bodyHtmlTemplate.trim() || tpl.bodyHtmlTemplate,
    };
  });

  const updated = {
    ...current,
    templates: nextTemplates,
    updatedAt: new Date().toISOString(),
    updatedByEmail: actor.email,
  };

  await saveEmailSystemConfig(updated);
  revalidatePath('/admin/email-settings');

  return {
    ok: true,
    config: toPublicEmailConfig(updated),
    message: '已更新信件內容模板設定',
  };
}

export async function resetEmailTemplateToDefaultAction(templateId: string): Promise<
  | { ok: true; config: PublicEmailSystemConfig; message: string }
  | { ok: false; error: string }
> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: '需要系統管理員權限' };

  const def = DEFAULT_EMAIL_TEMPLATES.find((d) => d.id === templateId);
  if (!def) return { ok: false, error: '找不到指定的預設模板' };

  const current = await getEmailSystemConfig();
  const nextTemplates = current.templates.map((t) =>
    t.id === templateId ? { ...def } : t
  );

  const updated = {
    ...current,
    templates: nextTemplates,
    updatedAt: new Date().toISOString(),
    updatedByEmail: actor.email,
  };

  await saveEmailSystemConfig(updated);
  revalidatePath('/admin/email-settings');

  return {
    ok: true,
    config: toPublicEmailConfig(updated),
    message: `已將「${def.name}」還原為系統預設樣板`,
  };
}

export async function sendTestEmailAction(input: {
  recipientEmail: string;
  templateId: string;
}): Promise<
  | {
      ok: true;
      message: string;
      config: PublicEmailSystemConfig;
    }
  | {
      ok: false;
      error: string;
      config: PublicEmailSystemConfig;
    }
> {
  const actor = await requireAdminActor();
  const current = await getEmailSystemConfig();
  if (!actor) {
    return {
      ok: false,
      error: '需要系統管理員權限',
      config: toPublicEmailConfig(current),
    };
  }

  const tpl =
    current.templates.find((t) => t.id === input.templateId) ??
    current.templates[0];
  if (!tpl) {
    return {
      ok: false,
      error: '找不到測試信件模板',
      config: toPublicEmailConfig(current),
    };
  }

  const sampleVars: Record<string, string> = {
    recipientName: '簽核主管',
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    applicantName: '阮振瑋',
    departmentName: '自動駕駛系統部 (ADS)',
    formLabel: '公出差旅申請單',
    caseNumber: '20261117BT0001',
    title: '新竹竹北高鐵自駕場域光達道路實測與 V2X 聯調',
    amount: 'NT$ 3,600',
    stepLabel: '第 2 關：高階主管覆核（待您簽核）',
    reason: '單筆採購金額逾 5 萬元，請補附第二家供應商比價報價單與原廠保固年限說明',
    message: `阮振瑋（自動駕駛系統部）提出「公出差旅申請單 20261117BT0001」（事由：赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 聯調），套用樣板：【${tpl.name}】。`,
    actionUrl: `${process.env.APP_ORIGIN || 'http://localhost:3001'}/applications`,
    companyName: '台灣智慧駕駛股份有限公司 (TURING DRIVE)',
    documentDetailsHtml: SAMPLE_DOCUMENT_DETAILS_HTML,
    documentDetailsText:
      '【單據欄位明細】\n・申請總額：NT$ 3,600\n・出差時間：2026/11/19 08:30 ～ 2026/11/19 18:30\n・出差地點：新竹縣竹北市（高鐵自駕測試場域）\n・出差事由：赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 聯調',
    approvalActionsHtml:
      tpl.id === 'approval_requested' ? SAMPLE_APPROVAL_ACTIONS_HTML : '',
    approvalActionsText: '',
  };

  const subject = renderTemplateString(tpl.subjectTemplate, sampleVars);
  const text = renderTemplateString(tpl.bodyTextTemplate, sampleVars);
  const html = renderTemplateString(tpl.bodyHtmlTemplate, sampleVars);

  const res = await sendViaGmailServiceAccount({
    to: input.recipientEmail.trim(),
    subject,
    text,
    html,
    templateId: tpl.id,
  });

  const refreshed = await getEmailSystemConfig();
  revalidatePath('/admin/email-settings');

  if (!res.ok) {
    return {
      ok: false,
      error: res.reason || '發送失敗',
      config: toPublicEmailConfig(refreshed),
    };
  }

  return {
    ok: true,
    message: `測試信已成功寄出！收件人：${res.finalRecipient}（委派信箱：${res.delegatedUser}，Gmail Message ID: ${res.gmailMessageId ?? 'OK'}）`,
    config: toPublicEmailConfig(refreshed),
  };
}

export async function runSingleWorkScenarioEmailAction(
  scenarioId: string
): Promise<
  | {
      ok: true;
      result: WorkScenarioExecutionResult;
      config: PublicEmailSystemConfig;
      message: string;
    }
  | {
      ok: false;
      error: string;
      config: PublicEmailSystemConfig;
    }
> {
  const actor = await requireAdminActor();
  const current = await getEmailSystemConfig();
  if (!actor) {
    return {
      ok: false,
      error: '需要系統管理員權限',
      config: toPublicEmailConfig(current),
    };
  }

  try {
    const result = await executeWorkScenarioWithEmail(scenarioId, {
      createDbRecords: true,
    });
    const refreshed = await getEmailSystemConfig();
    revalidatePath('/admin/email-settings');
    revalidatePath('/notifications');
    revalidatePath('/my-tasks/budget');
    revalidatePath('/assets/mine');

    const statusLabel =
      result.actualStatus === 'sent'
        ? `已寄達 ${result.recipientEmail} (Gmail ID: ${result.gmailMessageId ?? 'OK'})`
        : result.actualStatus === 'blocked_by_test_guard'
          ? `已由安全防線攔截 (${result.recipientEmail})`
          : `狀態：${result.actualStatus}`;

    return {
      ok: true,
      result,
      config: toPublicEmailConfig(refreshed),
      message: `[${result.code}] ${result.title} — ${statusLabel}｜${result.dbRecordSummary}`,
    };
  } catch (err) {
    const refreshed = await getEmailSystemConfig();
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      config: toPublicEmailConfig(refreshed),
    };
  }
}

export async function runAllWorkScenariosEmailAction(): Promise<
  | {
      ok: true;
      summary: {
        total: number;
        passedCount: number;
        sentCount: number;
        blockedByGuardCount: number;
        results: WorkScenarioExecutionResult[];
      };
      config: PublicEmailSystemConfig;
      message: string;
    }
  | {
      ok: false;
      error: string;
      config: PublicEmailSystemConfig;
    }
> {
  const actor = await requireAdminActor();
  const current = await getEmailSystemConfig();
  if (!actor) {
    return {
      ok: false,
      error: '需要系統管理員權限',
      config: toPublicEmailConfig(current),
    };
  }

  try {
    const summary = await executeAllWorkScenariosWithEmail();
    const refreshed = await getEmailSystemConfig();
    revalidatePath('/admin/email-settings');
    revalidatePath('/notifications');
    revalidatePath('/my-tasks/budget');
    revalidatePath('/assets/mine');

    return {
      ok: true,
      summary,
      config: toPublicEmailConfig(refreshed),
      message: `已完成全系統 ${summary.total} 項工作情境測試：通過 ${summary.passedCount}/${summary.total}（成功寄達白名單信箱共 ${summary.sentCount} 封，安全防線攔截非白名單信箱 ${summary.blockedByGuardCount} 封）。`,
    };
  } catch (err) {
    const refreshed = await getEmailSystemConfig();
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      config: toPublicEmailConfig(refreshed),
    };
  }
}

