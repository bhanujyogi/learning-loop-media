import { clamp01 } from '@learning-loop/shared';

/**
 * Concept mastery is an ESTIMATE with confidence, not a truth (docs/LEARNER_MODEL.md).
 * Model: Beta-like pseudo-counts with evidence weighting + exponential recency decay.
 * `ALGORITHM_VERSION` is stored with every persisted row so changes are never silent.
 */
export const MASTERY_ALGORITHM_VERSION = 'mastery_v1';

export interface MasteryState {
  /** Weighted pseudo-counts of success/failure evidence (prior included). */
  alpha: number;
  beta: number;
  exposures: number;
  correct: number;
  incorrect: number;
  /** Consecutive incorrect answers on this concept. */
  mistakeStreak: number;
  /** Total times a mistake was repeated after a previous mistake. */
  repeatedMistakes: number;
  lastEvidenceAt: number | null; // epoch ms
}

export type EvidenceKind =
  | 'exposure' // saw it, no assessment
  | 'answer' // answered a question
  | 'delayed_recall' // answered correctly after a gap (strong evidence)
  | 'review';

export interface Evidence {
  kind: EvidenceKind;
  correct?: boolean;
  /** 0..1 question difficulty; harder correct answers weigh more. */
  difficulty?: number;
  hintsUsed?: number;
  /** self-reported 0..1 confidence if captured */
  confidence?: number;
  at: number;
}

export const MASTERY_PRIOR = { alpha: 1, beta: 1 } as const;
/** Half-life of evidence, in days. Older evidence counts less (stale knowledge). */
export const EVIDENCE_HALF_LIFE_DAYS = 45;

export const newMasteryState = (): MasteryState => ({
  alpha: MASTERY_PRIOR.alpha,
  beta: MASTERY_PRIOR.beta,
  exposures: 0,
  correct: 0,
  incorrect: 0,
  mistakeStreak: 0,
  repeatedMistakes: 0,
  lastEvidenceAt: null,
});

const DAY = 86_400_000;

/** Decay pseudo-counts toward the prior as time passes without evidence. */
export function decay(state: MasteryState, now: number): MasteryState {
  if (state.lastEvidenceAt == null) return state;
  const days = Math.max(0, (now - state.lastEvidenceAt) / DAY);
  const f = Math.pow(0.5, days / EVIDENCE_HALF_LIFE_DAYS);
  return {
    ...state,
    alpha: MASTERY_PRIOR.alpha + (state.alpha - MASTERY_PRIOR.alpha) * f,
    beta: MASTERY_PRIOR.beta + (state.beta - MASTERY_PRIOR.beta) * f,
  };
}

/** Weight of one piece of evidence. Transparent and testable. */
export function evidenceWeight(e: Evidence): number {
  let w = 1;
  if (e.kind === 'delayed_recall') w = 2;
  else if (e.kind === 'review') w = 1.25;
  const diff = e.difficulty ?? 0.5;
  // Correct on hard = more informative; incorrect on easy = more informative.
  w *= e.correct ? 0.75 + 0.5 * diff : 1.25 - 0.5 * diff;
  // Hints reduce the evidence of true mastery from a correct answer.
  if (e.correct && e.hintsUsed) w *= Math.max(0.25, 1 - 0.3 * e.hintsUsed);
  return w;
}

export function applyEvidence(prev: MasteryState, e: Evidence): MasteryState {
  const s = decay(prev, e.at);
  if (e.kind === 'exposure') {
    return { ...s, exposures: s.exposures + 1, lastEvidenceAt: e.at };
  }
  const w = evidenceWeight(e);
  const correct = !!e.correct;
  const repeated = !correct && s.mistakeStreak >= 1;
  // Confidently-wrong answers are a misconception signal: extra failure weight.
  const overconfident = !correct && (e.confidence ?? 0) > 0.7 ? 1.25 : 1;
  return {
    ...s,
    alpha: s.alpha + (correct ? w : 0),
    beta: s.beta + (correct ? 0 : w * (repeated ? 1.5 : 1) * overconfident),
    exposures: s.exposures + 1,
    correct: s.correct + (correct ? 1 : 0),
    incorrect: s.incorrect + (correct ? 0 : 1),
    mistakeStreak: correct ? 0 : s.mistakeStreak + 1,
    repeatedMistakes: s.repeatedMistakes + (repeated ? 1 : 0),
    lastEvidenceAt: e.at,
  };
}

export interface MasteryEstimate {
  mastery: number; // posterior mean 0..1
  confidence: number; // 0..1, grows with evidence amount
  uncertainty: number; // posterior std-dev
}

export function estimate(state: MasteryState, now: number): MasteryEstimate {
  const s = decay(state, now);
  const n = s.alpha + s.beta;
  const mean = s.alpha / n;
  const variance = (s.alpha * s.beta) / (n * n * (n + 1));
  // Evidence beyond the prior (2 pseudo-counts) → confidence saturating near 1.
  const effective = Math.max(0, n - (MASTERY_PRIOR.alpha + MASTERY_PRIOR.beta));
  return {
    mastery: clamp01(mean),
    confidence: clamp01(1 - Math.exp(-effective / 4)),
    uncertainty: Math.sqrt(variance),
  };
}

export type KnowledgeLevel =
  'unseen' | 'exposed' | 'familiar' | 'mastered' | 'weak' | 'uncertain' | 'stale';

/** Distinguishes exposure / familiarity / demonstrated mastery / weakness / staleness. */
export function classify(state: MasteryState, now: number): KnowledgeLevel {
  if (state.exposures === 0) return 'unseen';
  const assessed = state.correct + state.incorrect;
  if (assessed === 0) return 'exposed';
  const fresh = estimate(state, now);
  const raw = estimate({ ...state, lastEvidenceAt: now }, now); // un-decayed view
  if (raw.mastery >= 0.7 && fresh.mastery < raw.mastery - 0.1) return 'stale';
  if (fresh.confidence < 0.35) return 'uncertain';
  if (fresh.mastery >= 0.75) return 'mastered';
  if (fresh.mastery < 0.45 || state.mistakeStreak >= 2) return 'weak';
  return 'familiar';
}
