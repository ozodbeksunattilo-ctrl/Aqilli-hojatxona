/**
 * Real PostgreSQL test harness.
 *
 * Boots an embedded PostgreSQL 17 server, recreates the parts of Supabase the
 * migrations depend on (auth schema, auth.uid(), anon/authenticated/service_role
 * roles and Supabase's permissive default privileges) and applies the real
 * migrations from supabase/migrations. Queries can then be run "as" an
 * employee, an admin or the service role exactly like PostgREST would.
 */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(__dirname, '../..');
const DATA_DIR = join(ROOT, '.test-db');
const PORT = 55432;

const SUPABASE_STUB = `
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
-- Mirror Supabase's (permissive) defaults so the migrations must lock them down.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let server: EmbeddedPostgres | null = null;
let starting: Promise<void> | null = null;

async function ensureServer() {
  if (server) return;
  if (!starting) {
    starting = (async () => {
      rmSync(DATA_DIR, { recursive: true, force: true });
      const instance = new EmbeddedPostgres({
        databaseDir: DATA_DIR,
        user: 'postgres',
        password: 'postgres',
        port: PORT,
        persistent: false,
        onLog: () => {},
        onError: () => {},
      });
      await instance.initialise();
      await instance.start();
      server = instance;
    })();
  }
  await starting;
}

export async function stopServer() {
  if (server) {
    await server.stop();
    server = null;
    starting = null;
  }
}

export type Actor =
  | { kind: 'user'; id: string }
  | { kind: 'service' }
  | { kind: 'anon' }
  | { kind: 'superuser' };

export interface TestDb {
  pool: pg.Pool;
  /** Run a statement as the given actor inside its own transaction. */
  as<T extends pg.QueryResultRow = any>(actor: Actor, sql: string, params?: unknown[]): Promise<T[]>;
  /** Create an auth user (and therefore a profile). Returns the user id. */
  createUser(username: string, fullName: string, role?: 'admin' | 'employee'): Promise<string>;
  close(): Promise<void>;
}

export async function freshDb(): Promise<TestDb> {
  await ensureServer();
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await admin.connect();
  // UTF8 like Supabase (the Windows default cluster encoding may be a legacy code page).
  await admin.query(`create database ${name} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
  await admin.end();

  const pool = new pg.Pool({ host: 'localhost', port: PORT, user: 'postgres', password: 'postgres', database: name, max: 40 });
  await pool.query(SUPABASE_STUB);
  const dir = join(ROOT, 'supabase/migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(dir, file), 'utf8'));
  }

  const as: TestDb['as'] = async (actor, sql, params = []) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (actor.kind === 'user') {
        await client.query('set local role authenticated');
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: actor.id, role: 'authenticated' }),
        ]);
      } else if (actor.kind === 'service') {
        await client.query('set local role service_role');
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
      } else if (actor.kind === 'anon') {
        await client.query('set local role anon');
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
      }
      const res = await client.query(sql, params as any[]);
      await client.query('commit');
      return res.rows;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  const createUser: TestDb['createUser'] = async (username, fullName, role = 'employee') => {
    const { rows } = await pool.query(
      `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
       values ($1, $2, $3) returning id`,
      [`${username}@smartrestroom.local`, { username, full_name: fullName }, { role }],
    );
    return rows[0].id as string;
  };

  return {
    pool,
    as,
    createUser,
    async close() {
      await pool.end();
    },
  };
}
