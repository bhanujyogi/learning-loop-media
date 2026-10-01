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

let pg: ReturnType<typeof postgres> | null = null;
const wrap = (db: postgres.Sql | postgres.TransactionSql): Sql => ({
  query: async (text, params) => (await db.unsafe(text, (params ?? []) as never[])) as never,
  transaction: (fn) => (db as postgres.Sql).begin((tx) => fn(wrap(tx))) as never,
});
export const sql = (): Sql =>
  wrap((pg ??= postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 3, prepare: false })));

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
