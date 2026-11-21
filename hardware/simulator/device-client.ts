/**
 * Reference implementation of the controller-side protocol (store-and-forward).
 *
 * The ESP32 firmware in ../esp32-turnstile follows exactly the same rules:
 *   1. A confirmed passage is written to the persistent queue FIRST.
 *   2. The queue is flushed in order, in batches, to /turnstile-events.
 *   3. An event leaves the queue only when the server returns a final status
 *      (counted / duplicate / logged / rejected / invalid).
 *   4. Network errors, timeouts and 5xx keep the event queued (retry with backoff).
 *   Because the server de-duplicates on (device_id, event_id), retrying is always safe.
 */

export interface QueuedEvent {
  device_id: string;
  event_id: string;
  event_type: 'passage_confirmed' | 'release_button_pressed' | 'passage_timeout' | 'fault' | 'boot';
  timestamp: string;
  simulated?: boolean;
}

export interface QueueStorage {
  load(): QueuedEvent[];
  save(events: QueuedEvent[]): void;
}

export class MemoryStorage implements QueueStorage {
  private data: QueuedEvent[] = [];
  load() {
    return [...this.data];
  }
  save(events: QueuedEvent[]) {
    this.data = [...events];
  }
}

export const FINAL_STATUSES = new Set(['counted', 'duplicate', 'logged', 'ok', 'rejected', 'invalid']);

export interface DeviceClientOptions {
  url: string;
  deviceId: string;
  token: string;
  storage: QueueStorage;
  simulated?: boolean;
  batchSize?: number;
  fetchImpl?: typeof fetch;
  firmware?: string;
  now?: () => Date;
}

export type FlushResult =
  | { ok: true; sent: number; remaining: number }
  | { ok: false; reason: 'network' | 'server' | 'unauthorized'; sent: number; remaining: number };

export class DeviceClient {
  private queue: QueuedEvent[];
  private seq = 0;
  private readonly bootId = Math.random().toString(36).slice(2, 8);
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private flushing: Promise<FlushResult> | null = null;

  constructor(private readonly opts: DeviceClientOptions) {
    this.queue = opts.storage.load();
    this.batchSize = opts.batchSize ?? 50;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Called by the passage sensor ISR/loop. Persists before anything else. */
  record(eventType: QueuedEvent['event_type'] = 'passage_confirmed'): QueuedEvent {
    const event: QueuedEvent = {
      device_id: this.opts.deviceId,
      event_id: `${this.opts.deviceId}-${this.bootId}-${++this.seq}`,
      event_type: eventType,
      timestamp: this.now().toISOString(),
      ...(this.opts.simulated ? { simulated: true } : {}),
    };
    this.queue.push(event);
    this.opts.storage.save(this.queue);
    return event;
  }

  private async post(body: unknown): Promise<Response> {
    return this.fetchImpl(this.opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': this.opts.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  /** Flushes the queue in order. Safe to call concurrently (calls are coalesced). */
  flush(): Promise<FlushResult> {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async doFlush(): Promise<FlushResult> {
    let sent = 0;
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.batchSize);
      let res: Response;
      try {
        res = await this.post({ events: batch });
      } catch {
        return { ok: false, reason: 'network', sent, remaining: this.queue.length };
      }
      if (res.status === 401) return { ok: false, reason: 'unauthorized', sent, remaining: this.queue.length };

      const body = (await res.json().catch(() => null)) as { results?: { event_id: string; status: string }[] } | null;
      if (res.status === 422) {
        // Malformed event (firmware bug): drop the head so it can't block the queue forever.
        this.queue.shift();
        this.opts.storage.save(this.queue);
        continue;
      }
      const results = body?.results ?? [];
      const done = new Set(results.filter((r) => FINAL_STATUSES.has(r.status)).map((r) => r.event_id));
      const before = this.queue.length;
      this.queue = this.queue.filter((e) => !done.has(e.event_id));
      this.opts.storage.save(this.queue);
      sent += before - this.queue.length;
      if (!res.ok || done.size < batch.length) {
        return { ok: false, reason: 'server', sent, remaining: this.queue.length };
      }
    }
    return { ok: true, sent, remaining: 0 };
  }

  async heartbeat(): Promise<boolean> {
    try {
      const res = await this.post({
        device_id: this.opts.deviceId,
        event_type: 'heartbeat',
        meta: { firmware: this.opts.firmware ?? 'simulator-1.0.0', queue_depth: this.queue.length },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** Exponential backoff with jitter, capped — used between failed flushes. */
export function backoffMs(attempt: number, baseMs = 1000, maxMs = 60_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 16));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
