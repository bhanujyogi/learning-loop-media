import type { RankingConfig } from '@learning-loop/config';
import { examPressure } from './features.ts';
import { scoreCandidate } from './scoring.ts';
import { sequenceBatch } from './sequence.ts';
import type {
  Candidate,
  CandidateLog,
  Exclusion,
  FeedResult,
  LearnerFeatures,
  RankedItem,
  ScoredCandidate,
} from './types.ts';

/** Deterministic PRNG so ranking is reproducible from (seed) for debugging. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function filterEligible(
  pool: Candidate[],
  f: LearnerFeatures,
): { eligible: Candidate[]; excluded: Exclusion[] } {
  const excluded: Exclusion[] = [];
  const eligible: Candidate[] = [];
  const seenInPool = new Set<string>();
  for (const c of pool) {
    const ex = (reason: Exclusion['reason']) => excluded.push({ contentId: c.contentId, reason });
    if (seenInPool.has(c.contentId)) {
      ex('duplicate_in_pool');
      continue;
    }
    seenInPool.add(c.contentId);
    if (!c.published) ex('not_published');
    else if (!c.moderationOk) ex('moderation');
    else if (c.freshness === 'outdated' || c.freshness === 'archived') ex('outdated');
    else if (f.blockedCreatorIds.includes(c.creatorId)) ex('blocked_creator');
    else if (
      f.seenContentIds.includes(c.contentId) &&
      !c.sources.includes('review_due') // deliberate review may resurface
    )
      ex('already_seen');
    else eligible.push(c);
  }
  return { eligible, excluded };
}

/** Greedy selection with diversity constraints and a reserved exploration share. */
export function selectBatch(
  scored: ScoredCandidate[],
  cfg: RankingConfig,
  rng: () => number,
  /** Optional sink: records how each chosen candidate was selected (decision + propensity) for logging. */
  decisions?: Map<ScoredCandidate, { decision: 'exploit' | 'explore'; propensity: number }>,
): ScoredCandidate[] {
  const size = cfg.batchSize;
  const explorationSlots = Math.round(size * cfg.explorationRatio);
  const chosen: ScoredCandidate[] = [];
  const counts = {
    creator: new Map<string, number>(),
    subject: new Map<string, number>(),
    format: new Map<string, number>(),
  };
  const fits = (s: ScoredCandidate, relax: boolean) => {
    const c = s.candidate;
    const lim = cfg.diversity;
    const r = relax ? 2 : 1;
    return (
      (counts.creator.get(c.creatorId) ?? 0) < lim.maxPerCreator * r &&
      (counts.subject.get(c.subjectId) ?? 0) < lim.maxPerSubject * r &&
      (counts.format.get(c.format) ?? 0) < lim.maxPerFormat * r
    );
  };
  const take = (s: ScoredCandidate) => {
    chosen.push(s);
    const c = s.candidate;
    counts.creator.set(c.creatorId, (counts.creator.get(c.creatorId) ?? 0) + 1);
    counts.subject.set(c.subjectId, (counts.subject.get(c.subjectId) ?? 0) + 1);
    counts.format.set(c.format, (counts.format.get(c.format) ?? 0) + 1);
  };

  const byScore = [...scored].sort(
    (a, b) => b.score - a.score || a.candidate.contentId.localeCompare(b.candidate.contentId),
  );
  const explorers = byScore.filter((s) => s.isExploration);
  // Exploration slots: sample (not just top) from exploration candidates → discovery with randomness.
  const pool = [...explorers];
  while (chosen.length < explorationSlots && pool.length) {
    const top = pool.slice(0, Math.max(3, Math.ceil(pool.length / 2)));
    const pick = top[Math.floor(rng() * top.length)]!;
    pool.splice(pool.indexOf(pick), 1);
    if (fits(pick, false)) {
      take(pick);
      decisions?.set(pick, { decision: 'explore', propensity: 1 / top.length });
    }
  }
  for (const relax of [false, true]) {
    for (const s of byScore) {
      if (chosen.length >= size) break;
      if (chosen.includes(s)) continue;
      if (fits(s, relax)) {
        take(s);
        decisions?.set(s, { decision: 'exploit', propensity: 1 });
      }
    }
  }
  return chosen;
}

const whyShown = (s: ScoredCandidate): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const c of [...s.contributions, ...s.penalties])
    out[c.feature] = Math.round(c.contribution * 1000) / 1000;
  if (s.isReview) out['deliberate_review'] = 1;
  if (s.isExploration) out['exploration_slot'] = 1;
  return out;
};

export interface RankOptions {
  now: number;
  /** seed for exploration sampling; store with diagnostics to reproduce */
  seed?: number;
}

/**
 * Feed request core (docs/FEED_RANKING.md §pipeline):
 * eligibility → score → repetition penalties → diversity → exploration → sequencing → diagnostics.
 * Pure and deterministic given (features, pool, config, seed).
 */
/** Max scored candidates persisted per request (top by score) — bounded log volume; every selected item is always included. */
export const CANDIDATE_LOG_LIMIT = 50;

export function rankFeed(
  pool: Candidate[],
  f: LearnerFeatures,
  cfg: RankingConfig,
  opts: RankOptions,
): FeedResult {
  const { eligible, excluded } = filterEligible(pool, f);
  const scored = eligible.map((c) => scoreCandidate(c, f, cfg, opts.now));
  const decisions = new Map<
    ScoredCandidate,
    { decision: 'exploit' | 'explore'; propensity: number }
  >();
  const seed = opts.seed ?? 1;
  const batch = selectBatch(scored, cfg, mulberry32(seed), decisions);
  const sequenced = sequenceBatch(batch);
  const items: RankedItem[] = sequenced.map((s, i) => {
    const d = decisions.get(s) ?? { decision: 'exploit' as const, propensity: 1 };
    return {
      contentId: s.candidate.contentId,
      position: i,
      score: Math.round(s.score * 1000) / 1000,
      isExploration: s.isExploration,
      whyShown: whyShown(s),
      sources: s.candidate.sources,
      decision: d.decision,
      propensity: d.propensity,
    };
  });
  const chosenIds = new Set(items.map((i) => i.contentId));
  const ranked = [...scored].sort(
    (a, b) => b.score - a.score || a.candidate.contentId.localeCompare(b.candidate.contentId),
  );
  const candidates: CandidateLog[] = ranked
    .map((s, rank) => ({ s, rank }))
    .filter(({ s, rank }) => rank < CANDIDATE_LOG_LIMIT || chosenIds.has(s.candidate.contentId))
    .map(({ s, rank }) => ({
      contentId: s.candidate.contentId,
      rank,
      score: Math.round(s.score * 1000) / 1000,
      sources: s.candidate.sources,
      isExploration: s.isExploration,
      selected: chosenIds.has(s.candidate.contentId),
      contributions: whyShown(s),
    }));
  return {
    rankingVersion: cfg.version,
    items,
    excluded,
    diagnostics: {
      candidatePool: pool.length,
      eligible: eligible.length,
      explorationCount: items.filter((i) => i.isExploration).length,
      examPressure: examPressure(f.examDate, opts.now),
    },
    candidates,
    policy: {
      selection: 'greedy_diverse+sampled_exploration',
      explorationRatio: cfg.explorationRatio,
      explorationSlots: Math.round(cfg.batchSize * cfg.explorationRatio),
      batchSize: cfg.batchSize,
      seed,
    },
  };
}
