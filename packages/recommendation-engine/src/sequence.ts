import type { ScoredCandidate, SequenceRole } from './types';

const ORDER: Record<SequenceRole, number> = {
  introduction: 0, application: 1, prediction: 2, challenge: 3, explanation: 4, review: 5,
};

/**
 * Arrange a selected batch into short learning arcs where roles are known
 * (intro → application → prediction → challenge → explanation → review) while
 * preserving the top-ranked item's primacy and rank order inside each role.
 * Items without a role keep their rank positions. No fake cliffhangers: ordering only.
 */
export function sequenceBatch(batch: ScoredCandidate[]): ScoredCandidate[] {
  if (batch.length <= 2) return batch;
  const ranked = [...batch].sort((a, b) => b.score - a.score);
  const [first, ...rest] = ranked;
  const withRole = rest.filter((s) => s.candidate.role);
  const sortedRoles = [...withRole].sort(
    (a, b) => ORDER[a.candidate.role!] - ORDER[b.candidate.role!] || b.score - a.score,
  );
  let ri = 0;
  const out = rest.map((s) => (s.candidate.role ? sortedRoles[ri++]! : s));
  return [first!, ...out];
}
