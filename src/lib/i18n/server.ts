import { cookies } from 'next/headers';
import {
  DEFAULT_LOCALE,
  getMessages,
  LOCALE_COOKIE_NAME,
  normalizeLocale,
  translatePhrase,
  type Locale,
  type TranslationShape,
} from './messages';

export async function getServerLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    const raw = store.get(LOCALE_COOKIE_NAME)?.value;
    return normalizeLocale(raw);
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function getServerI18n(): Promise<{
  locale: Locale;
  t: TranslationShape;
  tr: (phrase: string | null | undefined) => string;
}> {
  const locale = await getServerLocale();
  const t = getMessages(locale);
  return {
    locale,
    t,
    tr: (phrase) => translatePhrase(phrase, locale),
  };
}
