import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeOnboarding,
  DomainFailure,
  getFeed,
  recordEvents,
  submitAnswer,
  loadFeatures,
  type Sql,
} from '../src';
import { createUser, freshDb, serviceSql } from './harness';

const OHM = '50000000-0000-0000-0000-000000000004';
const Q_UNIT = '60000000-0000-0000-0000-000000000002';
const Q_CALC = '60000000-0000-0000-0000-000000000003';
const NOTE = '60000000-0000-0000-0000-000000000001';
const SCIENCE = '20000000-0000-0000-0000-000000000002';
const T0 = Date.UTC(2026, 5, 1, 9);

let db: PGlite, sql: Sql, user: string;
beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  sql = serviceSql(db, 'app_server');
  user = await createUser(db, 'student@example.com');
});

describe('closed learning loop (answer → learner model → feed)', () => {
  it('onboarding → feed: bounded, answer-free, explainable, deduplicated', async () => {
    await completeOnboarding(sql, {
      userId: user,
      examId: '10000000-0000-0000-0000-000000000001',
      interestSubjectIds: [SCIENCE],
    });
    const a = await getFeed(sql, { userId: user, limit: 3, now: T0, seed: 1 });
    expect(a.items).toHaveLength(3);
    expect(a.rankingVersion).toBe('ranking_v1');
    expect(JSON.stringify(a.items)).not.toMatch(/explanation|"answer"|optionId":"a"\}/);
    const rec = await db.query(
      `select why_shown, score from recommendation_items where recommendation_id = $1`,
      [a.recommendationId],
    );
    expect(rec.rows).toHaveLength(3);
    expect(Object.keys((rec.rows[0] as { why_shown: object }).why_shown)).toEqual(
      expect.arrayContaining(['learning_need', 'difficulty_fit', 'personal_interest']),
    );
    const b = await getFeed(sql, { userId: user, limit: 3, now: T0 + 1000, seed: 2 });
    const ids = new Set(a.items.map((i) => i.contentId));
    expect(b.items.every((i) => !ids.has(i.contentId))).toBe(true);
    const c = await getFeed(sql, { userId: user, limit: 3, now: T0 + 2000, seed: 3 });
    expect(c.items).toHaveLength(0);
    expect(c.exhausted).toBe(true); // graceful low inventory
  });

  it('a wrong answer is graded server-side, updates mastery/review/XP/events, and reveals the answer only afterwards', async () => {
    const r = await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'b' },
      responseMs: 4000,
      now: T0,
    });
    expect(r.correct).toBe(false);
    expect(r.correctAnswer).toEqual({ optionId: 'a' });
    expect(r.explanation).toMatch(/ohm/i);
    expect(r.xp.awarded).toBe(2);
    expect(r.mastery[0]).toMatchObject({ conceptId: OHM });
    expect(r.mastery[0]!.mastery).toBeLessThan(0.5);
    expect(
      (await db.query(`select 1 from review_items where user_id = $1`, [user])).rows,
    ).toHaveLength(1);
    expect(
      (await db.query(`select name from events where user_id = $1 order by id`, [user])).rows.map(
        (x) => (x as { name: string }).name,
      ),
    ).toEqual(['question_answered', 'answer_incorrect']);
    const f = await sql.transaction((tx) => loadFeatures(tx, user));
    expect(f.ability).toBeLessThan(0.5);
    expect(f.formatLearning['question']!.score).toBeLessThan(0.5);
  });

  it('is idempotent: replaying the same attempt never double-counts XP or mastery', async () => {
    const input = {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      idempotencyKey: 'attempt-1',
      now: T0,
    };
    const first = await submitAnswer(sql, input);
    const again = await submitAnswer(sql, { ...input, now: T0 + 5000 });
    expect(again.replayed).toBe(true);
    expect(again.attemptId).toBe(first.attemptId);
    expect(
      (await db.query(`select 1 from question_attempts where user_id = $1`, [user])).rows,
    ).toHaveLength(1);
    expect(
      (await db.query(`select xp from user_progress where user_id = $1`, [user])).rows[0],
    ).toEqual({ xp: 10 });
    expect(first.achievements).toContain('first_correct');
  });

  it('repeated mistakes make the concept weak, and the NEXT FEED prioritises that concept (behaviour changes recommendations)', async () => {
    for (let i = 0; i < 3; i++)
      await submitAnswer(sql, {
        userId: user,
        questionId: Q_CALC,
        response: { value: 7 },
        now: T0 + i * 60_000,
      });
    const f = await sql.transaction((tx) => loadFeatures(tx, user));
    expect(f.conceptNeed[OHM]).toBeGreaterThan(0.6);
    const feed = await getFeed(sql, { userId: user, limit: 2, now: T0 + 600_000, seed: 5 });
    const rows = (
      await db.query(
        `select content_id, why_shown from recommendation_items where recommendation_id = $1`,
        [feed.recommendationId],
      )
    ).rows as { content_id: string; why_shown: Record<string, number> }[];
    const ohmContent = new Set([NOTE, '60000000-0000-0000-0000-000000000006', Q_UNIT, Q_CALC]);
    expect(rows.every((r) => ohmContent.has(r.content_id))).toBe(true);
    expect(rows.every((r) => r.why_shown.learning_need! > 0.05)).toBe(true);
  });

  it('delayed correct recall counts as stronger evidence than an immediate correct answer', async () => {
    const fresh = await createUser(db, 'b@example.com');
    const imm1 = await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: T0,
    });
    const imm2 = await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: T0 + 60_000,
    });
    const d1 = await submitAnswer(sql, {
      userId: fresh,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: T0,
    });
    const d2 = await submitAnswer(sql, {
      userId: fresh,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: T0 + 3 * 86_400_000,
    });
    expect(d2.mastery[0]!.mastery - d1.mastery[0]!.mastery).toBeGreaterThan(
      imm2.mastery[0]!.mastery - imm1.mastery[0]!.mastery,
    );
  });

  it('spaced repetition pushes the review further out after successes', async () => {
    const r1 = await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: T0,
    });
    const r2 = await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: r1.nextReviewAt,
    });
    expect(r2.nextReviewAt - r1.nextReviewAt).toBeGreaterThan(r1.nextReviewAt - T0);
  });

  it('refuses unpublished / removed / unknown questions', async () => {
    await db.query(`update content_items set moderation = 'removed' where id = $1`, [Q_UNIT]);
    await expect(
      submitAnswer(sql, { userId: user, questionId: Q_UNIT, response: {} }),
    ).rejects.toBeInstanceOf(DomainFailure);
    await expect(
      submitAnswer(sql, {
        userId: user,
        questionId: '00000000-0000-0000-0000-00000000dead',
        response: {},
      }),
    ).rejects.toBeInstanceOf(DomainFailure);
    await expect(
      submitAnswer(sql, { userId: user, questionId: Q_CALC, response: {}, hintsUsed: -1 }),
    ).rejects.toBeInstanceOf(DomainFailure);
  });

  it('engagement events are sanitised and shift preferences; learning events cannot be forged through them', async () => {
    const res = await recordEvents(
      sql,
      user,
      [
        { name: 'save', payload: { content_id: NOTE, auth_token: 'leak' } },
        { name: 'save', payload: { content_id: NOTE } },
        { name: 'answer_correct', payload: { question_id: Q_UNIT, concept_id: OHM } }, // accepted as a raw event, but gives NO mastery
        { name: 'drop_table' },
      ],
      T0,
    );
    expect(res).toEqual({ accepted: 3, dropped: 1 });
    const stored = await db.query(
      `select payload from events where user_id = $1 and name = 'save'`,
      [user],
    );
    expect(JSON.stringify(stored.rows)).not.toContain('leak');
    const f = await sql.transaction((tx) => loadFeatures(tx, user));
    expect(f.format['note']!.score).toBeGreaterThan(0.5);
    expect(
      (await db.query(`select 1 from concept_mastery where user_id = $1`, [user])).rows,
    ).toHaveLength(0);
    expect(f.formatLearning['question']).toBeUndefined();
  });

  it('XP rewards learning: passive watching earns nothing', async () => {
    await recordEvents(sql, user, [{ name: 'watch_complete', payload: { content_id: NOTE } }], T0);
    expect(
      (await db.query(`select 1 from xp_ledger where user_id = $1`, [user])).rows,
    ).toHaveLength(0);
  });

  it('experiments: assignment is sticky and recorded on the recommendation', async () => {
    const exp = await db.query<{ id: string }>(
      `insert into experiments(key, hypothesis, status, variants) values ('rank_ab','v1 vs v1',$1,$2::jsonb) returning id`,
      [
        'running',
        JSON.stringify([
          { name: 'control', weight: 1, ranking_version: 'ranking_v1' },
          { name: 'treat', weight: 1, ranking_version: 'ranking_v1' },
        ]),
      ],
    );
    const a = await getFeed(sql, { userId: user, limit: 1, now: T0, seed: 1 });
    const rec = (
      await db.query<{ experiment_id: string; variant: string }>(
        `select experiment_id, variant from recommendations where id = $1`,
        [a.recommendationId],
      )
    ).rows[0]!;
    expect(rec.experiment_id).toBe(exp.rows[0]!.id);
    const b = await getFeed(sql, { userId: user, limit: 1, now: T0 + 1, seed: 2 });
    const rec2 = (
      await db.query<{ variant: string }>(`select variant from recommendations where id = $1`, [
        b.recommendationId,
      ])
    ).rows[0]!;
    expect(rec2.variant).toBe(rec.variant);
  });
});

describe('candidate sources', () => {
  const sourcesFor = async (feedId: string | null) =>
    new Map(
      (
        await db.query<{ content_id: string; sources: string[] }>(
          `select content_id, sources from recommendation_items where recommendation_id = $1`,
          [feedId],
        )
      ).rows.map((r) => [r.content_id, r.sources]),
    );
  const FC = '60000000-0000-0000-0000-000000000005'; // simple-interest flashcard (prereq: percentage-basics)

  it('adjacent_concept: concepts whose prerequisites are mastered become "next up"', async () => {
    await db.query(
      `insert into concept_mastery(user_id, concept_id, alpha, beta, exposures, correct) values ($1,'50000000-0000-0000-0000-000000000001',9,1,8,8)`,
      [user],
    );
    const feed = await getFeed(sql, { userId: user, limit: 10, now: T0, seed: 1 });
    expect((await sourcesFor(feed.recommendationId)).get(FC)).toContain('adjacent_concept');
  });

  it('not adjacent while the prerequisite is weak/unknown', async () => {
    const feed = await getFeed(sql, { userId: user, limit: 10, now: T0, seed: 1 });
    expect((await sourcesFor(feed.recommendationId)).get(FC) ?? []).not.toContain(
      'adjacent_concept',
    );
  });

  it('saved_topic: saving content surfaces other content on the same concept', async () => {
    await db.query(`insert into saves(user_id, content_id) values ($1,$2)`, [user, NOTE]);
    const feed = await getFeed(sql, { userId: user, limit: 10, now: T0, seed: 1 });
    expect((await sourcesFor(feed.recommendationId)).get(Q_UNIT)).toContain('saved_topic');
  });

  it('challenge: items a stretch above current ability', async () => {
    await db.query(`insert into learner_profiles(user_id, ability) values ($1, 0.2)`, [user]);
    await submitAnswer(sql, {
      userId: user,
      questionId: Q_UNIT,
      response: { optionId: 'b' },
      now: T0,
    }); // sets features.ability
    const f = await sql.transaction((tx) => loadFeatures(tx, user));
    expect(f.ability).toBeLessThan(0.3);
    const feed = await getFeed(sql, { userId: user, limit: 10, now: T0 + 1000, seed: 1 });
    expect((await sourcesFor(feed.recommendationId)).get(Q_CALC)).toContain('challenge');
  });

  it('related: relation edges from recently shown content', async () => {
    const first = await getFeed(sql, { userId: user, limit: 1, now: T0, seed: 1 }); // populates the recent window
    const shown = first.items[0]!.contentId;
    const target = [NOTE, Q_UNIT, Q_CALC, FC].find((id) => id !== shown)!;
    await db.query(
      `insert into content_relations(from_content_id, to_content_id, kind) values ($1,$2,'related_question')`,
      [shown, target],
    );
    const next = await getFeed(sql, { userId: user, limit: 10, now: T0 + 1000, seed: 2 });
    expect((await sourcesFor(next.recommendationId)).get(target)).toContain('related');
  });
});

describe('feed request hardening', () => {
  it('a non-numeric / negative / huge limit never yields an empty or unbounded feed', async () => {
    for (const limit of [Number.NaN, -5, 0, 1e9, undefined]) {
      const u = await createUser(db, `lim${String(limit)}@x.io`);
      const feed = await getFeed(sql, { userId: u, limit: limit as number, now: T0, seed: 1 });
      expect(feed.items.length).toBeGreaterThan(0);
      expect(feed.items.length).toBeLessThanOrEqual(30);
    }
  });
});
