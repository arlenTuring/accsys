export const DEFAULT_AFTER_LOGIN = '/dashboard';

/**
 * Returns a same-origin path for a post-login redirect, or the default. Only
 * plain absolute paths on the app origin are accepted; anything that could be
 * read as another host (`//evil`, `/\evil`, schemes, encoded slashes) or points
 * back into the auth routes is replaced.
 */
export function safeReturnTo(value: string | null | undefined, appOrigin: string): string {
  if (!value || value.length > 512) return DEFAULT_AFTER_LOGIN;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_AFTER_LOGIN;
  if (/[\u0000-\u001f\\]/.test(value)) return DEFAULT_AFTER_LOGIN;
  let url: URL;
  try {
    url = new URL(value, appOrigin);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== appOrigin) return DEFAULT_AFTER_LOGIN;
  if (url.pathname === '/login' || url.pathname.startsWith('/auth/')) return DEFAULT_AFTER_LOGIN;
  return `${url.pathname}${url.search}`;
}
