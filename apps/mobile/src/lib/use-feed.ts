import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiError } from './api';
import { feedReducer, initialFeed, type LoadKind } from './feed-state';

/** Small batches keep the feed close to the learner model: answers update it, and the next batch is ranked from it. */
const BATCH = 6;

/**
 * Paged personalised feed. Every batch comes from the server's ranking pipeline (`feed` Edge Function → getFeed): the client
 * never sorts or re-ranks. All state transitions live in feed-state.ts (pure, unit-tested).
 */
export function useFeed() {
  const [state, dispatch] = useReducer(feedReducer, initialFeed);
  const busy = useRef(false);
  const gen = useRef(0);

  const run = useCallback(async (kind: LoadKind) => {
    if (busy.current) return;
    busy.current = true;
    const myGen = gen.current;
    dispatch({ type: 'started', kind, gen: myGen });
    try {
      const r = await api.feed(BATCH);
      dispatch({ type: 'succeeded', kind, gen: myGen, items: r.items });
    } catch (e) {
      dispatch({
        type: 'failed',
        kind,
        gen: myGen,
        error: e instanceof ApiError ? e : new ApiError(500, 'error'),
      });
    } finally {
      if (myGen === gen.current) busy.current = false;
    }
  }, []);

  useEffect(() => {
    void run('first');
  }, [run]);

  return {
    ...state,
    loadMore: useCallback(() => run('more'), [run]),
    refresh: useCallback(() => run('refresh'), [run]),
    retry: useCallback(() => run('first'), [run]),
    /** Start over (e.g. after the learner changes language): clears the list and loads a fresh first batch. */
    reset: useCallback(() => {
      gen.current += 1;
      busy.current = false;
      dispatch({ type: 'reset' });
      void run('first');
    }, [run]),
  };
}
