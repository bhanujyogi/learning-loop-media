import { clamp01 } from '@learning-loop/shared';

/** Elo-style item difficulty + learner ability on 0..1 scale (docs/LEARNER_MODEL.md). */
export const DIFFICULTY_ALGORITHM_VERSION = 'difficulty_v1';

export function expectedCorrect(ability: number, difficulty: number): number {
  // logistic on the difference, scaled so 0.5 diff → ~0.73
  return 1 / (1 + Math.exp(-6 * (ability - difficulty)));
}

export function updateItemDifficulty(
  difficulty: number,
  ability: number,
  correct: boolean,
  attempts: number,
): number {
  const k = Math.max(0.01, 0.15 / Math.sqrt(1 + attempts / 10));
  const delta = k * ((correct ? 1 : 0) - expectedCorrect(ability, difficulty));
  return clamp01(difficulty - delta); // learners succeed more than expected → easier
}

export function updateLearnerAbility(
  ability: number,
  difficulty: number,
  correct: boolean,
  k = 0.08,
): number {
  return clamp01(ability + k * ((correct ? 1 : 0) - expectedCorrect(ability, difficulty)));
}

export interface DifficultyPreference {
  /** Preferred difficulty centre (0..1) – "challenging but not frustrating". */
  target: number;
  frustration: number; // 0..1 EMA of abandon/hint/failure
}

/**
 * Challenge-zone target: slightly above ability when the learner is not frustrated,
 * easing back when frustration signals accumulate. Never simply optimises toward easy.
 */
export function targetDifficulty(ability: number, frustration: number): number {
  const stretch = 0.12 * (1 - clamp01(frustration));
  return clamp01(ability + stretch - 0.1 * clamp01(frustration));
}

/** How well an item's difficulty fits the target (1 = perfect). */
export function difficultyFit(itemDifficulty: number, target: number): number {
  const d = Math.abs(itemDifficulty - target);
  return clamp01(1 - d / 0.5);
}

export interface InteractionOutcome {
  correct?: boolean;
  hintsUsed?: number;
  retries?: number;
  abandoned?: boolean;
}

export function updateFrustration(prev: number, o: InteractionOutcome, alpha = 0.2): number {
  const signal = clamp01(
    (o.abandoned ? 0.8 : 0) +
      (o.correct === false ? 0.35 : 0) +
      Math.min(0.3, (o.hintsUsed ?? 0) * 0.1) +
      Math.min(0.3, (o.retries ?? 0) * 0.1),
  );
  return clamp01((1 - alpha) * prev + alpha * signal);
}
