/**
 * POST /functions/v1/telegram-bot   (Telegram webhook)
 *
 * Register once:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<FUNCTIONS_URL>/telegram-bot&secret_token=<TELEGRAM_WEBHOOK_SECRET>
 *
 * Only Telegram user IDs listed in Settings → Telegram (or TELEGRAM_ADMIN_IDS)
 * can run commands. The bot token lives only in Edge Function secrets.
 */
import { json, safeEqual } from '../_shared/http.ts';
import { serviceClient, telegramAdminIds } from '../_shared/supabase.ts';
import { handleCommand, isAuthorized, parseCommand, sendTelegramMessage, type BotData } from '../_shared/telegram.ts';

Deno.serve(async (req) => {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  if (!token) return json({ error: 'Bot not configured' }, 503);
  if (!secret || !safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const update = await req.json().catch(() => null);
  const message = update?.message;
  const command = parseCommand(message?.text);
  if (!message || !command) return json({ ok: true });

  const db = serviceClient();
  const fromId: number | undefined = message.from?.id;
  if (!isAuthorized(fromId, await telegramAdminIds(db))) {
    await sendTelegramMessage(token, message.chat.id,
      `⛔️ Access denied.\nYour Telegram ID is <code>${fromId}</code> — ask the administrator to add it in Settings → Telegram.`);
    return json({ ok: true });
  }

  const data: BotData = {
    async timezone() {
      const { data } = await db.from('app_settings').select('timezone').eq('id', 1).single();
      return data?.timezone ?? 'UTC';
    },
    async today() {
      const { data, error } = await db.rpc('get_today_summary');
      if (error) throw error;
      return data;
    },
    async dailyReport() {
      const { data, error } = await db.rpc('build_daily_report', { p_day: null });
      if (error) throw error;
      return data;
    },
    async employees() {
      const [{ data: people }, { data: active }] = await Promise.all([
        db.from('profiles').select('id, full_name, username, is_active').eq('role', 'employee').order('full_name'),
        db.from('shifts').select('employee_id').eq('status', 'active'),
      ]);
      const on = new Set((active ?? []).map((s) => s.employee_id));
      return (people ?? []).map((p) => ({ ...p, on_shift: on.has(p.id) }));
    },
    async activeShifts() {
      const { data, error } = await db.rpc('get_active_shifts');
      if (error) throw error;
      return data ?? [];
    },
    async recentShifts(limit) {
      const { data, error } = await db
        .from('shifts')
        .select('start_time, end_time, male_count, female_count, total_count, status, employee:profiles!shifts_employee_id_fkey(full_name)')
        .order('start_time', { ascending: false })
        .limit(limit);
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((s: any) => ({ ...s, employee_name: s.employee?.full_name ?? '—' }));
    },
  };

  try {
    await sendTelegramMessage(token, message.chat.id, await handleCommand(command, data));
  } catch (err) {
    console.error('command failed', command, err);
    await sendTelegramMessage(token, message.chat.id, '⚠️ Something went wrong. Please try again.').catch(() => {});
  }
  return json({ ok: true });
});
