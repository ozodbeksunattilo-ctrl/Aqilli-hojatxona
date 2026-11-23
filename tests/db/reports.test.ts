import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, stopServer, type Actor, type TestDb } from './harness';

const service: Actor = { kind: 'service' };
const su: Actor = { kind: 'superuser' };
const user = (id: string): Actor => ({ kind: 'user', id });

let db: TestDb;
let adminId: string;
let asqarId: string;
let bekzodId: string;
let menToken: string;
let womenToken: string;
let seq = 0;

async function setup() {
  await db?.close();
  db = await freshDb();
  adminId = await db.createUser('admin', 'Main Admin', 'admin');
  asqarId = await db.createUser('asqar', 'Asqar Karimov');
  bekzodId = await db.createUser('bekzod', 'Bekzod Aliyev');
  [{ admin_rotate_device_token: menToken }] = await db.as(user(adminId), `select public.admin_rotate_device_token('MEN-001')`);
  [{ admin_rotate_device_token: womenToken }] = await db.as(user(adminId), `select public.admin_rotate_device_token('WOMEN-001')`);
}

/** Local (Asia/Tashkent) wall-clock time → ISO timestamp, relative to today. */
async function localTime(daysAgo: number, hhmm: string): Promise<string> {
  const { rows } = await db.pool.query(
    `select ((((now() at time zone 'Asia/Tashkent')::date - $1::int) + $2::time) at time zone 'Asia/Tashkent') t`,
    [daysAgo, hhmm],
  );
  return (rows[0].t as Date).toISOString();
}

async function localDay(daysAgo: number): Promise<string> {
  const { rows } = await db.pool.query(`select ((now() at time zone 'Asia/Tashkent')::date - $1::int)::text d`, [daysAgo]);
  return rows[0].d;
}

async function passage(device: 'MEN-001' | 'WOMEN-001', time: string | null = null) {
  const [row] = await db.as(service, `select public.ingest_turnstile_event($1, $2, $3, 'passage_confirmed', $4) r`, [
    device, device === 'MEN-001' ? menToken : womenToken, `evt-${Date.now()}-${++seq}`, time,
  ]);
  return row.r;
}

const startShift = async (id: string) => (await db.as(user(id), `select * from public.start_shift()`))[0];
const endShift = async (id: string, shiftId: string) => (await db.as(user(id), `select * from public.end_shift($1)`, [shiftId]))[0];

afterAll(async () => {
  await db?.close();
  await stopServer();
});

describe('period summary — one source of truth for dashboard and bot', () => {
  beforeAll(async () => {
    await setup();
    // Two days ago, 23:30 local and yesterday 00:30 local: time-zone boundary, no shift → unassigned.
    await passage('MEN-001', await localTime(2, '23:30'));
    await passage('WOMEN-001', await localTime(1, '00:30'));
    // A 3-hour completed shift for Bekzod ending now (moved back in time by the superuser).
    const b = await startShift(bekzodId);
    await db.pool.query(`alter table public.shifts disable trigger shifts_guard`);
    await db.pool.query(`update public.shifts set start_time = now() - interval '3 hours' where id = $1`, [b.id]);
    await db.pool.query(`alter table public.shifts enable trigger shifts_guard`);
    await passage('MEN-001');
    await passage('MEN-001');
    await endShift(bekzodId, b.id);
    // Asqar's live shift: 3 men + 1 woman.
    await startShift(asqarId);
    for (let i = 0; i < 3; i++) await passage('MEN-001');
    await passage('WOMEN-001');
  });

  it('assigns events to the business-time-zone day', async () => {
    const rows = await db.as(user(adminId), `select day::text, total::int from public.get_daily_stats($1, $2)`, [await localDay(2), await localDay(1)]);
    expect(rows).toEqual([{ day: await localDay(2), total: 1 }, { day: await localDay(1), total: 1 }]);
  });

  it('totals reconcile: Σ employees + outside any shift = total', async () => {
    const [{ p }] = await db.as(user(adminId), `select public.get_period_summary($1, $2) p`, [await localDay(6), await localDay(0)]);
    expect(p).toMatchObject({ days: 7, total: 8, male: 6, female: 2, unassigned: 2, late: 0 });
    const employeesTotal = p.employees.reduce((n: number, e: any) => n + e.total, 0);
    expect(employeesTotal + p.unassigned).toBe(p.total);
    const asqar = p.employees.find((e: any) => e.name === 'Asqar Karimov');
    const bekzod = p.employees.find((e: any) => e.name === 'Bekzod Aliyev');
    expect(asqar).toMatchObject({ shifts: 1, male: 3, female: 1, total: 4 });
    expect(bekzod).toMatchObject({ shifts: 1, male: 2, female: 0, total: 2 });
    expect(bekzod.hours).toBeGreaterThan(2.9);
    expect(bekzod.hours).toBeLessThanOrEqual(3.01);
  });

  it('compares with the previous period of the same length', async () => {
    const today = await localDay(0);
    const [{ p }] = await db.as(user(adminId), `select public.get_period_summary($1, $1) p`, [today]);
    expect(p.previous).toMatchObject({ from: await localDay(1), to: await localDay(1), total: 1 });
    expect(p.total).toBe(6);
    expect(Number(p.change_pct)).toBe(500);
    expect(p.best_day).toMatchObject({ date: today, total: 6 });
  });

  it('employees only ever see their own numbers', async () => {
    const [{ p }] = await db.as(user(asqarId), `select public.get_period_summary($1, $2, $3) p`,
      [await localDay(6), await localDay(0), bekzodId]);
    expect(p.employees).toHaveLength(1);
    expect(p.employees[0].name).toBe('Asqar Karimov');
    expect(p.total).toBe(4);
    const stats = await db.as(user(asqarId), `select sum(total)::int n from public.get_daily_stats($1, $2)`, [await localDay(6), await localDay(0)]);
    expect(stats[0].n).toBe(4);
  });

  it('the bot summary (last N days) equals the dashboard summary', async () => {
    const [{ r }] = await db.as(service, `select public.get_recent_summary(7) r`);
    const [{ p }] = await db.as(user(adminId), `select public.get_period_summary($1, $2) p`, [await localDay(6), await localDay(0)]);
    expect(r.total).toBe(p.total);
    expect(r.employees).toEqual(p.employees);
    expect(r.business).toBe('Smart Restroom');
  });

  it('daily report uses the same numbers', async () => {
    const [{ r }] = await db.as(user(adminId), `select public.build_daily_report($1) r`, [await localDay(0)]);
    expect(r).toMatchObject({ total: 6, male: 5, female: 1, unassigned: 0, business: 'Smart Restroom' });
  });

  it('validates ranges', async () => {
    await expect(db.as(user(adminId), `select public.get_period_summary(current_date, current_date - 1)`)).rejects.toThrow(/Invalid date range/);
    await expect(db.as(user(adminId), `select public.get_period_summary(current_date - 500, current_date)`)).rejects.toThrow(/Invalid date range/);
  });
});

describe('paged shift & event lists keep exact totals', () => {
  beforeAll(async () => {
    await setup();
    for (let i = 0; i < 7; i++) {
      const who = i % 2 ? asqarId : bekzodId;
      const s = await startShift(who);
      await passage('MEN-001');
      if (i % 3 === 0) await passage('WOMEN-001');
      await endShift(who, s.id);
    }
  });

  it('get_shifts pages rows but totals cover every matching shift', async () => {
    const [{ r }] = await db.as(user(adminId), `select public.get_shifts(null, null, null, null, 3, 0) r`);
    expect(r.rows).toHaveLength(3);
    expect(r).toMatchObject({ count: 7, male: 7, female: 3 });
    const [{ r: page3 }] = await db.as(user(adminId), `select public.get_shifts(null, null, null, null, 3, 6) r`);
    expect(page3.rows).toHaveLength(1);
    expect(page3.rows[0].employee_name).toBeTruthy();
  });

  it('employees get only their own shifts from get_shifts', async () => {
    const [{ r }] = await db.as(user(asqarId), `select public.get_shifts(null, null, $1) r`, [bekzodId]);
    expect(r.count).toBe(3);
    expect(r.rows.every((x: any) => x.employee_id === asqarId)).toBe(true);
  });

  it('get_events filters, pages and counts', async () => {
    const today = await localDay(0);
    const [{ r }] = await db.as(user(adminId), `select public.get_events($1, $1, null, 'female', null, null, 2, 0) r`, [today]);
    expect(r).toMatchObject({ count: 3, female: 3, male: 0 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].employee_name).toBeTruthy();
  });
});

describe('telegram bot admins', () => {
  beforeAll(async () => {
    await setup();
    await db.as(user(adminId), `select public.update_settings($1)`, [JSON.stringify({ telegram_enabled: true, telegram_admin_ids: [333] })]);
  });

  it('a dashboard admin links their Telegram account with a one-time code', async () => {
    await expect(db.as(user(asqarId), `select public.create_telegram_link_code()`)).rejects.toThrow(/Administrator access required/);
    const [{ code }] = await db.as(user(adminId), `select public.create_telegram_link_code() code`);
    await expect(db.as(user(adminId), `select public.consume_telegram_link_code($1, 111, 111)`, [code])).rejects.toThrow(/permission denied/);
    const [{ r }] = await db.as(service, `select public.consume_telegram_link_code($1, 111, 111, 'boss', 'Boss') r`, [code]);
    expect(r).toMatchObject({ status: 'linked', purpose: 'link', name: 'Main Admin' });
    const [{ again }] = await db.as(service, `select public.consume_telegram_link_code($1, 999, 999) again`, [code]);
    expect(again.status).toBe('invalid');
  });

  it('expired codes are rejected', async () => {
    const [{ code }] = await db.as(user(adminId), `select public.create_telegram_link_code() code`);
    await db.pool.query(`update app_private.telegram_link_codes set expires_at = now() - interval '1 minute'`);
    const [{ r }] = await db.as(service, `select public.consume_telegram_link_code($1, 112, 112) r`, [code]);
    expect(r.status).toBe('invalid');
  });

  it('an admin can invite a bot-only admin from Telegram', async () => {
    const [{ code }] = await db.as(service, `select public.create_telegram_invite('Boss') code`);
    expect(code).toMatch(/^inv[0-9a-f]{32}$/);
    const [{ r }] = await db.as(service, `select public.consume_telegram_link_code($1, 222, 222, 'helper', 'Helper') r`, [code]);
    expect(r).toMatchObject({ status: 'linked', purpose: 'invite', name: 'Helper' });
  });

  it('recipients = linked active admins + bot-only admins + manual IDs', async () => {
    const ids = async () => (await db.as(service, `select telegram_user_id::int id from public.telegram_recipients() order by 1`)).map((r) => r.id);
    expect(await ids()).toEqual([111, 222, 333]);
    await db.pool.query(`update public.profiles set is_active = false where id = $1`, [adminId]);
    expect(await ids()).toEqual([222, 333]);
    await db.pool.query(`update public.profiles set is_active = true where id = $1`, [adminId]);
    const [{ id }] = await db.as(su, `select id from public.telegram_links where telegram_user_id = 222`);
    await db.as(service, `select public.remove_telegram_admin($1, 'Boss')`, [id]);
    expect(await ids()).toEqual([111, 333]);
    await expect(db.as(service, `select public.telegram_recipients()`)).resolves.toBeTruthy();
    await expect(db.as(user(adminId), `select public.telegram_recipients()`)).rejects.toThrow(/permission denied/);
  });

  it('only admins can see the bot admin list and the notification log', async () => {
    expect((await db.as(user(adminId), `select id from public.telegram_links`)).length).toBe(1);
    expect(await db.as(user(asqarId), `select id from public.telegram_links`)).toEqual([]);
    expect((await db.as(user(adminId), `select id from public.notification_outbox`)).length).toBeGreaterThan(0);
    expect(await db.as(user(asqarId), `select id from public.notification_outbox`)).toEqual([]);
  });

  it('every admin action is announced in Telegram', async () => {
    const rows = await db.as(su, `select payload->>'action' a, payload->>'target' t, payload->>'actor' who
                                    from public.notification_outbox where kind = 'admin_action' order by id`);
    expect(rows).toEqual([
      { a: 'telegram.linked', t: null, who: 'Main Admin' },
      { a: 'telegram.admin_added', t: 'Helper', who: 'Boss' },
      { a: 'telegram.admin_removed', t: 'Helper', who: 'Boss' },
    ]);
    // Service-side account actions (e.g. password reset from the bot) are announced too.
    await db.as(service, `select public.service_log('employee.password_reset', $1)`, [JSON.stringify({ user_id: asqarId, actor: 'Boss' })]);
    const [last] = await db.as(su, `select payload from public.notification_outbox where kind = 'admin_action' order by id desc limit 1`);
    expect(last.payload).toMatchObject({ action: 'employee.password_reset', target: 'Asqar Karimov', actor: 'Boss' });
  });

  it('switching system mode is announced', async () => {
    await db.as(user(adminId), `select public.update_settings('{"system_mode":"production"}')`);
    const [last] = await db.as(su, `select payload from public.notification_outbox where kind = 'admin_action' order by id desc limit 1`);
    expect(last.payload).toMatchObject({ action: 'settings.mode_changed', target: 'production', actor: 'Main Admin' });
  });
});

describe('scheduler: daily / weekly / monthly reports and device alerts', () => {
  beforeAll(async () => {
    await setup();
    await db.as(user(adminId), `select public.update_settings('{"telegram_enabled":true}')`);
  });

  const tick = (localIso: string) => db.as(su, `select app_private.cron_tick_at(($1::timestamp) at time zone 'Asia/Tashkent')`, [localIso]);
  const reports = () => db.as(su, `select kind, payload->>'from' f, payload->>'to' t from public.notification_outbox
                                     where kind like '%_report' order by id`);

  it('sends the previous day at the report hour, once', async () => {
    await tick('2026-11-18 05:00');            // not the report hour (default 00)
    expect(await reports()).toEqual([]);
    await tick('2026-11-18 00:10');            // Wednesday
    await tick('2026-11-18 00:40');            // same hour again → deduplicated
    expect(await reports()).toEqual([{ kind: 'daily_report', f: '2026-11-17', t: '2026-11-17' }]);
  });

  it('adds the previous Monday–Sunday on Mondays', async () => {
    await tick('2026-11-23 00:05');            // Monday
    expect((await reports()).slice(1)).toEqual([
      { kind: 'daily_report', f: '2026-11-22', t: '2026-11-22' },
      { kind: 'weekly_report', f: '2026-11-16', t: '2026-11-22' },
    ]);
  });

  it('adds the previous calendar month on the 1st', async () => {
    await tick('2026-12-01 00:05');
    expect((await reports()).slice(3)).toEqual([
      { kind: 'daily_report', f: '2026-11-30', t: '2026-11-30' },
      { kind: 'monthly_report', f: '2026-11-01', t: '2026-11-30' },
    ]);
  });

  it('alerts once when a turnstile goes silent and once when it recovers', async () => {
    const kinds = async () => (await db.as(su, `select kind, payload->>'device_id' d from public.notification_outbox
                                                where kind like 'device_%' order by id`));
    await db.pool.query(`update public.devices set last_seen = now() - interval '10 minutes' where id = 'MEN-001'`);
    await db.as(su, `select app_private.cron_tick_at(now())`);
    await db.as(su, `select app_private.cron_tick_at(now())`);
    expect(await kinds()).toEqual([{ kind: 'device_offline', d: 'MEN-001' }]);
    await db.as(service, `select public.ingest_turnstile_event('MEN-001', $1, 'hb-1', 'heartbeat')`, [menToken]);
    await db.as(su, `select app_private.cron_tick_at(now())`);
    expect(await kinds()).toEqual([{ kind: 'device_offline', d: 'MEN-001' }, { kind: 'device_online', d: 'MEN-001' }]);
    void womenToken;
  });

  it('automation wiring stores the API URL and a dispatcher secret', async () => {
    await expect(db.as(user(adminId), `select public.configure_automation('not a url')`)).rejects.toThrow(/Invalid functions URL/);
    const [{ s }] = await db.as(user(adminId), `select public.configure_automation('https://app.example.com/api/') s`);
    expect(s).toMatchObject({ functions_url: 'https://app.example.com/api', cron: false, net: false });
    const [{ v }] = await db.as(service, `select public.service_get_config('dispatch_secret') v`);
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    await expect(db.as(user(adminId), `select public.service_get_config('dispatch_secret')`)).rejects.toThrow(/permission denied/);
    await expect(db.as(service, `select public.service_put_config('dispatch_secret', 'x')`)).rejects.toThrow(/not writable/);
  });
});
