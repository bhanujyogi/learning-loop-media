/**
 * Minimal SQL port used by server-side services. Production adapter: a Postgres driver connected as a
 * privileged role inside an Edge Function (user id comes from a VERIFIED JWT, never from the request body).
 * Tests adapt PGlite. The mobile app never has an implementation of this interface.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in ONE database transaction (role/user binding is applied by the adapter). Not re-entrant. */
  transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R>;
  /** True for the `tx` handed to `transaction()`; used to refuse unsafe read-modify-write outside a transaction. */
  readonly inTransaction: boolean;
}

/**
 * Every service entry point runs through this: one transaction, bound to the VERIFIED user id so `auth.uid()` is
 * meaningful to guards/audit inside the privileged-but-least-privileged service role (docs/AUTHORIZATION.md).
 */
export async function asUser<R>(sql: Sql, userId: string, fn: (tx: Sql) => Promise<R>): Promise<R> {
  const run = async (tx: Sql) => {
    // both forms Supabase's auth.uid() understands (legacy claim.sub and the JSON claims object)
    await tx.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [userId],
    );
    return fn(tx);
  };
  return sql.inTransaction ? run(sql) : sql.transaction(run);
}

export const ms = (d: Date | string | null | undefined): number | null =>
  d == null ? null : new Date(d).getTime();
/** SQL fragment converting a bound epoch-ms parameter to timestamptz. */
export const ts = (n: number) => `to_timestamp($${n}::double precision / 1000.0)`;
