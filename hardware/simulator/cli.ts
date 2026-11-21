/**
 * Turnstile controller simulator — speaks the real hardware protocol.
 *
 *   pnpm simulate --device MEN-001 --token <token> [--rate 6] [--url <functions-url>/turnstile-events]
 *
 * Every event is sent with "simulated": true, so the backend stores it as
 * source = 'simulated' and rejects it entirely when the system is in
 * production mode. Press "o" to toggle a simulated network outage and watch the
 * offline queue fill up and drain on reconnect; "p" sends one passage; "q" quits.
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DeviceClient, backoffMs, type QueueStorage, type QueuedEvent } from './device-client';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');

const deviceId = args.get('device') ?? 'MEN-001';
const token = args.get('token') ?? process.env[`SIM_TOKEN_${deviceId.replace(/-/g, '_')}`] ?? '';
const url = args.get('url') ?? `${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1/turnstile-events`;
const perMinute = Number(args.get('rate') ?? 6);

if (!token) {
  console.error(`Missing --token (or SIM_TOKEN_${deviceId.replace(/-/g, '_')} in .env). Generate one in Admin → Devices → Rotate token.`);
  process.exit(1);
}

class FileStorage implements QueueStorage {
  constructor(private readonly path: string) {}
  load(): QueuedEvent[] {
    return existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
  }
  save(events: QueuedEvent[]) {
    writeFileSync(this.path, JSON.stringify(events));
  }
}

let offline = false;
const realFetch = globalThis.fetch;
const client = new DeviceClient({
  url,
  deviceId,
  token,
  simulated: true,
  storage: new FileStorage(`.sim-queue-${deviceId}.json`),
  fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
    offline ? Promise.reject(new Error('simulated outage')) : realFetch(input, init)) as typeof fetch,
});

let failures = 0;
async function flushLoop() {
  const r = await client.flush();
  if (r.ok) {
    failures = 0;
    if (r.sent) console.log(`✔ delivered ${r.sent} event(s)`);
    setTimeout(flushLoop, 1000);
  } else {
    if (r.reason === 'unauthorized') console.error('✖ device token rejected — check --token');
    const wait = backoffMs(failures++);
    console.log(`… ${r.reason} error, ${r.remaining} queued, retry in ${(wait / 1000).toFixed(1)}s`);
    setTimeout(flushLoop, wait);
  }
}

function passage() {
  const e = client.record();
  console.log(`→ passage ${e.event_id}  (queue: ${client.pending})`);
  void client.flush();
}

console.log(`Simulating ${deviceId} → ${url}\n  ~${perMinute} passages/min · keys: [p] passage  [o] toggle outage  [q] quit\n`);
setInterval(() => void client.heartbeat(), 30_000);
void client.heartbeat();
void flushLoop();
if (perMinute > 0) {
  const tick = () => {
    passage();
    setTimeout(tick, (60_000 / perMinute) * (0.4 + Math.random() * 1.2));
  };
  setTimeout(tick, 1500);
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on('data', (buf) => {
    const key = buf.toString();
    if (key === 'q' || key === '\u0003') process.exit(0);
    if (key === 'p') passage();
    if (key === 'o') {
      offline = !offline;
      console.log(offline ? '⚡ network DOWN — events are queued locally' : '⚡ network UP — draining queue');
    }
  });
}
