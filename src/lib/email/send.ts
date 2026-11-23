import nodemailer from 'nodemailer';
import { getRequiredEnv } from '@/lib/env';
import { getEmailSystemConfig } from '@/lib/email/config';
import {
  sendViaGmailServiceAccount,
  type EmailAttachment,
} from '@/lib/email/gmail-sender';
import {
  renderTemplateString,
  resolveTemplateIdForNotification,
} from '@/lib/email/templates';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  templateId?: string;
  templateVars?: Record<string, string | undefined>;
  attachments?: EmailAttachment[];
};

export async function sendEmail(message: EmailMessage): Promise<void> {
  // Legacy / unit-test SMTP path when SMTP_HOST is explicitly configured in env
  if (process.env.SMTP_HOST?.trim()) {
    const host = getRequiredEnv('SMTP_HOST');
    const port = Number(getRequiredEnv('SMTP_PORT'));
    const user = getRequiredEnv('SMTP_USER');
    const pass = getRequiredEnv('SMTP_PASSWORD');
    const from = getRequiredEnv('SMTP_FROM');

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      tls: { minVersion: 'TLSv1.2' },
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    await transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return;
  }

  // Check if Google Service Account + Gmail API is available or configured
  const hasGmailSaEnv = Boolean(
    process.env.GMAIL_SERVICE_ACCOUNT_KEY_PATH?.trim() ||
      process.env.GMAIL_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GMAIL_DELEGATED_USER?.trim()
  );

  // Preserve original unit-test behavior when neither SMTP_HOST nor Gmail Service Account is configured in test env
  if (process.env.NODE_ENV === 'test' && !hasGmailSaEnv) {
    getRequiredEnv('SMTP_HOST');
  }

  const config = await getEmailSystemConfig();
  if (!config.serviceAccountJson) {
    // Fallback check for SMTP_HOST so callers know why it failed if neither is set
    getRequiredEnv('SMTP_HOST');
  }

  let finalSubject = message.subject;
  let finalText = message.text;
  let finalHtml = message.html;
  const templateId = message.templateId;

  if (templateId || message.templateVars) {
    const matchedTemplate = config.templates.find(
      (t) => t.id === (templateId ?? 'approval_requested')
    );
    if (matchedTemplate) {
      if (!matchedTemplate.enabled) {
        return; // Admin disabled this specific template
      }
      const vars: Record<string, string | undefined> = {
        companyName: '圖靈駕馭股份有限公司 (TURING DRIVE)',
        actionUrl: `${process.env.APP_ORIGIN || 'http://localhost:3001'}/applications`,
        recipientEmail: message.to,
        recipientName: message.to.split('@')[0],
        message: message.text,
        ...message.templateVars,
      };
      if (message.templateVars) {
        finalSubject = renderTemplateString(matchedTemplate.subjectTemplate, vars);
        finalText = renderTemplateString(matchedTemplate.bodyTextTemplate, vars);
        if (
          vars.documentDetailsText &&
          !matchedTemplate.bodyTextTemplate.includes('documentDetailsText')
        ) {
          finalText = `${finalText}\n\n${vars.documentDetailsText}`;
        }
        if (
          vars.approvalActionsText &&
          !matchedTemplate.bodyTextTemplate.includes('approvalActionsText')
        ) {
          finalText = `${finalText}\n${vars.approvalActionsText}`;
        }
      }
      if (!finalHtml && matchedTemplate.bodyHtmlTemplate) {
        let htmlTemplate = matchedTemplate.bodyHtmlTemplate;
        if (
          (vars.documentDetailsHtml || vars.approvalActionsHtml) &&
          !htmlTemplate.includes('documentDetailsHtml') &&
          !htmlTemplate.includes('approvalActionsHtml')
        ) {
          const footerBlockRegex =
            /<div style="margin-top:\s*24px;\s*padding-top:\s*16px;[\s\S]*?<\/div>/i;
          if (footerBlockRegex.test(htmlTemplate)) {
            htmlTemplate = htmlTemplate.replace(
              footerBlockRegex,
              `{{documentDetailsHtml}}\n{{approvalActionsHtml}}`
            );
          } else {
            htmlTemplate = `${htmlTemplate}\n{{documentDetailsHtml}}\n{{approvalActionsHtml}}`;
          }
        }
        // Remove any legacy footer button jumping to ACCSYS main system when approvalActionsHtml is present
        if (vars.approvalActionsHtml) {
          htmlTemplate = htmlTemplate.replace(
            /<div style="margin-top:\s*24px;\s*padding-top:\s*16px;[\s\S]*?前往 ACCSYS 系統[\s\S]*?<\/div>/gi,
            ''
          );
        }
        finalHtml = renderTemplateString(htmlTemplate, vars).replace(
          /max-width:\s*6[0-9]{2}px/gi,
          'max-width: 1080px; width: 100%'
        );
      }
    }
  }

  await sendViaGmailServiceAccount(
    {
      to: message.to,
      subject: finalSubject,
      text: finalText,
      html: finalHtml,
      templateId,
      attachments: message.attachments,
    },
    config
  );
}

/**
 * 判斷目前系統是否已啟用任何發信管道（Gmail Service Account 或 SMTP）
 */
export async function isEmailDeliveryConfigured(): Promise<boolean> {
  if (process.env.SMTP_HOST?.trim()) return true;
  if (
    process.env.GMAIL_SERVICE_ACCOUNT_KEY_PATH?.trim() ||
    process.env.GMAIL_SERVICE_ACCOUNT_JSON?.trim()
  ) {
    return true;
  }
  const config = await getEmailSystemConfig();
  return Boolean(config.enabled && config.serviceAccountJson);
}

export { resolveTemplateIdForNotification };
