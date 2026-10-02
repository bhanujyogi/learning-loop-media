import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { Sql } from '../src/sql';
import { MIGRATIONS_DIR, SUPABASE_STUB, migrationFiles } from './harness';

/**
 * Optional REAL PostgreSQL (multi-connection) for tests that PGlite cannot express — concurrency/locking.
 * Starts a throwaway cluster from the PostgreSQL server binaries on this machine (Ubuntu: /usr/lib/postgresql/<v>/bin).
 * Not Supabase: no GoTrue/Realtime/Storage — only real Postgres concurrency semantics. CI sets REQUIRE_REAL_PG=1.
 */
export const findPgBin = (): string | null => {
  for (const v of ['17', '16', '15', '14']) {
    const d = `/usr/lib/postgresql/${v}/bin`;
    if (existsSync(join(d, 'initdb'))) return d;
  }
  return null;
};

export interface RealPg {
  pool: pg.Pool;
  stop: () => void;
  dir: string;
}

export async function startRealPg(): Promise<RealPg> {
  const bin = findPgBin();
  if (!bin) throw new Error('no PostgreSQL server binaries found');
  const dir = mkdtempSync(join(tmpdir(), 'll-realpg-'));
  const asRoot = process.getuid?.() === 0;
  const run = (cmd: string, args: string[]) => {
    const r = asRoot
      ? spawnSync(
          'su',
          ['postgres', '-s', '/bin/bash', '-c', [cmd, ...args].map((a) => `'${a}'`).join(' ')],
          { encoding: 'utf8' },
        )
      : spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
  };
  if (asRoot) execFileSync('chown', ['-R', 'postgres', dir]);
  const data = join(dir, 'data');
  const port = 55000 + Math.floor(Math.random() * 4000);
  run(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-sync']);
  run(join(bin, 'pg_ctl'), [
    '-D',
    data,
    '-w',
    '-l',
    join(dir, 'log'),
    '-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dir} -c fsync=off -c max_connections=50`,
    'start',
  ]);
  const stop = () => {
    try {
      run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    } catch {
      /* already stopped */
    }
  };
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    database: 'postgres',
    max: 16,
  });
  const c = await pool.connect();
  try {
    await c.query(SUPABASE_STUB);
    for (const f of migrationFiles()) await c.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    await c.query(
      `grant usage on schema app to authenticated, service_role; grant execute on all functions in schema app to authenticated, service_role;`,
    );
  } finally {
    c.release();
  }
  return { pool, stop, dir };
}

/** Sql port over a pg Pool: each transaction() takes its OWN connection (true concurrency), under the given service role. */
export function pgSql(pool: pg.Pool, role: 'app_server' | 'app_jobs'): Sql {
  const wrap = (c: pg.PoolClient | pg.Pool, inTransaction: boolean): Sql => ({
    inTransaction,
    query: async (t, p) => (await c.query(t, p as unknown[])).rows as never,
    transaction: async (fn) => {
      if (inTransaction) throw new Error('nested transaction');
      const conn = await pool.connect();
      try {
        await conn.query('begin');
        await conn.query(`set local role ${role}`);
        const r = await fn(wrap(conn, true));
        await conn.query('commit');
        return r;
      } catch (e) {
        await conn.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        conn.release();
      }
    },
  });
  const top = wrap(pool, false);
  return { ...top, query: (t, p) => top.transaction((tx) => tx.query(t, p)) };
}
