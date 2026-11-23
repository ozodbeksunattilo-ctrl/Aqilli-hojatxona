import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { getLocale, LOCALE_META, setLocale, subscribeLocale, type Locale } from './locale';
import { translate } from './translations';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (text: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const t = useCallback((text: string, vars?: Record<string, string | number>) => translate(text, locale, vars), [locale]);
  useEffect(() => {
    document.documentElement.lang = LOCALE_META[locale].htmlLang;
  }, [locale]);
  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

/** Call in a component so it re-renders when the language changes. */
export function useT() {
  return useI18n().t;
}
