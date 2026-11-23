-- =============================================================================
-- Smart Restroom — period reports, Telegram bot admins, notifications, automation
--
-- Every number shown in the dashboard AND sent by the Telegram bot comes from
-- the same functions below, computed from the append-only event ledger in the
-- business time zone. Totals always reconcile:
--     Σ employees + outside any shift = total
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Optional platform extensions (present on Supabase; skipped elsewhere)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column notify_weekly_report boolean not null default true,
  add column notify_monthly_report boolean not null default true,
  add column notify_device_offline boolean not null default true,
  add column notify_admin_actions boolean not null default true;

-- The daily report covers the previous full day; 00:00 sends it right after the day closes.
alter table public.app_settings alter column daily_report_hour set default 0;
alter table public.app_settings alter column business_name set default 'Smart Restroom';
update public.app_settings set daily_report_hour = 0 where id = 1 and daily_report_hour = 23;

alter table public.devices add column offline_notified_at timestamptz;

alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'shift_started', 'shift_ended', 'daily_report', 'weekly_report', 'monthly_report',
  'device_offline', 'device_online', 'admin_action', 'test'));

-- Telegram users allowed to use the bot and receive notifications.
--   profile_id set  → a dashboard admin who linked their Telegram account
--   profile_id null → a bot-only admin added through an invite link
create table public.telegram_links (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles (id) on delete set null,
  telegram_user_id bigint not null unique,
  chat_id bigint not null,
  username text,
  first_name text,
  added_by text,
  linked_at timestamptz not null default now()
);
create index telegram_links_profile_idx on public.telegram_links (profile_id);

-- One-time codes for t.me/<bot>?start=<code> deep links.
create table app_private.telegram_link_codes (
  code_hash text primary key,
  purpose text not null check (purpose in ('link', 'invite')),
  profile_id uuid references public.profiles (id) on delete cascade,
  created_by text,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Private config helpers (functions URL, dispatcher + webhook secrets)
-- ---------------------------------------------------------------------------
create function app_private.get_config(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from app_private.config where key = p_key
$$;

create function app_private.put_config(p_key text, p_value text) returns void
language sql security definer set search_path = '' as $$
  insert into app_private.config (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value
$$;

create function public.service_get_config(p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return app_private.get_config(p_key);
end $$;

create function public.service_put_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_key not in ('telegram_webhook_secret', 'telegram_bot_username') then
    raise exception 'Config key % is not writable', p_key using errcode = '22023';
  end if;
  perform app_private.put_config(p_key, p_value);
end $$;

-- Audit entries written by server code acting for a Telegram admin (no Supabase user).
create function public.service_log(p_action text, p_details jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_action !~ '^[a-z_]+\.[a-z_]+$' then
    raise exception 'Invalid action' using errcode = '22023';
  end if;
  perform app_private.log(null, p_action, coalesce(p_details, '{}'));
end $$;

-- Wake the Telegram dispatcher (async, via pg_net). No-op until automation is configured.
create function app_private.kick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_base text := app_private.get_config('functions_url');
begin
  if v_base is null or to_regproc('net.http_post') is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_base || '/telegram-dispatch', '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json',
                             'x-dispatch-secret', coalesce(app_private.get_config('dispatch_secret'), ''));
exception when others then
  raise warning 'telegram dispatcher kick failed: %', sqlerrm;
end $$;

create or replace function app_private.kick_dispatcher() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.kick();
  return null;
end $$;

create function public.get_automation_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_job boolean := false;
begin
  perform app_private.require_admin();
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = $1)' into v_job using 'smart-restroom-tick';
  end if;
  return jsonb_build_object(
    'functions_url', app_private.get_config('functions_url'),
    'cron', v_job,
    'net', to_regproc('net.http_post') is not null,
    'webhook_secret_set', app_private.get_config('telegram_webhook_secret') is not null,
    'bot_username', app_private.get_config('telegram_bot_username')
  );
end $$;

-- One-call production wiring: store the API base URL, create the dispatcher
-- secret and schedule the per-minute tick (when pg_cron exists).
create function public.configure_automation(p_functions_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := rtrim(btrim(coalesce(p_functions_url, '')), '/');
  v_cron boolean := to_regclass('cron.job') is not null;
begin
  perform app_private.require_admin();
  if v_url !~ '^https?://[^[:space:]/]+(/[^[:space:]]*)?$' then
    raise exception 'Invalid functions URL' using errcode = '22023';
  end if;
  perform app_private.put_config('functions_url', v_url);
  if app_private.get_config('dispatch_secret') is null then
    perform app_private.put_config('dispatch_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  end if;
  if v_cron then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = $1' using 'smart-restroom-tick';
    execute 'select cron.schedule($1, $2, $3)' using 'smart-restroom-tick', '* * * * *', 'select public.cron_tick()';
  end if;
  perform app_private.log(auth.uid(), 'automation.configured', jsonb_build_object('functions_url', v_url, 'cron', v_cron));
  return public.get_automation_status();
end $$;

-- ---------------------------------------------------------------------------
-- Telegram bot admins
-- ---------------------------------------------------------------------------
-- Dashboard admin links their own Telegram account (15 min, one time).
create function public.create_telegram_link_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_code text := replace(gen_random_uuid()::text, '-', '');
begin
  v_me := app_private.require_active_user();
  if v_me.role <> 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  delete from app_private.telegram_link_codes
   where (purpose = 'link' and profile_id = v_me.id) or expires_at < now();
  insert into app_private.telegram_link_codes (code_hash, purpose, profile_id, created_by, expires_at)
  values (app_private.token_hash(v_code), 'link', v_me.id, v_me.full_name, now() + interval '15 minutes');
  return v_code;
end $$;

-- Invite another person as a bot admin (24 h, one time). Called from the
-- dashboard (admin JWT) or by the bot on behalf of a Telegram admin (service role).
create function public.create_telegram_invite(p_created_by text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_by text;
  v_code text := 'inv' || replace(gen_random_uuid()::text, '-', '');
begin
  if app_private.is_service_role() then
    v_by := coalesce(nullif(btrim(p_created_by), ''), 'Telegram admin');
  else
    perform app_private.require_admin();
    select full_name into v_by from public.profiles where id = auth.uid();
  end if;
  delete from app_private.telegram_link_codes where expires_at < now();
  insert into app_private.telegram_link_codes (code_hash, purpose, created_by, expires_at)
  values (app_private.token_hash(v_code), 'invite', left(v_by, 80), now() + interval '24 hours');
  return v_code;
end $$;

-- Called by the bot (service role) when someone opens a deep link.
create function public.consume_telegram_link_code(
  p_code text, p_telegram_user_id bigint, p_chat_id bigint, p_username text default null, p_first_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_code app_private.telegram_link_codes;
  v_profile public.profiles;
  v_display text := coalesce(nullif(btrim(p_first_name), ''), nullif(btrim(p_username), ''), p_telegram_user_id::text);
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into v_code from app_private.telegram_link_codes
   where code_hash = app_private.token_hash(p_code)
   for update;
  if not found or v_code.used_at is not null or v_code.expires_at < now() then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_code.purpose = 'link' then
    select * into v_profile from public.profiles where id = v_code.profile_id;
    if not found or not v_profile.is_active or v_profile.role <> 'admin' then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;

  update app_private.telegram_link_codes set used_at = now() where code_hash = v_code.code_hash;
  insert into public.telegram_links (profile_id, telegram_user_id, chat_id, username, first_name, added_by)
  values (v_profile.id, p_telegram_user_id, p_chat_id, left(p_username, 64), left(p_first_name, 64), v_code.created_by)
  on conflict (telegram_user_id) do update
    set profile_id = coalesce(excluded.profile_id, public.telegram_links.profile_id),
        chat_id = excluded.chat_id, username = excluded.username, first_name = excluded.first_name,
        added_by = coalesce(public.telegram_links.added_by, excluded.added_by), linked_at = now();

  if v_code.purpose = 'link' then
    perform app_private.log(v_profile.id, 'telegram.linked',
      jsonb_build_object('telegram_user_id', p_telegram_user_id, 'username', p_username));
    return jsonb_build_object('status', 'linked', 'purpose', 'link', 'name', v_profile.full_name);
  end if;
  perform app_private.log(null, 'telegram.admin_added', jsonb_build_object(
    'actor', v_code.created_by, 'target', v_display, 'telegram_user_id', p_telegram_user_id, 'username', p_username));
  return jsonb_build_object('status', 'linked', 'purpose', 'invite', 'name', v_display);
end $$;

-- Remove a bot admin (dashboard admin, or a Telegram admin through the bot).
create function public.remove_telegram_admin(p_link_id bigint, p_actor text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.telegram_links;
  v_actor text;
begin
  if app_private.is_service_role() then
    v_actor := coalesce(nullif(btrim(p_actor), ''), 'Telegram admin');
  else
    perform app_private.require_admin();
    select full_name into v_actor from public.profiles where id = auth.uid();
  end if;
  delete from public.telegram_links where id = p_link_id returning * into v_link;
  if not found then
    raise exception 'Telegram admin not found' using errcode = 'P0002';
  end if;
  perform app_private.log(case when app_private.is_service_role() then null else auth.uid() end,
    'telegram.admin_removed', jsonb_build_object(
      'actor', v_actor,
      'target', coalesce(v_link.first_name, v_link.username, v_link.telegram_user_id::text),
      'telegram_user_id', v_link.telegram_user_id));
end $$;

-- Who receives notifications and may use bot commands.
create function public.telegram_recipients() returns table (chat_id bigint, telegram_user_id bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query
    select l.chat_id, l.telegram_user_id
      from public.telegram_links l
      left join public.profiles p on p.id = l.profile_id
     where l.profile_id is null or (p.is_active and p.role = 'admin')
    union
    select x, x
      from public.app_settings s, unnest(s.telegram_admin_ids) x
     where s.id = 1;
end $$;

-- ---------------------------------------------------------------------------
-- Scoping: admins / service may query anyone; employees only themselves.
-- ---------------------------------------------------------------------------
create function app_private.scope_employee(p_employee uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
begin
  if app_private.is_service_role() then
    return p_employee;
  end if;
  v_me := app_private.require_active_user();
  if v_me.role = 'admin' then
    return p_employee;
  end if;
  return v_me.id;
end $$;

-- ---------------------------------------------------------------------------
-- Period summary — the single source of truth for reports (dashboard + bot)
-- ---------------------------------------------------------------------------
create function app_private.period_summary(p_from date, p_to date, p_employee uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer;
  v_from timestamptz;
  v_to timestamptz;
  v_prev_from date;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Invalid date range (max 400 days)' using errcode = '22023';
  end if;
  v_days := p_to - p_from + 1;
  v_from := app_private.day_start(p_from);
  v_to := app_private.day_start(p_to + 1);
  v_prev_from := p_from - v_days;

  with ev as (
    select e.gender, e.attribution, e.occurred_at, s.employee_id
      from public.entry_events e
      left join public.shifts s on s.id = e.shift_id
     where e.occurred_at >= v_from and e.occurred_at < v_to
       and (p_employee is null or s.employee_id = p_employee)
  ),
  prev as (
    select count(*) filter (where e.gender = 'male') as m,
           count(*) filter (where e.gender = 'female') as f
      from public.entry_events e
      left join public.shifts s on s.id = e.shift_id
     where e.occurred_at >= app_private.day_start(v_prev_from) and e.occurred_at < v_from
       and (p_employee is null or s.employee_id = p_employee)
  ),
  per_day as (
    select (occurred_at at time zone app_private.tz())::date as d, count(*) as n
      from ev group by 1
  ),
  -- Shifts overlapping the period; hours are clipped to the period.
  sh as (
    select s.employee_id,
           count(*) as c,
           sum(extract(epoch from (least(coalesce(s.end_time, now()), v_to) - greatest(s.start_time, v_from)))) as secs
      from public.shifts s
     where s.start_time < v_to and coalesce(s.end_time, now()) > v_from
       and (p_employee is null or s.employee_id = p_employee)
     group by s.employee_id
  ),
  emp as (
    select employee_id,
           count(*) filter (where gender = 'male') as m,
           count(*) filter (where gender = 'female') as f
      from ev where employee_id is not null
     group by employee_id
  ),
  people as (
    select p.id, p.full_name, p.username, p.is_active,
           coalesce(sh.c, 0) as shifts,
           round(greatest(coalesce(sh.secs, 0), 0)::numeric / 3600, 2) as hours,
           coalesce(emp.m, 0) as male,
           coalesce(emp.f, 0) as female
      from public.profiles p
      left join sh on sh.employee_id = p.id
      left join emp on emp.employee_id = p.id
     where p.role = 'employee'
       and (p_employee is null or p.id = p_employee)
       and (p.is_active or sh.c is not null or emp.employee_id is not null)
  ),
  totals as (
    select count(*) filter (where gender = 'male') as m,
           count(*) filter (where gender = 'female') as f,
           count(*) filter (where attribution = 'unassigned') as u,
           count(*) filter (where attribution = 'late') as l
      from ev
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'days', v_days,
    'male', t.m,
    'female', t.f,
    'total', t.m + t.f,
    'unassigned', t.u,
    'late', t.l,
    'daily_avg', round((t.m + t.f)::numeric / v_days, 1),
    'best_day', (select jsonb_build_object('date', d, 'total', n) from per_day order by n desc, d limit 1),
    'previous', jsonb_build_object('from', v_prev_from, 'to', p_from - 1, 'male', pr.m, 'female', pr.f, 'total', pr.m + pr.f),
    'change_pct', case when pr.m + pr.f > 0
                       then round(((t.m + t.f) - (pr.m + pr.f))::numeric * 100 / (pr.m + pr.f), 1) end,
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee_id', x.id, 'name', x.full_name, 'username', x.username, 'is_active', x.is_active,
               'shifts', x.shifts, 'hours', x.hours, 'male', x.male, 'female', x.female,
               'total', x.male + x.female,
               'per_hour', case when x.hours > 0 then round((x.male + x.female) / x.hours, 1) else 0 end)
             order by x.male + x.female desc, x.full_name)
        from people x), '[]'::jsonb)
  ) into v_result
  from totals t, prev pr;
  return v_result;
end $$;

create function public.get_period_summary(p_from date, p_to date, p_employee uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.period_summary(p_from, p_to, app_private.scope_employee(p_employee));
end $$;

-- Last N days up to today (business time zone) — used by the bot.
create function public.get_recent_summary(p_days integer, p_employee uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := app_private.today();
begin
  perform app_private.require_admin();
  if p_days is null or p_days < 1 or p_days > 400 then
    raise exception 'Invalid number of days' using errcode = '22023';
  end if;
  return app_private.period_summary(v_today - (p_days - 1), v_today, p_employee)
         || jsonb_build_object('business', (select business_name from public.app_settings where id = 1),
                               'timezone', app_private.tz());
end $$;

create or replace function app_private.daily_report(p_day date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.period_summary(coalesce(p_day, app_private.today()), coalesce(p_day, app_private.today()), null)
         || jsonb_build_object('date', coalesce(p_day, app_private.today()),
                               'business', (select business_name from public.app_settings where id = 1))
$$;

drop function public.get_employee_performance(date, date);

-- Daily / hourly series, optionally for one employee (ledger events of that employee's shifts).
drop function public.get_daily_stats(date, date);
create function public.get_daily_stats(p_from date, p_to date, p_employee uuid default null) returns table (
  day date, male bigint, female bigint, total bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := app_private.scope_employee(p_employee);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Invalid date range (max 400 days)' using errcode = '22023';
  end if;
  return query
    select d::date, coalesce(x.m, 0), coalesce(x.f, 0), coalesce(x.m, 0) + coalesce(x.f, 0)
      from generate_series(p_from, p_to, interval '1 day') d
      left join (
        select (e.occurred_at at time zone app_private.tz())::date as dd,
               count(*) filter (where e.gender = 'male') as m,
               count(*) filter (where e.gender = 'female') as f
          from public.entry_events e
          left join public.shifts s on s.id = e.shift_id
         where e.occurred_at >= app_private.day_start(p_from) and e.occurred_at < app_private.day_start(p_to + 1)
           and (v_emp is null or s.employee_id = v_emp)
         group by 1
      ) x on x.dd = d::date
     order by 1;
end $$;

drop function public.get_hourly_distribution(date, date);
create function public.get_hourly_distribution(p_from date, p_to date, p_employee uuid default null) returns table (
  hour integer, male bigint, female bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := app_private.scope_employee(p_employee);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Invalid date range (max 400 days)' using errcode = '22023';
  end if;
  return query
    select h, coalesce(x.m, 0), coalesce(x.f, 0)
      from generate_series(0, 23) h
      left join (
        select extract(hour from e.occurred_at at time zone app_private.tz())::int as hr,
               count(*) filter (where e.gender = 'male') as m,
               count(*) filter (where e.gender = 'female') as f
          from public.entry_events e
          left join public.shifts s on s.id = e.shift_id
         where e.occurred_at >= app_private.day_start(p_from) and e.occurred_at < app_private.day_start(p_to + 1)
           and (v_emp is null or s.employee_id = v_emp)
         group by 1
      ) x on x.hr = h
     order by 1;
end $$;

-- ---------------------------------------------------------------------------
-- Paged lists with server-side totals (never truncated)
-- ---------------------------------------------------------------------------
create function public.get_shifts(
  p_from date default null, p_to date default null, p_employee uuid default null,
  p_status text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := app_private.scope_employee(p_employee);
  v_lo timestamptz := case when p_from is null then '-infinity'::timestamptz else app_private.day_start(p_from) end;
  v_hi timestamptz := case when p_to is null then 'infinity'::timestamptz else app_private.day_start(p_to + 1) end;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  with f as (
    select s.*, p.full_name as employee_name
      from public.shifts s
      join public.profiles p on p.id = s.employee_id
     where s.start_time >= v_lo and s.start_time < v_hi
       and (v_emp is null or s.employee_id = v_emp)
       and (p_status is null or s.status::text = p_status)
  )
  select jsonb_build_object(
    'count', (select count(*) from f),
    'male', (select coalesce(sum(male_count), 0) from f),
    'female', (select coalesce(sum(female_count), 0) from f),
    'late', (select coalesce(sum(late_male_count + late_female_count), 0) from f),
    'seconds', (select coalesce(sum(extract(epoch from (coalesce(end_time, now()) - start_time))), 0)::bigint from f),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.start_time desc)
        from (select * from f order by start_time desc limit v_limit offset v_offset) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create function public.get_events(
  p_from date, p_to date, p_device text default null, p_gender text default null,
  p_source text default null, p_attribution text default null,
  p_limit integer default 100, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  perform app_private.require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Invalid date range (max 400 days)' using errcode = '22023';
  end if;
  with f as (
    select e.id, e.event_id, e.shift_id, e.device_id, e.gender, e.occurred_at, e.created_at,
           e.device_time, e.source, e.attribution, p.full_name as employee_name
      from public.entry_events e
      left join public.shifts s on s.id = e.shift_id
      left join public.profiles p on p.id = s.employee_id
     where e.occurred_at >= app_private.day_start(p_from) and e.occurred_at < app_private.day_start(p_to + 1)
       and (p_device is null or e.device_id = p_device)
       and (p_gender is null or e.gender::text = p_gender)
       and (p_source is null or e.source::text = p_source)
       and (p_attribution is null or e.attribution = p_attribution)
  )
  select jsonb_build_object(
    'count', (select count(*) from f),
    'male', (select count(*) from f where gender = 'male'),
    'female', (select count(*) from f where gender = 'female'),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.occurred_at desc, x.id desc)
        from (select * from f order by occurred_at desc, id desc limit v_limit offset v_offset) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications & scheduler
-- ---------------------------------------------------------------------------
create or replace function app_private.notify(p_kind text, p_payload jsonb, p_dedupe text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
begin
  select * into s from public.app_settings where id = 1;
  if not s.telegram_enabled then return; end if;
  if (p_kind = 'shift_started' and not s.notify_shift_start)
    or (p_kind = 'shift_ended' and not s.notify_shift_end)
    or (p_kind = 'daily_report' and not s.notify_daily_report)
    or (p_kind = 'weekly_report' and not s.notify_weekly_report)
    or (p_kind = 'monthly_report' and not s.notify_monthly_report)
    or (p_kind in ('device_offline', 'device_online') and not s.notify_device_offline)
    or (p_kind = 'admin_action' and not s.notify_admin_actions) then
    return;
  end if;
  insert into public.notification_outbox (kind, payload, dedupe_key)
  values (p_kind, p_payload, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- Every sensitive account / device / configuration change is also announced in Telegram.
create function app_private.audit_to_telegram() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text;
  v_target text;
begin
  if new.action not in (
    'employee.created', 'employee.password_reset', 'employee.activated', 'employee.deactivated',
    'employee.role_changed', 'telegram.linked', 'telegram.admin_added', 'telegram.admin_removed',
    'device.token_rotated', 'device.updated', 'settings.mode_changed') then
    return null;
  end if;
  select full_name into v_actor from public.profiles where id = new.user_id;
  if new.details ->> 'user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select full_name into v_target from public.profiles where id = (new.details ->> 'user_id')::uuid;
  end if;
  perform app_private.notify('admin_action', jsonb_build_object(
      'action', new.action,
      'actor', coalesce(v_actor, new.details ->> 'actor', 'Tizim'),
      'target', case when new.action = 'telegram.linked' then null else coalesce(v_target, new.details ->> 'target', new.details ->> 'device_id', new.details ->> 'username') end,
      'details', new.details,
      'at', new.created_at,
      'timezone', app_private.tz()),
    'admin_action:' || new.id);
  return null;
end $$;

create trigger activity_logs_to_telegram
  after insert on public.activity_logs
  for each row execute function app_private.audit_to_telegram();

-- update_settings: same contract, plus the new toggles and a dedicated audit entry for mode switches.
create or replace function public.update_settings(p jsonb) returns public.app_settings
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.app_settings;
  v_row public.app_settings;
begin
  perform app_private.require_admin();
  select * into v_old from public.app_settings where id = 1;
  update public.app_settings set
    business_name = coalesce(p ->> 'business_name', business_name),
    business_location = coalesce(p ->> 'business_location', business_location),
    timezone = coalesce(p ->> 'timezone', timezone),
    system_mode = coalesce((p ->> 'system_mode')::public.system_mode, system_mode),
    single_shared_shift = coalesce((p ->> 'single_shared_shift')::boolean, single_shared_shift),
    device_offline_after_seconds = coalesce((p ->> 'device_offline_after_seconds')::int, device_offline_after_seconds),
    telegram_enabled = coalesce((p ->> 'telegram_enabled')::boolean, telegram_enabled),
    telegram_admin_ids = coalesce(
      (select array_agg(x::bigint) from jsonb_array_elements_text(p -> 'telegram_admin_ids') x),
      case when p ? 'telegram_admin_ids' then '{}'::bigint[] end,
      telegram_admin_ids),
    notify_shift_start = coalesce((p ->> 'notify_shift_start')::boolean, notify_shift_start),
    notify_shift_end = coalesce((p ->> 'notify_shift_end')::boolean, notify_shift_end),
    notify_daily_report = coalesce((p ->> 'notify_daily_report')::boolean, notify_daily_report),
    notify_weekly_report = coalesce((p ->> 'notify_weekly_report')::boolean, notify_weekly_report),
    notify_monthly_report = coalesce((p ->> 'notify_monthly_report')::boolean, notify_monthly_report),
    notify_device_offline = coalesce((p ->> 'notify_device_offline')::boolean, notify_device_offline),
    notify_admin_actions = coalesce((p ->> 'notify_admin_actions')::boolean, notify_admin_actions),
    daily_report_hour = coalesce((p ->> 'daily_report_hour')::smallint, daily_report_hour),
    updated_by = auth.uid()
  where id = 1
  returning * into v_row;
  perform app_private.log(auth.uid(), 'settings.updated', p - 'telegram_admin_ids');
  if v_row.system_mode is distinct from v_old.system_mode then
    perform app_private.log(auth.uid(), 'settings.mode_changed',
      jsonb_build_object('from', v_old.system_mode, 'to', v_row.system_mode, 'target', v_row.system_mode));
  end if;
  return v_row;
end $$;

-- The scheduler body, parameterised by "now" so it can be tested deterministically.
create function app_private.cron_tick_at(p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
  v_local timestamp;
  v_today date;
  v_month_start date;
  d public.devices;
begin
  select * into s from public.app_settings where id = 1;
  v_local := p_now at time zone s.timezone;
  v_today := v_local::date;

  if extract(hour from v_local)::int = s.daily_report_hour then
    -- Daily: the previous full day.
    perform app_private.notify('daily_report',
      app_private.daily_report(v_today - 1) || jsonb_build_object('period', 'day', 'timezone', s.timezone),
      'daily_report:' || (v_today - 1));
    -- Weekly, on Mondays: the previous Monday–Sunday.
    if extract(isodow from v_today) = 1 then
      perform app_private.notify('weekly_report',
        app_private.period_summary(v_today - 7, v_today - 1, null)
          || jsonb_build_object('business', s.business_name, 'period', 'week', 'timezone', s.timezone),
        'weekly_report:' || (v_today - 7));
    end if;
    -- Monthly, on the 1st: the previous calendar month.
    if extract(day from v_today) = 1 then
      v_month_start := date_trunc('month', v_today - 1)::date;
      perform app_private.notify('monthly_report',
        app_private.period_summary(v_month_start, v_today - 1, null)
          || jsonb_build_object('business', s.business_name, 'period', 'month', 'timezone', s.timezone),
        'monthly_report:' || to_char(v_month_start, 'YYYY-MM'));
    end if;
  end if;

  -- Turnstile connectivity alerts (one per outage, one on recovery).
  for d in select * from public.devices where status = 'active' and last_seen is not null loop
    if d.last_seen < p_now - make_interval(secs => s.device_offline_after_seconds) then
      if d.offline_notified_at is null then
        update public.devices set offline_notified_at = p_now where id = d.id;
        perform app_private.notify('device_offline',
          jsonb_build_object('device_id', d.id, 'device_name', d.device_name, 'last_seen', d.last_seen, 'timezone', s.timezone),
          'device_offline:' || d.id || ':' || floor(extract(epoch from d.last_seen))::bigint);
      end if;
    elsif d.offline_notified_at is not null then
      update public.devices set offline_notified_at = null where id = d.id;
      perform app_private.notify('device_online',
        jsonb_build_object('device_id', d.id, 'device_name', d.device_name, 'offline_since', d.offline_notified_at, 'timezone', s.timezone),
        'device_online:' || d.id || ':' || floor(extract(epoch from p_now))::bigint);
    end if;
  end loop;

  -- Retry path: anything still waiting gets another delivery attempt.
  if exists (select 1 from public.notification_outbox
              where status = 'pending' or (status = 'sending' and created_at < p_now - interval '2 minutes')) then
    perform app_private.kick();
  end if;
end $$;

create or replace function public.cron_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.cron_tick_at(now());
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
-- New functions get EXECUTE for PUBLIC by Postgres' global default: revoke explicitly.
revoke execute on all functions in schema app_private from public, anon, authenticated;
revoke all on public.telegram_links from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter table public.telegram_links enable row level security;
grant select on public.telegram_links to authenticated;
create policy telegram_links_read on public.telegram_links for select to authenticated using (public.is_admin());

-- Admins can see the delivery log of every Telegram notification.
grant select on public.notification_outbox to authenticated;
create policy notification_outbox_read on public.notification_outbox for select to authenticated using (public.is_admin());

revoke execute on function
  public.service_get_config(text), public.service_put_config(text, text), public.service_log(text, jsonb),
  public.configure_automation(text), public.get_automation_status(),
  public.create_telegram_link_code(), public.create_telegram_invite(text),
  public.consume_telegram_link_code(text, bigint, bigint, text, text),
  public.remove_telegram_admin(bigint, text), public.telegram_recipients(),
  public.get_period_summary(date, date, uuid), public.get_recent_summary(integer, uuid),
  public.get_daily_stats(date, date, uuid), public.get_hourly_distribution(date, date, uuid),
  public.get_shifts(date, date, uuid, text, integer, integer),
  public.get_events(date, date, text, text, text, text, integer, integer)
from public, anon, authenticated;

grant execute on function
  public.configure_automation(text), public.get_automation_status(),
  public.create_telegram_link_code(), public.create_telegram_invite(text),
  public.remove_telegram_admin(bigint, text),
  public.get_period_summary(date, date, uuid), public.get_recent_summary(integer, uuid),
  public.get_daily_stats(date, date, uuid), public.get_hourly_distribution(date, date, uuid),
  public.get_shifts(date, date, uuid, text, integer, integer),
  public.get_events(date, date, text, text, text, text, integer, integer)
to authenticated;

grant execute on function
  public.service_get_config(text), public.service_put_config(text, text), public.service_log(text, jsonb),
  public.configure_automation(text), public.get_automation_status(),
  public.create_telegram_invite(text), public.consume_telegram_link_code(text, bigint, bigint, text, text),
  public.remove_telegram_admin(bigint, text), public.telegram_recipients(),
  public.get_period_summary(date, date, uuid), public.get_recent_summary(integer, uuid),
  public.get_daily_stats(date, date, uuid), public.get_hourly_distribution(date, date, uuid),
  public.get_shifts(date, date, uuid, text, integer, integer),
  public.get_events(date, date, text, text, text, text, integer, integer)
to service_role;
