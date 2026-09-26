import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { recordAudit } from '@/lib/audit/record';
import { getAuthConfig } from '@/lib/auth/config';
import { getDevPersonaEmail, isDevLoginAllowed } from '@/lib/auth/dev-personas';
import { loginErrorRedirect, noStore, redirectTo, setSessionCookie } from '@/lib/auth/http';
import { createSession } from '@/lib/auth/sessions';
import { getDb } from '@/lib/db';
import { employees } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/** Development-only persona login (404 unless `next dev` + NEXT_PUBLIC_DEV_LOGIN=true). */
export async function GET(request: NextRequest) {
  if (!isDevLoginAllowed()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const cfg = getAuthConfig();
  const email = getDevPersonaEmail(request.nextUrl.searchParams.get('as')) ?? process.env.DEV_LOGIN_EMAIL?.trim();
  if (!email) return loginErrorRedirect(cfg, 'auth_failed');

  const token = await getDb().transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id, accessEnabled: employees.accessEnabled })
      .from(employees)
      .where(eq(employees.googleEmail, email));
    if (!employee?.accessEnabled) return null;
    const session = await createSession(tx, { employeeId: employee.id, identityId: null, ttlMs: cfg.sessionTtlMs });
    await recordAudit(tx, {
      actorEmployeeId: employee.id,
      action: 'auth.dev_login',
      entityType: 'session',
      entityId: session.sessionId,
    });
    return session.token;
  });
  if (!token) return loginErrorRedirect(cfg, 'not_registered');

  const res = redirectTo(cfg, '/dashboard');
  setSessionCookie(res, cfg, token);
  return noStore(res);
}
