/**
 * POST /functions/v1/admin-users   (called by the admin web UI with the user's JWT)
 *
 * Account management that needs the Supabase Auth admin API:
 *   { action: 'create', username, full_name, password }
 *   { action: 'update', user_id, full_name }
 *   { action: 'set_active', user_id, is_active }
 *   { action: 'reset_password', user_id, password }
 */
import { corsHeaders, json } from '../_shared/http.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';

const USERNAME = /^[a-z0-9][a-z0-9_.]{2,31}$/;
const EMAIL_DOMAIN = Deno.env.get('AUTH_EMAIL_DOMAIN') ?? 'smartrestroom.local';

const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 72;
const validName = (n: string) => n.length >= 2 && n.length <= 80;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 1) Identify the caller from their JWT and require an active admin.
  const { data: who, error: whoErr } = await userClient(req).auth.getUser();
  if (whoErr || !who.user) return json({ error: 'Not authenticated' }, 401);

  const db = serviceClient();
  const { data: caller } = await db.from('profiles').select('id, role, is_active').eq('id', who.user.id).single();
  if (!caller || caller.role !== 'admin' || !caller.is_active) return json({ error: 'Administrator access required' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const log = (action: string, details: Record<string, unknown>) =>
    db.from('activity_logs').insert({ user_id: caller.id, action, details });

  const loadTarget = async () => {
    if (typeof body.user_id !== 'string') return null;
    const { data } = await db.from('profiles').select('id, role, username').eq('id', body.user_id).single();
    return data;
  };

  switch (body.action) {
    case 'create': {
      const username = String(body.username ?? '').trim().toLowerCase();
      const fullName = String(body.full_name ?? '').trim();
      if (!USERNAME.test(username)) return json({ error: 'Username: 3–32 chars, a-z 0-9 _ .' }, 422);
      if (!validName(fullName)) return json({ error: 'Full name must be 2–80 characters' }, 422);
      if (!validPassword(body.password)) return json({ error: 'Password must be 8–72 characters' }, 422);
      const { data, error } = await db.auth.admin.createUser({
        email: `${username}@${EMAIL_DOMAIN}`,
        password: body.password,
        email_confirm: true,
        user_metadata: { username, full_name: fullName },
        app_metadata: { role: 'employee' },
      });
      if (error) {
        const taken = /already|exists|registered/i.test(error.message);
        return json({ error: taken ? 'Username is already taken' : error.message }, taken ? 409 : 400);
      }
      await log('employee.created', { user_id: data.user.id, username });
      return json({ id: data.user.id });
    }
    case 'update': {
      const target = await loadTarget();
      if (!target) return json({ error: 'User not found' }, 404);
      const fullName = String(body.full_name ?? '').trim();
      if (!validName(fullName)) return json({ error: 'Full name must be 2–80 characters' }, 422);
      const { error } = await db.from('profiles').update({ full_name: fullName }).eq('id', target.id);
      if (error) return json({ error: error.message }, 400);
      await db.auth.admin.updateUserById(target.id, { user_metadata: { username: target.username, full_name: fullName } });
      await log('employee.updated', { user_id: target.id });
      return json({ ok: true });
    }
    case 'set_active': {
      const target = await loadTarget();
      if (!target) return json({ error: 'User not found' }, 404);
      if (target.id === caller.id) return json({ error: 'You cannot deactivate your own account' }, 422);
      const isActive = body.is_active === true;
      const { error } = await db.from('profiles').update({ is_active: isActive }).eq('id', target.id);
      if (error) return json({ error: error.message }, 400);
      // Banning also blocks sign-in at the Auth layer and invalidates refresh tokens.
      await db.auth.admin.updateUserById(target.id, { ban_duration: isActive ? 'none' : '876000h' });
      await log(isActive ? 'employee.activated' : 'employee.deactivated', { user_id: target.id });
      return json({ ok: true });
    }
    case 'reset_password': {
      const target = await loadTarget();
      if (!target) return json({ error: 'User not found' }, 404);
      if (!validPassword(body.password)) return json({ error: 'Password must be 8–72 characters' }, 422);
      const { error } = await db.auth.admin.updateUserById(target.id, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      await log('employee.password_reset', { user_id: target.id });
      return json({ ok: true });
    }
    default:
      return json({ error: 'Unknown action' }, 400);
  }
});
