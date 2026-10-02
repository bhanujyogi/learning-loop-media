// Shared runtime for Edge Functions. Secrets come from the Supabase-provided environment ONLY.
// SUPABASE_DB_URL is a privileged connection: it never leaves this server runtime.
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import type { Sql } from '@learning-loop/database';
import { log } from '@learning-loop/shared';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Verifies the caller's JWT with Supabase Auth and returns the user id. The id is NEVER read from the request body. */
export async function requireUser(req: Request): Promise<string> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw new Response('unauthorized', { status: 401 });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Response('unauthorized', { status: 401 });
  return data.user.id;
}

// ---- Database access: LEAST PRIVILEGE (audit H6) ----------------------------------------------------------------
// Every transaction runs `SET LOCAL ROLE app_server` (or `app_jobs`): a non-superuser role WITHOUT BYPASSRLS whose grants
// are listed in supabase/migrations/20260102000002_service_roles.sql. Even if the connection string is the platform's
// privileged `postgres` user, application code never executes with those privileges.
// Preferred hardening: create a dedicated LOGIN role that is only a member of app_server/app_jobs (password set out-of-band,
// never in a migration) and provide its URL as APP_DB_URL; SUPABASE_DB_URL remains the fallback.
let pg: ReturnType<typeof postgres> | null = null;
type Role = 'app_server' | 'app_jobs';
const wrap = (
  db: postgres.Sql | postgres.TransactionSql,
  role: Role,
  inTransaction: boolean,
): Sql => ({
  inTransaction,
  query: async (text, params) => {
    if (inTransaction) return (await db.unsafe(text, (params ?? []) as never[])) as never;
    // a bare query still runs inside its own role-scoped transaction
    return (await (db as postgres.Sql).begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      return tx.unsafe(text, (params ?? []) as never[]);
    })) as never;
  },
  transaction: (fn) => {
    if (inTransaction) throw new Error('nested transaction');
    return (db as postgres.Sql).begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      return fn(wrap(tx, role, true));
    }) as never;
  },
});
export const sql = (role: Role = 'app_server'): Sql =>
  wrap(
    (pg ??= postgres(Deno.env.get('APP_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL')!, {
      max: 3,
      prepare: false,
    })),
    role,
    false,
  );

/** Maps domain errors to safe HTTP responses (no stack traces / internals). */
export function errorResponse(e: unknown): Response {
  if (e instanceof Response) return e;
  const code = (e as { code?: string })?.code;
  if (code === 'not_found') return json(404, { error: 'not_found' });
  if (code === 'invalid_input') return json(400, { error: 'invalid_input' });
  if (code === 'forbidden') return json(403, { error: 'forbidden' });
  log.error('edge function error', { error: (e as Error)?.message });
  return json(500, { error: 'internal' });
}
