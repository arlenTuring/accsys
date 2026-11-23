import dns from 'node:dns';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { JWT } from 'google-auth-library';
import {
  appendEmailDeliveryLog,
  DEFAULT_DELEGATED_SENDER,
  GMAIL_SEND_SCOPE,
  getEmailSystemConfig,
  HARD_LOCKED_TEST_RECIPIENT,
  parseServiceAccountKey,
  type EmailSystemConfig,
} from '@/lib/email/config';

try {
  dns.setDefaultResultOrder('ipv4first');
  if (typeof net.setDefaultAutoSelectFamily === 'function') {
    net.setDefaultAutoSelectFamily(true);
  }
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250);
  }
  const origLookup = dns.lookup.bind(dns) as (
    hostname: string,
    options: unknown,
    callback?: unknown
  ) => unknown;
  const patchedLookup = ((
    hostname: string,
    options: unknown,
    callback?: unknown
  ) => {
    const targetHost =
      hostname === 'gmail.googleapis.com' ||
      hostname === 'oauth2.googleapis.com' ||
      hostname === 'iamcredentials.googleapis.com'
        ? 'www.googleapis.com'
        : hostname;
    if (typeof options === 'function') {
      return origLookup(targetHost, options);
    }
    return origLookup(targetHost, options, callback);
  }) as unknown as typeof dns.lookup;
  dns.lookup = patchedLookup;
} catch {
  // ignore dns patch errors
}

export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer | Uint8Array;
};

export type GmailSendInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  templateId?: string;
  attachments?: EmailAttachment[];
};

export type GmailSendResult = {
  ok: boolean;
  status: 'sent' | 'blocked_by_test_guard' | 'disabled' | 'failed';
  gmailMessageId?: string;
  delegatedUser?: string;
  finalRecipient?: string;
  reason?: string;
};

function encodeMimeWordUtf8(value: string): string {
  const clean = value.replace(/\r?\n/g, ' ').trim();
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function toBase64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function wrapBase64Lines(b64: string, lineLength = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    chunks.push(b64.slice(i, i + lineLength));
  }
  return chunks.join('\r\n');
}

/**
 * 建立符合 RFC 2822 的 MIME 郵件（支援純文字、HTML multipart/alternative 與附件 multipart/mixed），並編碼為 base64url
 */
export function buildRawMimeMessage(params: {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}): string {
  const boundary = `accsys_mime_${randomUUID().replace(/-/g, '')}`;
  const encodedFromName = params.fromName
    ? `${encodeMimeWordUtf8(params.fromName)} <${params.fromEmail}>`
    : params.fromEmail;
  const encodedSubject = encodeMimeWordUtf8(params.subject);

  const headers = [
    `From: ${encodedFromName}`,
    `To: ${params.to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
  ];

  const hasAttachments = Array.isArray(params.attachments) && params.attachments.length > 0;
  const normalizedHtml =
    params.html && params.html.trim().length > 0
      ? params.html.replace(
          /max-width:\s*6[0-9]{2}px/gi,
          'max-width: 1080px; width: 100%'
        )
      : undefined;
  const hasHtml = Boolean(normalizedHtml);

  if (hasAttachments) {
    const mixedBoundary = `accsys_mixed_${randomUUID().replace(/-/g, '')}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    const textBase64 = wrapBase64Lines(Buffer.from(params.text, 'utf8').toString('base64'));
    const parts: string[] = [...headers, ''];

    if (hasHtml) {
      const htmlBase64 = wrapBase64Lines(Buffer.from(normalizedHtml!, 'utf8').toString('base64'));
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        textBase64,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        htmlBase64,
        '',
        `--${boundary}--`,
        ''
      );
    } else {
      parts.push(
        `--${mixedBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        textBase64,
        ''
      );
    }

    for (const att of params.attachments!) {
      const attBuf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
      const attBase64 = wrapBase64Lines(attBuf.toString('base64'));
      const encodedFilename = encodeMimeWordUtf8(att.filename);
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${att.contentType}; name="${encodedFilename}"`,
        `Content-Disposition: attachment; filename="${encodedFilename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        attBase64,
        ''
      );
    }

    parts.push(`--${mixedBoundary}--`, '');
    return toBase64Url(parts.join('\r\n'));
  }

  if (hasHtml) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const textBase64 = Buffer.from(params.text, 'utf8').toString('base64');
    const htmlBase64 = Buffer.from(normalizedHtml!, 'utf8').toString('base64');

    const mimeParts = [
      ...headers,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      textBase64,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      htmlBase64,
      '',
      `--${boundary}--`,
      '',
    ];

    return toBase64Url(mimeParts.join('\r\n'));
  }

  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: base64');
  const textBase64 = Buffer.from(params.text, 'utf8').toString('base64');
  const mime = [...headers, '', textBase64, ''].join('\r\n');
  return toBase64Url(mime);
}

/**
 * 檢查收件人是否通過「測試階段白名單收信」之安全防線。
 * 在測試期間（testModeOnly = true），除了白名單信箱外，
 * 任何其他人的信箱都會被強制攔截，絕不對外發送。
 */
export function evaluateRecipientSafetyGuard(
  targetEmail: string,
  config: Pick<EmailSystemConfig, 'testModeOnly' | 'allowedTestRecipients'>
): { allowed: boolean; normalizedRecipient: string; blockReason?: string } {
  const normalized = targetEmail.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return {
      allowed: false,
      normalizedRecipient: normalized,
      blockReason: '無效的收件者信箱格式',
    };
  }

  // 環境變數或系統設定只要開啟測試鎖，就嚴格限制只准寄給白名單收件人，其他所有人一律攔截不發送
  const envForceTest = process.env.GMAIL_TEST_MODE_ONLY !== 'false';
  if (config.testModeOnly || envForceTest) {
    const allowedList = (config.allowedTestRecipients ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const effectiveAllowed =
      allowedList.length > 0 ? allowedList : [HARD_LOCKED_TEST_RECIPIENT];
    if (!effectiveAllowed.includes(normalized)) {
      return {
        allowed: false,
        normalizedRecipient: normalized,
        blockReason: `[測試安全防線攔截] 目前處於測試階段，僅允許發信給 ${effectiveAllowed.join(', ')}，已自動攔截寄往 ${normalized} 的信件。`,
      };
    }
  }

  return { allowed: true, normalizedRecipient: normalized };
}

/**
 * 透過 Google Service Account + Domain-Wide Delegation 取得指定信箱的 Access Token
 * 若管理員輸入的 delegatedUser 為不存在的別名（如 no-reply@turing-drive.com 尚未建帳號），
 * 會自動 fallback 至 turing-drive_mis@turing-drive.com 確保發信成功。
 */
let cachedDelegatedToken: {
  cacheKey: string;
  accessToken: string;
  activeDelegatedUser: string;
  expiresAt: number;
} | null = null;

async function acquireDelegatedAccessToken(
  keyJsonRaw: string,
  preferredDelegatedUser: string
): Promise<{ accessToken: string; activeDelegatedUser: string }> {
  const key = parseServiceAccountKey(keyJsonRaw);
  if (!key) {
    throw new Error('Service Account JSON 金鑰格式不正確或尚未設定');
  }

  const cacheKey = `${key.client_email}|${preferredDelegatedUser.trim().toLowerCase()}`;
  if (
    cachedDelegatedToken &&
    cachedDelegatedToken.cacheKey === cacheKey &&
    cachedDelegatedToken.expiresAt > Date.now() + 60_000
  ) {
    return {
      accessToken: cachedDelegatedToken.accessToken,
      activeDelegatedUser: cachedDelegatedToken.activeDelegatedUser,
    };
  }

  const candidates = Array.from(
    new Set(
      [
        preferredDelegatedUser.trim().toLowerCase(),
        DEFAULT_DELEGATED_SENDER,
        HARD_LOCKED_TEST_RECIPIENT,
      ].filter(Boolean)
    )
  );

  let lastError: Error | null = null;
  for (const subjectUser of candidates) {
    try {
      const jwtClient = new JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: [GMAIL_SEND_SCOPE],
        subject: subjectUser,
      });
      const tokenRes = await jwtClient.authorize();
      if (tokenRes.access_token) {
        cachedDelegatedToken = {
          cacheKey,
          accessToken: tokenRes.access_token,
          activeDelegatedUser: subjectUser,
          expiresAt: Date.now() + 50 * 60 * 1000,
        };
        return {
          accessToken: tokenRes.access_token,
          activeDelegatedUser: subjectUser,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw (
    lastError ??
    new Error('無法透過 Service Account 取得 Gmail API 委派授權 Token')
  );
}

/**
 * 使用 Google 官方推薦的 Service Account + Gmail API (`users.messages.send`) 發送郵件
 */
export async function sendViaGmailServiceAccount(
  input: GmailSendInput,
  overrideConfig?: EmailSystemConfig
): Promise<GmailSendResult> {
  const config = overrideConfig ?? (await getEmailSystemConfig());

  if (!config.enabled) {
    return {
      ok: false,
      status: 'disabled',
      reason: '系統管理員目前已停用信箱通知功能',
    };
  }

  // 第一道硬性防線：檢查是否為允許發送的測試白名單信箱
  const guard = evaluateRecipientSafetyGuard(input.to, config);
  if (!guard.allowed) {
    console.warn(
      `[email-guard] Blocked outgoing email to "${input.to}" (Subject: "${input.subject}") — ${guard.blockReason}`
    );
    await appendEmailDeliveryLog({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      originalRecipient: input.to,
      finalRecipient: guard.normalizedRecipient,
      delegatedUser: config.delegatedUser,
      displayFromEmail: config.displayFromEmail || config.delegatedUser,
      subject: input.subject,
      templateId: input.templateId,
      status: 'blocked_by_test_guard',
      note: guard.blockReason,
    });
    return {
      ok: false,
      status: 'blocked_by_test_guard',
      finalRecipient: guard.normalizedRecipient,
      reason: guard.blockReason,
    };
  }

  if (!config.serviceAccountJson) {
    const reason = '尚未設定 Google Service Account 金鑰 (.json)';
    await appendEmailDeliveryLog({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      originalRecipient: input.to,
      finalRecipient: guard.normalizedRecipient,
      delegatedUser: config.delegatedUser,
      displayFromEmail: config.displayFromEmail || config.delegatedUser,
      subject: input.subject,
      templateId: input.templateId,
      status: 'failed',
      note: reason,
    });
    return { ok: false, status: 'failed', reason };
  }

  try {
    const fromEmailHeader =
      config.displayFromEmail?.trim() ||
      config.delegatedUser ||
      DEFAULT_DELEGATED_SENDER;

    if ((globalThis as Record<string, unknown>).__e2eBatchThrottleGmail === true) {
      const syntheticId = `e2e-gmail-${randomUUID().slice(0, 12)}`;
      await appendEmailDeliveryLog({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        originalRecipient: input.to,
        finalRecipient: guard.normalizedRecipient,
        delegatedUser: config.delegatedUser || DEFAULT_DELEGATED_SENDER,
        displayFromEmail: fromEmailHeader,
        subject: input.subject,
        templateId: input.templateId,
        status: 'sent',
        gmailMessageId: syntheticId,
        note: `成功透過 Service Account 委派發送至白名單收件人 ${guard.normalizedRecipient} (Gmail ID: ${syntheticId})`,
      });
      return {
        ok: true,
        status: 'sent',
        gmailMessageId: syntheticId,
        delegatedUser: config.delegatedUser || DEFAULT_DELEGATED_SENDER,
        finalRecipient: guard.normalizedRecipient,
      };
    }

    const { accessToken, activeDelegatedUser } =
      await acquireDelegatedAccessToken(
        config.serviceAccountJson,
        config.delegatedUser
      );

    const raw = buildRawMimeMessage({
      fromName: config.displayFromName || 'TURING DRIVE ACCSYS 系統通知',
      fromEmail: fromEmailHeader,
      to: guard.normalizedRecipient,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });

    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        `Gmail API 回應錯誤 (${response.status}): ${errBody.slice(0, 300)}`
      );
    }

    const data = (await response.json()) as { id?: string; threadId?: string };

    await appendEmailDeliveryLog({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      originalRecipient: input.to,
      finalRecipient: guard.normalizedRecipient,
      delegatedUser: activeDelegatedUser,
      displayFromEmail: fromEmailHeader,
      subject: input.subject,
      templateId: input.templateId,
      status: 'sent',
      gmailMessageId: data.id,
      note: `成功透過 Service Account 委派 ${activeDelegatedUser} 發送 (Gmail ID: ${data.id ?? 'ok'})`,
    });

    return {
      ok: true,
      status: 'sent',
      gmailMessageId: data.id,
      delegatedUser: activeDelegatedUser,
      finalRecipient: guard.normalizedRecipient,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendEmailDeliveryLog({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      originalRecipient: input.to,
      finalRecipient: guard.normalizedRecipient,
      delegatedUser: config.delegatedUser,
      displayFromEmail: config.displayFromEmail || config.delegatedUser,
      subject: input.subject,
      templateId: input.templateId,
      status: 'failed',
      note: message,
    });
    return {
      ok: false,
      status: 'failed',
      finalRecipient: guard.normalizedRecipient,
      reason: message,
    };
  }
}
