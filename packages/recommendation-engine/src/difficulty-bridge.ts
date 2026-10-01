import type { LearnerFeatures } from './types';

/** Same formula as learning-engine targetDifficulty (kept local to avoid a package cycle; tested for parity). */
export function targetDifficultyFor(f: Pick<LearnerFeatures, 'ability' | 'frustration'>): number {
  const fr = Math.max(0, Math.min(1, f.frustration));
  const v = f.ability + 0.12 * (1 - fr) - 0.1 * fr;
  return Math.max(0, Math.min(1, v));
}
