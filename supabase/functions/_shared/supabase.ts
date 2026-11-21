// Deno-only helper (Edge Functions). Uses the service role key, which never leaves the server.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Caller-scoped client: queries run with the caller's JWT and RLS. */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Authorised Telegram user IDs: Settings → Telegram plus the TELEGRAM_ADMIN_IDS secret. */
export async function telegramAdminIds(db: SupabaseClient): Promise<number[]> {
  const { data } = await db.from('app_settings').select('telegram_admin_ids').eq('id', 1).single();
  const fromEnv = (Deno.env.get('TELEGRAM_ADMIN_IDS') ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set([...((data?.telegram_admin_ids as number[] | null) ?? []).map(Number), ...fromEnv])];
}
