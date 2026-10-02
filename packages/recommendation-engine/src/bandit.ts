import type { Affinity } from './types.ts';

/**
 * Bandit-readiness (docs/RECOMMENDATION_ENGINE.md): Thompson sampling over per-arm
 * Beta posteriors derived from Affinity (score,n). Not wired into ranking_v1 — it exists so
 * ranking_v2 can swap exploration scoring without changing data shapes.
 */
export function betaParams(a: Affinity | undefined): { alpha: number; beta: number } {
  const x = a ?? { score: 0.5, n: 0 };
  return { alpha: 1 + x.score * x.n, beta: 1 + (1 - x.score) * x.n };
}

const gaussian = (rng: () => number) => {
  const u = Math.max(rng(), 1e-12),
    v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
// Marsaglia–Tsang gamma sampler (shape >= 1 here since alpha,beta >= 1)
function gamma(shape: number, rng: () => number): number {
  const d = shape - 1 / 3,
    c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v)))
      return d * v;
  }
}
export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = gamma(alpha, rng),
    y = gamma(beta, rng);
  return x / (x + y);
}
export function thompsonPick(
  arms: Record<string, Affinity>,
  keys: string[],
  rng: () => number,
): string {
  let best = keys[0]!,
    bestV = -1;
  for (const k of keys) {
    const { alpha, beta } = betaParams(arms[k]);
    const v = sampleBeta(alpha, beta, rng);
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return best;
}
