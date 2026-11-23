export const LOCALES = ['uz', 'uz-cyrl', 'ru'] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_META: Record<Locale, { label: string; short: string; intl: string; htmlLang: string }> = {
  uz: { label: "O'zbekcha", short: 'UZ', intl: 'uz-UZ', htmlLang: 'uz' },
  'uz-cyrl': { label: 'Ўзбекча', short: 'ЎЗ', intl: 'uz-Cyrl-UZ', htmlLang: 'uz-Cyrl' },
  ru: { label: 'Русский', short: 'RU', intl: 'ru-RU', htmlLang: 'ru' },
};

const STORAGE_KEY = 'sr-locale';

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'uz' || saved === 'uz-cyrl' || saved === 'ru') return saved;
    const nav = navigator.language.toLowerCase();
    if (nav.startsWith('ru')) return 'ru';
    if (nav.startsWith('uz') && (nav.includes('cyrl') || nav.includes('кир'))) return 'uz-cyrl';
  } catch {
    /* non-browser environments */
  }
  return 'uz';
}

let current: Locale = detect();
const listeners = new Set<() => void>();

export const getLocale = () => current;

export function setLocale(next: Locale) {
  if (current === next) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage may be unavailable */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = LOCALE_META[next].htmlLang;
  listeners.forEach((listener) => listener());
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
