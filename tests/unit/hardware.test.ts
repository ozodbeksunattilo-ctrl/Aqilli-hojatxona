import { describe, expect, it } from 'vitest';
import { parsePayload, readDeviceToken, MAX_BATCH } from '../../supabase/functions/_shared/events';
import { DeviceClient, MemoryStorage, backoffMs } from '../../hardware/simulator/device-client';

describe('turnstile payload validation', () => {
  const valid = { device_id: 'MEN-001', event_id: 'evt-123456', event_type: 'passage_confirmed', timestamp: '2026-11-21T10:00:00Z' };

  it('accepts the documented single-event format', () => {
    const r = parsePayload(valid);
    expect(r).toEqual({ ok: true, events: [{ ...valid, timestamp: '2026-11-21T10:00:00.000Z', simulated: false, meta: {} }] });
  });

  it('accepts batches and enforces the batch limit', () => {
    expect(parsePayload({ events: [valid, { ...valid, event_id: 'evt-654321' }] }).ok).toBe(true);
    expect(parsePayload({ events: Array(MAX_BATCH + 1).fill(valid) })).toMatchObject({ ok: false });
    expect(parsePayload({ events: [] })).toMatchObject({ ok: false });
  });

  it('rejects malformed fields', () => {
    expect(parsePayload({ ...valid, device_id: 'men 1' })).toMatchObject({ ok: false });
    expect(parsePayload({ ...valid, event_id: 'x' })).toMatchObject({ ok: false });
    expect(parsePayload({ ...valid, event_type: 'button' })).toMatchObject({ ok: false });
    expect(parsePayload({ ...valid, timestamp: 'yesterday' })).toMatchObject({ ok: false });
    expect(parsePayload(null)).toMatchObject({ ok: false });
  });

  it('heartbeats do not need an event id', () => {
    expect(parsePayload({ device_id: 'MEN-001', event_type: 'heartbeat' }).ok).toBe(true);
  });

  it('reads the device token from either header', () => {
    expect(readDeviceToken(new Headers({ 'X-Device-Token': ' abc ' }))).toBe('abc');
    expect(readDeviceToken(new Headers({ Authorization: 'Bearer xyz' }))).toBe('xyz');
    expect(readDeviceToken(new Headers())).toBeNull();
  });
});

/** Fake backend with the same idempotency semantics as ingest_turnstile_event. */
function fakeServer() {
  const seen = new Set<string>();
  let online = true;
  let calls = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls++;
    if (!online) throw new TypeError('fetch failed');
    const body = JSON.parse(String(init.body));
    const events = body.events ?? [body];
    const results = events.map((e: any) => {
      if (e.event_type === 'heartbeat') return { status: 'ok' };
      const key = `${e.device_id}:${e.event_id}`;
      if (seen.has(key)) return { event_id: e.event_id, status: 'duplicate' };
      seen.add(key);
      return { event_id: e.event_id, status: 'counted' };
    });
    return new Response(JSON.stringify(body.events ? { results } : results[0]), { status: 200 });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    seen,
    get calls() { return calls; },
    setOnline(v: boolean) { online = v; },
  };
}

describe('controller store-and-forward (disconnect / reconnect)', () => {
  it('queues events while offline and delivers every one exactly once after reconnect', async () => {
    const server = fakeServer();
    const storage = new MemoryStorage();
    const client = new DeviceClient({ url: 'http://x', deviceId: 'MEN-001', token: 't', storage, fetchImpl: server.fetchImpl, batchSize: 4 });

    server.setOnline(false);
    for (let i = 0; i < 10; i++) client.record();
    const failed = await client.flush();
    expect(failed).toMatchObject({ ok: false, reason: 'network', remaining: 10 });
    expect(storage.load()).toHaveLength(10); // persisted, survives a reboot

    server.setOnline(true);
    const ok = await client.flush();
    expect(ok).toEqual({ ok: true, sent: 10, remaining: 0 });
    expect(server.seen.size).toBe(10);
    expect(storage.load()).toHaveLength(0);
  });

  it('survives a reboot mid-outage by reloading the persisted queue', async () => {
    const server = fakeServer();
    const storage = new MemoryStorage();
    server.setOnline(false);
    const before = new DeviceClient({ url: 'http://x', deviceId: 'WOMEN-001', token: 't', storage, fetchImpl: server.fetchImpl });
    before.record();
    before.record();
    await before.flush();

    const after = new DeviceClient({ url: 'http://x', deviceId: 'WOMEN-001', token: 't', storage, fetchImpl: server.fetchImpl });
    expect(after.pending).toBe(2);
    server.setOnline(true);
    await after.flush();
    expect(server.seen.size).toBe(2);
  });

  it('a lost HTTP response leads to a safe retry (server de-duplicates)', async () => {
    const server = fakeServer();
    let dropResponse = true;
    const flaky = (async (url: string, init: RequestInit) => {
      const res = await server.fetchImpl(url, init);
      if (dropResponse) {
        dropResponse = false;
        throw new TypeError('connection reset'); // server processed it, controller never heard back
      }
      return res;
    }) as unknown as typeof fetch;
    const client = new DeviceClient({ url: 'http://x', deviceId: 'MEN-001', token: 't', storage: new MemoryStorage(), fetchImpl: flaky });
    client.record();
    client.record();
    expect((await client.flush()).ok).toBe(false);
    expect(await client.flush()).toEqual({ ok: true, sent: 2, remaining: 0 });
    expect(server.seen.size).toBe(2);
  });

  it('keeps events when the token is rejected', async () => {
    const client = new DeviceClient({
      url: 'http://x', deviceId: 'MEN-001', token: 'bad', storage: new MemoryStorage(),
      fetchImpl: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
    });
    client.record();
    expect(await client.flush()).toMatchObject({ ok: false, reason: 'unauthorized', remaining: 1 });
  });

  it('coalesces concurrent flushes', async () => {
    const server = fakeServer();
    const client = new DeviceClient({ url: 'http://x', deviceId: 'MEN-001', token: 't', storage: new MemoryStorage(), fetchImpl: server.fetchImpl });
    client.record();
    await Promise.all([client.flush(), client.flush(), client.flush()]);
    expect(server.calls).toBe(1);
  });

  it('backs off exponentially with a cap', () => {
    expect(backoffMs(0)).toBeLessThanOrEqual(1000);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(4000);
    expect(backoffMs(30)).toBeLessThanOrEqual(60_000);
  });
});
