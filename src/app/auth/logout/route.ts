import { NextResponse, type NextRequest } from 'next/server';
import { recordAudit } from '@/lib/audit/record';
import { getAuthConfig, sessionCookieNames } from '@/lib/auth/config';
import { clearAuthCookies, isSameOriginRequest, noStore, redirectTo } from '@/lib/auth/http';
import { revokeSessionToken } from '@/lib/auth/sessions';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** POST only (a GET logout could be triggered cross-site); revokes the DB session. */
export async function POST(request: NextRequest) {
  const cfg = getAuthConfig();
  if (!isSameOriginRequest(request, cfg.appOrigin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const token = sessionCookieNames()
    .map((name) => request.cookies.get(name)?.value)
    .find(Boolean);
  if (token) {
    await getDb().transaction(async (tx) => {
      const employeeId = await revokeSessionToken(tx, token, 'logout');
      if (employeeId) {
        await recordAudit(tx, { actorEmployeeId: employeeId, action: 'auth.logout', entityType: 'employee', entityId: employeeId });
      }
    });
  }

  const res = redirectTo(cfg, '/login');
  clearAuthCookies(res, cfg);
  return noStore(res);
}
