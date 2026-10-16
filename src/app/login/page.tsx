import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandLogo } from '@/app/components/brand-logo';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getLoginErrorMessage } from '@/lib/auth/login-errors';
import { DEFAULT_AFTER_LOGIN, safeReturnTo } from '@/lib/auth/redirect';

export const dynamic = 'force-dynamic';

function configuredOrigin(): string {
  const raw = process.env.APP_ORIGIN?.trim();
  if (!raw) return 'http://localhost:3001';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://localhost:3001';
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo ?? null, configuredOrigin());
  const employee = await getCurrentEmployee();
  if (employee) redirect(returnTo === DEFAULT_AFTER_LOGIN ? '/dashboard' : returnTo);

  const errorMessage = getLoginErrorMessage(params.error ?? null);
  const googleHref =
    returnTo && returnTo !== DEFAULT_AFTER_LOGIN
      ? `/auth/google?returnTo=${encodeURIComponent(returnTo)}`
      : '/auth/google';

  return (
    <main className="relative min-h-screen overflow-hidden bg-td-surface px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-login-grid bg-grid opacity-70" />
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-td-blue/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-td-apex/15 blur-3xl" />

      <div className="relative mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center">
        <BrandLogo href={undefined} showProduct />
        <p className="mt-4 text-center text-sm leading-6 text-td-muted">電子採購與簽核系統 · 請使用公司 Google 帳號登入</p>

        {errorMessage && (
          <p role="alert" className="mt-6 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        <div className="card mt-8 w-full space-y-4">
          <a href={googleHref} className="btn-primary flex w-full items-center justify-center gap-2 !py-3 text-base">
            <GoogleMark />
            使用 Google 帳號登入
          </a>
          <p className="text-center text-xs leading-5 text-td-muted">
            僅限公司 Workspace 帳號（@turing-drive.com）。點擊後可選擇 Google 帳號；若瀏覽器已登入公司帳號，通常不必再輸入密碼。首次登入須由管理員核准綁定後才能進入系統。
          </p>
        </div>

        <p className="mt-8 text-center text-xs text-td-muted">
          遇到問題請聯絡系統管理員，或返回{' '}
          <Link href="/" className="text-td-blue underline">
            首頁
          </Link>
          。
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        opacity=".9"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        opacity=".75"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        opacity=".6"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        opacity=".85"
      />
    </svg>
  );
}
