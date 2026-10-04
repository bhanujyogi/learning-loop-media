/** Pure feed-windowing logic: which cards may hold heavy resources, and when to prefetch the next batch. */
export const PREFETCH_AHEAD = 3;
/** Only the active card plays video; neighbours may preload; everything else releases its player. */
export const mediaState = (index: number, active: number): 'active' | 'preload' | 'released' =>
  index === active ? 'active' : Math.abs(index - active) === 1 ? 'preload' : 'released';
export const shouldFetchMore = (
  active: number,
  total: number,
  loading: boolean,
  exhausted: boolean,
): boolean => !loading && !exhausted && total - 1 - active <= PREFETCH_AHEAD;
/** Append a batch without duplicates (the server dedupes too; this protects against races/retries). */
export function mergeBatch<T extends { contentId: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((e) => e.contentId));
  return [...existing, ...incoming.filter((i) => !seen.has(i.contentId))];
}
