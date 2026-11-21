import { describe, expect, it, vi } from 'vitest';
import {
  dailyReportMessage,
  formatDuration,
  handleCommand,
  isAuthorized,
  parseCommand,
  renderNotification,
  sendTelegramMessage,
  shiftEndedMessage,
  shiftStartedMessage,
  type BotData,
} from '../../supabase/functions/_shared/telegram';

const tz = 'Asia/Tashkent';

describe('telegram notifications', () => {
  it('shift started includes employee name and local start time', () => {
    const msg = shiftStartedMessage({ employee: 'Asqar', start_time: '2026-11-21T03:00:00Z', timezone: tz });
    expect(msg).toContain('Shift started');
    expect(msg).toContain('<b>Asqar</b>');
    expect(msg).toContain('21/11/2026, 08:00');
  });

  it('shift ended includes all counts and duration', () => {
    const msg = shiftEndedMessage({
      employee: 'Asqar', start_time: '2026-11-21T03:00:00Z', end_time: '2026-11-21T11:30:00Z', timezone: tz,
      duration_seconds: 30_600, male: 620, female: 380, total: 1000,
    });
    expect(msg).toContain('Male: <b>620</b>');
    expect(msg).toContain('Female: <b>380</b>');
    expect(msg).toContain('Total: <b>1 000</b>');
    expect(msg).toContain('8h 30m');
  });

  it('daily report lists employees and escapes HTML', () => {
    const msg = dailyReportMessage({
      date: '2026-11-21', male: 10, female: 5, total: 15, unassigned: 2,
      employees: [{ name: 'A <script>', shifts: 1, male: 10, female: 5, total: 15 }],
    });
    expect(msg).toContain('A &lt;script&gt;');
    expect(msg).toContain('Outside any shift: 2');
    expect(renderNotification('daily_report', { date: 'd', male: 0, female: 0, total: 0, employees: [] })).toContain('No shifts today');
  });

  it('formats durations', () => {
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(3600 * 2 + 60 * 5)).toBe('2h 05m');
    expect(formatDuration(null)).toBe('—');
  });

  it('sends via the Bot API and surfaces errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    await sendTelegramMessage('TOKEN', 42, 'hi', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.telegram.org/botTOKEN/sendMessage', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ chat_id: 42, text: 'hi', parse_mode: 'HTML' });

    const failing = vi.fn(async () => new Response('Forbidden: bot was blocked', { status: 403 }));
    await expect(sendTelegramMessage('T', 1, 'x', failing as unknown as typeof fetch)).rejects.toThrow(/403/);
  });
});

describe('telegram commands', () => {
  const data: BotData = {
    timezone: async () => tz,
    today: async () => ({ date: '2026-11-21', male: 3, female: 2, total: 5, active_shifts: 1, completed_shifts: 2 }),
    dailyReport: async () => ({ date: '2026-11-21', male: 3, female: 2, total: 5, employees: [] }),
    employees: async () => [
      { full_name: 'Asqar', username: 'asqar', is_active: true, on_shift: true },
      { full_name: 'Old', username: 'old', is_active: false, on_shift: false },
    ],
    activeShifts: async () => [{ employee_name: 'Asqar', start_time: '2026-11-21T03:00:00Z', male_count: 3, female_count: 2, total_count: 5 }],
    recentShifts: async () => [],
  };

  it('parses commands including bot mentions', () => {
    expect(parseCommand('/today@SmartRestroomBot')).toBe('/today');
    expect(parseCommand('/REPORT now')).toBe('/report');
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });

  it('restricts commands to authorised IDs', () => {
    expect(isAuthorized(111, [111, 222])).toBe(true);
    expect(isAuthorized(111, ['111'])).toBe(true);
    expect(isAuthorized(333, [111, 222])).toBe(false);
    expect(isAuthorized(undefined, [111])).toBe(false);
    expect(isAuthorized(111, [])).toBe(false);
  });

  it.each([
    ['/start', '/today'],
    ['/today', 'Total: <b>5</b>'],
    ['/report', 'Daily report'],
    ['/employees', 'on shift'],
    ['/active', 'Asqar since'],
    ['/shifts', 'No shifts recorded yet'],
    ['/unknown', 'Unknown command'],
  ])('%s', async (cmd, expected) => {
    expect(await handleCommand(cmd, data)).toContain(expected);
  });
});
