import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';
import { BackendError, type Backend, type LiveTopic } from './backend';
import type { Profile, Settings, Shift, ShiftFilter } from '@/types/domain';
import { localDayStartIso } from '@/lib/format';

const SHIFT_COLUMNS =
  'id, employee_id, start_time, end_time, male_count, female_count, total_count, late_male_count, late_female_count, status, duration_seconds, end_reason, employee:profiles!shifts_employee_id_fkey(full_name)';

type ShiftRow = Omit<Shift, 'employee_name'> & { employee: { full_name: string } | null };
const toShift = ({ employee, ...row }: ShiftRow): Shift => ({ ...row, employee_name: employee?.full_name ?? '—' });

/** Turns PostgREST / Postgres errors into short, human-readable messages. */
function fail(error: { message: string; code?: string; hint?: string | null } | null): never {
  const msg = error?.message ?? 'Unexpected error';
  if (error?.code === '42501' && /permission denied/i.test(msg)) throw new BackendError('You do not have permission for this action', '42501');
  throw new BackendError(msg, error?.hint ?? error?.code);
}

export class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const;
  readonly db: SupabaseClient;

  constructor() {
    this.db = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sr-auth' },
    });
  }

  private async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) fail(error);
    return data as T;
  }

  private async invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.functions.invoke(fn, { body });
    if (error) {
      let message = error.message;
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx) message = (await ctx.json()).error ?? message;
      } catch {
        /* keep the generic message */
      }
      throw new BackendError(message);
    }
    return data as T;
  }

  // ---------------------------------------------------------------- auth
  async signIn(username: string, password: string) {
    const email = `${username.trim().toLowerCase()}@${env.authEmailDomain}`;
    const { error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) {
      throw new BackendError(/banned/i.test(error.message) ? 'This account has been deactivated' : 'Invalid username or password');
    }
    const profile = await this.currentProfile();
    if (!profile || !profile.is_active) {
      await this.db.auth.signOut();
      throw new BackendError('This account has been deactivated');
    }
    // Query builders are lazy: `.then` is what actually sends the request. Audit failures never block sign-in.
    this.db.rpc('log_activity', { p_action: 'auth.login', p_details: {} }).then(undefined, () => undefined);
    return profile;
  }

  async signOut() {
    await this.db.auth.signOut();
  }

  async currentProfile(): Promise<Profile | null> {
    const { data: session } = await this.db.auth.getSession();
    const uid = session.session?.user.id;
    if (!uid) return null;
    const { data, error } = await this.db
      .from('profiles')
      .select('id, full_name, username, role, is_active, created_at')
      .eq('id', uid)
      .maybeSingle();
    if (error) fail(error);
    return data;
  }

  onAuthChange(cb: () => void) {
    const { data } = this.db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') cb();
    });
    return () => data.subscription.unsubscribe();
  }

  // ---------------------------------------------------------------- shifts
  getActiveShifts() {
    return this.rpc<any[]>('get_active_shifts');
  }

  async startShift() {
    const row = await this.rpc<Omit<Shift, 'employee_name'>>('start_shift');
    return { ...row, employee_name: '' };
  }

  async endShift(shiftId: string) {
    const row = await this.rpc<Omit<Shift, 'employee_name'>>('end_shift', { p_shift_id: shiftId });
    return { ...row, employee_name: '' };
  }

  async listShifts(f: ShiftFilter) {
    let q = this.db.from('shifts').select(SHIFT_COLUMNS).order('start_time', { ascending: false }).limit(f.limit ?? 200);
    if (f.employeeId) q = q.eq('employee_id', f.employeeId);
    if (f.status) q = q.eq('status', f.status);
    if (f.from) q = q.gte('start_time', localDayStartIso(f.from));
    if (f.to) q = q.lt('start_time', localDayStartIso(f.to, 1));
    const { data, error } = await q;
    if (error) fail(error);
    return (data as unknown as ShiftRow[]).map(toShift);
  }

  // ---------------------------------------------------------------- events & stats
  async listEvents({ shiftId, limit = 30 }: { shiftId?: string; limit?: number }) {
    let q = this.db
      .from('entry_events')
      .select('id, event_id, shift_id, device_id, gender, occurred_at, created_at, source, attribution')
      .order('id', { ascending: false })
      .limit(limit);
    if (shiftId) q = q.eq('shift_id', shiftId);
    const { data, error } = await q;
    if (error) fail(error);
    return data ?? [];
  }

  getTodaySummary() {
    return this.rpc<any>('get_today_summary');
  }

  async getDailyStats(from: string, to: string) {
    const rows = await this.rpc<any[]>('get_daily_stats', { p_from: from, p_to: to });
    return rows.map((r) => ({ day: r.day, male: Number(r.male), female: Number(r.female), total: Number(r.total) }));
  }

  async getHourlyDistribution(from: string, to: string) {
    const rows = await this.rpc<any[]>('get_hourly_distribution', { p_from: from, p_to: to });
    return rows.map((r) => ({ hour: r.hour, male: Number(r.male), female: Number(r.female) }));
  }

  async getEmployeePerformance(from: string, to: string) {
    const rows = await this.rpc<any[]>('get_employee_performance', { p_from: from, p_to: to });
    return rows.map((r) => ({
      ...r,
      shifts: Number(r.shifts),
      male: Number(r.male),
      female: Number(r.female),
      total: Number(r.total),
      hours: Number(r.hours),
      per_hour: Number(r.per_hour),
    }));
  }

  getDailyReport(day: string) {
    return this.rpc<any>('build_daily_report', { p_day: day });
  }

  // ---------------------------------------------------------------- employees
  async listEmployees() {
    const { data, error } = await this.db
      .from('profiles')
      .select('id, full_name, username, role, is_active, created_at')
      .order('role')
      .order('full_name');
    if (error) fail(error);
    return data ?? [];
  }

  async createEmployee(input: { username: string; full_name: string; password: string }) {
    await this.invoke('admin-users', { action: 'create', ...input });
  }

  async updateEmployee(id: string, input: { full_name: string }) {
    await this.invoke('admin-users', { action: 'update', user_id: id, ...input });
  }

  async setEmployeeActive(id: string, active: boolean) {
    await this.invoke('admin-users', { action: 'set_active', user_id: id, is_active: active });
  }

  async resetPassword(id: string, password: string) {
    await this.invoke('admin-users', { action: 'reset_password', user_id: id, password });
  }

  // ---------------------------------------------------------------- devices
  async listDevices() {
    const { data, error } = await this.db
      .from('devices')
      .select('id, device_name, device_type, restroom_type, status, last_seen, last_event_at, firmware_version, queue_depth, token_rotated_at')
      .order('id', { ascending: true });
    if (error) fail(error);
    return data ?? [];
  }

  async listDeviceLogs({ deviceId, limit = 50 }: { deviceId?: string; limit?: number }) {
    let q = this.db.from('device_logs').select('*').order('id', { ascending: false }).limit(limit);
    if (deviceId) q = q.eq('device_id', deviceId);
    const { data, error } = await q;
    if (error) fail(error);
    return data ?? [];
  }

  async updateDevice(id: string, input: { device_name?: string; status?: string }) {
    await this.rpc('admin_update_device', { p_device_id: id, p_name: input.device_name ?? null, p_status: input.status ?? null });
  }

  rotateDeviceToken(id: string) {
    return this.rpc<string>('admin_rotate_device_token', { p_device_id: id });
  }

  async simulatePassage(deviceId: string) {
    await this.rpc('simulate_passage', { p_device_id: deviceId });
  }

  // ---------------------------------------------------------------- settings
  async getSettings(): Promise<Settings> {
    const { data, error } = await this.db.from('app_settings').select('*').eq('id', 1).single();
    if (error) fail(error);
    return { ...data, telegram_admin_ids: (data.telegram_admin_ids ?? []).map(Number) };
  }

  async updateSettings(patch: Partial<Settings>) {
    const row = await this.rpc<Settings>('update_settings', { p: patch });
    return { ...row, telegram_admin_ids: (row.telegram_admin_ids ?? []).map(Number) };
  }

  async listActivity(limit: number) {
    const { data, error } = await this.db
      .from('activity_logs')
      .select('id, user_id, action, details, created_at, user:profiles(full_name)')
      .order('id', { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return (data ?? []).map(({ user, ...r }: any) => ({ ...r, user_name: user?.full_name ?? null }));
  }

  telegramStatus() {
    return this.invoke<{ bot_configured: boolean; chats: number }>('telegram-dispatch', { action: 'status' });
  }

  async telegramTest() {
    await this.invoke('telegram-dispatch', { action: 'test' });
  }

  // ---------------------------------------------------------------- realtime
  subscribe(cb: (topic: LiveTopic) => void) {
    const channel = this.db
      .channel(`sr-live-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entry_events' }, () => cb('events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => cb('shifts'))
      .subscribe();
    return () => {
      void this.db.removeChannel(channel);
    };
  }

  hardwareEndpoint() {
    return `${env.supabaseUrl}/functions/v1/turnstile-events`;
  }
}
