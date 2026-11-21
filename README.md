# Smart Restroom

Paid-restroom visitor management. Two tripod turnstiles (men / women) count every
**confirmed passage** automatically; employees work in shifts; the administrator
gets live dashboards, analytics, reports and Telegram notifications.

* **Frontend** — React 18 · TypeScript · Tailwind CSS · Framer Motion · Recharts · Lucide
* **Backend** — Supabase: PostgreSQL (RLS, atomic SQL functions), Auth, Realtime, Edge Functions (Deno)
* **Hardware** — ESP32 store-and-forward controller per turnstile ([docs/HARDWARE.md](docs/HARDWARE.md))
* **Telegram** — notifications + admin bot commands, delivered through a transactional outbox

```
 Turnstile ──► ESP32 (flash queue) ──HTTPS──► Edge Function turnstile-events
                                                   │  ingest_turnstile_event()  ← one transaction:
                                                   │  verify token · dedupe · lock shift · +1
                                                   ▼
 Employee / Admin web app ◄── Realtime ── PostgreSQL (source of truth, RLS) ──► notification_outbox
                                                                                   │ pg_net / pg_cron
                                                                                   ▼
                                                       Edge Function telegram-dispatch ──► Telegram
```

---

## 1. Try it now (local demo, no backend)

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

Without Supabase credentials the app starts a **clearly labelled local demo**: a
self-contained in-browser backend with 5 weeks of generated history. Demo accounts:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Administrator |
| `asqar` | `asqar123` | Employee |
| `bekzod` | `bekzod123` | Employee |
| `dilnoza` | `dilnoza123` | Employee |

Tip: open the admin in one tab and an employee in another (sessions are per tab).
Start a shift as the employee, then use **Overview → Turnstile simulator** as admin
and watch both dashboards update live. **Reset demo data** (in the yellow demo banner) restores the seed.

The local demo is for evaluation only — production statistics always come from PostgreSQL.

## Deploy: GitHub → Vercel

```bash
git add -A
git commit -m "Smart Restroom"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

In Vercel: **Add New → Project → Import** the repository. Everything else is read from
`vercel.json` (Vite, `pnpm install --frozen-lockfile`, `pnpm build`, output `dist`, SPA
rewrites so refreshing `/admin/...` never returns 404, cache and security headers).

| Vercel environment variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project's anon (public) key |
| `VITE_AUTH_EMAIL_DOMAIN` | `smartrestroom.local` (optional) |

Without these variables the deployment runs the labelled **local demo** — handy for a preview
link. `VITE_*` values are baked in at build time, so **redeploy** after changing them.
Never add `SUPABASE_SERVICE_ROLE_KEY` or the Telegram token to Vercel — they belong only in
Supabase Edge Function secrets. After the first deploy, set the Supabase Auth *Site URL* to the
Vercel domain.

## 2. Production setup (Supabase)

### 2.1 Database
1. Create a Supabase project (Postgres 15+).
2. Apply the migrations in `supabase/migrations` — either `supabase link && supabase db push`,
   or paste the three files in order into the SQL editor.
3. In **Authentication → Providers → Email**: disable *sign-ups* and *confirm email*
   (accounts are created by the admin only; usernames map to `<username>@smartrestroom.local`).

### 2.2 Edge Functions & secrets
```bash
supabase functions deploy turnstile-events --no-verify-jwt
supabase functions deploy telegram-bot --no-verify-jwt
supabase functions deploy telegram-dispatch --no-verify-jwt
supabase functions deploy admin-users

supabase secrets set \
  TELEGRAM_BOT_TOKEN=<from @BotFather> \
  TELEGRAM_WEBHOOK_SECRET=<random 32+ chars> \
  DISPATCH_SECRET=<random 32+ chars> \
  TELEGRAM_ADMIN_IDS=<your numeric Telegram id> \
  AUTH_EMAIL_DOMAIN=smartrestroom.local
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

### 2.3 Scheduling & Telegram
* Edit and run `supabase/setup/production.sql` in the SQL editor (enables `pg_net` + `pg_cron`,
  stores the dispatcher URL/secret, schedules the per-minute tick for daily reports and retries).
* Register the bot webhook once:
  `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<REF>.supabase.co/functions/v1/telegram-bot&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
* Send `/start` to the bot — it replies with your Telegram ID if it is not yet authorised.

### 2.4 Accounts, devices, web app
```bash
cp .env.example .env      # set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
pnpm bootstrap            # creates admin + 3 employees, provisions MEN-001 / WOMEN-001 tokens (printed once)
pnpm build                # static site in dist/ — deploy to any static host (Vercel, Netlify, Nginx…)
```
Remove `SUPABASE_SERVICE_ROLE_KEY` from any machine that only builds or serves the frontend.

### 2.5 Go live
Flash the controllers (see [docs/HARDWARE.md](docs/HARDWARE.md)), confirm both turnstiles are
*Online* in **Admin → Devices**, run the acceptance test, then **Settings → System mode → Production**.

## 3. How counting stays correct

| Requirement | Implementation |
|---|---|
| Count only real passages | Only `passage_confirmed` increments; release button, timeouts and faults are logged only |
| Never double count | `unique (device_id, event_id)` + `insert … on conflict do nothing` in the same transaction as the increment |
| Simultaneous events | Shift row locked `FOR UPDATE`; 105 concurrent events and 40 concurrent duplicates are covered by tests |
| Never lose events | Controller flash queue + retries; events outside a shift are stored as `unassigned`; late offline events are stored as `late` |
| Correct shift | Attribution by (trusted) device time inside the database, server time otherwise |
| History is permanent | Triggers block deleting shifts and editing completed shifts; event & audit tables are append-only |
| One shared shift | Advisory-locked `start_shift()`; configurable in Settings |
| Server is the source of truth | Clients have **no** write grants; every change goes through `SECURITY DEFINER` functions; the UI re-fetches on Realtime signals |

## 4. Security model
* **RLS everywhere.** Employees see only their own profile, shifts and events; admins see all.
* **Role from `app_metadata`** (service-role only) — users can never promote themselves.
* **Device tokens** are 256-bit random, stored as SHA-256, shown once, rotatable per device.
* **Secrets stay server-side**: bot token, service role key and dispatcher secret live only in Edge Function secrets.
* **Telegram commands** are restricted to the authorised user IDs; the webhook is verified with Telegram's secret header.
* Deactivated employees are banned in Supabase Auth (sessions revoked) and blocked by RLS.
* CSV export neutralises spreadsheet formula injection.

## 5. Tests
```bash
pnpm test           # everything
pnpm test:db        # 34 PostgreSQL integration tests (embedded Postgres 17, real migrations + RLS)
pnpm test:unit      # hardware protocol, offline queue, Telegram formatting/commands
pnpm typecheck
```
DB tests start a throw-away PostgreSQL, recreate the Supabase auth schema/roles and apply the real
migrations, then cover: login/roles, permission restrictions, start/end/new shift, historical data
preservation, male/female counting, duplicate protection, concurrent events, simultaneous shift
starts, device auth & rotation, disconnection/reconnection with offline backlog, demo vs production,
Telegram outbox and reports.

## 6. Project structure
```
src/
  auth/            session + role guards
  components/      ui/ (design system) · layout/ · charts/ · dashboard/
  config/          environment
  hooks/           data loading with live refresh, theme, timers
  lib/             formatting, device status, translate-safe DOM guard
  pages/           Login · employee/ · admin/ (Overview, Shifts, Employees, Analytics, Reports, Devices, Settings)
  services/        Backend interface · supabaseBackend · demo/demoBackend
  types/  utils/
supabase/
  migrations/      schema · business logic · security (RLS, grants, realtime)
  functions/       turnstile-events · admin-users · telegram-bot · telegram-dispatch · _shared/
  setup/           production.sql (pg_net / pg_cron, project specific)
hardware/
  esp32-turnstile/ reference firmware (Arduino)
  simulator/       protocol-identical controller simulator (pnpm simulate)
scripts/           bootstrap.ts
tests/             db/ (embedded Postgres) · unit/
docs/              HARDWARE.md
```

## 7. What still needs to be connected
These cannot be done from code alone:
1. **Supabase project** credentials (URL, anon key, service role key) and the deploy steps in §2.
2. **Telegram bot** token from @BotFather and your Telegram user ID.
3. **Turnstile survey** — confirm the passage signal, voltage, pulses per passage and direction
   on the actual turnstile model ([docs/HARDWARE.md §2](docs/HARDWARE.md#2-what-must-be-verified-on-the-real-turnstile-site-survey-checklist)),
   then wire the ESP32 through optocouplers and set the firmware constants.
4. Pin the TLS root certificate in the firmware for production.
5. Network at the site (Ethernet preferred) and a UPS for the controllers and router.
