import { useSyncExternalStore } from 'react';

/** What the learner did THIS app session — a truthful progress strip, derived only from graded server results. */
export interface SessionStats {
  /** most recent first-attempt results, oldest → newest, capped */
  results: boolean[];
  answered: number;
  correct: number;
  xp: number;
}
export const EMPTY_STATS: SessionStats = { results: [], answered: 0, correct: 0, xp: 0 };
export const MAX_DOTS = 10;

export function recordResult(
  s: SessionStats,
  r: { correct: boolean; xpAwarded: number },
): SessionStats {
  return {
    results: [...s.results, r.correct].slice(-MAX_DOTS),
    answered: s.answered + 1,
    correct: s.correct + (r.correct ? 1 : 0),
    xp: s.xp + Math.max(0, r.xpAwarded),
  };
}

let state = EMPTY_STATS;
const listeners = new Set<() => void>();
export const sessionStats = {
  record(r: { correct: boolean; xpAwarded: number }) {
    state = recordResult(state, r);
    listeners.forEach((l) => l());
  },
  reset() {
    state = EMPTY_STATS;
    listeners.forEach((l) => l());
  },
};
export const useSessionStats = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
