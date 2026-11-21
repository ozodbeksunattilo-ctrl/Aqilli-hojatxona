-- =============================================================================
-- Smart Restroom — business logic
-- All writes go through these SECURITY DEFINER functions. Clients never write
-- to tables directly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function app_private.is_service_role() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  )
$$;

create function app_private.require_active_user() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found or not v_profile.is_active then
    raise exception 'Not authenticated or account is inactive' using errcode = '42501';
  end if;
  return v_profile;
end $$;

create function app_private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() or app_private.is_service_role()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
end $$;

create function app_private.tz() returns text
language sql stable set search_path = '' as $$
  select timezone from public.app_settings where id = 1
$$;

create function app_private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone app_private.tz())::date
$$;

-- Start of a business day (local midnight) as an absolute timestamp.
create function app_private.day_start(p_day date) returns timestamptz
language sql stable set search_path = '' as $$
  select (p_day::timestamp at time zone app_private.tz())
$$;

create function app_private.log(p_user uuid, p_action text, p_details jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
  insert into public.activity_logs (user_id, action, details) values (p_user, p_action, coalesce(p_details, '{}'))
$$;

create function app_private.token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- Queue a Telegram notification if the integration and the specific toggle are enabled.
create function app_private.notify(p_kind text, p_payload jsonb, p_dedupe text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.app_settings;
begin
  select * into s from public.app_settings where id = 1;
  if not s.telegram_enabled then return; end if;
  if (p_kind = 'shift_started' and not s.notify_shift_start)
    or (p_kind = 'shift_ended' and not s.notify_shift_end)
    or (p_kind = 'daily_report' and not s.notify_daily_report) then
    return;
  end if;
  insert into public.notification_outbox (kind, payload, dedupe_key)
  values (p_kind, p_payload, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- Wake the dispatcher immediately through pg_net when it is installed and
-- configured (see supabase/setup/production.sql). pg_cron retries otherwise.
create function app_private.kick_dispatcher() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_private.config where key = 'dispatch_url';
  select value into v_secret from app_private.config where key = 'dispatch_secret';
  if v_url is null or to_regproc('net.http_post') is null then
    return null;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', coalesce(v_secret, ''));
  return null;
exception when others then
  raise warning 'telegram dispatcher kick failed: %', sqlerrm;
  return null;
end $$;

create trigger notification_outbox_kick
  after insert on public.notification_outbox
  for each statement execute function app_private.kick_dispatcher();

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
create function public.start_shift() returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_settings public.app_settings;
  v_shift public.shifts;
  v_other text;
begin
  v_me := app_private.require_active_user();
  if v_me.role <> 'employee' then
    raise exception 'Only employees can start shifts' using errcode = '42501';
  end if;

  -- Serialise all shift starts so the "one shared shift" rule cannot race.
  perform pg_advisory_xact_lock(hashtextextended('smart_restroom.start_shift', 0));
  select * into v_settings from public.app_settings where id = 1;

  if exists (select 1 from public.shifts where employee_id = v_me.id and status = 'active') then
    raise exception 'You already have an active shift' using errcode = 'P0001', hint = 'shift_already_active';
  end if;

  if v_settings.single_shared_shift then
    select p.full_name into v_other
    from public.shifts s join public.profiles p on p.id = s.employee_id
    where s.status = 'active' limit 1;
    if found then
      raise exception 'Another shift is in progress (%). It must be ended first.', v_other
        using errcode = 'P0001', hint = 'location_busy';
    end if;
  end if;

  insert into public.shifts (employee_id, start_time, is_demo)
  values (v_me.id, clock_timestamp(), v_settings.system_mode = 'demo')
  returning * into v_shift;

  perform app_private.log(v_me.id, 'shift.started', jsonb_build_object('shift_id', v_shift.id));
  perform app_private.notify('shift_started', jsonb_build_object(
    'shift_id', v_shift.id,
    'employee', v_me.full_name,
    'start_time', v_shift.start_time,
    'timezone', v_settings.timezone,
    'business', v_settings.business_name
  ), 'shift_started:' || v_shift.id);
  return v_shift;
end $$;

create function public.end_shift(p_shift_id uuid) returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_shift public.shifts;
  v_employee text;
  v_settings public.app_settings;
begin
  v_me := app_private.require_active_user();

  -- Row lock: waits for in-flight passage events on this shift to commit.
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  if v_shift.employee_id <> v_me.id and v_me.role <> 'admin' then
    raise exception 'You can only end your own shift' using errcode = '42501';
  end if;
  if v_shift.status <> 'active' then
    raise exception 'Shift is already completed' using errcode = 'P0001', hint = 'shift_not_active';
  end if;

  update public.shifts
     set status = 'completed',
         end_time = greatest(clock_timestamp(), start_time),
         ended_by = v_me.id,
         end_reason = case when v_shift.employee_id = v_me.id then 'employee' else 'admin_forced' end
   where id = p_shift_id
  returning * into v_shift;

  select full_name into v_employee from public.profiles where id = v_shift.employee_id;
  select * into v_settings from public.app_settings where id = 1;

  perform app_private.log(v_me.id, 'shift.ended', jsonb_build_object(
    'shift_id', v_shift.id, 'male', v_shift.male_count, 'female', v_shift.female_count,
    'total', v_shift.total_count, 'forced', v_shift.end_reason = 'admin_forced'));
  perform app_private.notify('shift_ended', jsonb_build_object(
    'shift_id', v_shift.id,
    'employee', v_employee,
    'start_time', v_shift.start_time,
    'end_time', v_shift.end_time,
    'duration_seconds', v_shift.duration_seconds,
    'male', v_shift.male_count,
    'female', v_shift.female_count,
    'total', v_shift.total_count,
    'forced', v_shift.end_reason = 'admin_forced',
    'timezone', v_settings.timezone,
    'business', v_settings.business_name
  ), 'shift_ended:' || v_shift.id);
  return v_shift;
end $$;

-- Current active shift(s), visible to any signed-in user (name + counters only).
create function public.get_active_shifts() returns table (
  id uuid, employee_id uuid, employee_name text, start_time timestamptz,
  male_count integer, female_count integer, total_count integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_service_role() then
    perform app_private.require_active_user();
  end if;
  return query
    select s.id, s.employee_id, p.full_name, s.start_time, s.male_count, s.female_count, s.total_count
    from public.shifts s join public.profiles p on p.id = s.employee_id
    where s.status = 'active'
    order by s.start_time;
end $$;

-- ---------------------------------------------------------------------------
-- Passage recording (shared by hardware ingest and the demo simulator)
-- ---------------------------------------------------------------------------
create function app_private.record_passage(
  p_device public.devices,
  p_event_id text,
  p_device_time timestamptz,
  p_source public.event_source
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_occurred timestamptz;
  v_clock_trusted boolean;
  v_shift public.shifts;
  v_attr text;
  v_pk bigint;
  v_male int := case when p_device.restroom_type = 'male' then 1 else 0 end;
  v_female int := case when p_device.restroom_type = 'female' then 1 else 0 end;
begin
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9._:-]{6,128}$' then
    insert into public.device_logs (device_id, event_id, event_type, result, source)
    values (p_device.id, left(p_event_id, 128), 'passage_confirmed', 'invalid_event_id', p_source);
    return jsonb_build_object('status', 'invalid', 'reason', 'invalid_event_id');
  end if;

  -- Device clocks are trusted only inside a sane window; otherwise server time wins.
  v_clock_trusted := p_device_time is not null
    and p_device_time <= v_now + interval '2 minutes'
    and p_device_time >= v_now - interval '14 days';
  v_occurred := case when v_clock_trusted then least(p_device_time, v_now) else v_now end;

  if exists (select 1 from public.entry_events where device_id = p_device.id and event_id = p_event_id) then
    insert into public.device_logs (device_id, event_id, event_type, result, source)
    values (p_device.id, p_event_id, 'passage_confirmed', 'duplicate', p_source);
    return jsonb_build_object('status', 'duplicate');
  end if;

  -- 1) live: the active shift that was already running when the passage happened.
  select * into v_shift from public.shifts
   where status = 'active' and start_time <= v_occurred
   order by start_time desc limit 1
   for update;
  if found then
    v_attr := 'live';
  else
    -- 2) late: an offline event that belongs to an already-closed shift.
    select * into v_shift from public.shifts
     where status = 'completed' and start_time <= v_occurred and end_time > v_occurred
     order by start_time desc limit 1
     for update;
    v_attr := case when found then 'late' else 'unassigned' end;
  end if;

  insert into public.entry_events (event_id, shift_id, device_id, gender, device_time, occurred_at, source, attribution)
  values (p_event_id, case when v_attr = 'unassigned' then null else v_shift.id end, p_device.id,
          p_device.restroom_type, p_device_time, v_occurred, p_source, v_attr)
  on conflict on constraint entry_events_device_event_unique do nothing
  returning id into v_pk;

  if v_pk is null then
    -- Lost a race against an identical event: the other transaction counted it.
    insert into public.device_logs (device_id, event_id, event_type, result, source)
    values (p_device.id, p_event_id, 'passage_confirmed', 'duplicate', p_source);
    return jsonb_build_object('status', 'duplicate');
  end if;

  if v_attr = 'live' then
    update public.shifts
       set male_count = male_count + v_male, female_count = female_count + v_female
     where id = v_shift.id
    returning * into v_shift;
  elsif v_attr = 'late' then
    update public.shifts
       set late_male_count = late_male_count + v_male, late_female_count = late_female_count + v_female
     where id = v_shift.id
    returning * into v_shift;
  end if;

  update public.devices set last_event_at = v_now where id = p_device.id;

  insert into public.device_logs (device_id, event_id, event_type, result, source, detail)
  values (p_device.id, p_event_id, 'passage_confirmed', 'counted_' || v_attr, p_source,
          jsonb_build_object('clock_trusted', v_clock_trusted, 'shift_id', v_shift.id));

  return jsonb_build_object(
    'status', 'counted',
    'attribution', v_attr,
    'gender', p_device.restroom_type,
    'shift_id', case when v_attr = 'unassigned' then null else v_shift.id end,
    'shift_total', case when v_attr = 'live' then v_shift.total_count end,
    'occurred_at', v_occurred
  );
end $$;

-- Hardware entry point. Called by the turnstile-events Edge Function with the
-- service role; the device token is verified here against its stored hash.
create function public.ingest_turnstile_event(
  p_device_id text,
  p_token text,
  p_event_id text,
  p_event_type text,
  p_device_time timestamptz default null,
  p_simulated boolean default false,
  p_meta jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_device public.devices;
  v_mode public.system_mode;
  v_source public.event_source := case when p_simulated then 'simulated' else 'hardware' end;
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into v_device from public.devices where id = p_device_id;
  if not found or v_device.token_hash <> app_private.token_hash(p_token) then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  -- Any authenticated message proves the controller is alive.
  -- Telemetry is best-effort: malformed values are ignored, never fatal.
  update public.devices
     set last_seen = clock_timestamp(),
         firmware_version = coalesce(left(p_meta ->> 'firmware', 40), firmware_version),
         queue_depth = coalesce(
           case when (p_meta ->> 'queue_depth') ~ '^\d{1,9}$' then (p_meta ->> 'queue_depth')::int end,
           queue_depth)
   where id = p_device_id;

  if p_event_type = 'heartbeat' then
    return jsonb_build_object('status', 'ok');
  end if;

  select system_mode into v_mode from public.app_settings where id = 1;
  if p_simulated and v_mode = 'production' then
    insert into public.device_logs (device_id, event_id, event_type, result, source)
    values (p_device_id, left(p_event_id, 128), coalesce(p_event_type, 'unknown'), 'rejected_simulated', v_source);
    return jsonb_build_object('status', 'rejected', 'reason', 'simulated_events_disabled_in_production');
  end if;

  if v_device.status = 'disabled' then
    insert into public.device_logs (device_id, event_id, event_type, result, source)
    values (p_device_id, left(p_event_id, 128), coalesce(p_event_type, 'unknown'), 'rejected_disabled', v_source);
    return jsonb_build_object('status', 'rejected', 'reason', 'device_disabled');
  end if;

  if p_event_type = 'passage_confirmed' then
    return app_private.record_passage(v_device, p_event_id, p_device_time, v_source);
  end if;

  -- Informational events (release button, timeouts, faults) are logged, never counted.
  insert into public.device_logs (device_id, event_id, event_type, result, source, detail)
  values (p_device_id, left(p_event_id, 128), left(coalesce(p_event_type, 'unknown'), 64), 'logged', v_source,
          coalesce(p_meta, '{}'));
  return jsonb_build_object('status', 'logged');
end $$;

-- Demo-mode simulator for administrators (no hardware required).
create function public.simulate_passage(p_device_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_device public.devices;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if (select system_mode from public.app_settings where id = 1) <> 'demo' then
    raise exception 'Simulation is disabled in production mode' using errcode = '42501';
  end if;
  select * into v_device from public.devices where id = p_device_id;
  if not found then
    raise exception 'Unknown device %', p_device_id using errcode = 'P0002';
  end if;
  update public.devices set last_seen = clock_timestamp() where id = p_device_id;
  return app_private.record_passage(v_device, 'sim-' || replace(gen_random_uuid()::text, '-', ''), null, 'simulated');
end $$;

-- ---------------------------------------------------------------------------
-- Statistics
-- ---------------------------------------------------------------------------
create function public.get_today_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date;
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  if not app_private.is_service_role() then
    perform app_private.require_active_user();
  end if;
  v_day := app_private.today();
  v_from := app_private.day_start(v_day);
  v_to := app_private.day_start(v_day + 1);

  select jsonb_build_object(
    'date', v_day,
    'male', count(*) filter (where e.gender = 'male'),
    'female', count(*) filter (where e.gender = 'female'),
    'total', count(*),
    'unassigned', count(*) filter (where e.attribution = 'unassigned'),
    'simulated', count(*) filter (where e.source = 'simulated'),
    'completed_shifts', (select count(*) from public.shifts s
                          where s.status = 'completed' and s.end_time >= v_from and s.end_time < v_to),
    'active_shifts', (select count(*) from public.shifts s where s.status = 'active'),
    'hourly', (
      select jsonb_agg(jsonb_build_object('hour', h, 'male', coalesce(x.m, 0), 'female', coalesce(x.f, 0)) order by h)
      from generate_series(0, 23) h
      left join (
        select extract(hour from e2.occurred_at at time zone app_private.tz())::int hr,
               count(*) filter (where e2.gender = 'male') m,
               count(*) filter (where e2.gender = 'female') f
        from public.entry_events e2
        where e2.occurred_at >= v_from and e2.occurred_at < v_to
        group by 1
      ) x on x.hr = h
    )
  ) into v_result
  from public.entry_events e
  where e.occurred_at >= v_from and e.occurred_at < v_to;
  return v_result;
end $$;

create function public.get_daily_stats(p_from date, p_to date) returns table (
  day date, male bigint, female bigint, total bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Invalid date range (max 400 days)' using errcode = '22023';
  end if;
  return query
    select d::date,
           coalesce(x.m, 0), coalesce(x.f, 0), coalesce(x.m, 0) + coalesce(x.f, 0)
    from generate_series(p_from, p_to, interval '1 day') d
    left join (
      select (e.occurred_at at time zone app_private.tz())::date dd,
             count(*) filter (where e.gender = 'male') m,
             count(*) filter (where e.gender = 'female') f
      from public.entry_events e
      where e.occurred_at >= app_private.day_start(p_from) and e.occurred_at < app_private.day_start(p_to + 1)
      group by 1
    ) x on x.dd = d::date
    order by 1;
end $$;

create function public.get_hourly_distribution(p_from date, p_to date) returns table (
  hour integer, male bigint, female bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return query
    select h, coalesce(x.m, 0), coalesce(x.f, 0)
    from generate_series(0, 23) h
    left join (
      select extract(hour from e.occurred_at at time zone app_private.tz())::int hr,
             count(*) filter (where e.gender = 'male') m,
             count(*) filter (where e.gender = 'female') f
      from public.entry_events e
      where e.occurred_at >= app_private.day_start(p_from) and e.occurred_at < app_private.day_start(p_to + 1)
      group by 1
    ) x on x.hr = h
    order by 1;
end $$;

create function public.get_employee_performance(p_from date, p_to date) returns table (
  employee_id uuid, full_name text, username text, is_active boolean,
  shifts bigint, male bigint, female bigint, total bigint, hours numeric, per_hour numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return query
    with agg as (
      select s.employee_id eid,
             count(*) c,
             sum(s.male_count) m,
             sum(s.female_count) f,
             sum(extract(epoch from (coalesce(s.end_time, now()) - s.start_time))) / 3600.0 h
      from public.shifts s
      where s.start_time >= app_private.day_start(p_from) and s.start_time < app_private.day_start(p_to + 1)
      group by s.employee_id
    )
    select p.id, p.full_name, p.username, p.is_active,
           coalesce(a.c, 0), coalesce(a.m, 0)::bigint, coalesce(a.f, 0)::bigint,
           (coalesce(a.m, 0) + coalesce(a.f, 0))::bigint,
           round(coalesce(a.h, 0)::numeric, 2),
           case when coalesce(a.h, 0) > 0 then round(((a.m + a.f) / a.h)::numeric, 1) else 0 end
    from public.profiles p
    left join agg a on a.eid = p.id
    where p.role = 'employee'
    order by 8 desc, p.full_name;
end $$;

create function app_private.daily_report(p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date;
  v_from timestamptz;
  v_to timestamptz;
  v_settings public.app_settings;
  v_result jsonb;
begin
  v_day := coalesce(p_day, app_private.today());
  v_from := app_private.day_start(v_day);
  v_to := app_private.day_start(v_day + 1);
  select * into v_settings from public.app_settings where id = 1;

  select jsonb_build_object(
    'date', v_day,
    'business', v_settings.business_name,
    'male', count(*) filter (where e.gender = 'male'),
    'female', count(*) filter (where e.gender = 'female'),
    'total', count(*),
    'unassigned', count(*) filter (where e.attribution = 'unassigned'),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', p.full_name, 'shifts', x.c, 'male', x.m, 'female', x.f, 'total', x.m + x.f)
             order by x.m + x.f desc)
      from (
        select s.employee_id, count(*) c, sum(s.male_count) m, sum(s.female_count) f
        from public.shifts s
        where s.start_time >= v_from and s.start_time < v_to
        group by s.employee_id
      ) x join public.profiles p on p.id = x.employee_id
    ), '[]'::jsonb)
  ) into v_result
  from public.entry_events e
  where e.occurred_at >= v_from and e.occurred_at < v_to;
  return v_result;
end $$;

create function public.build_daily_report(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  return app_private.daily_report(p_day);
end $$;

-- Called every minute by pg_cron: enqueue the daily report once per day.
create function public.cron_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.app_settings;
  v_local timestamp;
begin
  select * into v_settings from public.app_settings where id = 1;
  v_local := now() at time zone v_settings.timezone;
  if extract(hour from v_local)::int = v_settings.daily_report_hour then
    perform app_private.notify(
      'daily_report',
      app_private.daily_report(v_local::date),
      'daily_report:' || v_local::date
    );
  end if;
end $$;

-- Atomically claim pending notifications (safe with concurrent dispatchers).
create function public.claim_notifications(p_limit integer default 20) returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query
    update public.notification_outbox o
       set status = 'sending', attempts = o.attempts + 1
     where o.id in (
       select id from public.notification_outbox
        where status = 'pending'
           or (status = 'sending' and attempts < 5 and created_at < now() - interval '2 minutes')
        order by id
        limit p_limit
        for update skip locked
     )
    returning o.*;
end $$;

create function public.complete_notification(p_id bigint, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_service_role() then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.notification_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
         sent_at = case when p_ok then now() end,
         last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
create function public.update_settings(p jsonb) returns public.app_settings
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.app_settings;
begin
  perform app_private.require_admin();
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
    daily_report_hour = coalesce((p ->> 'daily_report_hour')::smallint, daily_report_hour),
    updated_by = auth.uid()
  where id = 1
  returning * into v_row;
  perform app_private.log(auth.uid(), 'settings.updated', p - 'telegram_admin_ids');
  return v_row;
end $$;

create function public.admin_update_device(p_device_id text, p_name text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin();
  update public.devices
     set device_name = coalesce(nullif(btrim(p_name), ''), device_name),
         status = coalesce(p_status, status)
   where id = p_device_id;
  if not found then
    raise exception 'Unknown device %', p_device_id using errcode = 'P0002';
  end if;
  perform app_private.log(auth.uid(), 'device.updated', jsonb_build_object('device_id', p_device_id, 'status', p_status));
end $$;

-- Generates a fresh 256-bit device token. The plaintext is returned exactly once.
create function public.admin_rotate_device_token(p_device_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform app_private.require_admin();
  update public.devices
     set token_hash = app_private.token_hash(v_token), token_rotated_at = now()
   where id = p_device_id;
  if not found then
    raise exception 'Unknown device %', p_device_id using errcode = 'P0002';
  end if;
  perform app_private.log(auth.uid(), 'device.token_rotated', jsonb_build_object('device_id', p_device_id));
  return v_token;
end $$;

create function public.log_activity(p_action text, p_details jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_action !~ '^[a-z_]+\.[a-z_]+$' then
    raise exception 'Invalid action' using errcode = '22023';
  end if;
  perform app_private.require_active_user();
  perform app_private.log(auth.uid(), p_action, p_details);
end $$;
