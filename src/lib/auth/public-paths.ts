/** Paths reachable without a session cookie (navigation only; pages still check the session). */
export function isPublicPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/login' || pathname.startsWith('/auth/');
}
