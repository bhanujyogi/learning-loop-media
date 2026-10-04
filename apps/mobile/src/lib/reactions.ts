/** Pure helpers for like/save/follow state. */
export const toggled = <T>(set: ReadonlySet<T>, id: T): Set<T> => {
  const n = new Set(set);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
};
/** Ids we have not yet asked the server about (so each batch triggers one small lookup, not one per card). */
export const unseen = <T>(ids: readonly T[], known: ReadonlySet<T>): T[] => [
  ...new Set(ids.filter((i) => !known.has(i))),
];

export type WriteOutcome = 'ok' | 'already' | 'failed';
/**
 * Interprets the result of a like/save/follow write.
 *  - adding a row that already exists (Postgres unique violation 23505) means the state is ALREADY on (e.g. the initial lookup
 *    failed or another device did it): keep it on, no error, and don't count a second engagement event;
 *  - removing a row that isn't there is simply fine;
 *  - anything else is a real failure → roll back and tell the learner.
 */
export function settleWrite(op: 'add' | 'remove', error: { code?: string } | null): WriteOutcome {
  if (!error) return 'ok';
  if (op === 'add' && error.code === '23505') return 'already';
  return 'failed';
}

/** Applies a server lookup to local state without clobbering rows the learner is toggling right now. */
export function mergeFetched<T>(
  current: ReadonlySet<T>,
  fetched: readonly T[],
  pending: ReadonlySet<T>,
  asked: readonly T[],
): Set<T> {
  const n = new Set(current);
  for (const id of asked) if (!pending.has(id)) n.delete(id); // server is the truth for everything it was asked about…
  for (const id of fetched) if (!pending.has(id)) n.add(id); // …and for the ones that are on
  return n;
}
