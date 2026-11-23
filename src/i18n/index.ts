export { LOCALES, LOCALE_META, getLocale, setLocale, subscribeLocale, type Locale } from './locale';
export { translate } from './translations';
export { I18nProvider, useI18n, useT } from './I18nProvider';
import { getLocale } from './locale';
import { translate } from './translations';

/** Translate a string at call time; components re-render when the locale changes. */
export function t(text: string, vars?: Record<string, string | number>): string {
  return translate(text, getLocale(), vars);
}
