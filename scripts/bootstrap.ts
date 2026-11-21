/**
 * One-time production bootstrap (idempotent — safe to run again).
 *
 *   pnpm bootstrap
 *
 * Requires in .env:  VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional:          BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_EMPLOYEES="asqar:Asqar Karimov,bekzod:Bekzod Aliyev,dilnoza:Dilnoza Rahimova"
 *
 * Creates the administrator and the three employee accounts, then provisions
 * an API token for each turnstile controller (MEN-001, WOMEN-001). Generated
 * passwords and tokens are printed ONCE — store them in a password manager.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.VITE_AUTH_EMAIL_DOMAIN ?? 'smartrestroom.local';

if (!url || !serviceKey) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const password = () => randomBytes(9).toString('base64url'); // 12 chars

const employees = (process.env.BOOTSTRAP_EMPLOYEES ?? 'asqar:Asqar,bekzod:Bekzod,dilnoza:Dilnoza')
  .split(',')
  .map((pair) => pair.split(':').map((s) => s.trim()) as [string, string])
  .filter(([username]) => username);

const accounts: { username: string; full_name: string; role: 'admin' | 'employee'; password: string }[] = [
  { username: 'admin', full_name: 'Administrator', role: 'admin', password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? password() },
  ...employees.map(([username, full_name]) => ({ username, full_name: full_name || username, role: 'employee' as const, password: password() })),
];

async function main() {
  const { data: existing, error: listErr } = await db.from('profiles').select('username');
  if (listErr) throw new Error(`Cannot read profiles — did you run the migrations? ${listErr.message}`);
  const taken = new Set((existing ?? []).map((p) => p.username));

  console.log('\nAccounts');
  for (const a of accounts) {
    if (taken.has(a.username)) {
      console.log(`  • ${a.username.padEnd(10)} already exists — skipped`);
      continue;
    }
    const { error } = await db.auth.admin.createUser({
      email: `${a.username}@${domain}`,
      password: a.password,
      email_confirm: true,
      user_metadata: { username: a.username, full_name: a.full_name },
      app_metadata: { role: a.role },
    });
    if (error) throw new Error(`Creating ${a.username} failed: ${error.message}`);
    console.log(`  • ${a.username.padEnd(10)} ${a.role.padEnd(9)} password: ${a.password}`);
  }

  console.log('\nDevice tokens (paste into each controller, shown only once)');
  const { data: devices, error: devErr } = await db.from('devices').select('id, token_rotated_at').order('id');
  if (devErr) throw devErr;
  for (const d of devices ?? []) {
    if (d.token_rotated_at && !process.argv.includes('--rotate')) {
      console.log(`  • ${d.id.padEnd(10)} token already provisioned — run with --rotate to replace it`);
      continue;
    }
    const { data: token, error } = await db.rpc('admin_rotate_device_token', { p_device_id: d.id });
    if (error) throw error;
    console.log(`  • ${d.id.padEnd(10)} ${token}`);
  }
  console.log('\nDone. Sign in at your web app with the usernames above.\n');
}

main().catch((e) => {
  console.error('\n✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
