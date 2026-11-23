import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, stopServer, type Actor, type TestDb } from './harness';

const service: Actor = { kind: 'service' };
const user = (id: string): Actor => ({ kind: 'user', id });

let db: TestDb;
let adminId: string;
let asqarId: string;
let bekzodId: string;
let dilnozaId: string;
let menToken: string;
let womenToken: string;

async function setup() {
  await db?.close();
  db = await freshDb();
  adminId = await db.createUser('admin', 'Main Admin', 'admin');
  asqarId = await db.createUser('asqar', 'Asqar Karimov');
  bekzodId = await db.createUser('bekzod', 'Bekzod Aliyev');
  dilnozaId = await db.createUser('dilnoza', 'Dilnoza Rahimova');
  [{ admin_rotate_device_token: menToken }] = await db.as(user(adminId), `select public.admin_rotate_device_token('MEN-001')`);
  [{ admin_rotate_device_token: womenToken }] = await db.as(user(adminId), `select public.admin_rotate_device_token('WOMEN-001')`);
}

let seq = 0;
const nextEventId = () => `evt-${Date.now()}-${++seq}`;

async function passage(device: 'MEN-001' | 'WOMEN-001', eventId = nextEventId(), opts: { token?: string; time?: string | null; simulated?: boolean } = {}) {
  const token = opts.token ?? (device === 'MEN-001' ? menToken : womenToken);
  const [row] = await db.as(service, `select public.ingest_turnstile_event($1, $2, $3, 'passage_confirmed', $4, $5) r`, [
    device, token, eventId, opts.time ?? null, opts.simulated ?? false,
  ]);
  return row.r as Record<string, any>;
}

async function startShift(id: string) {
  const [row] = await db.as(user(id), `select * from public.start_shift()`);
  return row;
}
async function endShift(id: string, shiftId: string) {
  const [row] = await db.as(user(id), `select * from public.end_shift($1)`, [shiftId]);
  return row;
}
async function shiftRow(id: string) {
  const [row] = await db.as({ kind: 'superuser' }, `select * from public.shifts where id = $1`, [id]);
  return row;
}

afterAll(async () => {
  await db?.close();
  await stopServer();
});

describe('authentication & profiles', () => {
  beforeAll(setup);

  it('creates profiles from auth users with role taken only from app_metadata', async () => {
    const rows = await db.as({ kind: 'superuser' }, `select username, role from public.profiles order by username`);
    expect(rows).toEqual([
      { username: 'admin', role: 'admin' },
      { username: 'asqar', role: 'employee' },
      { username: 'bekzod', role: 'employee' },
      { username: 'dilnoza', role: 'employee' },
    ]);
    // A user that tries to self-assign admin through user_metadata stays an employee.
    const { rows: [u] } = await db.pool.query(
      `insert into auth.users (email, raw_user_meta_data) values ('evil@x.local', '{"username":"evil","full_name":"Evil","role":"admin"}') returning id`);
    const [p] = await db.as({ kind: 'superuser' }, `select role from public.profiles where id = $1`, [u.id]);
    expect(p.role).toBe('employee');
  });

  it('admin is recognised, employees are not', async () => {
    expect((await db.as(user(adminId), `select public.is_admin() a`))[0].a).toBe(true);
    expect((await db.as(user(asqarId), `select public.is_admin() a`))[0].a).toBe(false);
  });
});

describe('permission restrictions (RLS)', () => {
  beforeAll(setup);

  it('employee sees only their own profile; admin sees all', async () => {
    expect(await db.as(user(asqarId), `select username from public.profiles`)).toEqual([{ username: 'asqar' }]);
    expect((await db.as(user(adminId), `select username from public.profiles`)).length).toBeGreaterThanOrEqual(4);
  });

  it("employee cannot see another employee's shifts or events", async () => {
    const s = await startShift(bekzodId);
    await passage('MEN-001');
    expect(await db.as(user(asqarId), `select id from public.shifts`)).toEqual([]);
    expect(await db.as(user(asqarId), `select id from public.entry_events`)).toEqual([]);
    expect((await db.as(user(bekzodId), `select id from public.entry_events`)).length).toBe(1);
    expect((await db.as(user(adminId), `select id from public.shifts`)).length).toBe(1);
    await endShift(bekzodId, s.id);
  });

  it('clients cannot write tables directly', async () => {
    await expect(db.as(user(asqarId), `insert into public.shifts (employee_id) values ($1)`, [asqarId])).rejects.toThrow(/permission denied/);
    await expect(db.as(user(adminId), `update public.shifts set male_count = 999`)).rejects.toThrow(/permission denied/);
    await expect(db.as(user(adminId), `delete from public.entry_events`)).rejects.toThrow(/permission denied/);
    await expect(db.as(user(adminId), `update public.profiles set role = 'admin'`)).rejects.toThrow(/permission denied/);
  });

  it('device token hashes are never readable', async () => {
    await expect(db.as(user(adminId), `select token_hash from public.devices`)).rejects.toThrow(/permission denied/);
    const rows = await db.as(user(asqarId), `select id, restroom_type from public.devices order by id`);
    expect(rows.map((r) => r.id)).toEqual(['MEN-001', 'WOMEN-001']);
  });

  it('employees cannot call admin functions', async () => {
    for (const sql of [
      `select public.update_settings('{"business_name":"x"}')`,
      `select public.admin_rotate_device_token('MEN-001')`,
      `select public.simulate_passage('MEN-001')`,
      `select public.build_daily_report(null)`,
      `select public.get_recent_summary(7)`,
      `select public.get_events(current_date - 7, current_date)`,
      `select public.create_telegram_invite(null)`,
      `select public.configure_automation('https://example.com/api')`,
      `select public.get_automation_status()`,
    ]) {
      await expect(db.as(user(asqarId), sql), sql).rejects.toThrow(/Administrator access required/);
    }
  });

  it('anonymous and authenticated users cannot call the hardware ingest function', async () => {
    await expect(db.as({ kind: 'anon' }, `select public.ingest_turnstile_event('MEN-001','x','evt-000001','passage_confirmed')`)).rejects.toThrow(/permission denied/);
    await expect(db.as(user(adminId), `select public.ingest_turnstile_event('MEN-001','x','evt-000001','passage_confirmed')`)).rejects.toThrow(/permission denied/);
  });

  it('an inactive employee cannot start a shift', async () => {
    await db.pool.query(`update public.profiles set is_active = false where id = $1`, [dilnozaId]);
    await expect(startShift(dilnozaId)).rejects.toThrow(/inactive/);
    await db.pool.query(`update public.profiles set is_active = true where id = $1`, [dilnozaId]);
  });

  it('admins cannot start shifts and employees cannot end other shifts', async () => {
    await expect(startShift(adminId)).rejects.toThrow(/Only employees/);
    const s = await startShift(asqarId);
    await expect(endShift(bekzodId, s.id)).rejects.toThrow(/only end your own/);
    const forced = await endShift(adminId, s.id);
    expect(forced.end_reason).toBe('admin_forced');
  });
});

describe('shift lifecycle & counting', () => {
  beforeAll(setup);

  it('starts a shift at zero, counts male/female passages, ends with a frozen snapshot', async () => {
    const s = await startShift(asqarId);
    expect(s).toMatchObject({ status: 'active', male_count: 0, female_count: 0, total_count: 0 });

    for (let i = 0; i < 6; i++) expect((await passage('MEN-001')).status).toBe('counted');
    for (let i = 0; i < 4; i++) await passage('WOMEN-001');

    const live = await shiftRow(s.id);
    expect(live).toMatchObject({ male_count: 6, female_count: 4, total_count: 10 });

    const ended = await endShift(asqarId, s.id);
    expect(ended).toMatchObject({ status: 'completed', male_count: 6, female_count: 4, total_count: 10, end_reason: 'employee' });
    expect(ended.end_time).not.toBeNull();
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(0);
    await expect(endShift(asqarId, s.id)).rejects.toThrow(/already completed/);
  });

  it('a new shift by another employee starts from zero and leaves history untouched', async () => {
    const [prev] = await db.as({ kind: 'superuser' }, `select * from public.shifts where employee_id = $1`, [asqarId]);
    const s2 = await startShift(bekzodId);
    expect(s2).toMatchObject({ male_count: 0, female_count: 0 });
    await passage('MEN-001');
    await passage('WOMEN-001');
    await passage('WOMEN-001');

    expect(await shiftRow(s2.id)).toMatchObject({ male_count: 1, female_count: 2, total_count: 3 });
    const prevAfter = await shiftRow(prev.id);
    expect(prevAfter).toMatchObject({ male_count: 6, female_count: 4, total_count: 10, status: 'completed' });
    expect(prevAfter.end_time.toISOString()).toBe(prev.end_time.toISOString());
    await endShift(bekzodId, s2.id);
  });

  it('completed shifts are read-only and no shift can ever be deleted', async () => {
    const [done] = await db.as({ kind: 'superuser' }, `select id from public.shifts where status = 'completed' limit 1`);
    await expect(db.pool.query(`update public.shifts set male_count = 0 where id = $1`, [done.id])).rejects.toThrow(/read-only/);
    await expect(db.pool.query(`delete from public.shifts where id = $1`, [done.id])).rejects.toThrow(/cannot be deleted/);
    await expect(db.pool.query(`delete from public.entry_events`)).rejects.toThrow(/append-only/);
  });

  it('only one shared shift can be active at the location', async () => {
    const s = await startShift(asqarId);
    await expect(startShift(bekzodId)).rejects.toThrow(/Another shift is in progress \(Asqar Karimov\)/);
    await expect(startShift(asqarId)).rejects.toThrow(/already have an active shift/);
    await endShift(asqarId, s.id);
  });

  it('simultaneous shift starts by two employees: exactly one wins', async () => {
    const results = await Promise.allSettled([startShift(bekzodId), startShift(dilnozaId), startShift(asqarId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [{ n }] = await db.as({ kind: 'superuser' }, `select count(*)::int n from public.shifts where status = 'active'`);
    expect(n).toBe(1);
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    await endShift(winner.employee_id, winner.id);
  });

  it('passages with no active shift are stored as unassigned, never lost', async () => {
    const r = await passage('MEN-001');
    expect(r).toMatchObject({ status: 'counted', attribution: 'unassigned', shift_id: null });
    const [{ n }] = await db.as({ kind: 'superuser' }, `select count(*)::int n from public.entry_events where attribution = 'unassigned'`);
    expect(n).toBe(1);
  });
});

describe('event integrity', () => {
  beforeAll(setup);
  let shiftId: string;
  beforeEach(async () => {
    const [active] = await db.as({ kind: 'superuser' }, `select id from public.shifts where status = 'active'`);
    shiftId = active?.id ?? (await startShift(asqarId)).id;
  });

  it('ignores duplicate event ids', async () => {
    const id = nextEventId();
    expect((await passage('MEN-001', id)).status).toBe('counted');
    expect((await passage('MEN-001', id)).status).toBe('duplicate');
    expect((await passage('MEN-001', id)).status).toBe('duplicate');
    expect((await shiftRow(shiftId)).male_count).toBe(1);
  });

  it('counts exactly once under 40 concurrent deliveries of the same event', async () => {
    const before = (await shiftRow(shiftId)).female_count;
    const id = nextEventId();
    const results = await Promise.all(Array.from({ length: 40 }, () => passage('WOMEN-001', id)));
    expect(results.filter((r) => r.status === 'counted')).toHaveLength(1);
    expect((await shiftRow(shiftId)).female_count).toBe(before + 1);
  });

  it('handles simultaneous distinct events from both turnstiles without losing any', async () => {
    const before = await shiftRow(shiftId);
    const jobs = [
      ...Array.from({ length: 60 }, () => passage('MEN-001')),
      ...Array.from({ length: 45 }, () => passage('WOMEN-001')),
    ];
    const results = await Promise.all(jobs);
    expect(results.every((r) => r.status === 'counted' && r.attribution === 'live')).toBe(true);
    const after = await shiftRow(shiftId);
    expect(after.male_count - before.male_count).toBe(60);
    expect(after.female_count - before.female_count).toBe(45);
    const [{ n }] = await db.as({ kind: 'superuser' }, `select count(*)::int n from public.entry_events where shift_id = $1`, [shiftId]);
    expect(n).toBe(after.total_count);
  });

  it('rejects bad device tokens and unknown devices without counting', async () => {
    const before = await shiftRow(shiftId);
    expect((await passage('MEN-001', nextEventId(), { token: 'wrong' })).status).toBe('unauthorized');
    expect((await passage('MEN-001', nextEventId(), { token: womenToken })).status).toBe('unauthorized');
    const [r] = await db.as(service, `select public.ingest_turnstile_event('FAKE-9', 'x', 'evt-123456', 'passage_confirmed') r`);
    expect(r.r.status).toBe('unauthorized');
    expect(await shiftRow(shiftId)).toMatchObject({ male_count: before.male_count, female_count: before.female_count });
  });

  it('never counts button presses or other non-passage events', async () => {
    const before = await shiftRow(shiftId);
    for (const type of ['release_button_pressed', 'passage_timeout', 'fault']) {
      const [r] = await db.as(service, `select public.ingest_turnstile_event('MEN-001', $1, $2, $3) r`, [menToken, nextEventId(), type]);
      expect(r.r.status).toBe('logged');
    }
    expect(await shiftRow(shiftId)).toMatchObject({ male_count: before.male_count });
    const logs = await db.as(user(adminId), `select event_type, result from public.device_logs where result = 'logged'`);
    expect(logs.map((l) => l.event_type).sort()).toEqual(['fault', 'passage_timeout', 'release_button_pressed']);
  });

  it('rejects malformed event ids', async () => {
    expect((await passage('MEN-001', 'bad id with spaces')).status).toBe('invalid');
    expect((await passage('MEN-001', 'x')).status).toBe('invalid');
  });

  it('disabled devices are rejected', async () => {
    await db.as(user(adminId), `select public.admin_update_device('WOMEN-001', null, 'disabled')`);
    expect((await passage('WOMEN-001')).status).toBe('rejected');
    await db.as(user(adminId), `select public.admin_update_device('WOMEN-001', null, 'active')`);
    expect((await passage('WOMEN-001')).status).toBe('counted');
  });

  it('token rotation invalidates the old token', async () => {
    const old = menToken;
    [{ admin_rotate_device_token: menToken }] = await db.as(user(adminId), `select public.admin_rotate_device_token('MEN-001')`);
    expect((await passage('MEN-001', nextEventId(), { token: old })).status).toBe('unauthorized');
    expect((await passage('MEN-001')).status).toBe('counted');
  });
});

describe('hardware disconnection & reconnection', () => {
  beforeAll(setup);

  it('heartbeats mark the device online; silence marks it offline', async () => {
    await db.as(service, `select public.ingest_turnstile_event('MEN-001', $1, 'hb-000001', 'heartbeat', null, false, '{"firmware":"1.2.0","queue_depth":3}')`, [menToken]);
    const [d] = await db.as(user(adminId), `select last_seen, firmware_version, queue_depth from public.devices where id = 'MEN-001'`);
    expect(d.firmware_version).toBe('1.2.0');
    expect(d.queue_depth).toBe(3);
    expect(Date.now() - new Date(d.last_seen).getTime()).toBeLessThan(10_000);
    const [w] = await db.as(user(adminId), `select last_seen from public.devices where id = 'WOMEN-001'`);
    expect(w.last_seen).toBeNull();
  });

  it('offline events synced after reconnect are attributed by device time', async () => {
    // Shift A runs and closes while the men's controller is offline.
    const a = await startShift(asqarId);
    await db.pool.query(`alter table public.shifts disable trigger shifts_guard`);
    await db.pool.query(`update public.shifts set start_time = now() - interval '3 hours' where id = $1`, [a.id]);
    await db.pool.query(`alter table public.shifts enable trigger shifts_guard`);
    await endShift(asqarId, a.id);
    const frozen = await shiftRow(a.id);

    // Shift B is now running.
    const b = await startShift(bekzodId);

    // Controller reconnects and flushes its queue: two events from shift A, one now.
    const inA = new Date(Date.now() - 2 * 3600_000).toISOString();
    const queued = ['q-000001', 'q-000002'];
    expect(await passage('MEN-001', queued[0], { time: inA })).toMatchObject({ status: 'counted', attribution: 'late', shift_id: a.id });
    expect(await passage('MEN-001', queued[1], { time: inA })).toMatchObject({ attribution: 'late' });
    expect(await passage('MEN-001', 'q-000003', { time: new Date().toISOString() })).toMatchObject({ attribution: 'live', shift_id: b.id });

    // A retry of the same batch after a lost HTTP response is fully idempotent.
    for (const id of queued) expect((await passage('MEN-001', id, { time: inA })).status).toBe('duplicate');

    const aAfter = await shiftRow(a.id);
    expect(aAfter).toMatchObject({ male_count: frozen.male_count, total_count: frozen.total_count, late_male_count: 2 });
    expect((await shiftRow(b.id)).male_count).toBe(1);
  });

  it('device timestamps in the future or far past fall back to server time', async () => {
    const r = await passage('WOMEN-001', nextEventId(), { time: '2099-01-01T00:00:00Z' });
    expect(Math.abs(new Date(r.occurred_at).getTime() - Date.now())).toBeLessThan(10_000);
    expect(r.attribution).toBe('live');
  });
});

describe('demo vs production separation', () => {
  beforeAll(setup);

  it('admin simulation works in demo mode and is tagged simulated', async () => {
    const s = await startShift(asqarId);
    const [r] = await db.as(user(adminId), `select public.simulate_passage('WOMEN-001') r`);
    expect(r.r).toMatchObject({ status: 'counted', gender: 'female' });
    const [e] = await db.as(user(adminId), `select source from public.entry_events`);
    expect(e.source).toBe('simulated');
    await endShift(asqarId, s.id);
  });

  it('production mode rejects every simulated event', async () => {
    await db.as(user(adminId), `select public.update_settings('{"system_mode":"production"}')`);
    await expect(db.as(user(adminId), `select public.simulate_passage('MEN-001')`)).rejects.toThrow(/disabled in production/);
    expect((await passage('MEN-001', nextEventId(), { simulated: true })).status).toBe('rejected');
    expect((await passage('MEN-001')).status).toBe('counted');
    const sources = await db.as(user(adminId), `select source, count(*)::int n from public.entry_events group by 1 order by 1`);
    expect(sources).toEqual([{ source: 'hardware', n: 1 }, { source: 'simulated', n: 1 }]);
  });

  it('validates settings', async () => {
    await expect(db.as(user(adminId), `select public.update_settings('{"timezone":"Mars/Base"}')`)).rejects.toThrow(/Unknown timezone/);
  });
});

describe('statistics & telegram outbox', () => {
  beforeAll(setup);

  it('queues shift notifications only when telegram is enabled', async () => {
    let s = await startShift(asqarId);
    await endShift(asqarId, s.id);
    expect(await db.as({ kind: 'superuser' }, `select id from public.notification_outbox`)).toEqual([]);

    await db.as(user(adminId), `select public.update_settings('{"telegram_enabled":true,"telegram_admin_ids":[111,222]}')`);
    s = await startShift(asqarId);
    for (let i = 0; i < 3; i++) await passage('MEN-001');
    await passage('WOMEN-001');
    await endShift(asqarId, s.id);

    const rows = await db.as({ kind: 'superuser' }, `select kind, payload from public.notification_outbox order by id`);
    expect(rows.map((r) => r.kind)).toEqual(['shift_started', 'shift_ended']);
    expect(rows[0].payload).toMatchObject({ employee: 'Asqar Karimov' });
    expect(rows[1].payload).toMatchObject({ employee: 'Asqar Karimov', male: 3, female: 1, total: 4 });
    const [settings] = await db.as(user(asqarId), `select telegram_admin_ids from public.app_settings`);
    expect(settings.telegram_admin_ids.map(Number)).toEqual([111, 222]);
  });

  it('dispatcher claims each notification exactly once and tracks delivery', async () => {
    const [a, b] = await Promise.all([
      db.as(service, `select * from public.claim_notifications(10)`),
      db.as(service, `select * from public.claim_notifications(10)`),
    ]);
    expect(a.length + b.length).toBe(2);
    for (const row of [...a, ...b]) await db.as(service, `select public.complete_notification($1, true)`, [row.id]);
    const rows = await db.as({ kind: 'superuser' }, `select status from public.notification_outbox`);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
    await expect(db.as(user(adminId), `select * from public.claim_notifications(1)`)).rejects.toThrow(/permission denied/);
  });

  it('daily report and today summary aggregate the ledger', async () => {
    const [{ r }] = await db.as(user(adminId), `select public.build_daily_report(null) r`);
    expect(r).toMatchObject({ male: 3, female: 1, total: 4 });
    expect(r.employees[0]).toMatchObject({ name: 'Asqar Karimov', total: 4 });

    const [{ s }] = await db.as(user(bekzodId), `select public.get_today_summary() s`);
    expect(s).toMatchObject({ male: 3, female: 1, total: 4, completed_shifts: 2, active_shifts: 0 });
    expect(s.hourly).toHaveLength(24);

    const daily = await db.as(user(adminId), `select * from public.get_daily_stats(current_date - 6, current_date + 1)`);
    expect(daily).toHaveLength(8);
    expect(daily.reduce((n, d) => n + Number(d.total), 0)).toBe(4);

    const [{ p }] = await db.as(user(adminId), `select public.get_period_summary(current_date - 1, current_date + 1) p`);
    expect(p.employees.find((e: any) => e.username === 'asqar')).toMatchObject({ total: 4, shifts: 2 });
  });

  it('cron_tick enqueues one daily report (for the previous day) at the configured hour', async () => {
    const [{ h }] = await db.pool.query(`select extract(hour from now() at time zone 'Asia/Tashkent')::int h`).then((r) => r.rows);
    await db.as(user(adminId), `select public.update_settings($1)`, [JSON.stringify({ daily_report_hour: h })]);
    await db.as(service, `select public.cron_tick()`);
    await db.as(service, `select public.cron_tick()`);
    const rows = await db.as({ kind: 'superuser' },
      `select payload->>'date' d from public.notification_outbox where kind = 'daily_report'`);
    expect(rows).toHaveLength(1);
    const [{ y }] = await db.pool.query(`select ((now() at time zone 'Asia/Tashkent')::date - 1)::text y`).then((r) => r.rows);
    expect(rows[0].d).toBe(y);
  });
});
