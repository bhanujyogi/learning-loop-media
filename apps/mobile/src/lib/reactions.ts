/** Pure helpers for optimistic like/save/follow state. */
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
