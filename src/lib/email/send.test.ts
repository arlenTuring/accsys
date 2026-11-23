import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRawMimeMessage,
  evaluateRecipientSafetyGuard,
} from './gmail-sender';
import {
  renderTemplateString,
  resolveTemplateIdForNotification,
} from './templates';

const sendMailMock = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'test' }));
const createTransportMock = vi.hoisted(() => vi.fn(() => ({ sendMail: sendMailMock })));
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

describe('sendEmail', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    sendMailMock.mockClear();
    createTransportMock.mockClear();
  });

  it('throws when SMTP_HOST is missing in pure SMTP test mode', async () => {
    vi.stubEnv('GMAIL_SERVICE_ACCOUNT_KEY_PATH', '');
    vi.stubEnv('GMAIL_SERVICE_ACCOUNT_JSON', '');
    vi.stubEnv('GMAIL_DELEGATED_USER', '');
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_USER', 'user@turing-drive.com');
    vi.stubEnv('SMTP_PASSWORD', 'app-password');
    vi.stubEnv('SMTP_FROM', 'noreply@turing-drive.com');
    const { sendEmail } = await import('./send');
    await expect(
      sendEmail({ to: 'a@turing-drive.com', subject: '主旨', text: '內容' })
    ).rejects.toThrow('Missing required environment variable: SMTP_HOST');
  });

  it('builds an SMTP transport from env vars and sends the message', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp-relay.gmail.com');
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_USER', 'user@turing-drive.com');
    vi.stubEnv('SMTP_PASSWORD', 'app-password');
    vi.stubEnv('SMTP_FROM', 'noreply@turing-drive.com');
    const { sendEmail } = await import('./send');
    await sendEmail({ to: 'a@turing-drive.com', subject: '主旨', text: '內容' });
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp-relay.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2' },
      auth: { user: 'user@turing-drive.com', pass: 'app-password' },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@turing-drive.com',
      to: 'a@turing-drive.com',
      subject: '主旨',
      text: '內容',
    });
  });

  it('marks the connection secure when the port is 465', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp-relay.gmail.com');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_USER', 'user@turing-drive.com');
    vi.stubEnv('SMTP_PASSWORD', 'app-password');
    vi.stubEnv('SMTP_FROM', 'noreply@turing-drive.com');
    const { sendEmail } = await import('./send');
    await sendEmail({ to: 'a@turing-drive.com', subject: '主旨', text: '內容' });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true })
    );
  });
});

describe('Gmail Service Account safety guard & template rendering', () => {
  it('strictly allows only whitelisted test recipients and blocks all other emails in test mode', () => {
    const allowedCheck = evaluateRecipientSafetyGuard('test-recipient@turing-drive.com', {
      testModeOnly: true,
      allowedTestRecipients: ['test-recipient@turing-drive.com'],
    });
    expect(allowedCheck.allowed).toBe(true);

    const blockedCheck = evaluateRecipientSafetyGuard('other_user@turing-drive.com', {
      testModeOnly: true,
      allowedTestRecipients: ['test-recipient@turing-drive.com'],
    });
    expect(blockedCheck.allowed).toBe(false);
    expect(blockedCheck.blockReason).toContain('僅允許發信給 test-recipient@turing-drive.com');
  });

  it('renders template variables and resolves notification categories accurately', () => {
    const rendered = renderTemplateString(
      '【待簽核】{{formLabel}} {{caseNumber}} — {{applicantName}}',
      {
        formLabel: '請購單',
        caseNumber: 'PR-20261115-0001',
        applicantName: '阮振瑋',
      }
    );
    expect(rendered).toBe('【待簽核】請購單 PR-20261115-0001 — 阮振瑋');

    expect(
      resolveTemplateIdForNotification({
        type: 'approval_requested',
        formType: 'asset_inventory',
        caseNumber: 'INV-20261115-0001',
      })
    ).toBe('asset_inventory_dispatched');

    expect(
      resolveTemplateIdForNotification({
        type: 'approval_requested',
        formType: 'budget_application',
        caseNumber: 'BDG-2026-01',
      })
    ).toBe('budget_form_dispatched');
  });

  it('encodes RFC 2822 multipart MIME into base64url format', () => {
    const raw = buildRawMimeMessage({
      fromName: 'ACCSYS 系統通知',
      fromEmail: 'no-reply@turing-drive.com',
      to: 'test-recipient@turing-drive.com',
      subject: '測試信件',
      text: '純文字內容',
      html: '<p>HTML 內容</p>',
    });
    expect(raw).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    expect(decoded).toContain('To: test-recipient@turing-drive.com');
    expect(decoded).toContain('multipart/alternative');
  });
});
