import { createHash } from 'node:crypto';
import { getRankingConfig, RANKING_V1, type RankingConfig } from '@learning-loop/config';
import type { FormatType, HookType } from '@learning-loop/shared';
import {
  effective,
  rankFeed,
  recordImpression,
  type Candidate,
  type CandidateSource,
  type SequenceRole,
} from '@learning-loop/recommendation-engine';
import { asUser, ts, type Sql } from '../sql';
import { loadFeatures, saveFeatures } from './features-store';

export interface FeedRequest {
  userId: string;
  limit?: number;
  now?: number;
  seed?: number;
}
export interface FeedItem {
  contentId: string;
  type: string;
  title: string;
  format: string | null;
  hook: string | null;
  difficulty: number | null;
  /** Public body only: question answer keys/explanations are never included. */
  body: unknown;
  position: number;
  recommendationId: string;
  isExploration: boolean;
}
export interface FeedResponse {
  recommendationId: string | null;
  rankingVersion: string;
  items: FeedItem[];
  exhausted: boolean;
}

interface Row {
  id: string;
  type: string;
  title: string;
  format: FormatType | null;
  hook: HookType | null;
  difficulty: number | null;
  creator: string;
  freshness: Candidate['freshness'];
  moderation: string;
  age_hours: number | null;
  quality: number | null;
  learning_gain: number | null;
  likes: number;
  subject: string | null;
  concepts: string[] | null;
  ownership: string;
  body: unknown;
}

const FEEDABLE = `('video','note','question','flashcard','interactive','lesson','image','audio')`;
const BASE = `
  select c.id, c.type::text as type, c.title, c.format::text as format, c.hook::text as hook, c.difficulty, coalesce(c.owner_user_id::text, c.owner_org_id::text) as creator,
         c.freshness::text as freshness, c.moderation::text as moderation, extract(epoch from (now() - c.published_at)) / 3600.0 as age_hours,
         st.quality_score as quality, st.learning_gain, coalesce(st.like_count, 0)::int as likes, c.ownership::text as ownership, v.body,
         (select s.id::text from content_concepts cc join concepts co on co.id = cc.concept_id join topics t on t.id = co.topic_id
            join chapters ch on ch.id = t.chapter_id join subjects s on s.id = ch.subject_id where cc.content_id = c.id order by cc.role limit 1) as subject,
         (select array_agg(concept_id::text) from content_concepts where content_id = c.id) as concepts
    from content_items c
    join content_versions v on v.id = c.current_version_id
    left join content_stats st on st.content_id = c.id
   where c.publishing = 'published' and c.deleted_at is null and c.type::text in ${FEEDABLE}
     and c.moderation in ('none','cleared','pending_review') and c.freshness in ('current','needs_review')
     and not (c.owner_user_id is not null and app.is_blocked_between($1, c.owner_user_id))`;

const roleOf = (r: Row, review: boolean): SequenceRole | undefined => {
  if (review) return 'review';
  if (r.type === 'question' || r.format === 'challenge') return 'challenge';
  if (r.type === 'interactive') return 'application';
  if (r.type === 'note') return 'explanation';
  if (r.type === 'video') return 'introduction';
  return undefined;
};

/** Deterministic experiment bucketing (stable per user+experiment). */
export const bucket = (userId: string, key: string): number =>
  parseInt(createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 8), 16) /
  0xffffffff;

export async function resolveRanking(
  sql: Sql,
  userId: string,
): Promise<{ config: RankingConfig; experimentId: string | null; variant: string | null }> {
  const exps = await sql.query<{
    id: string;
    key: string;
    variants: { name: string; weight: number; ranking_version?: string }[];
  }>(
    `select id, key, variants from experiments where status = 'running' and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) order by created_at limit 5`,
  );
  for (const e of exps) {
    if (!e.variants.some((v) => v.ranking_version)) continue;
    let a = (
      await sql.query<{ variant: string }>(
        `select variant from experiment_assignments where experiment_id = $1 and user_id = $2`,
        [e.id, userId],
      )
    )[0]?.variant;
    if (!a) {
      const total = e.variants.reduce((s, v) => s + v.weight, 0);
      let x = bucket(userId, e.key) * total;
      a = e.variants[e.variants.length - 1]!.name;
      for (const v of e.variants) {
        if (x < v.weight) {
          a = v.name;
          break;
        }
        x -= v.weight;
      }
      await sql.query(
        `insert into experiment_assignments(experiment_id, user_id, variant) values ($1,$2,$3) on conflict do nothing`,
        [e.id, userId, a],
      );
    }
    const rv = e.variants.find((v) => v.name === a)?.ranking_version;
    if (rv) {
      try {
        return { config: getRankingConfig(rv), experimentId: e.id, variant: a };
      } catch {
        /* unknown version: fall through */
      }
    }
  }
  const active = (
    await sql.query<{ version: string }>(
      `select version from ranking_versions where status = 'active' limit 1`,
    )
  )[0]?.version;
  try {
    return {
      config: active ? getRankingConfig(active) : RANKING_V1,
      experimentId: null,
      variant: null,
    };
  } catch {
    return { config: RANKING_V1, experimentId: null, variant: null };
  }
}

/**
 * Feed request pipeline (docs/FEED_RANKING.md): identify learner → load features → multi-source candidate pool →
 * eligibility → score → repetition/diversity/exploration → sequence → persist diagnostics → return client-safe items.
 * Candidate queries are bounded; nothing here scans the full catalogue.
 */
export async function getFeed(sql: Sql, req: FeedRequest): Promise<FeedResponse> {
  return asUser(sql, req.userId, (tx) => getFeedInTx(tx, req));
}

async function getFeedInTx(sql: Sql, req: FeedRequest): Promise<FeedResponse> {
  const now = req.now ?? Date.now();
  const { config, experimentId, variant } = await resolveRanking(sql, req.userId);
  // `limit` comes from an HTTP query string: coerce defensively (NaN/negative/huge → bounded; default = ranking batch size)
  const requested = Number(req.limit);
  const cfg: RankingConfig =
    Number.isFinite(requested) && requested >= 1
      ? { ...config, batchSize: Math.min(30, Math.floor(requested)) }
      : config;
  let f = await loadFeatures(sql, req.userId);

  const pool = new Map<string, { row: Row; sources: Set<CandidateSource> }>();
  const add = (rows: Row[], source: CandidateSource) => {
    for (const r of rows) {
      const e = pool.get(r.id);
      if (e) e.sources.add(source);
      else pool.set(r.id, { row: r, sources: new Set([source]) });
    }
  };
  const seen = f.seenContentIds.slice(-500);
  const notSeen = `and c.id <> all($2::uuid[])`;
  const q = (
    extra: string,
    params: unknown[],
    order = 'c.published_at desc',
    limit = 40,
    withSeen = true,
  ) =>
    sql.query<Row>(`${BASE} ${withSeen ? notSeen : ''} ${extra} order by ${order} limit ${limit}`, [
      req.userId,
      seen,
      ...params,
    ]);

  const needIds = Object.entries(f.conceptNeed)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([id]) => id);
  if (needIds.length)
    add(
      await q(
        `and exists (select 1 from content_concepts x where x.content_id = c.id and x.concept_id = any($3::uuid[]))`,
        [needIds],
      ),
      'weak_concept',
    );
  const due = await sql.query<Row>(
    `${BASE} and exists (select 1 from review_items ri where ri.content_id = c.id and ri.user_id = $1 and ri.due_at <= ${ts(2)}) limit 20`,
    [req.userId, now],
  );
  add(due, 'review_due');
  const exam = (
    await sql.query<{ exam_id: string | null }>(
      `select exam_id from learner_profiles where user_id = $1`,
      [req.userId],
    )
  )[0]?.exam_id;
  if (exam)
    add(
      await q(
        `and exists (select 1 from content_exams x where x.content_id = c.id and x.exam_id = $3)`,
        [exam],
        'c.difficulty nulls last, c.published_at desc',
        30,
      ),
      'exam_requirement',
    );
  const liked = Object.entries(f.subject)
    .filter(([, a]) => effective(a) > 0.55)
    .map(([id]) => id);
  if (liked.length)
    add(
      await q(
        `and exists (select 1 from content_concepts x join concepts co on co.id = x.concept_id join topics t on t.id = co.topic_id join chapters ch on ch.id = t.chapter_id where x.content_id = c.id and ch.subject_id = any($3::uuid[]))`,
        [liked],
      ),
      'interest',
    );
  if (f.followedCreatorIds.length)
    add(
      await q(
        `and coalesce(c.owner_user_id::text, c.owner_org_id::text) = any($3::text[])`,
        [f.followedCreatorIds],
        'c.published_at desc',
        30,
      ),
      'followed_creator',
    );
  // saved_topic: other content on concepts the learner has saved
  add(
    await q(
      `and exists (select 1 from content_concepts x where x.content_id = c.id and x.concept_id in
         (select cc.concept_id from saves sv join content_concepts cc on cc.content_id = sv.content_id where sv.user_id = $1))`,
      [],
    ),
    'saved_topic',
  );
  // adjacent_concept: unseen concepts whose prerequisites are all reasonably mastered ("next up")
  add(
    await q(
      `and exists (select 1 from content_concepts x join concept_prerequisites p on p.concept_id = x.concept_id
          where x.content_id = c.id
            and not exists (select 1 from concept_mastery m where m.user_id = $1 and m.concept_id = x.concept_id)
            and not exists (select 1 from concept_prerequisites p2 left join concept_mastery m2 on m2.user_id = $1 and m2.concept_id = p2.prerequisite_id
                             where p2.concept_id = x.concept_id and (m2.concept_id is null or m2.alpha / (m2.alpha + m2.beta) < 0.65)))`,
      [],
      'c.difficulty nulls last, c.published_at desc',
      25,
    ),
    'adjacent_concept',
  );
  // challenge: a stretch above current ability
  add(
    await q(
      `and c.difficulty >= $3`,
      [Math.min(1, f.ability + 0.15)],
      'c.difficulty, c.published_at desc',
      20,
    ),
    'challenge',
  );
  // related: explicit relation edges from recently shown content
  const recentIds = f.recent.contentIds.slice(-10);
  if (recentIds.length)
    add(
      await q(
        `and exists (select 1 from content_relations r where r.to_content_id = c.id and r.from_content_id = any($3::uuid[]))`,
        [recentIds],
      ),
      'related',
    );
  add(
    await q(`and c.published_at > now() - interval '7 days'`, [], 'c.published_at desc', 30),
    'new_content',
  );
  add(
    await q(`and coalesce(st.quality_score, 0) >= 0.7`, [], 'st.quality_score desc nulls last', 20),
    'high_quality',
  );
  const seed = String(req.seed ?? now);
  add(await q('', [seed], `md5(c.id::text || $3)`, 25), 'exploration');

  const candidates: Candidate[] = [...pool.values()].map(({ row: r, sources }) => ({
    contentId: r.id,
    conceptIds: r.concepts ?? [],
    subjectId: r.subject ?? 'unknown',
    creatorId: r.creator,
    format: (r.format ?? (r.type === 'question' ? 'question' : 'note')) as FormatType,
    hook: r.hook,
    difficulty: r.difficulty ?? 0.5,
    quality: r.quality ?? (r.ownership === 'official' ? 0.7 : 0.5),
    socialSignal: Math.min(1, r.likes / 50),
    learningGainStat: r.learning_gain,
    ageHours: r.age_hours ?? 24 * 30,
    sources: [...sources],
    role: roleOf(r, sources.has('review_due')),
    published: true,
    moderationOk: ['none', 'cleared', 'pending_review'].includes(r.moderation),
    freshness: r.freshness,
  }));

  // add due concept ids (cheap) so ranking treats due reviews as deliberate resurfacing
  const dueConcepts = await sql.query<{ concept_id: string }>(
    `select distinct concept_id from review_items where user_id = $1 and concept_id is not null and due_at <= ${ts(2)} limit 200`,
    [req.userId, now],
  );
  f = { ...f, dueConceptIds: dueConcepts.map((d) => d.concept_id) };

  const result = rankFeed(candidates, f, cfg, { now, seed: req.seed ?? now % 2_147_483_647 });
  if (!result.items.length)
    return {
      recommendationId: null,
      rankingVersion: result.rankingVersion,
      items: [],
      exhausted: true,
    };

  const rec = (
    await sql.query<{ id: string }>(
      `insert into recommendations(user_id, ranking_version, experiment_id, variant, seed, diagnostics) values ($1,$2,$3,$4,$5,$6::jsonb) returning id`,
      [
        req.userId,
        result.rankingVersion,
        experimentId,
        variant,
        req.seed ?? now,
        JSON.stringify({ ...result.diagnostics, excluded: result.excluded.slice(0, 50) }),
      ],
    )
  )[0]!.id;
  const byId = new Map(candidates.map((c) => [c.contentId, c]));
  const rows = new Map([...pool.values()].map((p) => [p.row.id, p.row]));
  const items: FeedItem[] = [];
  for (const it of result.items) {
    await sql.query(
      `insert into recommendation_items(recommendation_id, content_id, position, score, is_exploration, sources, why_shown) values ($1,$2,$3,$4,$5,$6::text[],$7::jsonb)`,
      [
        rec,
        it.contentId,
        it.position,
        it.score,
        it.isExploration,
        it.sources,
        JSON.stringify(it.whyShown),
      ],
    );
    const r = rows.get(it.contentId)!;
    const c = byId.get(it.contentId)!;
    f = recordImpression(f, {
      contentId: c.contentId,
      conceptIds: c.conceptIds,
      creatorId: c.creatorId,
      hook: c.hook,
      format: c.format,
    });
    items.push({
      contentId: r.id,
      type: r.type,
      title: r.title,
      format: r.format,
      hook: r.hook,
      difficulty: r.difficulty,
      body: r.body,
      position: it.position,
      recommendationId: rec,
      isExploration: it.isExploration,
    });
  }
  await saveFeatures(sql, f);
  return {
    recommendationId: rec,
    rankingVersion: result.rankingVersion,
    items,
    exhausted: items.length < cfg.batchSize,
  };
}
