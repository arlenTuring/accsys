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

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
