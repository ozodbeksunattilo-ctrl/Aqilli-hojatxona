/**
 * Validation of hardware payloads for POST /functions/v1/turnstile-events.
 * Pure TypeScript so it runs both in Deno (Edge Function) and Node (tests).
 */
export const EVENT_TYPES = [
  'passage_confirmed',
  'heartbeat',
  'release_button_pressed',
  'passage_timeout',
  'fault',
  'boot',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface TurnstileEvent {
  device_id: string;
  event_id: string;
  event_type: EventType;
  timestamp: string | null;
  simulated: boolean;
  meta: Record<string, unknown>;
}

export type ParseResult =
  | { ok: true; events: TurnstileEvent[] }
  | { ok: false; error: string };

export const MAX_BATCH = 100;
const DEVICE_ID = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const EVENT_ID = /^[A-Za-z0-9._:-]{6,128}$/;

function parseOne(raw: unknown, index: number): TurnstileEvent | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `events[${index}]: must be an object`;
  const e = raw as Record<string, unknown>;
  if (typeof e.device_id !== 'string' || !DEVICE_ID.test(e.device_id)) return `events[${index}].device_id is invalid`;
  if (typeof e.event_type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(e.event_type)) {
    return `events[${index}].event_type must be one of ${EVENT_TYPES.join(', ')}`;
  }
  const isHeartbeat = e.event_type === 'heartbeat';
  if (!isHeartbeat && (typeof e.event_id !== 'string' || !EVENT_ID.test(e.event_id))) {
    return `events[${index}].event_id must match ${EVENT_ID}`;
  }
  let timestamp: string | null = null;
  if (e.timestamp !== undefined && e.timestamp !== null) {
    if (typeof e.timestamp !== 'string' || Number.isNaN(Date.parse(e.timestamp))) {
      return `events[${index}].timestamp must be ISO-8601`;
    }
    timestamp = new Date(e.timestamp).toISOString();
  }
  const meta = e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta) ? (e.meta as Record<string, unknown>) : {};
  return {
    device_id: e.device_id,
    event_id: typeof e.event_id === 'string' ? e.event_id : `hb-${Date.now()}`,
    event_type: e.event_type as EventType,
    timestamp,
    simulated: e.simulated === true,
    meta,
  };
}

/** Accepts a single event object or `{ "events": [...] }` (offline queue flush). */
export function parsePayload(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  const list = Array.isArray((body as { events?: unknown }).events) ? (body as { events: unknown[] }).events : [body];
  if (list.length === 0) return { ok: false, error: 'No events' };
  if (list.length > MAX_BATCH) return { ok: false, error: `Batch too large (max ${MAX_BATCH})` };
  const events: TurnstileEvent[] = [];
  for (let i = 0; i < list.length; i++) {
    const parsed = parseOne(list[i], i);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    events.push(parsed);
  }
  return { ok: true, events };
}

/** Extracts the device token from `Authorization: Bearer` or `X-Device-Token`. */
export function readDeviceToken(headers: Headers): string | null {
  const direct = headers.get('x-device-token');
  if (direct) return direct.trim();
  const auth = headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

/** Statuses the controller may drop from its offline queue. Anything else must be retried. */
export const FINAL_STATUSES = new Set(['counted', 'duplicate', 'logged', 'ok', 'rejected', 'invalid']);
