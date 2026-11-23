import { createHmac, timingSafeEqual } from 'node:crypto';
import { FORM_TYPES, type FormType } from '@/lib/procurement/form-registry';

export type EmailApprovalTokenPayload = {
  formType: FormType;
  formId: string;
  stepOrder: number;
  version: number;
  approverEmployeeId: string;
  /** Expiration timestamp in milliseconds (Epoch ms) */
  exp: number;
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const FALLBACK_HMAC_KEY = 'accsys-turing-drive-email-approval-hmac-key-v1';

function getCandidateSigningSecrets(): string[] {
  const candidates = [
    process.env.EMAIL_APPROVAL_SECRET?.trim(),
    process.env.SESSION_SECRET?.trim(),
    process.env.NEXTAUTH_SECRET?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    FALLBACK_HMAC_KEY,
  ].filter((s): s is string => Boolean(s && s.length > 0));
  return Array.from(new Set(candidates));
}

function getSigningSecret(): string {
  return getCandidateSigningSecrets()[0] || FALLBACK_HMAC_KEY;
}

function signData(encodedPayload: string, secret = getSigningSecret()): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createEmailApprovalToken(
  input: Omit<EmailApprovalTokenPayload, 'exp'> & { ttlMs?: number; now?: number }
): string {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const payload: EmailApprovalTokenPayload = {
    formType: input.formType,
    formId: input.formId,
    stepOrder: input.stepOrder,
    version: input.version,
    approverEmployeeId: input.approverEmployeeId,
    exp: now + ttlMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signData(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export type VerifyEmailApprovalTokenResult =
  | { ok: true; payload: EmailApprovalTokenPayload }
  | { ok: false; reason: 'invalid_format' | 'invalid_signature' | 'expired' };

export function verifyEmailApprovalToken(
  token: string | null | undefined,
  now = Date.now()
): VerifyEmailApprovalTokenResult {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'invalid_format' };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'invalid_format' };
  }
  const [encodedPayload, providedSig] = parts;
  const a = Buffer.from(providedSig, 'utf8');
  const matchedSecret = getCandidateSigningSecrets().some((secret) => {
    const expectedSig = signData(encodedPayload, secret);
    const b = Buffer.from(expectedSig, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  });

  if (!matchedSecret) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_format' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'invalid_format' };
  }
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.formType !== 'string' ||
    !FORM_TYPES.includes(p.formType as FormType) ||
    typeof p.formId !== 'string' ||
    typeof p.stepOrder !== 'number' ||
    typeof p.version !== 'number' ||
    typeof p.approverEmployeeId !== 'string' ||
    typeof p.exp !== 'number'
  ) {
    return { ok: false, reason: 'invalid_format' };
  }

  if (p.exp <= now) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    payload: {
      formType: p.formType as FormType,
      formId: p.formId,
      stepOrder: p.stepOrder,
      version: p.version,
      approverEmployeeId: p.approverEmployeeId,
      exp: p.exp,
    },
  };
}

export function buildEmailApprovalUrls(
  appOrigin: string,
  input: Omit<EmailApprovalTokenPayload, 'exp'>
): { token: string; approveUrl: string; returnUrl: string; actionEndpointUrl: string } {
  const cleanOrigin = appOrigin.replace(/\/$/, '');
  const token = createEmailApprovalToken(input);
  const encodedToken = encodeURIComponent(token);
  return {
    token,
    approveUrl: `${cleanOrigin}/email-approval?token=${encodedToken}&intent=approve&autoClose=1`,
    returnUrl: `${cleanOrigin}/email-approval?token=${encodedToken}&intent=return&autoClose=1`,
    actionEndpointUrl: `${cleanOrigin}/email-approval`,
  };
}
