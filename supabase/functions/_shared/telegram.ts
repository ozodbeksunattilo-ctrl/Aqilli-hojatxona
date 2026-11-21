/**
 * Telegram message formatting and command routing.
 * Pure TypeScript (no Deno APIs) so it is unit-tested in Node.
 */

export interface ShiftStartedPayload {
  employee: string;
  start_time: string;
  timezone: string;
  business?: string;
}

export interface ShiftEndedPayload extends ShiftStartedPayload {
  end_time: string;
  duration_seconds: number | null;
  male: number;
  female: number;
  total: number;
  forced?: boolean;
}

export interface DailyReportPayload {
  date: string;
  business?: string;
  male: number;
  female: number;
  total: number;
  unassigned?: number;
  employees: { name: string; shifts: number; male: number; female: number; total: number }[];
}

export interface ShiftRow {
  employee_name: string;
  start_time: string;
  end_time?: string | null;
  male_count: number;
  female_count: number;
  total_count: number;
  status?: string;
}

export interface EmployeeRow {
  full_name: string;
  username: string;
  is_active: boolean;
  on_shift: boolean;
}

/** Data the bot needs; implemented with the Supabase service client in the Edge Function. */
export interface BotData {
  timezone(): Promise<string>;
  today(): Promise<{ date: string; male: number; female: number; total: number; active_shifts: number; completed_shifts: number }>;
  dailyReport(): Promise<DailyReportPayload>;
  employees(): Promise<EmployeeRow[]>;
  activeShifts(): Promise<ShiftRow[]>;
  recentShifts(limit: number): Promise<ShiftRow[]>;
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const num = (n: number) => new Intl.NumberFormat('en-US').format(n).replace(/,/g, ' ');

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function shiftStartedMessage(p: ShiftStartedPayload): string {
  return [
    `🟢 <b>Shift started</b>${p.business ? ` · ${esc(p.business)}` : ''}`,
    '',
    `👤 Employee: <b>${esc(p.employee)}</b>`,
    `🕒 Start: ${formatTime(p.start_time, p.timezone)}`,
  ].join('\n');
}

export function shiftEndedMessage(p: ShiftEndedPayload): string {
  return [
    `🔴 <b>Shift ended</b>${p.forced ? ' (closed by admin)' : ''}${p.business ? ` · ${esc(p.business)}` : ''}`,
    '',
    `👤 Employee: <b>${esc(p.employee)}</b>`,
    `🕒 ${formatTime(p.start_time, p.timezone)} → ${formatTime(p.end_time, p.timezone)}`,
    `⏱ Duration: ${formatDuration(p.duration_seconds)}`,
    '',
    `🚹 Male: <b>${num(p.male)}</b>`,
    `🚺 Female: <b>${num(p.female)}</b>`,
    `👥 Total: <b>${num(p.total)}</b>`,
  ].join('\n');
}

export function dailyReportMessage(p: DailyReportPayload): string {
  const lines = [
    `📊 <b>Daily report · ${p.date}</b>${p.business ? `\n${esc(p.business)}` : ''}`,
    '',
    `👥 Total visitors: <b>${num(p.total)}</b>`,
    `🚹 Male: ${num(p.male)}`,
    `🚺 Female: ${num(p.female)}`,
  ];
  if (p.unassigned) lines.push(`⚠️ Outside any shift: ${num(p.unassigned)}`);
  lines.push('', '<b>Employees</b>');
  if (p.employees.length === 0) lines.push('No shifts today.');
  for (const e of p.employees) {
    lines.push(`• ${esc(e.name)} — ${num(e.total)} (🚹 ${num(e.male)} / 🚺 ${num(e.female)}), ${e.shifts} shift${e.shifts === 1 ? '' : 's'}`);
  }
  return lines.join('\n');
}

export function renderNotification(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'shift_started':
      return shiftStartedMessage(payload as unknown as ShiftStartedPayload);
    case 'shift_ended':
      return shiftEndedMessage(payload as unknown as ShiftEndedPayload);
    case 'daily_report':
      return dailyReportMessage(payload as unknown as DailyReportPayload);
    default:
      return `ℹ️ ${esc(String(payload.text ?? 'Test notification from Smart Restroom'))}`;
  }
}

export const COMMANDS = ['/start', '/today', '/report', '/employees', '/active', '/shifts'] as const;

/** Parses "/today@MyBot args" → "/today". Returns null for non-commands. */
export function parseCommand(text: string | undefined): string | null {
  if (!text || !text.startsWith('/')) return null;
  return text.split(/\s+/)[0].split('@')[0].toLowerCase();
}

export function isAuthorized(userId: number | undefined, allowed: readonly (number | string)[]): boolean {
  if (userId == null) return false;
  return allowed.some((id) => Number(id) === userId);
}

const HELP = [
  '<b>Smart Restroom bot</b>',
  '',
  '/today — today\'s visitors',
  '/report — full daily report',
  '/employees — employees and status',
  '/active — active shifts',
  '/shifts — last 10 shifts',
].join('\n');

export async function handleCommand(command: string, data: BotData): Promise<string> {
  switch (command) {
    case '/start':
      return HELP;
    case '/today': {
      const t = await data.today();
      return [
        `📅 <b>Today · ${t.date}</b>`,
        '',
        `👥 Total: <b>${num(t.total)}</b>`,
        `🚹 Male: ${num(t.male)}`,
        `🚺 Female: ${num(t.female)}`,
        '',
        `Active shifts: ${t.active_shifts} · Completed: ${t.completed_shifts}`,
      ].join('\n');
    }
    case '/report':
      return dailyReportMessage(await data.dailyReport());
    case '/employees': {
      const list = await data.employees();
      if (list.length === 0) return 'No employees yet.';
      return ['<b>Employees</b>', '', ...list.map((e) =>
        `${e.on_shift ? '🟢' : e.is_active ? '⚪️' : '⛔️'} ${esc(e.full_name)} (@${esc(e.username)})${e.on_shift ? ' — on shift' : e.is_active ? '' : ' — deactivated'}`,
      )].join('\n');
    }
    case '/active': {
      const [list, tz] = await Promise.all([data.activeShifts(), data.timezone()]);
      if (list.length === 0) return 'No active shifts right now.';
      return ['<b>Active shifts</b>', '', ...list.map((s) =>
        `🟢 ${esc(s.employee_name)} since ${formatTime(s.start_time, tz)}\n    🚹 ${num(s.male_count)} · 🚺 ${num(s.female_count)} · 👥 ${num(s.total_count)}`,
      )].join('\n');
    }
    case '/shifts': {
      const [list, tz] = await Promise.all([data.recentShifts(10), data.timezone()]);
      if (list.length === 0) return 'No shifts recorded yet.';
      return ['<b>Last shifts</b>', '', ...list.map((s) =>
        `${s.status === 'active' ? '🟢' : '✅'} ${esc(s.employee_name)} · ${formatTime(s.start_time, tz)}${s.end_time ? ` → ${formatTime(s.end_time, tz).slice(-5)}` : ''}\n    👥 ${num(s.total_count)} (🚹 ${num(s.male_count)} / 🚺 ${num(s.female_count)})`,
      )].join('\n');
    }
    default:
      return `Unknown command.\n\n${HELP}`;
  }
}

export async function sendTelegramMessage(token: string, chatId: number | string, html: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 200)}`);
  }
}
