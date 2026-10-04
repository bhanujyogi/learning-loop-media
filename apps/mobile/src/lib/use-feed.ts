import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type FeedItem } from './api';
import { mergeBatch, prependBatch } from './feed-window';

/** Small batches keep the feed close to the learner model: answers update it, and the next batch is ranked from it. */
const BATCH = 6;

/**
 * Paged personalised feed. Every batch comes from the server's ranking pipeline (`feed` Edge Function → getFeed): the client
 * never sorts or re-ranks, it only appends (scrolling) or prepends (pull-to-refresh) what the server returns.
 */
export function useFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true); // first load / retry
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [pagingError, setPagingError] = useState<ApiError | null>(null);
  const busy = useRef(false);

  const run = useCallback(async (kind: 'first' | 'more' | 'refresh') => {
    if (busy.current) return;
    busy.current = true;
    if (kind === 'first') setLoading(true);
    if (kind === 'more') setPaging(true);
    if (kind === 'refresh') setRefreshing(true);
    setUpToDate(false);
    try {
      const r = await api.feed(BATCH);
      if (kind === 'refresh') {
        setItems((cur) => prependBatch(cur, r.items));
        setUpToDate(r.items.length === 0);
      } else {
        setItems((cur) => mergeBatch(cur, r.items));
        setExhausted(r.items.length === 0);
      }
      setError(null);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(500, 'error');
      // A failed background page must not blank a feed the learner is reading; surface it only when there is nothing to show.
      if (kind !== 'more') setError(err);
      else setPagingError(err);
    } finally {
      busy.current = false;
      setLoading(false);
      setRefreshing(false);
      setPaging(false);
    }
  }, []);
  useEffect(() => {
    void run('first');
  }, [run]);

  return {
    items,
    loading,
    refreshing,
    paging,
    exhausted,
    error,
    pagingError,
    upToDate,
    loadMore: useCallback(() => {
      setPagingError(null);
      return run('more');
    }, [run]),
    refresh: useCallback(() => run('refresh'), [run]),
    retry: useCallback(() => {
      setError(null);
      return run('first');
    }, [run]),
  };
}
