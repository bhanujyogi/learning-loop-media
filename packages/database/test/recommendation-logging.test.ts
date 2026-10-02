import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { RANKING_V1, rankingAlgorithmOf } from '@learning-loop/config';
import { getFeed, recordEvents, submitAnswer, type Sql } from '../src';
import { Actor, createUser, freshDb, grantRole, serviceSql } from './harness';

/** Audit H9: DB-authoritative ranking config + decision/candidate/outcome logging suitable for bandits / learned ranking. */
const T0 = Date.UTC(2026, 5, 1, 9);
let db: PGlite, sql: Sql, user: string;
beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  sql = serviceSql(db, 'app_server');
  user = await createUser(db, 'rec@x.io');
});

const algo = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...rankingAlgorithmOf(RANKING_V1), ...over });
const activate = async (version: string, algorithm: string) => {
  await db.query(`update ranking_versions set status = 'retired' where status = 'active'`);
  await db.query(
    `insert into ranking_versions(version, algorithm, status) values ($1,$2::jsonb,'draft')`,
    [version, algorithm],
  );
  await db.query(`update ranking_versions set status = 'active' where version = $1`, [version]);
};

describe('ranking configuration is authoritative in the database', () => {
  it('ranking_v1 exists from migrations and equals the code constant (no drift)', async () => {
    const r = (
      await db.query<{ algorithm: unknown; status: string }>(
        `select algorithm, status from ranking_versions where version='ranking_v1'`,
      )
    ).rows[0]!;
    expect(r.status).toBe('active');
    expect(r.algorithm).toEqual(rankingAlgorithmOf(RANKING_V1));
  });

  it('a new active version in the DB changes the feed with NO code change, and is recorded on the recommendation', async () => {
    await activate('ranking_v2', algo({ batchSize: 2, explorationRatio: 0 }));
    const feed = await getFeed(sql, { userId: user, now: T0, seed: 1 });
    expect(feed.items).toHaveLength(2);
    expect(feed.rankingVersion).toBe('ranking_v2');
    const rec = (
      await db.query<{
        ranking_version: string;
        ranking_config: { source: string; batchSize: number; version: string };
      }>(`select ranking_version, ranking_config from recommendations where id=$1`, [
        feed.recommendationId,
      ])
    ).rows[0]!;
    expect(rec.ranking_version).toBe('ranking_v2');
    expect(rec.ranking_config).toMatchObject({ version: 'ranking_v2', source: 'db', batchSize: 2 });
  });

  it('an invalid stored config never reaches ranking: falls back to RANKING_V1 and the fallback is recorded, not silent', async () => {
    const bad = JSON.parse(algo());
    bad.weights.exploration = 0.9; // weights no longer sum to 1
    await activate('ranking_v3', JSON.stringify(bad));
    const feed = await getFeed(sql, { userId: user, now: T0, seed: 1 });
    expect(feed.rankingVersion).toBe('ranking_v1');
    const rec = (
      await db.query<{ ranking_config: { source: string; fallback_reason: string } }>(
        `select ranking_config from recommendations where id=$1`,
        [feed.recommendationId],
      )
    ).rows[0]!;
    expect(rec.ranking_config.source).toBe('fallback');
    expect(rec.ranking_config.fallback_reason).toMatch(/sum/);
  });

  it('an active/retired algorithm is immutable; status transitions are constrained and audited', async () => {
    await expect(
      db.query(
        `update ranking_versions set algorithm = '{"weights":{},"explorationRatio":0,"repetition":{},"diversity":{},"batchSize":1}'::jsonb where version='ranking_v1'`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.query(
        `insert into ranking_versions(version, algorithm) values ('ranking_v4','{"weights":1}'::jsonb)`,
      ),
    ).rejects.toThrow(/ranking_algorithm_shape/);
    await db.query(`update ranking_versions set status='retired' where version='ranking_v1'`);
    await expect(
      db.query(`update ranking_versions set status='active' where version='ranking_v1'`),
    ).rejects.toThrow(/illegal ranking version status transition/);
    expect(
      (
        await db.query(
          `select 1 from audit_log where action='ranking.status_changed' and target_id='ranking_v1'`,
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('only staff with ranking.manage can write versions; service roles can only read them', async () => {
    const plain = new Actor(db, user);
    await plain.fails(
      `insert into ranking_versions(version, algorithm) values ('ranking_v9', '${algo()}'::jsonb)`,
    );
    await expect(sql.query(`update ranking_versions set notes='x'`)).rejects.toThrow(
      /permission denied/,
    );
    const admin = new Actor(db, await createUser(db, 'rm@x.io'));
    await grantRole(db, admin.id!, 'admin');
    await admin.q(
      `insert into ranking_versions(version, algorithm) values ('ranking_v9', '${algo()}'::jsonb)`,
    );
  });
});

describe('every served batch is trainable and auditable', () => {
  it('stores config + feature snapshot + policy, a candidate log with score components, and per-item decision/propensity', async () => {
    const feed = await getFeed(sql, { userId: user, limit: 3, now: T0, seed: 9 });
    const rec = (
      await db.query<{
        features_version: string;
        feature_snapshot: Record<string, unknown>;
        candidate_count: number;
        policy: { selection: string; seed: number };
        ranking_config: { weights: unknown };
      }>(
        `select features_version, feature_snapshot, candidate_count, policy, ranking_config from recommendations where id=$1`,
        [feed.recommendationId],
      )
    ).rows[0]!;
    expect(rec.features_version).toBe('features_v1');
    expect(rec.feature_snapshot).toHaveProperty('ability');
    expect(rec.candidate_count).toBeGreaterThanOrEqual(3);
    expect(rec.policy).toMatchObject({ selection: 'greedy_diverse+sampled_exploration', seed: 9 });
    expect(rec.ranking_config.weights).toEqual(RANKING_V1.weights);
    const items = (
      await db.query<{ content_id: string; decision: string; propensity: number }>(
        `select content_id, decision, propensity from recommendation_items where recommendation_id=$1`,
        [feed.recommendationId],
      )
    ).rows;
    expect(items).toHaveLength(3);
    expect(
      items.every(
        (i) => ['exploit', 'explore'].includes(i.decision) && i.propensity > 0 && i.propensity <= 1,
      ),
    ).toBe(true);
    const cands = (
      await db.query<{
        content_id: string;
        selected: boolean;
        contributions: Record<string, number>;
      }>(
        `select content_id, selected, contributions from recommendation_candidates where recommendation_id=$1`,
        [feed.recommendationId],
      )
    ).rows;
    expect(cands.length).toBe(rec.candidate_count);
    expect(
      cands
        .filter((c) => c.selected)
        .map((c) => c.content_id)
        .sort(),
    ).toEqual(items.map((i) => i.content_id).sort());
    expect(Object.keys(cands[0]!.contributions)).toContain('learning_need');
  });

  it('outcome events are attributable to (recommendation, content); other users cannot hijack attribution', async () => {
    const feed = await getFeed(sql, { userId: user, limit: 10, now: T0, seed: 1 });
    const q = feed.items.find((i) => i.type === 'question')!;
    const note = feed.items.find((i) => i.type === 'note')!;
    await recordEvents(
      sql,
      user,
      [
        {
          name: 'feed_impression',
          payload: {
            content_id: note.contentId,
            recommendation_id: feed.recommendationId,
            position: 0,
          },
        },
        {
          name: 'like',
          payload: { content_id: note.contentId, recommendation_id: feed.recommendationId },
        },
        {
          name: 'save',
          payload: { content_id: note.contentId, recommendation_id: feed.recommendationId },
        },
      ],
      T0,
    );
    await submitAnswer(sql, {
      userId: user,
      questionId: q.contentId,
      response: { optionId: 'zzz', value: 0 },
      recommendationId: feed.recommendationId!,
      now: T0,
    });
    const thief = await createUser(db, 'thief@x.io');
    await recordEvents(
      sql,
      thief,
      [
        {
          name: 'like',
          payload: { content_id: note.contentId, recommendation_id: feed.recommendationId },
        },
      ],
      T0,
    );

    const out = (
      await db.query<{
        content_id: string;
        impressions: number;
        likes: number;
        saves: number;
        answered: number;
        incorrect: number;
        decision: string;
      }>(
        `select content_id, impressions::int, likes::int, saves::int, answered::int, incorrect::int, decision from recommendation_outcomes where recommendation_id=$1`,
        [feed.recommendationId],
      )
    ).rows;
    const n = out.find((o) => o.content_id === note.contentId)!;
    expect([n.impressions, n.likes, n.saves]).toEqual([1, 1, 1]); // the thief's like is NOT counted
    const qq = out.find((o) => o.content_id === q.contentId)!;
    expect([qq.answered, qq.incorrect]).toEqual([1, 1]);
    expect(out).toHaveLength(feed.items.length);
  });

  it('logs are staff-only: learners cannot read recommendations, candidates, items or outcomes', async () => {
    await getFeed(sql, { userId: user, limit: 3, now: T0, seed: 1 });
    const a = new Actor(db, user);
    for (const t of [
      'recommendations',
      'recommendation_items',
      'recommendation_candidates',
      'recommendation_outcomes',
    ])
      expect(await a.q(`select * from ${t}`), t).toEqual([]);
    const staff = new Actor(db, await createUser(db, 'an@x.io'));
    await grantRole(db, staff.id!, 'analytics_worker');
    expect((await staff.q(`select * from recommendation_outcomes`)).length).toBeGreaterThan(0);
    expect((await staff.q(`select * from recommendation_candidates`)).length).toBeGreaterThan(0);
  });

  it('the log tables are indexed for the access paths trainers/analysts use', async () => {
    const idx = (
      await db.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname='public' and tablename in ('recommendations','recommendation_candidates','recommendation_items','events')`,
      )
    ).rows.map((r) => r.indexname);
    for (const i of [
      'recommendations_version_idx',
      'recommendations_experiment_idx',
      'recommendation_candidates_content_idx',
      'recommendation_items_content_idx',
      'events_recommendation_idx',
      'events_content_idx',
    ])
      expect(idx).toContain(i);
  });
});
