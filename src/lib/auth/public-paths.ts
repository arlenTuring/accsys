/** Paths reachable without a session cookie (navigation only; pages still check the session). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/email-approval' ||
    pathname === '/api/email-approval' ||
    pathname.startsWith('/api/teaching-ai') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/admin-guide/') ||
    pathname.startsWith('/guide/')
  );
}
