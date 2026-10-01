/**
 * Minimal SQL port used by server-side services. Production adapter: a Postgres driver connected as a
 * privileged role inside an Edge Function (user id comes from a VERIFIED JWT, never from the request body).
 * Tests adapt PGlite. The mobile app never has an implementation of this interface.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R>;
}

export const ms = (d: Date | string | null | undefined): number | null =>
  d == null ? null : new Date(d).getTime();
/** SQL fragment converting a bound epoch-ms parameter to timestamptz. */
export const ts = (n: number) => `to_timestamp($${n}::double precision / 1000.0)`;
