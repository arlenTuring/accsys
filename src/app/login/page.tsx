'use client';

import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getLoginErrorMessage } from '@/lib/auth/login-errors';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const errorMessage = getLoginErrorMessage(searchParams.get('error'));

  const handleLogin = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-bold">台灣智慧駕駛 電子採購與簽核系統</h1>
      {errorMessage && (
        <p className="rounded bg-red-50 px-4 py-2 text-sm text-red-700">{errorMessage}</p>
      )}
      <button
        onClick={handleLogin}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        使用 Google 帳號登入
      </button>
    </main>
  );
}
