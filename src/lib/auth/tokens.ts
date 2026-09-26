import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token for cookies / OIDC state (base64url, 43 chars). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database stores instead of a token: lower-case SHA-256 hex. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
