import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from '../src/sql';

export const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations');

/** Minimal emulation of what Supabase provides before our migrations run (roles, auth schema, auth.uid()). */
export const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export const migrationFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  // Supabase default privileges apply to objects created by migrations as well
  await db.exec(
    `grant usage on schema app to authenticated, service_role; grant execute on all functions in schema app to authenticated, service_role;`,
  );
  return db;
}

export type Row = Record<string, unknown>;

export class Actor {
  constructor(
    private db: PGlite,
    readonly id: string | null,
    private role: 'authenticated' | 'service_role' | 'anon' = 'authenticated',
  ) {}
  /** Run SQL as this actor (RLS applies unless service_role). */
  async q<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.db.exec(
      `set role ${this.role}; select set_config('request.jwt.claim.sub', '${this.id ?? ''}', false);`,
    );
    try {
      return (await this.db.query<T>(sql, params)).rows;
    } finally {
      await this.db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  }
  /** True when the statement is rejected OR affects/returns zero rows (RLS filtering). */
  async denied(sql: string, params: unknown[] = []): Promise<boolean> {
    try {
      return (await this.q(sql, params)).length === 0;
    } catch {
      return true;
    }
  }
  /** Expect the statement to be rejected (RLS violation, guard trigger, permission denied, …). */
  async fails(sql: string, params: unknown[] = []): Promise<string> {
    try {
      await this.q(sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`expected failure but succeeded: ${sql}`);
  }
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users(email) values ($1) returning id`,
    [email],
  );
  return r.rows[0]!.id;
}
export const grantRole = (db: PGlite, user: string, role: string) =>
  db.query(`insert into user_roles(user_id, role) values ($1, $2) on conflict do nothing`, [
    user,
    role,
  ]);

/**
 * Sql port over PGlite for the SERVER-SIDE services. `role` mirrors production: services run as a least-privileged
 * database role (not superuser, no BYPASSRLS), so tests exercise the real grants/policies (audit H6).
 */
export function serviceSql(db: PGlite, role?: 'app_server' | 'app_jobs'): Sql {
  type Tx = { query: (t: string, p?: never[]) => Promise<{ rows: unknown[] }> };
  const wrap = (tx: Tx, inTransaction: boolean): Sql => ({
    inTransaction,
    query: async (t, p) => (await tx.query(t, p as never[])).rows as never,
    transaction: async (fn) => {
      if (inTransaction) throw new Error('nested transaction');
      return db.transaction(async (t) => {
        if (role) await t.query(`set local role ${role}`);
        return fn(wrap(t as unknown as Tx, true));
      });
    },
  });
  // a bare query() (outside a transaction) still runs under the service role, in its own transaction
  const top = wrap(db as unknown as Tx, false);
  return {
    ...top,
    query: (t, p) => top.transaction((tx) => tx.query(t, p)),
  };
}
