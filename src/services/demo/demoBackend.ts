/**
 * LOCAL DEMO BACKEND — runs entirely in the browser (localStorage).
 *
 * Used only when no Supabase project is configured, so the product can be
 * explored without any infrastructure. It mirrors the production rules
 * (one shared shift, counting only confirmed passages, frozen closed shifts)
 * but it is NOT a source of truth: every number here is simulated and the UI
 * shows a permanent "Local demo" banner.
 */
import { BackendError, type Backend, type LiveTopic } from '../backend';
import type {
  ActivityLog,
  DailyReport,
  Device,
  DeviceLog,
  EntryEvent,
  Gender,
  HourStat,
  Profile,
  Settings,
  Shift,
  ShiftFilter,
} from '@/types/domain';
import { addDays, localDayStartIso, toDayStr, todayStr } from '@/lib/format';

interface DemoUser extends Profile {
  password: string;
}
type StoredShift = Omit<Shift, 'employee_name' | 'total_count' | 'duration_seconds'>;

interface DemoState {
  version: number;
  users: DemoUser[];
  shifts: StoredShift[];
  events: EntryEvent[];
  buckets: Record<string, [number, number]>; // "yyyy-mm-dd:HH" → [male, female]
  devices: Device[];
  deviceLogs: DeviceLog[];
  activity: ActivityLog[];
  settings: Settings;
  seq: number;
}

const KEY = 'sr-demo-state-v2';
const SESSION_KEY = 'sr-demo-session';
const VERSION = 2;

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Visitors per hour (shape of a busy public restroom), scaled with noise.
const HOUR_CURVE = [2, 1, 1, 1, 2, 6, 18, 34, 52, 58, 55, 60, 72, 70, 58, 54, 60, 74, 80, 66, 48, 32, 16, 6];

function seed(): DemoState {
  const created = new Date(Date.now() - 45 * 86400_000).toISOString();
  const users: DemoUser[] = [
    { id: uid(), username: 'admin', full_name: 'Otabek Administrator', role: 'admin', is_active: true, created_at: created, password: 'admin123' },
    { id: uid(), username: 'asqar', full_name: 'Asqar Karimov', role: 'employee', is_active: true, created_at: created, password: 'asqar123' },
    { id: uid(), username: 'bekzod', full_name: 'Bekzod Aliyev', role: 'employee', is_active: true, created_at: created, password: 'bekzod123' },
    { id: uid(), username: 'dilnoza', full_name: 'Dilnoza Rahimova', role: 'employee', is_active: true, created_at: created, password: 'dilnoza123' },
  ];
  const employees = users.filter((u) => u.role === 'employee');
  const buckets: DemoState['buckets'] = {};
  const shifts: StoredShift[] = [];
  const now = new Date();
  const today = todayStr();

  for (let d = 34; d >= 0; d--) {
    const day = addDays(today, -d);
    const weekday = new Date(`${day}T00:00:00`).getDay();
    const dayFactor = (weekday === 0 || weekday === 6 ? 1.25 : 1) * (0.85 + Math.random() * 0.3);
    const windows: [number, number][] = [[7, 15], [15, 23]];
    windows.forEach(([from, to], i) => {
      const start = new Date(`${day}T${String(from).padStart(2, '0')}:0${Math.floor(Math.random() * 6)}:00`);
      let end = new Date(`${day}T${String(to - 1).padStart(2, '0')}:5${Math.floor(Math.random() * 9)}:00`);
      if (start >= now) return;
      if (end > now) end = new Date(now.getTime() - 25 * 60_000);
      if (end <= start) return;
      const emp = employees[(d * 2 + i) % employees.length];
      let male = 0;
      let female = 0;
      for (let h = from; h < to; h++) {
        const hourStart = new Date(`${day}T${String(h).padStart(2, '0')}:00:00`);
        if (hourStart >= end) break;
        const share = Math.min(1, (end.getTime() - hourStart.getTime()) / 3600_000);
        const n = Math.round(HOUR_CURVE[h] * dayFactor * share * (0.8 + Math.random() * 0.4));
        const m = Math.round(n * (0.55 + Math.random() * 0.08));
        const key = `${day}:${String(h).padStart(2, '0')}`;
        const b = buckets[key] ?? [0, 0];
        buckets[key] = [b[0] + m, b[1] + (n - m)];
        male += m;
        female += n - m;
      }
      shifts.push({
        id: uid(), employee_id: emp.id, start_time: start.toISOString(), end_time: end.toISOString(),
        male_count: male, female_count: female, late_male_count: 0, late_female_count: 0,
        status: 'completed', end_reason: 'employee',
      });
    });
  }

  const recentSeen = new Date(now.getTime() - 4000).toISOString();
  return {
    version: VERSION,
    users,
    shifts,
    events: [],
    buckets,
    devices: [
      { id: 'MEN-001', device_name: "Men's restroom turnstile", device_type: 'tripod_turnstile', restroom_type: 'male', status: 'active', last_seen: recentSeen, last_event_at: null, firmware_version: 'demo-1.0.0', queue_depth: 0, token_rotated_at: created },
      { id: 'WOMEN-001', device_name: "Women's restroom turnstile", device_type: 'tripod_turnstile', restroom_type: 'female', status: 'active', last_seen: recentSeen, last_event_at: null, firmware_version: 'demo-1.0.0', queue_depth: 0, token_rotated_at: created },
    ],
    deviceLogs: [],
    activity: [],
    settings: {
      business_name: 'Smart Restroom — Chorsu',
      business_location: 'Chorsu Bazaar, Tashkent',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      system_mode: 'demo',
      single_shared_shift: true,
      device_offline_after_seconds: 90,
      telegram_enabled: false,
      telegram_admin_ids: [],
      notify_shift_start: true,
      notify_shift_end: true,
      notify_daily_report: true,
      daily_report_hour: 23,
    },
    seq: 1,
  };
}

export class DemoBackend implements Backend {
  readonly kind = 'demo' as const;
  private listeners = new Set<(t: LiveTopic) => void>();
  private authListeners = new Set<() => void>();
  private channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sr-demo') : null;

  constructor() {
    this.channel?.addEventListener('message', (e) => this.listeners.forEach((l) => l(e.data as LiveTopic)));
    // Controllers "heartbeat" while any demo tab is open.
    setInterval(() => {
      this.mutate((s) => {
        for (const d of s.devices) if (d.status !== 'disabled') d.last_seen = nowIso();
      }, 'devices');
    }, 20_000);
  }

  // ---------------------------------------------------------------- storage
  private load(): DemoState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoState;
        if (parsed.version === VERSION) return parsed;
      }
    } catch {
      /* fall through to a fresh seed */
    }
    const fresh = seed();
    this.save(fresh);
    return fresh;
  }

  private save(s: DemoState) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked: demo keeps running in memory for this call */
    }
  }

  private mutate<T>(fn: (s: DemoState) => T, topic: LiveTopic): T {
    const s = this.load();
    const result = fn(s);
    this.save(s);
    this.listeners.forEach((l) => l(topic));
    this.channel?.postMessage(topic);
    return result;
  }

  private me(s: DemoState): DemoUser | null {
    const id = sessionStorage.getItem(SESSION_KEY);
    return s.users.find((u) => u.id === id && u.is_active) ?? null;
  }

  private requireUser(s: DemoState) {
    const me = this.me(s);
    if (!me) throw new BackendError('Not authenticated or account is inactive');
    return me;
  }

  private requireAdmin(s: DemoState) {
    const me = this.requireUser(s);
    if (me.role !== 'admin') throw new BackendError('Administrator access required');
    return me;
  }

  private log(s: DemoState, userId: string | null, action: string, details: Record<string, unknown> = {}) {
    const name = s.users.find((u) => u.id === userId)?.full_name ?? null;
    s.activity.unshift({ id: s.seq++, user_id: userId, user_name: name, action, details, created_at: nowIso() });
    s.activity.length = Math.min(s.activity.length, 200);
  }

  private toShift(s: DemoState, r: StoredShift): Shift {
    return {
      ...r,
      employee_name: s.users.find((u) => u.id === r.employee_id)?.full_name ?? '—',
      total_count: r.male_count + r.female_count,
      duration_seconds: r.end_time ? Math.floor((Date.parse(r.end_time) - Date.parse(r.start_time)) / 1000) : null,
    };
  }

  private profile = ({ password: _p, ...u }: DemoUser): Profile => u;

  // ---------------------------------------------------------------- auth
  async signIn(username: string, password: string) {
    await sleep(450);
    const s = this.load();
    const u = s.users.find((x) => x.username === username.trim().toLowerCase());
    if (!u || u.password !== password) throw new BackendError('Invalid username or password');
    if (!u.is_active) throw new BackendError('This account has been deactivated');
    sessionStorage.setItem(SESSION_KEY, u.id);
    this.mutate((st) => this.log(st, u.id, 'auth.login'), 'settings');
    this.authListeners.forEach((l) => l());
    return this.profile(u);
  }

  async signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    this.authListeners.forEach((l) => l());
  }

  async currentProfile() {
    const me = this.me(this.load());
    return me ? this.profile(me) : null;
  }

  onAuthChange(cb: () => void) {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }

  // ---------------------------------------------------------------- shifts
  async getActiveShifts() {
    const s = this.load();
    this.requireUser(s);
    return s.shifts
      .filter((x) => x.status === 'active')
      .map((x) => this.toShift(s, x));
  }

  async startShift() {
    await sleep(250);
    return this.mutate((s) => {
      const me = this.requireUser(s);
      if (me.role !== 'employee') throw new BackendError('Only employees can start shifts');
      if (s.shifts.some((x) => x.status === 'active' && x.employee_id === me.id)) throw new BackendError('You already have an active shift');
      const other = s.shifts.find((x) => x.status === 'active');
      if (s.settings.single_shared_shift && other) {
        const name = s.users.find((u) => u.id === other.employee_id)?.full_name;
        throw new BackendError(`Another shift is in progress (${name}). It must be ended first.`);
      }
      const row: StoredShift = {
        id: uid(), employee_id: me.id, start_time: nowIso(), end_time: null, male_count: 0, female_count: 0,
        late_male_count: 0, late_female_count: 0, status: 'active', end_reason: null,
      };
      s.shifts.push(row);
      this.log(s, me.id, 'shift.started', { shift_id: row.id });
      return this.toShift(s, row);
    }, 'shifts');
  }

  async endShift(shiftId: string) {
    await sleep(250);
    return this.mutate((s) => {
      const me = this.requireUser(s);
      const row = s.shifts.find((x) => x.id === shiftId);
      if (!row) throw new BackendError('Shift not found');
      if (row.employee_id !== me.id && me.role !== 'admin') throw new BackendError('You can only end your own shift');
      if (row.status !== 'active') throw new BackendError('Shift is already completed');
      row.status = 'completed';
      row.end_time = nowIso();
      row.end_reason = row.employee_id === me.id ? 'employee' : 'admin_forced';
      this.log(s, me.id, 'shift.ended', { shift_id: row.id, total: row.male_count + row.female_count });
      return this.toShift(s, row);
    }, 'shifts');
  }

  async listShifts(f: ShiftFilter) {
    const s = this.load();
    const me = this.requireUser(s);
    const from = f.from ? localDayStartIso(f.from) : null;
    const to = f.to ? localDayStartIso(f.to, 1) : null;
    return s.shifts
      .filter((x) => me.role === 'admin' || x.employee_id === me.id)
      .filter((x) => !f.employeeId || x.employee_id === f.employeeId)
      .filter((x) => !f.status || x.status === f.status)
      .filter((x) => (!from || x.start_time >= from) && (!to || x.start_time < to))
      .sort((a, b) => b.start_time.localeCompare(a.start_time))
      .slice(0, f.limit ?? 200)
      .map((x) => this.toShift(s, x));
  }

  // ---------------------------------------------------------------- events & stats
  async listEvents({ shiftId, limit = 30 }: { shiftId?: string; limit?: number }) {
    const s = this.load();
    const me = this.requireUser(s);
    const mine = new Set(s.shifts.filter((x) => x.employee_id === me.id).map((x) => x.id));
    return s.events
      .filter((e) => me.role === 'admin' || (e.shift_id && mine.has(e.shift_id)))
      .filter((e) => !shiftId || e.shift_id === shiftId)
      .slice(0, limit);
  }

  private sumBuckets(s: DemoState, from: string, to: string) {
    const byDay = new Map<string, [number, number]>();
    const byHour: [number, number][] = Array.from({ length: 24 }, () => [0, 0]);
    for (const [key, [m, f]] of Object.entries(s.buckets)) {
      const [day, hour] = key.split(':');
      if (day < from || day > to) continue;
      const d = byDay.get(day) ?? [0, 0];
      byDay.set(day, [d[0] + m, d[1] + f]);
      byHour[Number(hour)][0] += m;
      byHour[Number(hour)][1] += f;
    }
    return { byDay, byHour };
  }

  async getTodaySummary() {
    const s = this.load();
    this.requireUser(s);
    const today = todayStr();
    const { byHour } = this.sumBuckets(s, today, today);
    const male = byHour.reduce((n, h) => n + h[0], 0);
    const female = byHour.reduce((n, h) => n + h[1], 0);
    const from = localDayStartIso(today);
    return {
      date: today,
      male,
      female,
      total: male + female,
      unassigned: s.events.filter((e) => e.attribution === 'unassigned' && e.occurred_at >= from).length,
      simulated: male + female,
      completed_shifts: s.shifts.filter((x) => x.status === 'completed' && x.end_time! >= from).length,
      active_shifts: s.shifts.filter((x) => x.status === 'active').length,
      hourly: byHour.map(([m, f], hour) => ({ hour, male: m, female: f })),
    };
  }

  async getDailyStats(from: string, to: string) {
    const s = this.load();
    this.requireAdmin(s);
    const { byDay } = this.sumBuckets(s, from, to);
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const [m, f] = byDay.get(d) ?? [0, 0];
      out.push({ day: d, male: m, female: f, total: m + f });
    }
    return out;
  }

  async getHourlyDistribution(from: string, to: string): Promise<HourStat[]> {
    const s = this.load();
    this.requireAdmin(s);
    return this.sumBuckets(s, from, to).byHour.map(([m, f], hour) => ({ hour, male: m, female: f }));
  }

  async getEmployeePerformance(from: string, to: string) {
    const s = this.load();
    this.requireAdmin(s);
    const lo = localDayStartIso(from);
    const hi = localDayStartIso(to, 1);
    return s.users
      .filter((u) => u.role === 'employee')
      .map((u) => {
        const list = s.shifts.filter((x) => x.employee_id === u.id && x.start_time >= lo && x.start_time < hi);
        const male = list.reduce((n, x) => n + x.male_count, 0);
        const female = list.reduce((n, x) => n + x.female_count, 0);
        const hours = list.reduce((n, x) => n + ((x.end_time ? Date.parse(x.end_time) : Date.now()) - Date.parse(x.start_time)) / 3600_000, 0);
        return {
          employee_id: u.id, full_name: u.full_name, username: u.username, is_active: u.is_active,
          shifts: list.length, male, female, total: male + female,
          hours: Math.round(hours * 100) / 100, per_hour: hours > 0 ? Math.round(((male + female) / hours) * 10) / 10 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  async getDailyReport(day: string): Promise<DailyReport> {
    const s = this.load();
    this.requireAdmin(s);
    const { byDay } = this.sumBuckets(s, day, day);
    const [male, female] = byDay.get(day) ?? [0, 0];
    const perf = await this.getEmployeePerformance(day, day);
    const lo = localDayStartIso(day);
    const hi = localDayStartIso(day, 1);
    const unassigned = s.events.filter((e) => e.attribution === 'unassigned' && e.occurred_at >= lo && e.occurred_at < hi).length;
    return {
      date: day, business: s.settings.business_name, male, female, total: male + female, unassigned,
      employees: perf.filter((p) => p.shifts > 0).map((p) => ({ name: p.full_name, shifts: p.shifts, male: p.male, female: p.female, total: p.total })),
    };
  }

  // ---------------------------------------------------------------- employees
  async listEmployees() {
    const s = this.load();
    this.requireAdmin(s);
    return s.users.map(this.profile).sort((a, b) => a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name));
  }

  async createEmployee(input: { username: string; full_name: string; password: string }) {
    await sleep(300);
    this.mutate((s) => {
      const me = this.requireAdmin(s);
      const username = input.username.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.]{2,31}$/.test(username)) throw new BackendError('Username: 3–32 chars, a-z 0-9 _ .');
      if (input.full_name.trim().length < 2) throw new BackendError('Full name must be 2–80 characters');
      if (input.password.length < 8) throw new BackendError('Password must be 8–72 characters');
      if (s.users.some((u) => u.username === username)) throw new BackendError('Username is already taken');
      const id = uid();
      s.users.push({ id, username, full_name: input.full_name.trim(), role: 'employee', is_active: true, created_at: nowIso(), password: input.password });
      this.log(s, me.id, 'employee.created', { user_id: id, username });
    }, 'settings');
  }

  async updateEmployee(id: string, input: { full_name: string }) {
    this.mutate((s) => {
      const me = this.requireAdmin(s);
      const u = s.users.find((x) => x.id === id);
      if (!u) throw new BackendError('User not found');
      if (input.full_name.trim().length < 2) throw new BackendError('Full name must be 2–80 characters');
      u.full_name = input.full_name.trim();
      this.log(s, me.id, 'employee.updated', { user_id: id });
    }, 'settings');
  }

  async setEmployeeActive(id: string, active: boolean) {
    this.mutate((s) => {
      const me = this.requireAdmin(s);
      if (id === me.id) throw new BackendError('You cannot deactivate your own account');
      const u = s.users.find((x) => x.id === id);
      if (!u) throw new BackendError('User not found');
      u.is_active = active;
      this.log(s, me.id, active ? 'employee.activated' : 'employee.deactivated', { user_id: id });
    }, 'settings');
  }

  async resetPassword(id: string, password: string) {
    this.mutate((s) => {
      const me = this.requireAdmin(s);
      if (password.length < 8) throw new BackendError('Password must be 8–72 characters');
      const u = s.users.find((x) => x.id === id);
      if (!u) throw new BackendError('User not found');
      u.password = password;
      this.log(s, me.id, 'employee.password_reset', { user_id: id });
    }, 'settings');
  }

  // ---------------------------------------------------------------- devices
  async listDevices() {
    const s = this.load();
    this.requireUser(s);
    return s.devices;
  }

  async listDeviceLogs({ deviceId, limit = 50 }: { deviceId?: string; limit?: number }) {
    const s = this.load();
    this.requireAdmin(s);
    return s.deviceLogs.filter((l) => !deviceId || l.device_id === deviceId).slice(0, limit);
  }

  async updateDevice(id: string, input: { device_name?: string; status?: Device['status'] }) {
    this.mutate((s) => {
      const me = this.requireAdmin(s);
      const d = s.devices.find((x) => x.id === id);
      if (!d) throw new BackendError(`Unknown device ${id}`);
      if (input.device_name?.trim()) d.device_name = input.device_name.trim();
      if (input.status) d.status = input.status;
      this.log(s, me.id, 'device.updated', { device_id: id, status: input.status });
    }, 'devices');
  }

  async rotateDeviceToken(id: string) {
    return this.mutate((s) => {
      const me = this.requireAdmin(s);
      const d = s.devices.find((x) => x.id === id);
      if (!d) throw new BackendError(`Unknown device ${id}`);
      d.token_rotated_at = nowIso();
      this.log(s, me.id, 'device.token_rotated', { device_id: id });
      return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    }, 'devices');
  }

  async simulatePassage(deviceId: string) {
    this.mutate((s) => {
      this.requireAdmin(s);
      if (s.settings.system_mode !== 'demo') throw new BackendError('Simulation is disabled in production mode');
      const d = s.devices.find((x) => x.id === deviceId);
      if (!d) throw new BackendError(`Unknown device ${deviceId}`);
      const eventId = `sim-${uid().replace(/-/g, '')}`;
      if (d.status === 'disabled') {
        s.deviceLogs.unshift({ id: s.seq++, device_id: d.id, event_id: eventId, event_type: 'passage_confirmed', result: 'rejected_disabled', source: 'simulated', detail: {}, created_at: nowIso() });
        return;
      }
      const gender: Gender = d.restroom_type;
      const active = s.shifts.filter((x) => x.status === 'active').sort((a, b) => b.start_time.localeCompare(a.start_time))[0];
      if (active) {
        if (gender === 'male') active.male_count++;
        else active.female_count++;
      }
      const at = new Date();
      const key = `${toDayStr(at)}:${String(at.getHours()).padStart(2, '0')}`;
      const b = s.buckets[key] ?? [0, 0];
      s.buckets[key] = gender === 'male' ? [b[0] + 1, b[1]] : [b[0], b[1] + 1];
      s.events.unshift({
        id: s.seq++, event_id: eventId, shift_id: active?.id ?? null, device_id: d.id, gender,
        occurred_at: at.toISOString(), created_at: at.toISOString(), source: 'simulated',
        attribution: active ? 'live' : 'unassigned',
      });
      s.events.length = Math.min(s.events.length, 300);
      d.last_seen = d.last_event_at = at.toISOString();
      s.deviceLogs.unshift({
        id: s.seq++, device_id: d.id, event_id: eventId, event_type: 'passage_confirmed',
        result: active ? 'counted_live' : 'counted_unassigned', source: 'simulated', detail: {}, created_at: at.toISOString(),
      });
      s.deviceLogs.length = Math.min(s.deviceLogs.length, 200);
    }, 'events');
  }

  // ---------------------------------------------------------------- settings
  async getSettings() {
    const s = this.load();
    this.requireUser(s);
    return s.settings;
  }

  async updateSettings(patch: Partial<Settings>) {
    await sleep(250);
    return this.mutate((s) => {
      const me = this.requireAdmin(s);
      s.settings = { ...s.settings, ...patch };
      this.log(s, me.id, 'settings.updated', { ...patch, telegram_admin_ids: undefined });
      return s.settings;
    }, 'settings');
  }

  async listActivity(limit: number) {
    const s = this.load();
    this.requireAdmin(s);
    return s.activity.slice(0, limit);
  }

  async telegramStatus() {
    return { bot_configured: false, chats: this.load().settings.telegram_admin_ids.length };
  }

  async telegramTest() {
    throw new BackendError('Telegram is not available in the local demo. Connect Supabase and set TELEGRAM_BOT_TOKEN.');
  }

  subscribe(cb: (topic: LiveTopic) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  hardwareEndpoint() {
    return 'https://<PROJECT_REF>.supabase.co/functions/v1/turnstile-events';
  }

  /** Demo only: wipe local data and re-seed. */
  reset() {
    localStorage.removeItem(KEY);
    this.load();
    this.listeners.forEach((l) => l('shifts'));
    this.channel?.postMessage('shifts');
  }
}
