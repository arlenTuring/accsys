import { type NextRequest } from 'next/server';
import { AuthConfigError, getAuthConfig, sessionCookieNames } from '@/lib/auth/config';
import {
  clearCookie,
  clientIp,
  loginErrorRedirect,
  newRequestId,
  noStore,
  redirectTo,
  setSessionCookie,
} from '@/lib/auth/http';
import { completeLogin } from '@/lib/auth/identity';
import { consumeLogin } from '@/lib/auth/login-state';
import { exchangeCode, LoginRejected } from '@/lib/auth/oidc';
import { hitRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let cfg;
  try {
    cfg = getAuthConfig();
  } catch (err) {
    console.error('[auth] login unavailable:', err instanceof AuthConfigError ? err.message : err);
    return NextResponse.redirect(new URL('/login?error=auth_unavailable', request.nextUrl.origin), 303);
  }
  const requestId = newRequestId();

  // The login transaction cookie is single-use: removed on every outcome.
  const fail = (code: string) => {
    const res = loginErrorRedirect(cfg, code);
    clearCookie(res, cfg, cfg.loginCookieName);
    return noStore(res);
  };

  const limit = await hitRateLimit(`login-callback:${clientIp(request, cfg)}`, RATE_LIMITS.loginCallbackPerIp);
  if (!limit.allowed) return fail('rate_limited');

  const params = request.nextUrl.searchParams;
  const login = await consumeLogin(request.cookies.get(cfg.loginCookieName)?.value, params.get('state'));

  if (params.get('error')) {
    if (login?.returnTo.includes('driveAuthPopup=1')) {
      const errHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'ACCSYS_DRIVE_AUTH_SILENT_FAILED' }, '*');
          }
          if (window.opener) {
            window.opener.postMessage({ type: 'ACCSYS_DRIVE_AUTH_SILENT_FAILED' }, '*');
            window.close();
          }
        } catch (e) {}
      </script></body></html>`;
      const errRes = new NextResponse(errHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
      clearCookie(errRes, cfg, cfg.loginCookieName);
      return noStore(errRes);
    }
    return fail('auth_cancelled');
  }

  if (!login) return fail('login_expired');

  // Rebuild the callback URL on the configured origin; the Host header is ignored.
  const callbackUrl = new URL(`/auth/callback${request.nextUrl.search}`, cfg.appOrigin);

  let identity;
  try {
    identity = await exchangeCode(cfg, callbackUrl, login.checks);
  } catch (err) {
    if (err instanceof LoginRejected) return fail(err.code);
    console.error(`[auth] ref=${requestId} token exchange failed`);
    return fail('auth_failed');
  }

  const previousToken = sessionCookieNames()
    .map((name) => request.cookies.get(name)?.value)
    .find(Boolean);
  const outcome = await completeLogin(identity, { ttlMs: cfg.sessionTtlMs, previousToken, requestId });
  if (outcome.kind !== 'signed_in') {
    return fail(outcome.kind === 'denied' ? outcome.reason : outcome.kind);
  }

  if (login.returnTo.includes('driveAuthPopup=1')) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>已完成授權</title></head><body><script>
      try {
        var payload = { type: 'ACCSYS_DRIVE_AUTH_DONE', email: ${JSON.stringify(identity.email)}, ts: Date.now() };
        try {
          var bc = new BroadcastChannel('accsys_drive_auth_channel');
          bc.postMessage(payload);
          bc.close();
        } catch (e) {}
        try {
          localStorage.setItem('accsys_drive_auth_done', JSON.stringify(payload));
        } catch (e) {}
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(payload, '*');
        }
        if (window.opener) {
          window.opener.postMessage(payload, '*');
        }
        window.close();
      } catch (e) {
        window.close();
      }
    </script><p style="font-family:sans-serif;font-size:13px;color:#334155;padding:16px;">已完成 Google Drive 寫入授權，此視窗將自動關閉（若未自動關閉請直接關閉本視窗，原開啟文件已自動同步寫入）。</p></body></html>`;
    const popupRes = new NextResponse(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    clearCookie(popupRes, cfg, cfg.loginCookieName);
    setSessionCookie(popupRes, cfg, outcome.token);
    return noStore(popupRes);
  }

  const res = redirectTo(cfg, login.returnTo);
  clearCookie(res, cfg, cfg.loginCookieName);
  setSessionCookie(res, cfg, outcome.token);
  return noStore(res);
}
