import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeOnboarding,
  getFeed,
  loadFeatures,
  recordEvents,
  submitAnswer,
  type Sql,
} from '../src';
import { createUser, freshDb, serviceSql } from './harness';

const T0 = Date.UTC(2026, 5, 1, 9);
const Q_UNIT = '60000000-0000-0000-0000-000000000002';

let db: PGlite, sql: Sql, user: string;
beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  sql = serviceSql(db, 'app_server');
  user = await createUser(db, 'learner@example.com');
  await completeOnboarding(sql, { userId: user, interestSubjectIds: [] });
});
const features = () => sql.transaction((tx) => loadFeatures(tx, user));

describe('core learning loop: repetition controls are not corrupted by client impressions', () => {
  it('a client feed_impression for an item the feed already served does not record it a second time', async () => {
    const feed = await getFeed(sql, { userId: user, limit: 4, now: T0, seed: 1 });
    const before = await features();
    expect(before.recent.contentIds).toHaveLength(feed.items.length);
    await recordEvents(
      sql,
      user,
      feed.items.map((i, n) => ({
        name: 'feed_impression',
        payload: {
          content_id: i.contentId,
          recommendation_id: feed.recommendationId,
          position: n,
        },
      })),
      T0,
    );
    const after = await features();
    // the recency windows (diversity / repetition inputs) must be unchanged: each served item appears exactly once
    expect(after.recent).toEqual(before.recent);
    expect(after.seenContentIds).toEqual(before.seenContentIds);
    expect(new Set(after.recent.contentIds).size).toBe(after.recent.contentIds.length);
  });

  it('an impression for content that was NOT served by the feed (e.g. opened from Saved) is still recorded once', async () => {
    const note = '60000000-0000-0000-0000-000000000001';
    const ev = { name: 'feed_impression', payload: { content_id: note } };
    await recordEvents(sql, user, [ev], T0);
    await recordEvents(sql, user, [ev], T0 + 1);
    const f = await features();
    expect(f.recent.contentIds.filter((c) => c === note)).toHaveLength(1);
    expect(f.seenContentIds).toContain(note);
  });
});

describe('core learning loop: recommendation outcome logging through the answer path', () => {
  it('the answer is attributed to the recommendation it came from, as a server-written LEARNING event', async () => {
    const feed = await getFeed(sql, { userId: user, limit: 10, now: T0, seed: 1 });
    const q =
      feed.items.find((i) => i.contentId === Q_UNIT) ??
      feed.items.find((i) => i.type === 'question')!;
    const r = await submitAnswer(sql, {
      userId: user,
      questionId: q.contentId,
      response: { optionId: 'zzz', value: 0 },
      recommendationId: feed.recommendationId!,
      responseMs: 4000,
      now: T0,
    });
    const out = (
      await db.query<{ answered: number; correct: number; incorrect: number }>(
        `select answered::int, correct::int, incorrect::int from recommendation_outcomes where recommendation_id = $1 and content_id = $2`,
        [feed.recommendationId, q.contentId],
      )
    ).rows[0]!;
    expect([out.answered, out.correct + out.incorrect]).toEqual([1, 1]);
    expect(out.correct).toBe(r.correct ? 1 : 0);
    // engagement and learning signals are separate event families with separate writers
    const names = (
      await db.query<{ name: string }>(`select distinct name from events where user_id = $1`, [
        user,
      ])
    ).rows.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['question_answered']));
    expect(names).not.toContain('like');
  });

  it("a forged recommendation id (someone else's) cannot attach outcomes to their recommendation", async () => {
    const victim = await createUser(db, 'victim@example.com');
    await completeOnboarding(sql, { userId: victim, interestSubjectIds: [] });
    const vf = await getFeed(sql, { userId: victim, limit: 3, now: T0, seed: 2 });
    const q = (await getFeed(sql, { userId: user, limit: 10, now: T0, seed: 1 })).items.find(
      (i) => i.type === 'question',
    )!;
    await submitAnswer(sql, {
      userId: user,
      questionId: q.contentId,
      response: { optionId: 'a', value: 1 },
      recommendationId: vf.recommendationId!,
      now: T0,
    });
    const leaked = (
      await db.query<{ n: number }>(
        `select coalesce(sum(answered),0)::int n from recommendation_outcomes where recommendation_id = $1`,
        [vf.recommendationId],
      )
    ).rows[0]!.n;
    expect(leaked).toBe(0);
  });

  it('server contract the app relies on: the same idempotency key replays the FIRST graded answer, even if the response differs', async () => {
    const key = 'attempt-key-1';
    const first = await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'b' },
      idempotencyKey: key,
      now: T0,
    });
    const second = await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'a' }, // the correct option — but the key was already used
      idempotencyKey: key,
      now: T0 + 1000,
    });
    expect(first.correct).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.correct).toBe(false); // so the app must use a NEW key when the learner changes their answer
    expect(second.xp.awarded).toBe(0);
    expect(
      (await db.query(`select 1 from question_attempts where user_id = $1`, [user])).rows,
    ).toHaveLength(1);
  });
});

describe('core learning loop end to end (the mobile journey, server side)', () => {
  it('feed → engagement events → graded answer → outcomes → NEXT batch reflects the answer and never repeats it', async () => {
    const rec1 = await getFeed(sql, { userId: user, limit: 3, now: T0, seed: 1 });
    const q =
      rec1.items.find((i) => i.type === 'question') ??
      (await getFeed(sql, { userId: user, limit: 10, now: T0 + 1, seed: 9 })).items.find(
        (i) => i.type === 'question',
      )!;
    const recId = rec1.items.some((i) => i.contentId === q.contentId)
      ? rec1.recommendationId!
      : (
          await db.query<{ id: string }>(
            `select recommendation_id id from recommendation_items where content_id = $1 limit 1`,
            [q.contentId],
          )
        ).rows[0]!.id;

    // engagement signals (client → events): impression + like — these may move PREFERENCES, never mastery
    await recordEvents(
      sql,
      user,
      [
        { name: 'feed_impression', payload: { content_id: q.contentId, recommendation_id: recId } },
        { name: 'like', payload: { content_id: q.contentId, recommendation_id: recId } },
        // a forged learning event from the client is ignored for learning state
        { name: 'answer_correct', payload: { question_id: q.contentId, recommendation_id: recId } },
      ],
      T0,
    );
    expect(
      (await db.query(`select 1 from concept_mastery where user_id = $1`, [user])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query(`select 1 from xp_ledger where user_id = $1`, [user])).rows,
    ).toHaveLength(0);

    // learning signal (server-graded): wrong answer
    const before = (await features()).ability;
    const res = await submitAnswer(sql, {
      userId: user,
      questionId: q.contentId,
      response: { optionId: 'zzz', value: -1 },
      recommendationId: recId,
      responseMs: 3000,
      now: T0 + 5000,
    });
    expect(res.correct).toBe(false);
    expect(res.mastery.length).toBeGreaterThan(0);
    expect((await features()).ability).toBeLessThan(before); // learner model moved, server-side

    // next recommendation: ranked from the updated model, answered item not repeated, outcome attributed to the first rec
    const next = await getFeed(sql, { userId: user, limit: 6, now: T0 + 10_000, seed: 2 });
    expect(next.recommendationId).not.toBe(recId);
    expect(next.items.map((i) => i.contentId)).not.toContain(q.contentId);
    const snap = (
      await db.query<{ feature_snapshot: { ability: number } }>(
        `select feature_snapshot from recommendations where id = $1`,
        [next.recommendationId],
      )
    ).rows[0]!.feature_snapshot;
    expect(snap.ability).toBeLessThan(before + 1e-9);
    const out = (
      await db.query<{ likes: number; answered: number; incorrect: number }>(
        `select likes::int, answered::int, incorrect::int from recommendation_outcomes where recommendation_id = $1 and content_id = $2`,
        [recId, q.contentId],
      )
    ).rows[0]!;
    expect([out.likes, out.answered, out.incorrect]).toEqual([1, 1, 1]);
  });
});
