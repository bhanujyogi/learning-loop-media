import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getFeed, loadFeatures, recordEvents, submitAnswer } from '../src';
import { findPgBin, pgSql, startRealPg, type RealPg } from './real-pg';

/**
 * Audit H8 regression: learner features are a JSON document updated by read-modify-write. Concurrent requests for the SAME
 * learner (feed prefetch + answer + events) must serialise on the row lock instead of overwriting each other.
 * Runs on a real multi-connection PostgreSQL (not PGlite). Skipped when no server binaries exist, except when REQUIRE_REAL_PG=1.
 */
const available = !!findPgBin();
if (!available && process.env.REQUIRE_REAL_PG === '1')
  throw new Error('REQUIRE_REAL_PG=1 but no PostgreSQL server binaries found');

const NOTE = '60000000-0000-0000-0000-000000000001';
const Q_UNIT = '60000000-0000-0000-0000-000000000002';

describe.skipIf(!available)('H8 concurrent learner-feature updates (real PostgreSQL)', () => {
  let real: RealPg;
  beforeAll(async () => {
    real = await startRealPg();
    await real.pool.query(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  }, 120_000);
  afterAll(async () => {
    await real?.pool.end();
    real?.stop();
  });

  const newUser = async (email: string) =>
    (
      await real.pool.query<{ id: string }>(
        `insert into auth.users(email) values ($1) returning id`,
        [email],
      )
    ).rows[0]!.id;

  it('N concurrent event batches for one learner lose no updates', async () => {
    const u = await newUser('conc1@x.io');
    const sql = pgSql(real.pool, 'app_server');
    const N = 12;
    await Promise.all(
      Array.from({ length: N }, () =>
        recordEvents(sql, u, [{ name: 'save', payload: { content_id: NOTE } }], Date.now()),
      ),
    );
    const f = await sql.transaction((tx) => loadFeatures(tx, u));
    expect(f.format['note']!.n).toBe(N); // lost updates would leave n < N
  });

  it('feed + graded answer + engagement events racing on one learner all persist', async () => {
    const u = await newUser('conc2@x.io');
    const sql = pgSql(real.pool, 'app_server');
    await Promise.all([
      getFeed(sql, { userId: u, limit: 3, now: Date.now(), seed: 7 }),
      submitAnswer(sql, {
        userId: u,
        questionId: Q_UNIT,
        response: { optionId: 'b' },
        now: Date.now(),
      }),
      recordEvents(sql, u, [{ name: 'save', payload: { content_id: NOTE } }], Date.now()),
      recordEvents(sql, u, [{ name: 'like', payload: { content_id: NOTE } }], Date.now()),
    ]);
    const f = await sql.transaction((tx) => loadFeatures(tx, u));
    expect(f.seenContentIds.length).toBe(3); // from the feed
    expect(f.formatLearning['question']).toBeDefined(); // from the answer
    expect(f.format['note']!.n).toBe(2); // from the two engagement batches
  });

  it('loadFeatures refuses to run outside a transaction (no unlocked read-modify-write)', async () => {
    const u = await newUser('conc3@x.io');
    await expect(loadFeatures(pgSql(real.pool, 'app_server'), u)).rejects.toThrow(
      /requires a transaction/,
    );
  });
});
