/**
 * POST /functions/v1/turnstile-events
 *
 * Hardware entry point. Accepts one event or a batch `{ "events": [...] }`
 * (offline queue flush). Every event is authenticated against the device's
 * token hash and processed atomically and idempotently in the database.
 *
 * Headers: X-Device-Token: <token>   (or Authorization: Bearer <token>)
 */
import { corsHeaders, json } from '../_shared/http.ts';
import { parsePayload, readDeviceToken } from '../_shared/events.ts';
import { serviceClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = readDeviceToken(req.headers);
  if (!token) return json({ error: 'Missing device token' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const parsed = parsePayload(body);
  if (!parsed.ok) return json({ error: parsed.error }, 422);

  const db = serviceClient();
  const results: Record<string, unknown>[] = [];
  // Sequential on purpose: preserves the controller's queue order.
  for (const e of parsed.events) {
    const { data, error } = await db.rpc('ingest_turnstile_event', {
      p_device_id: e.device_id,
      p_token: token,
      p_event_id: e.event_id,
      p_event_type: e.event_type,
      p_device_time: e.timestamp,
      p_simulated: e.simulated,
      p_meta: e.meta,
    });
    if (error) {
      console.error('ingest failed', e.device_id, e.event_id, error.message);
      // Transient failure: stop; the controller keeps this and later events queued.
      results.push({ event_id: e.event_id, status: 'retry' });
      break;
    }
    results.push({ event_id: e.event_id, ...(data as Record<string, unknown>) });
  }

  if (results.every((r) => r.status === 'unauthorized')) {
    return json({ error: 'Invalid device credentials', results }, 401);
  }
  const anyRetry = results.some((r) => r.status === 'retry');
  const single = !Array.isArray((body as { events?: unknown }).events);
  return json(single ? results[0] : { results }, anyRetry ? 503 : 200);
});
