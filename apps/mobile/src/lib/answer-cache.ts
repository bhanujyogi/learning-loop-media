import type { SubmitAnswerResponse } from './api';

/**
 * In-memory memory of this session's graded answers, so scrolling away from a question and back (the card unmounts to save
 * memory) shows the result instead of an unanswered question. Not persisted; the server remains the only source of truth.
 */
export interface CachedAnswer {
  selected: string[];
  text: string;
  result: SubmitAnswerResponse;
}
const MAX = 100;
const cache = new Map<string, CachedAnswer>();
export const answerCache = {
  get: (id: string) => cache.get(id),
  set(id: string, v: CachedAnswer) {
    cache.delete(id);
    cache.set(id, v);
    if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  },
  clear: () => cache.clear(),
};
