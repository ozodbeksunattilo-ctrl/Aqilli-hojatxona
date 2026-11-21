const nf = new Intl.NumberFormat('en-US');

export const formatNumber = (n: number | null | undefined) => nf.format(n ?? 0).replace(/,/g, ' ');

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
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';

export const formatTimeSec = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const formatShortDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export const formatDateTime = (iso: string | null | undefined) => (iso ? `${formatDate(iso)}, ${formatTime(iso)}` : '—');

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
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

export const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
