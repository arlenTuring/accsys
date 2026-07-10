export const PUBLIC_PATHS = ['/login', '/auth/callback'];

export function isPublicPath(pathname: string, publicPaths: string[] = PUBLIC_PATHS): boolean {
  return pathname === '/' || publicPaths.some((path) => pathname.startsWith(path));
}
