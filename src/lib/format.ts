import { getLocale, LOCALE_META, type Locale } from '@/i18n/locale';

/** Intl tag for the active interface language (numbers, dates and times). */
export const localeTag = () => LOCALE_META[getLocale()].intl;

const formatNumberFor = (n: number | null | undefined, locale: Locale) =>
  new Intl.NumberFormat(LOCALE_META[locale].intl).format(n ?? 0).replace(/[\u00a0\u202f\s]/g, ' ');

export const formatNumber = (n: number | null | undefined) => formatNumberFor(n, getLocale());

export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export function formatDuration(seconds: number | null | undefined, withSeconds = false): string {
  if (seconds == null || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (withSeconds) return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export const secondsBetween = (from: string, to?: string | null) =>
  Math.max(0, Math.floor(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000));

export const formatTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' }) : '—';

export const formatTimeSec = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(localeTag(), { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const formatShortDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString(localeTag(), { day: '2-digit', month: 'short' });

export const formatDateTime = (iso: string | null | undefined) => (iso ? `${formatDate(iso)}, ${formatTime(iso)}` : '—');

const RELATIVE = {
  uz: ['hech qachon', 'hozirgina', 'son oldin', 'min oldin', 'soat oldin', 'kun oldin'],
  'uz-cyrl': ['ҳеч қачон', 'ҳозиргина', 'сон олдин', 'мин олдин', 'соат олдин', 'кун олдин'],
  ru: ['никогда', 'только что', 'с назад', 'мин назад', 'ч назад', 'дн назад'],
} as const;

export function relativeTime(iso: string | null | undefined): string {
  const words = RELATIVE[getLocale()];
  if (!iso) return words[0];
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return words[1];
  if (s < 60) return `${s}${words[2]}`;
  if (s < 3600) return `${Math.floor(s / 60)}${words[3]}`;
  if (s < 86400) return `${Math.floor(s / 3600)}${words[4]}`;
  return `${Math.floor(s / 86400)}${words[5]}`;
}

/** yyyy-mm-dd of a Date in the browser's local time. */
export const toDayStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayStr = () => toDayStr(new Date());

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDayStr(d);
}

/** Local midnight of `day` (+ offset days) as ISO, for timestamp range filters. */
export const localDayStartIso = (day: string, offsetDays = 0) => new Date(`${addDays(day, offsetDays)}T00:00:00`).toISOString();

const GREETINGS = {
  uz: ['Xayrli tun', 'Xayrli Tong', 'Xayrli kun', 'Xayrli oqshom'],
  'uz-cyrl': ['Хайрли тун', 'Хайрли Тонг', 'Хайрли кун', 'Хайрли оқшом'],
  ru: ['Доброй ночи', 'Доброе утро', 'Добрый день', 'Добрый вечер'],
} as const;

export const greeting = () => {
  const h = new Date().getHours();
  const words = GREETINGS[getLocale()];
  return h < 5 ? words[0] : h < 12 ? words[1] : h < 18 ? words[2] : words[3];
};
