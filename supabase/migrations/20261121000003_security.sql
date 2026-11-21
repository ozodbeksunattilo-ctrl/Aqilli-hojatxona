-- =============================================================================
-- Smart Restroom — privileges, Row Level Security and Realtime
-- Default: deny. Clients get read access through RLS and write only via RPC.
-- =============================================================================

-- Supabase grants broad default privileges to anon/authenticated. Undo them.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.shifts enable row level security;
alter table public.entry_events enable row level security;
alter table public.device_logs enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notification_outbox enable row level security;

-- Settings: readable by any signed-in user (no secrets live here).
grant select on public.app_settings to authenticated;
create policy settings_read on public.app_settings for select to authenticated using (true);

-- Profiles: own row, or everything for admins.
grant select on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Devices: status is visible to signed-in users; token_hash is never readable.
grant select (id, device_name, device_type, restroom_type, status, last_seen, last_event_at,
              firmware_version, queue_depth, token_rotated_at, created_at)
  on public.devices to authenticated;
create policy devices_read on public.devices for select to authenticated using (true);

-- Shifts: employees see their own, admins see all.
grant select on public.shifts to authenticated;
create policy shifts_read on public.shifts for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- Entry events: employees see events of their own shifts, admins see all.
grant select on public.entry_events to authenticated;
create policy entry_events_read on public.entry_events for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.shifts s where s.id = shift_id and s.employee_id = auth.uid())
  );

-- Logs: admins only.
grant select on public.device_logs, public.activity_logs to authenticated;
create policy device_logs_read on public.device_logs for select to authenticated using (public.is_admin());
create policy activity_logs_read on public.activity_logs for select to authenticated using (public.is_admin());

-- notification_outbox: no client policies at all (service role only).

-- RPC surface
grant execute on function public.is_admin() to authenticated;
grant execute on function public.start_shift() to authenticated;
grant execute on function public.end_shift(uuid) to authenticated;
grant execute on function public.get_active_shifts() to authenticated, service_role;
grant execute on function public.get_today_summary() to authenticated, service_role;
grant execute on function public.get_daily_stats(date, date) to authenticated, service_role;
grant execute on function public.get_hourly_distribution(date, date) to authenticated, service_role;
grant execute on function public.get_employee_performance(date, date) to authenticated, service_role;
grant execute on function public.build_daily_report(date) to authenticated, service_role;
grant execute on function public.simulate_passage(text) to authenticated;
grant execute on function public.update_settings(jsonb) to authenticated;
grant execute on function public.admin_update_device(text, text, text) to authenticated;
grant execute on function public.admin_rotate_device_token(text) to authenticated, service_role;
grant execute on function public.log_activity(text, jsonb) to authenticated;
grant execute on function public.ingest_turnstile_event(text, text, text, text, timestamptz, boolean, jsonb) to service_role;
grant execute on function public.claim_notifications(integer) to service_role;
grant execute on function public.complete_notification(bigint, boolean, text) to service_role;
grant execute on function public.cron_tick() to service_role;

-- Realtime: stream row changes (RLS is applied per subscriber). Devices are
-- polled instead, so token_hash never travels through the replication stream.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.entry_events, public.shifts;
