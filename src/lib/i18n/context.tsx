'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { setLocaleCookieAction } from './actions';
import {
  DEFAULT_LOCALE,
  getMessages,
  LOCALE_COOKIE_NAME,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  translatePhrase,
  type Locale,
  type TranslationShape,
} from './messages';

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  isSwitching: boolean;
  t: TranslationShape;
  tr: (phrase: string | null | undefined) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  isSwitching: false,
  t: getMessages(DEFAULT_LOCALE),
  tr: (p) => p ?? '',
});

export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [isSwitching, startTransition] = useTransition();

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return;
      setLocaleState(next);
      try {
        document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(next)}; path=/; max-age=31536000; SameSite=Lax`;
        document.documentElement.lang = next;
      } catch {
        /* ignore */
      }
      startTransition(async () => {
        await setLocaleCookieAction(next);
        router.refresh();
      });
    },
    [locale, router]
  );

  const t = getMessages(locale);
  const tr = useCallback((phrase: string | null | undefined) => translatePhrase(phrase, locale), [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, isSwitching, t, tr }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * Compact language switcher pill (繁體中文 / English / 日本語)
 */
export function LanguageSwitcher({ variant = 'row' }: { variant?: 'row' | 'rail' }) {
  const { locale, setLocale, isSwitching } = useI18n();

  if (variant === 'rail') {
    const nextOrder: Record<Locale, Locale> = {
      'zh-Hant': 'en',
      en: 'ja',
      ja: 'zh-Hant',
    };
    const meta = LOCALE_LABELS[locale];
    return (
      <button
        type="button"
        disabled={isSwitching}
        onClick={() => setLocale(nextOrder[locale])}
        title={`切換語言 / Language / 言語 (${meta.native})`}
        className="flex h-9 w-9 flex-col items-center justify-center rounded-xl border border-slate-200/90 bg-white text-[10px] font-bold text-slate-700 shadow-2xs transition hover:scale-105 hover:border-td-blue/60 hover:text-td-blue disabled:opacity-60"
      >
        <span className="leading-none">{meta.short}</span>
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
      {SUPPORTED_LOCALES.map((loc) => {
        const active = locale === loc;
        const meta = LOCALE_LABELS[loc];
        return (
          <button
            key={loc}
            type="button"
            disabled={isSwitching}
            onClick={() => setLocale(loc)}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
              active
                ? 'bg-white text-td-blue shadow-2xs'
                : 'text-slate-600 hover:text-td-blue-dark'
            }`}
          >
            {meta.native}
          </button>
        );
      })}
    </div>
  );
}
