'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BrandLogo } from '@/app/components/brand-logo';
import { DEV_PERSONAS, isDevLoginEnabled } from '@/lib/auth/dev-personas';
import { getLoginErrorMessage } from '@/lib/auth/login-errors';

function PersonaCard({ persona }: { persona: (typeof DEV_PERSONAS)[number] }) {
  return (
    <a
      href={`/auth/dev?as=${persona.id}`}
      className="card group flex flex-col gap-3 transition hover:border-td-blue/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-td-blue">{persona.label}</p>
          <h2 className="mt-1 text-lg font-bold text-td-blue-dark">{persona.name}</h2>
          <p className="text-sm text-td-muted">
            {persona.department} · {persona.title}
          </p>
        </div>
        <span className="badge bg-td-blue-light text-td-blue">{persona.roleLabel}</span>
      </div>
      <p className="text-sm leading-6 text-td-muted">{persona.description}</p>
      <ul className="flex flex-wrap gap-2">
        {persona.highlights.map((item) => (
          <li key={item} className="rounded-md bg-td-surface px-2 py-1 text-xs text-td-blue-dark">
            {item}
          </li>
        ))}
      </ul>
      <span className="btn-primary mt-1 w-full text-center group-hover:bg-td-apex-dark group-hover:text-white">
        以此角色登入
      </span>
    </a>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const errorMessage = getLoginErrorMessage(searchParams.get('error'));
  const showDevLogin = isDevLoginEnabled();
  // The server re-validates returnTo; this only carries it through.
  const returnTo = searchParams.get('returnTo');
  const googleHref = returnTo ? `/auth/google?returnTo=${encodeURIComponent(returnTo)}` : '/auth/google';

  return (
    <main className="relative min-h-screen overflow-hidden bg-td-surface px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-login-grid bg-grid opacity-70" />
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-td-blue/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-td-apex/15 blur-3xl" />

      <div className="relative mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogo href={undefined} showProduct />
          <p className="mt-4 max-w-xl text-sm leading-6 text-td-muted">
            電子採購與簽核系統 · 請選擇示範角色登入，體驗不同身分的介面與待辦內容
          </p>
        </div>

        {errorMessage && (
          <p className="mx-auto mb-6 max-w-3xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        {showDevLogin ? (
          <div className="grid gap-4 md:grid-cols-2">
            {DEV_PERSONAS.map((persona) => (
              <PersonaCard key={persona.id} persona={persona} />
            ))}
          </div>
        ) : (
          <div className="card mx-auto max-w-md">
            <a href={googleHref} className="btn-primary w-full">
              使用 Google 帳號登入
            </a>
          </div>
        )}

        {showDevLogin && (
          <p className="mt-8 text-center text-xs leading-5 text-td-muted">
            本機示範模式 · 各角色對應不同假資料與導覽項目
            <br />
            正式環境請使用{' '}
            <a href={googleHref} className="text-td-blue underline">
              Google 公司帳號
            </a>
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
