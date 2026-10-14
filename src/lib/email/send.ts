import nodemailer from 'nodemailer';
import { getRequiredEnv } from '@/lib/env';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmail(message: EmailMessage): Promise<void> {
  const host = getRequiredEnv('SMTP_HOST');
  const port = Number(getRequiredEnv('SMTP_PORT'));
  const user = getRequiredEnv('SMTP_USER');
  const pass = getRequiredEnv('SMTP_PASSWORD');
  const from = getRequiredEnv('SMTP_FROM');

  // STARTTLS is mandatory: without it a network attacker could strip TLS and
  // read SMTP_PASSWORD. Timeouts keep a hanging server from stalling the
  // request that queued the mail (sent after commit, inside the request).
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
}
