import type { ApiError, FeedItem } from './api';
import { mergeBatch, prependBatch } from './feed-window';

export type LoadKind = 'first' | 'more' | 'refresh';
export interface FeedState {
  items: FeedItem[];
  loading: boolean;
  refreshing: boolean;
  paging: boolean;
  exhausted: boolean;
  error: ApiError | null;
  pagingError: ApiError | null;
  upToDate: boolean;
  /** bumped by `reset`; events from an older generation are ignored */
  gen: number;
}
export const initialFeed: FeedState = {
  items: [],
  loading: true,
  refreshing: false,
  paging: false,
  exhausted: false,
  error: null,
  pagingError: null,
  upToDate: false,
  gen: 0,
};

export type FeedEvent =
  | { type: 'started'; kind: LoadKind; gen: number }
  | { type: 'succeeded'; kind: LoadKind; gen: number; items: FeedItem[] }
  | { type: 'failed'; kind: LoadKind; gen: number; error: ApiError }
  | { type: 'reset' };

/**
 * Feed list state. The client only ever APPENDS (scrolling) or PREPENDS (pull-to-refresh) what the server's ranking returned —
 * it never sorts. After `reset` (e.g. the learner changed language) answers to requests made before the reset are dropped,
 * because they were ranked/filtered for the old preferences.
 */
export function feedReducer(s: FeedState, e: FeedEvent): FeedState {
  if (e.type === 'reset') return { ...initialFeed, gen: s.gen + 1 };
  if (e.gen !== s.gen) return s; // stale response from before a reset
  switch (e.type) {
    case 'started':
      return {
        ...s,
        upToDate: false,
        loading: e.kind === 'first' ? true : s.loading,
        paging: e.kind === 'more' ? true : s.paging,
        refreshing: e.kind === 'refresh' ? true : s.refreshing,
        pagingError: e.kind === 'more' ? null : s.pagingError,
        error: e.kind === 'more' ? s.error : null,
      };
    case 'succeeded': {
      const base = { ...s, loading: false, refreshing: false, paging: false, error: null };
      return e.kind === 'refresh'
        ? { ...base, items: prependBatch(s.items, e.items), upToDate: e.items.length === 0 }
        : { ...base, items: mergeBatch(s.items, e.items), exhausted: e.items.length === 0 };
    }
    case 'failed': {
      const base = { ...s, loading: false, refreshing: false, paging: false };
      // A failed background page must not blank a feed the learner is reading.
      return e.kind === 'more' ? { ...base, pagingError: e.error } : { ...base, error: e.error };
    }
  }
}
