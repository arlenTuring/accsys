'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE_NAME, normalizeLocale, type Locale } from './messages';

export async function setLocaleCookieAction(nextLocale: string): Promise<{ ok: true; locale: Locale }> {
  const locale = normalizeLocale(nextLocale);
  const store = await cookies();
  store.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return { ok: true, locale };
}
