/**
 * Content-Security-Policy with a per-request nonce. Next.js reads the nonce
 * from the request's CSP header and applies it to its own scripts, so no
 * 'unsafe-inline' / 'unsafe-eval' is needed for scripts in production.
 * Inline style attributes (React style props) still need 'unsafe-inline' for
 * styles; styles cannot execute script.
 */
export function buildCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' data: blob:${dev ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Static headers for every response (see next.config.ts). */
export const STATIC_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** HSTS only once HTTPS and the final domain are confirmed (ENABLE_HSTS=true), to avoid locking out test hosts. */
export function hstsHeader(env: Record<string, string | undefined> = process.env): string | null {
  return env.ENABLE_HSTS === 'true' ? 'max-age=31536000; includeSubDomains' : null;
}
