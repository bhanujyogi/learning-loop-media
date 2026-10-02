import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { aggregateContentQuality, submitAnswer, type Sql } from '../src';
import { createUser, freshDb, serviceSql } from './harness';

/** Regression tests for audit H4 (XP/mastery farming), H5 (distinct learners) and H6 (least-privilege service roles). */
const Q_UNIT = '60000000-0000-0000-0000-000000000002'; // single choice, answer 'a'
const Q_CALC = '60000000-0000-0000-0000-000000000003';
const Q_FILL = '60000000-0000-0000-0000-000000000004';
const T0 = Date.UTC(2026, 5, 1, 9);
const DAY = 86_400_000;
const OHM = '50000000-0000-0000-0000-000000000004';

let db: PGlite, sql: Sql, jobs: Sql;
beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  sql = serviceSql(db, 'app_server');
  jobs = serviceSql(db, 'app_jobs');
});

const right = (u: string, now: number, extra = {}) =>
  submitAnswer(sql, { userId: u, questionId: Q_UNIT, response: { optionId: 'a' }, now, ...extra });
const wrong = (u: string, now: number) =>
  submitAnswer(sql, { userId: u, questionId: Q_UNIT, response: { optionId: 'b' }, now });
const xp = async (u: string) =>
  (await db.query<{ xp: number }>(`select xp from user_progress where user_id=$1`, [u])).rows[0]
    ?.xp ?? 0;
const mastery = async (u: string) =>
  (
    await db.query<{ m: number }>(
      `select (alpha/(alpha+beta))::float m from concept_mastery where user_id=$1 and concept_id=$2`,
      [u, OHM],
    )
  ).rows[0]!.m;

describe('H4 anti-farming', () => {
  it('resubmitting a revealed answer 25 times (fresh idempotency keys) earns XP once and barely moves mastery', async () => {
    const farmer = await createUser(db, 'farmer@x.io');
    const control = await createUser(db, 'control@x.io');
    await right(control, T0); // one honest attempt
    for (let i = 0; i < 25; i++) await right(farmer, T0 + i * 1000, { idempotencyKey: `k${i}` });
    expect(await xp(farmer)).toBe(10); // was 300 before the fix
    expect(await xp(control)).toBe(10);
    expect((await mastery(farmer)) - (await mastery(control))).toBeLessThan(0.1); // was +0.33
    expect(
      (await db.query(`select 1 from question_attempts where user_id=$1`, [farmer])).rows,
    ).toHaveLength(25); // still recorded
  });

  it('flags repeats, leaves ability/review schedule untouched by them', async () => {
    const u = await createUser(db, 'rep@x.io');
    const first = await right(u, T0);
    const abilityAfterFirst = (
      await db.query<{ ability: number }>(`select ability from learner_profiles where user_id=$1`, [
        u,
      ])
    ).rows[0]!.ability;
    const dueAfterFirst = (
      await db.query<{ due_at: Date }>(`select due_at from review_items where user_id=$1`, [u])
    ).rows[0]!.due_at;
    const again = await right(u, T0 + 5000);
    expect(first.repeatAttempt).toBe(false);
    expect(again.repeatAttempt).toBe(true);
    expect(again.xp.awarded).toBe(0);
    expect(
      (
        await db.query<{ ability: number }>(
          `select ability from learner_profiles where user_id=$1`,
          [u],
        )
      ).rows[0]!.ability,
    ).toBe(abilityAfterFirst);
    expect(
      (await db.query<{ due_at: Date }>(`select due_at from review_items where user_id=$1`, [u]))
        .rows[0]!.due_at,
    ).toEqual(dueAfterFirst);
    expect(
      (await db.query(`select 1 from review_history where user_id=$1`, [u])).rows,
    ).toHaveLength(1);
  });

  it('a miss then a correct retry still earns the effort XP and the correct XP once each (no punishment for learning)', async () => {
    const u = await createUser(db, 'retry@x.io');
    expect((await wrong(u, T0)).xp.awarded).toBe(2);
    expect((await right(u, T0 + 60_000)).xp.awarded).toBe(10);
    expect((await wrong(u, T0 + 120_000)).xp.awarded).toBe(0); // second incorrect award today: none
    expect(await xp(u)).toBe(12);
  });

  it('a genuine later review (next day) counts again: new-day XP and full-weight delayed-recall evidence', async () => {
    const u = await createUser(db, 'later@x.io');
    const a = await right(u, T0);
    const b = await right(u, T0 + 2 * DAY);
    expect(b.repeatAttempt).toBe(false);
    expect(b.xp.awarded).toBeGreaterThanOrEqual(10); // 10, plus the one-off mastery bonus if the concept just crossed the bar
    expect(b.mastery[0]!.mastery).toBeGreaterThan(a.mastery[0]!.mastery + 0.1);
  });

  it('enforces the daily XP cap across questions', async () => {
    const u = await createUser(db, 'cap@x.io');
    await db.query(`insert into user_progress(user_id, xp) values ($1, 395)`, [u]);
    await db.query(
      `insert into xp_ledger(user_id, action, amount, ref_kind, ref_id, idempotency_key, created_at) values ($1,'question_correct',395,'question',$2,'seed-1', to_timestamp($3/1000.0))`,
      [u, Q_FILL, T0],
    );
    expect((await right(u, T0 + 1000)).xp.awarded).toBe(5); // 400 cap − 395
    expect(
      (
        await submitAnswer(sql, {
          userId: u,
          questionId: Q_CALC,
          response: { value: 10 },
          now: T0 + 2000,
        })
      ).xp.awarded,
    ).toBe(0);
    expect((await right(u, T0 + DAY + 1000)).xp.awarded).toBeGreaterThanOrEqual(10); // new UTC day
  });
});

describe('H5 quality signals use distinct learners', () => {
  const flagged = async (id: string) =>
    (
      await db.query<{ needs_revision: boolean }>(
        `select needs_revision from content_quality_signals where content_id=$1`,
        [id],
      )
    ).rows[0]?.needs_revision;

  it('one learner failing 40 times is one learner, not a crowd', async () => {
    const u = await createUser(db, 'one@x.io');
    for (let i = 0; i < 40; i++)
      await submitAnswer(sql, {
        userId: u,
        questionId: Q_FILL,
        response: { value: 'x' },
        now: T0 + i * 1000,
      });
    await aggregateContentQuality(jobs, T0 + DAY);
    expect(await flagged(Q_FILL)).toBe(false);
    const ev = (
      await db.query<{ evidence: { learners: number; attempts: number } }>(
        `select evidence from content_quality_signals where content_id=$1`,
        [Q_FILL],
      )
    ).rows[0]!.evidence;
    expect(ev.learners).toBe(1);
    expect(ev.attempts).toBe(40);
  });

  it('one viewer producing 60 immediate-skip events cannot flag content as abandoned or move its quality score', async () => {
    const u = await createUser(db, 'skipper@x.io');
    for (let i = 0; i < 60; i++) {
      await db.query(
        `insert into events(user_id,name,payload,created_at) values ($1,'feed_impression',$2::jsonb, to_timestamp($3/1000.0)), ($1,'skip',$4::jsonb, to_timestamp($3/1000.0))`,
        [
          u,
          JSON.stringify({ content_id: Q_UNIT }),
          T0 + i,
          JSON.stringify({ content_id: Q_UNIT, immediate: true }),
        ],
      );
    }
    await submitAnswer(sql, {
      userId: u,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: T0,
    });
    const r = await aggregateContentQuality(jobs, T0 + DAY);
    expect(r.flaggedForRevision).toBe(0);
    expect(r.contentScored).toBe(0);
    expect(await flagged(Q_UNIT)).toBe(false);
  });

  it('many throwaway reporters (low weight) cannot flag; 22 distinct failing learners can (negative control)', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await createUser(db, `rep${i}@x.io`);
      await db.query(
        `insert into reports(reporter_id,target_kind,target_id,reason) values ($1,'content',$2,'spam')`,
        [r, Q_UNIT],
      );
    }
    for (let i = 0; i < 22; i++) {
      const u = await createUser(db, `l${i}@x.io`);
      await submitAnswer(sql, {
        userId: u,
        questionId: Q_FILL,
        response: { value: 'x' },
        now: T0 + i,
      });
      await submitAnswer(sql, {
        userId: u,
        questionId: Q_UNIT,
        response: { optionId: 'a' },
        now: T0 + i,
      });
    }
    await aggregateContentQuality(jobs, T0 + DAY);
    expect(await flagged(Q_UNIT)).toBe(false);
    expect(await flagged(Q_FILL)).toBe(true);
  });
});

describe('H6 least-privilege service roles', () => {
  it('app_server / app_jobs are plain roles: not superuser, no BYPASSRLS, cannot log in', async () => {
    const r = (
      await db.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
      }>(
        `select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname in ('app_server','app_jobs')`,
      )
    ).rows;
    expect(r).toHaveLength(2);
    for (const x of r)
      expect([x.rolsuper, x.rolbypassrls, x.rolcanlogin]).toEqual([false, false, false]);
  });

  it('the service role cannot touch authorization, content, moderation, audit, identity or pipeline data', async () => {
    const u = await createUser(db, 'victim@x.io');
    const denied = async (q: string) => expect(sql.query(q)).rejects.toThrow(/permission denied/);
    await denied(`update user_roles set role = 'admin'`);
    await denied(`insert into user_roles(user_id, role) values ('${u}', 'admin')`);
    await denied(`update content_items set moderation = 'cleared'`);
    await denied(`update content_versions set body = '{}'`);
    await denied(`insert into audit_log(action) values ('forged')`);
    await denied(`update profiles set account_state = 'banned'`);
    await denied(`insert into pipeline_jobs(kind, idempotency_key) values ('fetch_source','x')`);
    await denied(`update sources set trust = 'high'`);
    await denied(`select * from messages`);
    await denied(`select * from reports`);
    await denied(
      `insert into publish_log(idempotency_key, content_id, content_version_id) values ('k','${Q_UNIT}', gen_random_uuid())`,
    );
    await denied(`update quality_gate_results set passed = true`);
  });

  it('RLS still applies to the service role (no BYPASSRLS): a table without a service policy returns nothing even if granted', async () => {
    await db.exec(`grant select on public.follows to app_server`);
    const a = await createUser(db, 'f1@x.io'),
      b = await createUser(db, 'f2@x.io');
    await db.query(`insert into follows(follower_id, followee_id) values ($1,$2)`, [a, b]);
    expect(await sql.query(`select * from follows`)).toEqual([]);
  });

  it('the jobs role cannot read learner models or write events/attempts; the service role cannot run job-only deletes', async () => {
    await expect(jobs.query(`select * from user_features`)).rejects.toThrow(/permission denied/);
    await expect(jobs.query(`select * from concept_mastery`)).rejects.toThrow(/permission denied/);
    await expect(
      jobs.query(`insert into events(user_id,name) values (gen_random_uuid(),'like')`),
    ).rejects.toThrow(/permission denied/);
    await expect(sql.query(`delete from events`)).rejects.toThrow(/permission denied/);
    await expect(sql.query(`delete from question_attempts`)).rejects.toThrow(/permission denied/);
  });

  it('end-user sessions still cannot touch derived learner fields; only the service role can', async () => {
    const u = await createUser(db, 'lp@x.io');
    await db.query(`insert into learner_profiles(user_id) values ($1)`, [u]);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${u}',false)`,
    );
    await expect(
      db.query(`update learner_profiles set ability = 0.99 where user_id = '${u}'`),
    ).rejects.toThrow(/server-managed/);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`);
    await right(u, T0); // service path updates ability legitimately
    expect(
      (
        await db.query<{ ability: number }>(
          `select ability from learner_profiles where user_id=$1`,
          [u],
        )
      ).rows[0]!.ability,
    ).not.toBe(0.5);
  });
});
