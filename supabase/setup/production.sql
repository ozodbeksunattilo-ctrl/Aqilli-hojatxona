-- =============================================================================
-- One-time, project-specific setup. Run in the Supabase SQL editor AFTER the
-- migrations and after deploying the Edge Functions. Replace the <...> values.
-- Not a migration on purpose: it contains your project URL and a secret.
-- =============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Where the database should "kick" the Telegram dispatcher (pg_net, async).
insert into app_private.config (key, value) values
  ('dispatch_url', 'https://<PROJECT_REF>.supabase.co/functions/v1/telegram-dispatch'),
  ('dispatch_secret', '<SAME VALUE AS THE DISPATCH_SECRET EDGE FUNCTION SECRET>')
on conflict (key) do update set value = excluded.value;

-- Every minute: enqueue the daily report at the configured hour, then retry
-- any pending notifications (covers Telegram or network outages).
select cron.unschedule(jobname) from cron.job where jobname = 'smart-restroom-tick';
select cron.schedule('smart-restroom-tick', '* * * * *', $$
  select public.cron_tick();
  select net.http_post(
    url := (select value from app_private.config where key = 'dispatch_url'),
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select value from app_private.config where key = 'dispatch_secret'))
  );
$$);

-- Switch to production when the real turnstiles are connected:
--   update public.app_settings set system_mode = 'production';
-- (or Settings → System mode in the admin UI)
