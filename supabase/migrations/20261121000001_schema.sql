-- =============================================================================
-- Smart Restroom — core schema
-- Tables, constraints, indexes and immutability guards.
-- The database is the single source of truth for every counter.
-- =============================================================================

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'employee');
create type public.shift_status as enum ('active', 'completed');
create type public.restroom_type as enum ('male', 'female');
create type public.event_source as enum ('hardware', 'simulated');
create type public.system_mode as enum ('demo', 'production');

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default 'Smart Restroom'
    check (char_length(btrim(business_name)) between 1 and 120),
  business_location text not null default '' check (char_length(business_location) <= 200),
  timezone text not null default 'Asia/Tashkent',
  system_mode public.system_mode not null default 'demo',
  single_shared_shift boolean not null default true,
  device_offline_after_seconds integer not null default 90
    check (device_offline_after_seconds between 15 and 3600),
  telegram_enabled boolean not null default false,
  telegram_admin_ids bigint[] not null default '{}',
  notify_shift_start boolean not null default true,
  notify_shift_end boolean not null default true,
  notify_daily_report boolean not null default true,
  daily_report_hour smallint not null default 23 check (daily_report_hour between 0 and 23),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.app_settings default values;

-- Private key/value config (dispatcher URL + secret). Never exposed via the API.
create table app_private.config (
  key text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_.]{2,31}$'),
  role public.user_role not null default 'employee',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role, is_active);

-- ---------------------------------------------------------------------------
-- Devices (turnstile controllers)
-- ---------------------------------------------------------------------------
create table public.devices (
  id text primary key check (id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  device_name text not null check (char_length(btrim(device_name)) between 2 and 80),
  device_type text not null default 'tripod_turnstile',
  restroom_type public.restroom_type not null,
  status text not null default 'active' check (status in ('active', 'maintenance', 'disabled')),
  last_seen timestamptz,
  last_event_at timestamptz,
  firmware_version text,
  queue_depth integer,
  -- sha256(hex) of the device API token. 'unprovisioned' never matches a hash.
  token_hash text not null default 'unprovisioned',
  token_rotated_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.devices (id, device_name, restroom_type) values
  ('MEN-001', 'Men''s restroom turnstile', 'male'),
  ('WOMEN-001', 'Women''s restroom turnstile', 'female');

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete restrict,
  start_time timestamptz not null default now(),
  end_time timestamptz,
  male_count integer not null default 0 check (male_count >= 0),
  female_count integer not null default 0 check (female_count >= 0),
  total_count integer generated always as (male_count + female_count) stored,
  -- Offline events that arrived after the shift closed. Kept separately so a
  -- closed shift's snapshot is never overwritten.
  late_male_count integer not null default 0 check (late_male_count >= 0),
  late_female_count integer not null default 0 check (late_female_count >= 0),
  status public.shift_status not null default 'active',
  duration_seconds integer generated always as (
    case when end_time is null then null else floor(extract(epoch from (end_time - start_time)))::integer end
  ) stored,
  ended_by uuid references public.profiles (id) on delete restrict,
  end_reason text check (end_reason in ('employee', 'admin_forced')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint shifts_end_consistent check (
    (status = 'active' and end_time is null)
    or (status = 'completed' and end_time is not null and end_time >= start_time)
  )
);
create unique index shifts_one_active_per_employee on public.shifts (employee_id) where status = 'active';
create index shifts_active_idx on public.shifts (start_time desc) where status = 'active';
create index shifts_start_idx on public.shifts (start_time desc);
create index shifts_employee_start_idx on public.shifts (employee_id, start_time desc);

-- ---------------------------------------------------------------------------
-- Entry events (append-only ledger of confirmed passages)
-- ---------------------------------------------------------------------------
create table public.entry_events (
  id bigint generated always as identity primary key,
  event_id text not null check (event_id ~ '^[A-Za-z0-9._:-]{6,128}$'),
  shift_id uuid references public.shifts (id) on delete restrict,
  device_id text not null references public.devices (id) on delete restrict,
  gender public.restroom_type not null,
  event_type text not null default 'passage_confirmed' check (event_type = 'passage_confirmed'),
  device_time timestamptz,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  source public.event_source not null,
  attribution text not null check (attribution in ('live', 'late', 'unassigned')),
  constraint entry_events_device_event_unique unique (device_id, event_id)
);
create index entry_events_occurred_idx on public.entry_events (occurred_at desc);
create index entry_events_shift_idx on public.entry_events (shift_id, created_at desc);
create index entry_events_device_idx on public.entry_events (device_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Device logs (every authenticated hardware message that is not a heartbeat)
-- ---------------------------------------------------------------------------
create table public.device_logs (
  id bigint generated always as identity primary key,
  device_id text references public.devices (id) on delete restrict,
  event_id text,
  event_type text not null,
  result text not null,
  source public.event_source,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index device_logs_created_idx on public.device_logs (created_at desc);
create index device_logs_device_idx on public.device_logs (device_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Activity logs (audit trail of user actions)
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete restrict,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Notification outbox (Telegram). Written in the same transaction as the
-- business change, delivered asynchronously by the telegram-dispatch function.
-- ---------------------------------------------------------------------------
create table public.notification_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('shift_started', 'shift_ended', 'daily_report', 'test')),
  payload jsonb not null default '{}',
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_pending_idx on public.notification_outbox (id) where status in ('pending', 'sending');

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------
create function app_private.guard_shift_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Shift records are permanent and cannot be deleted' using errcode = '42501';
  end if;
  if old.status = 'completed' then
    -- Only the late-arrival counters may change on a closed shift.
    if new.employee_id is distinct from old.employee_id
      or new.start_time is distinct from old.start_time
      or new.end_time is distinct from old.end_time
      or new.male_count is distinct from old.male_count
      or new.female_count is distinct from old.female_count
      or new.status is distinct from old.status
      or new.ended_by is distinct from old.ended_by
      or new.end_reason is distinct from old.end_reason then
      raise exception 'Completed shifts are read-only' using errcode = '42501';
    end if;
  end if;
  if new.employee_id is distinct from old.employee_id or new.start_time is distinct from old.start_time then
    raise exception 'Shift owner and start time are immutable' using errcode = '42501';
  end if;
  if new.male_count < old.male_count or new.female_count < old.female_count then
    raise exception 'Shift counters can only increase' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger shifts_guard
  before update or delete on public.shifts
  for each row execute function app_private.guard_shift_change();

create function app_private.guard_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create trigger entry_events_append_only
  before update or delete on public.entry_events
  for each row execute function app_private.guard_append_only();
create trigger activity_logs_append_only
  before update or delete on public.activity_logs
  for each row execute function app_private.guard_append_only();

create function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.touch_updated_at();

create function app_private.validate_settings() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger app_settings_validate before insert or update on public.app_settings
  for each row execute function app_private.validate_settings();

-- ---------------------------------------------------------------------------
-- Profile bootstrap from auth.users. The role is read from app_metadata, which
-- only the service role can set — users can never grant themselves admin.
-- ---------------------------------------------------------------------------
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, username, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1))),
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'employee')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();
