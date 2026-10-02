import type { RankingConfig, RankingWeights } from '@learning-loop/config';
import { clamp01 } from '@learning-loop/shared';
import { targetDifficultyFor } from './difficulty-bridge.ts';
import { effective, examPressure, uncertainty } from './features.ts';
import type { Candidate, Contribution, LearnerFeatures, ScoredCandidate } from './types.ts';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5);

export type FeatureValues = Record<keyof RankingWeights, number>;

/** Weights adjusted for exam proximity: pressure is a ranking feature, not an override. */
export function adjustWeights(w: RankingWeights, pressure: number): RankingWeights {
  return {
    ...w,
    learning_need: w.learning_need * (1 + 1.0 * pressure),
    exploration: w.exploration * (1 - 0.7 * pressure),
    novelty: w.novelty * (1 - 0.4 * pressure),
  };
}

export function conceptNeed(c: Candidate, f: LearnerFeatures): number {
  const needs = c.conceptIds.map((id) => f.conceptNeed[id] ?? 0);
  const due = c.conceptIds.some((id) => f.dueConceptIds.includes(id)) ? 0.35 : 0;
  const exam = Math.max(0, ...c.conceptIds.map((id) => f.examRelevance[id] ?? 0)) * 0.2;
  return clamp01(Math.max(0, ...needs) + due + exam);
}

export function featureValues(c: Candidate, f: LearnerFeatures): FeatureValues {
  const subj = effective(f.subject[c.subjectId]);
  const fmt = effective(f.format[c.format]);
  const hook = c.hook ? effective(f.hook[c.hook]) : 0.5;
  const creator = effective(f.creator[c.creatorId]);
  const followed = f.followedCreatorIds.includes(c.creatorId) ? 1 : 0;

  // Model A — engagement
  const predicted_engagement = clamp01(
    mean([subj, fmt, hook, creator]) *
      (1 - 0.4 * f.sessionFatigue * (c.difficulty > 0.6 ? 1 : 0.3)),
  );

  // Model B — learning response: per-learner format/hook learning + platform-level content stat
  const fl = effective(f.formatLearning[c.format]);
  const hl = c.hook ? effective(f.hookLearning[c.hook]) : 0.5;
  const stat = c.learningGainStat ?? 0.5;
  const predicted_learning_gain = clamp01(0.4 * fl + 0.2 * hl + 0.4 * stat);

  const tgt = targetDifficultyFor(f);
  const difficulty_fit = clamp01(1 - Math.abs(c.difficulty - tgt) / 0.5);

  const noveltyUnseen = f.seenContentIds.includes(c.contentId) ? 0 : 1;
  const unseenDims =
    (f.format[c.format] ? 0 : 1) +
    (c.hook && !f.hook[c.hook] ? 1 : 0) +
    (f.creator[c.creatorId] ? 0 : 1);
  const fresh = Math.exp(-c.ageHours / (24 * 14));
  const novelty = clamp01(0.5 * noveltyUnseen + 0.3 * (unseenDims / 3) + 0.2 * fresh);

  const exploration = clamp01(
    mean([
      uncertainty(f.subject[c.subjectId]),
      uncertainty(f.format[c.format]),
      c.hook ? uncertainty(f.hook[c.hook]) : 0.5,
      uncertainty(f.creator[c.creatorId]),
    ]),
  );

  return {
    predicted_engagement,
    predicted_learning_gain,
    learning_need: conceptNeed(c, f),
    personal_interest: clamp01(0.7 * subj + 0.3 * creator + 0.2 * followed),
    hook_affinity: hook,
    difficulty_fit,
    content_quality: clamp01(c.quality),
    novelty,
    social_signal: clamp01(0.6 * c.socialSignal + 0.4 * followed),
    exploration,
  };
}

const countIn = (arr: string[], v: string) => arr.filter((x) => x === v).length;

export function repetitionPenalties(
  c: Candidate,
  f: LearnerFeatures,
  cfg: RankingConfig,
  isReview: boolean,
): Contribution[] {
  if (isReview) return []; // deliberate review is never penalised
  const p = cfg.repetition;
  const rec = f.recent;
  const mk = (feature: string, n: number, w: number): Contribution => ({
    feature,
    value: Math.min(1, n / 3),
    weight: -w,
    contribution: -w * Math.min(1, n / 3),
  });
  const out = [
    mk('recent_content', countIn(rec.contentIds, c.contentId), p.content),
    mk(
      'recent_concept',
      c.conceptIds.reduce((a, id) => a + countIn(rec.conceptIds, id), 0),
      p.concept,
    ),
    mk('recent_creator', countIn(rec.creatorIds, c.creatorId), p.creator),
    mk('recent_hook', c.hook ? countIn(rec.hooks, c.hook) : 0, p.hook),
    mk('recent_format', countIn(rec.formats, c.format), p.format),
  ];
  return out.filter((x) => x.contribution !== 0);
}

/** A deliberate resurfacing: due review, or a concept the learner is failing. */
export function isDeliberateReview(c: Candidate, f: LearnerFeatures): boolean {
  return (
    c.sources.includes('review_due') ||
    c.conceptIds.some((id) => f.dueConceptIds.includes(id)) ||
    c.conceptIds.some((id) => (f.conceptNeed[id] ?? 0) >= 0.7)
  );
}

export function scoreCandidate(
  c: Candidate,
  f: LearnerFeatures,
  cfg: RankingConfig,
  now: number,
): ScoredCandidate {
  const pressure = examPressure(f.examDate, now);
  const weights = adjustWeights(cfg.weights, pressure);
  const values = featureValues(c, f);
  const contributions: Contribution[] = (Object.keys(weights) as (keyof RankingWeights)[]).map(
    (k) => ({
      feature: k,
      value: values[k],
      weight: weights[k],
      contribution: weights[k] * values[k],
    }),
  );
  const isReview = isDeliberateReview(c, f);
  const penalties = repetitionPenalties(c, f, cfg, isReview);
  const score =
    contributions.reduce((a, x) => a + x.contribution, 0) +
    penalties.reduce((a, x) => a + x.contribution, 0);
  return {
    candidate: c,
    score,
    contributions,
    penalties,
    isExploration: c.sources.includes('exploration'),
    isReview,
  };
}
