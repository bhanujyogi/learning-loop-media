import { describe, expect, it } from 'vitest';
import { freshDb, migrationFiles } from './harness';

describe('migrations', () => {
  it('apply cleanly in order on an empty database', async () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(13);
    const db = await freshDb();
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from information_schema.tables where table_schema='public'`,
    );
    expect(r.rows[0]!.n).toBeGreaterThan(60);
  });
  it('every public table has row level security enabled', async () => {
    const db = await freshDb();
    const r = await db.query<{
      relname: string;
    }>(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });
});
