import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('throws when SMTP_HOST is missing', async () => {
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
