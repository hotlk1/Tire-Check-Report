"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createTranslator, DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale, type Translator } from "./index";

interface I18nContextValue {
  locale: Locale;
  t: Translator;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nContextValue>(() => ({ locale, t: createTranslator(locale), setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return { locale: DEFAULT_LOCALE, t: createTranslator(DEFAULT_LOCALE), setLocale: () => {} };
  }
  return ctx;
}

export function useT(): Translator {
  return useI18n().t;
}
