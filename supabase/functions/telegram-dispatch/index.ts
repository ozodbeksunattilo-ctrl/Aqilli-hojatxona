/**
 * POST /functions/v1/telegram-dispatch
 *
 * Delivers queued notifications (notification_outbox) to every authorised
 * admin chat. Triggered by pg_net on insert and by pg_cron every minute, so a
 * Telegram outage only delays messages — it never loses them.
 *
 *   Dispatcher:  header `x-dispatch-secret: <DISPATCH_SECRET>`
 *   Admin UI:    { "action": "status" | "test" } with the admin's JWT
 */
import { corsHeaders, json, safeEqual } from '../_shared/http.ts';
import { serviceClient, telegramAdminIds, userClient } from '../_shared/supabase.ts';
import { renderNotification, sendTelegramMessage } from '../_shared/telegram.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = serviceClient();
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const secret = Deno.env.get('DISPATCH_SECRET') ?? '';
  const body = await req.json().catch(() => ({}));

  if (body?.action === 'status' || body?.action === 'test') {
    const { data: isAdmin } = await userClient(req).rpc('is_admin');
    if (isAdmin !== true) return json({ error: 'Administrator access required' }, 403);
    const chats = await telegramAdminIds(db);
    if (body.action === 'status') return json({ bot_configured: Boolean(token), chats: chats.length });
    if (!token) return json({ error: 'TELEGRAM_BOT_TOKEN is not configured' }, 400);
    if (chats.length === 0) return json({ error: 'No authorised Telegram IDs configured' }, 400);
    const results = await Promise.allSettled(chats.map((c) => sendTelegramMessage(token, c, renderNotification('test', {}))));
    const failed = results.filter((r) => r.status === 'rejected').length;
    return failed ? json({ error: `${failed} of ${chats.length} chats failed` }, 502) : json({ ok: true, sent: chats.length });
  }

  if (!secret || !safeEqual(req.headers.get('x-dispatch-secret') ?? '', secret)) return json({ error: 'Forbidden' }, 403);
  if (!token) return json({ skipped: 'TELEGRAM_BOT_TOKEN is not configured' });

  const chats = await telegramAdminIds(db);
  const { data: jobs, error } = await db.rpc('claim_notifications', { p_limit: 20 });
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const job of jobs ?? []) {
    try {
      if (chats.length === 0) throw new Error('No authorised Telegram IDs configured');
      const text = renderNotification(job.kind, job.payload);
      for (const chat of chats) await sendTelegramMessage(token, chat, text);
      await db.rpc('complete_notification', { p_id: job.id, p_ok: true });
      sent++;
    } catch (err) {
      await db.rpc('complete_notification', { p_id: job.id, p_ok: false, p_error: String(err) });
    }
  }
  return json({ claimed: jobs?.length ?? 0, sent });
});
